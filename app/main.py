import os
import shutil
from fastapi import FastAPI, HTTPException, status, UploadFile, File, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.schemas.legal import LegalQueryRequest, LegalQueryResponse, SimilarCasesRequest, DocumentStatusUpdateRequest, StatuteSearchRequest, StatuteSearchResponse
from app.services.gemini_service import GeminiService
from app.services.rag import RAGService
from app.services.ocr import OCRService
from app.schemas.entity import TextExtractionRequest, EntityExtractionResponse, DocumentAnalysisResponse, EntityItem
from app.services.entity_extractor import LegalEntityExtractor
from app.core.mongo import get_db

app = FastAPI(
    title="Indian Legal Assistant API",
    description="A simple, structured FastAPI backend that answers Indian legal queries using Gemini AI, RAG context from FAISS, and OCR using Mistral AI.",
    version="1.2.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Services
gemini_service = GeminiService()
rag_service = RAGService()
ocr_service = OCRService()
entity_extractor = LegalEntityExtractor()

# In-memory document storage fallback when MongoDB is not running or as a cache
IN_MEMORY_DOCUMENTS = {
    "doc-default-ref": {
        "id": "doc-default-ref",
        "filename": "writ_petition_1024_2024.pdf",
        "ocr_text": (
            "IN THE HIGH COURT OF DELHI AT NEW DELHI\n"
            "Writ Petition No. 1024 of 2024\n\n"
            "BEFORE: Hon'ble Mr. Justice Sanjay Kishan\n\n"
            "In the matter of:\n"
            "Apex Global Pvt Ltd ... Petitioner\n"
            "Versus\n"
            "Union of India & Ors. ... Respondents\n\n"
            "Advocate Ramesh Kumar appeared for the Petitioner.\n"
            "Counsel Sneha Gupta appeared for the Respondents.\n\n"
            "JUDGMENT:\n"
            "1. The Petitioner has filed this petition challenging the action of the respondents in connection with FIR No. 445/2023 registered at New Delhi Police Station under Section 406 and Section 420 of the Indian Penal Code (IPC) for alleged breach of contract and cheating."
        ),
        "status": "Under Review",
        "created_at": "2026-05-27T10:00:00Z"
    }
}


@app.get("/")
def read_root():
    rag_status = "uninitialized"
    if os.path.exists(settings.FAISS_INDEX_PATH):
        rag_status = "active (index found on disk)"
    
    return {
        "status": "online",
        "message": "Welcome to the Indian Legal Assistant API",
        "docs_url": "/docs",
        "endpoints": {
            "ask": "/api/ask",
            "upload_document": "/api/upload",
            "build_index": "/api/rag/build"
        },
        "rag_status": rag_status
    }

@app.post(
    "/api/rag/build",
    status_code=status.HTTP_200_OK,
    summary="Build RAG Index from CSV",
    description="Loads the configured CSV dataset of case laws, splits it into text documents, computes Gemini embeddings, and saves a local FAISS index on the server disk."
)
def build_rag_index():
    if not settings.has_valid_gemini_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GEMINI_API_KEY is not configured on the server. Please set a valid Gemini key."
        )

    try:
        rag_service.initialize()
        return {
    "status": "success",
    "message": "FAISS index loaded successfully.",
    "index_path": settings.FAISS_INDEX_PATH
}
    except FileNotFoundError as fnf:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(fnf)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while building the vector index: {str(e)}"
        )

@app.post(
    "/api/upload",
    status_code=status.HTTP_200_OK,
    summary="Upload and index a legal file (with OCR)",
    description="Uploads a PDF case file or image (PNG/JPG). Detects if the PDF is scanned (image-only) and uses Mistral OCR to extract raw text, or extracts text directly if it is a digital PDF. The extracted text is then chunked and embedded in the FAISS vector database."
)
def upload_legal_document(file: UploadFile = File(...)):
    filename = file.filename
    ext = os.path.splitext(filename)[1].lower()
    
    if ext not in [".pdf", ".png", ".jpg", ".jpeg"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Only PDF documents and PNG/JPG/JPEG images are supported."
        )

    # Setup a local temp folder to store file for processing
    temp_dir = "temp_uploads"
    os.makedirs(temp_dir, exist_ok=True)
    temp_file_path = os.path.join(temp_dir, filename)

    try:
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write uploaded file to server disk: {str(e)}"
        )

    extracted_text = ""
    is_scanned = False

    try:
        if ext == ".pdf":
            # Detect if pdf is scanned (image-only)
            is_scanned = ocr_service.is_pdf_scanned(temp_file_path)
            if is_scanned:
                print(f"Scanned PDF detected. Invoking Mistral OCR API...")
                extracted_text = ocr_service.run_mistral_ocr(temp_file_path)
            else:
                print(f"Digital PDF detected. Parsing text layers directly...")
                extracted_text = ocr_service.extract_text_from_pdf(temp_file_path)
        else:
            # Images are scanned documents
            is_scanned = True
            print(f"Image document detected. Invoking Mistral OCR API...")
            extracted_text = ocr_service.run_mistral_ocr(temp_file_path)

    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as ocr_err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process document content: {str(ocr_err)}"
        )
    finally:
        # Clean up local temporary file
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

    if not extracted_text.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The document text content could not be extracted (empty output)."
        )

    # Send extracted text to RAG chunking and indexing pipeline
    try:
        # Verify Gemini key is present before calling embeddings model
        if not settings.has_valid_gemini_key:
            raise ValueError("GEMINI_API_KEY is not configured on the server.")

        total_chunks = rag_service.add_text_to_index(extracted_text, filename)
        return {
            "status": "success",
            "filename": filename,
            "is_scanned": is_scanned,
            "text_length": len(extracted_text),
            "chunks_added": total_chunks,
            "message": f"Successfully extracted text, split into {total_chunks} chunks, and added to FAISS vector database."
        }
    except ValueError as val_err:
         raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to index extracted text: {str(e)}"
        )

@app.post(
    "/api/ask",
    response_model=LegalQueryResponse,
    status_code=status.HTTP_200_OK,
    summary="Ask a legal question (RAG-supported)",
    description="Analyzes the input legal query. If the RAG index is available, retrieves matching court cases from FAISS to pass as context alongside the query to Gemini."
)
def ask_legal_question(request: LegalQueryRequest):
    # Verify Gemini key configuration
    if not settings.has_valid_gemini_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY or GEMINI_API_KEYS in the environment or .env file."
        )

    # 1. Retrieve RAG context if requested (or default to True if no document context is provided)
    use_rag = request.use_rag
    if use_rag is None:
        use_rag = not bool(request.context and request.context.strip())

    rag_context = None
    if use_rag and (settings.GEMINI_API_KEY or settings.GEMINI_API_KEYS):
        try:
            # Check if vector DB is initialized (loads from disk if index exists)
            rag_service.initialize()
            if rag_service.is_initialized:
                rag_context = rag_service.retrieve_context(request.query, doc_context=request.context)
        except Exception as e:
            print(f"RAG Context retrieval skipped: {str(e)}.")

    # 2. Combine document context and RAG context
    context_parts = []
    if request.context and request.context.strip():
        doc_text = request.context.strip()
        if len(doc_text) > 5000:
            doc_text = f"{doc_text[:5000]}\n\n[Truncated case file context]"
        context_parts.append(f"Uploaded Case Document Content:\n{doc_text}")

    if rag_context and rag_context.strip():
        context_parts.append(f"Relevant Indian Case Law Precedents & Governing Acts from Dataset:\n{rag_context}")

    context = "\n\n---\n\n".join(context_parts) if context_parts else None

    # 2. Call Gemini service with query and context
    try:
        response = gemini_service.ask_legal_question(request.query, context=context)
        return response
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during legal query analysis: {str(e)}"
        )

@app.post(
    "/api/similar-cases",
    status_code=status.HTTP_200_OK,
    summary="Query similar court cases from the FAISS database"
)
def get_similar_cases(request: SimilarCasesRequest):
    try:
        cases = rag_service.search_similar_cases(request.query, k=request.k)
        return cases
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while matching similar cases: {str(e)}"
        )

@app.post(
    "/api/extract-entities",
    response_model=EntityExtractionResponse,
    status_code=status.HTTP_200_OK,
    summary="Extract entities from raw legal text",
    description="Analyzes the input text using spaCy and custom extraction logic. Persists the extracted document and entities in MongoDB, then returns the structured legal categories."
)
def extract_entities(request: TextExtractionRequest, db=Depends(get_db)):
    documents = db["documents"] if db is not None else None
    entities = db["entities"] if db is not None else None

    document_id = "doc-default-ref"
    status_str = "Under Review"

    doc_payload = {
        "filename": request.filename,
        "ocr_text": request.text,
        "status": status_str
    }

    if documents is not None:
        try:
            result = documents.insert_one(doc_payload)
            document_id = str(result.inserted_id)
        except Exception as e:
            print(f"MongoDB write error: {e}")
            import uuid
            document_id = f"doc-{uuid.uuid4()}"
    else:
        import uuid
        document_id = f"doc-{uuid.uuid4()}"

    IN_MEMORY_DOCUMENTS[document_id] = {
        "id": document_id,
        "filename": request.filename,
        "ocr_text": request.text,
        "status": status_str
    }

    extracted = entity_extractor.extract(request.text)

    raw_entity_items = []
    entity_docs = []
    for ent in extracted["raw_entities"]:
        entity_docs.append({
            "document_id": document_id,
            "entity_type": ent["entity_type"],
            "entity_value": ent["entity_value"],
            "context_text": ent.get("context_text"),
            "confidence_score": ent.get("confidence_score", 1.0)
        })
        raw_entity_items.append(EntityItem(
            entity_type=ent["entity_type"],
            entity_value=ent["entity_value"],
            context_text=ent.get("context_text"),
            confidence_score=ent.get("confidence_score", 1.0)
        ))

    if entity_docs and entities is not None:
        try:
            entities.insert_many(entity_docs)
        except Exception as e:
            print(f"MongoDB entities write error: {e}")

    return EntityExtractionResponse(
        document_id=document_id,
        judges=extracted["judges"],
        lawyers=extracted["lawyers"],
        ipc_sections=extracted["ipc_sections"],
        fir_numbers=extracted["fir_numbers"],
        courts=extracted["courts"],
        companies=extracted["companies"],
        organizations=extracted["organizations"],
        persons=extracted["persons"],
        locations=extracted["locations"],
        dates=extracted["dates"],
        case_numbers=extracted["case_numbers"],
        raw_entities=raw_entity_items,
        relationships=extracted["relationships"],
        timeline=extracted["timeline"]
    )

@app.post(
    "/api/analyze-document",
    response_model=DocumentAnalysisResponse,
    status_code=status.HTTP_200_OK,
    summary="Upload a file and run full investigation pipeline",
    description="Uploads a legal file (PDF/image), extracts text via OCR or digital parsing, extracts legal entities, saves state to MongoDB, and returns the structured investigation details."
)
def analyze_document(file: UploadFile = File(...), db=Depends(get_db)):
    filename = file.filename
    ext = os.path.splitext(filename)[1].lower()
    
    if ext not in [".pdf", ".png", ".jpg", ".jpeg"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Only PDF documents and PNG/JPG/JPEG images are supported."
        )

    temp_dir = "temp_uploads"
    os.makedirs(temp_dir, exist_ok=True)
    temp_file_path = os.path.join(temp_dir, filename)

    try:
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save temporary file: {str(e)}"
        )

    extracted_text = ""
    try:
        if ext == ".pdf":
            is_scanned = ocr_service.is_pdf_scanned(temp_file_path)
            if is_scanned:
                extracted_text = ocr_service.run_mistral_ocr(temp_file_path)
            else:
                extracted_text = ocr_service.extract_text_from_pdf(temp_file_path)
        else:
            extracted_text = ocr_service.run_mistral_ocr(temp_file_path)
    except Exception as ocr_err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OCR or parsing failed: {str(ocr_err)}"
        )
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

    if not extracted_text.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not extract text content from the uploaded file."
        )

    documents = db["documents"] if db is not None else None
    entities = db["entities"] if db is not None else None

    document_id = "doc-default-ref"
    status_str = "Under Review"

    doc_payload = {
        "filename": filename,
        "ocr_text": extracted_text,
        "status": status_str
    }

    if documents is not None:
        try:
            result = documents.insert_one(doc_payload)
            document_id = str(result.inserted_id)
        except Exception as e:
            print(f"MongoDB write error: {e}")
            import uuid
            document_id = f"doc-{uuid.uuid4()}"
    else:
        import uuid
        document_id = f"doc-{uuid.uuid4()}"

    IN_MEMORY_DOCUMENTS[document_id] = {
        "id": document_id,
        "filename": filename,
        "ocr_text": extracted_text,
        "status": status_str
    }

    extracted = entity_extractor.extract(extracted_text)

    raw_entity_items = []
    entity_docs = []
    for ent in extracted["raw_entities"]:
        entity_docs.append({
            "document_id": document_id,
            "entity_type": ent["entity_type"],
            "entity_value": ent["entity_value"],
            "context_text": ent.get("context_text"),
            "confidence_score": ent.get("confidence_score", 1.0)
        })
        raw_entity_items.append(EntityItem(
            entity_type=ent["entity_type"],
            entity_value=ent["entity_value"],
            context_text=ent.get("context_text"),
            confidence_score=ent.get("confidence_score", 1.0)
        ))

    if entity_docs and entities is not None:
        try:
            entities.insert_many(entity_docs)
        except Exception as e:
            print(f"MongoDB entities write error: {e}")

    if settings.GEMINI_API_KEY or settings.GEMINI_API_KEYS:
        try:
            rag_service.initialize()
            if rag_service.is_initialized:
                rag_service.add_text_to_index(extracted_text, filename)
        except Exception as e:
            print(f"Auto indexing in vector DB failed: {e}")

    extracted_resp = EntityExtractionResponse(
        document_id=document_id,
        judges=extracted["judges"],
        lawyers=extracted["lawyers"],
        ipc_sections=extracted["ipc_sections"],
        fir_numbers=extracted["fir_numbers"],
        courts=extracted["courts"],
        companies=extracted["companies"],
        organizations=extracted["organizations"],
        persons=extracted["persons"],
        locations=extracted["locations"],
        dates=extracted["dates"],
        case_numbers=extracted["case_numbers"],
        raw_entities=raw_entity_items,
        relationships=extracted["relationships"],
        timeline=extracted["timeline"]
    )

    return DocumentAnalysisResponse(
        status="success",
        message="Successfully processed document, ran OCR, extracted legal entities, and populated database.",
        document_id=document_id,
        filename=filename,
        entities=extracted_resp

    )

@app.get("/api/documents", summary="Retrieve all uploaded legal documents")
def get_all_documents(db=Depends(get_db)):
    docs_list = []
    if db is not None:
        try:
            for doc in db["documents"].find():
                doc_id = str(doc["_id"])
                docs_list.append({
                    "id": doc_id,
                    "filename": doc["filename"],
                    "status": doc.get("status", "Under Review"),
                    "ocr_text": doc.get("ocr_text", "")
                })
                IN_MEMORY_DOCUMENTS[doc_id] = {
                    "id": doc_id,
                    "filename": doc["filename"],
                    "status": doc.get("status", "Under Review"),
                    "ocr_text": doc.get("ocr_text", "")
                }
            if docs_list:
                return docs_list
        except Exception as e:
            print(f"Failed to query MongoDB, falling back to memory: {e}")
    return list(IN_MEMORY_DOCUMENTS.values())


@app.get("/api/documents/{doc_id}", summary="Retrieve a single document's text and status")
def get_document_details(doc_id: str, db=Depends(get_db)):
    if doc_id in IN_MEMORY_DOCUMENTS:
        return IN_MEMORY_DOCUMENTS[doc_id]
    if db is not None:
        try:
            from bson import ObjectId
            doc = db["documents"].find_one({"_id": ObjectId(doc_id)})
            if doc:
                return {
                    "id": str(doc["_id"]),
                    "filename": doc["filename"],
                    "status": doc.get("status", "Under Review"),
                    "ocr_text": doc.get("ocr_text", "")
                }
        except Exception as e:
            print(f"MongoDB detail search failed: {e}")
    raise HTTPException(status_code=404, detail="Document not found")


@app.put("/api/documents/{doc_id}/status", summary="Update document status")
def update_document_status(doc_id: str, request: DocumentStatusUpdateRequest, db=Depends(get_db)):
    updated = False
    if doc_id in IN_MEMORY_DOCUMENTS:
        IN_MEMORY_DOCUMENTS[doc_id]["status"] = request.status
        updated = True
    if db is not None:
        try:
            from bson import ObjectId
            result = db["documents"].update_one(
                {"_id": ObjectId(doc_id)},
                {"$set": {"status": request.status}}
            )
            if result.matched_count > 0:
                updated = True
        except Exception as e:
            print(f"MongoDB update failed: {e}")
    if not updated:
        raise HTTPException(status_code=404, detail="Document not found to update status")
    return {"status": "success", "message": f"Document status updated to '{request.status}'."}


@app.post(
    "/api/ask-client",
    response_model=LegalQueryResponse,
    summary="Ask a legal question in simple layman's terms for the client"
)
def ask_client_legal_question(request: LegalQueryRequest):
    if not settings.has_valid_gemini_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GEMINI_API_KEY is not configured on the server."
        )

    # 1. Retrieve RAG context if requested (or default to True if no document context is provided)
    use_rag = request.use_rag
    if use_rag is None:
        use_rag = not bool(request.context and request.context.strip())

    rag_context = None
    if use_rag and (settings.GEMINI_API_KEY or settings.GEMINI_API_KEYS):
        try:
            rag_service.initialize()
            if rag_service.is_initialized:
                rag_context = rag_service.retrieve_context(request.query, doc_context=request.context)
        except Exception as e:
            print(f"RAG retrieval skipped: {e}")

    # 2. Combine document context and RAG context
    context_parts = []
    if request.context and request.context.strip():
        doc_text = request.context.strip()
        if len(doc_text) > 5000:
            doc_text = f"{doc_text[:5000]}\n\n[Truncated case file context]"
        context_parts.append(f"Uploaded Case Document Content:\n{doc_text}")

    if rag_context and rag_context.strip():
        context_parts.append(f"Relevant Indian Case Law Precedents & Governing Acts from Dataset:\n{rag_context}")

    context = "\n\n---\n\n".join(context_parts) if context_parts else None

    try:
        response = gemini_service.ask_legal_question(request.query, context=context, client_mode=True)
        return response
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during legal query analysis: {str(e)}"
        )


@app.post(
    "/api/dataset/statute-search",
    response_model=StatuteSearchResponse,
    status_code=status.HTTP_200_OK,
    summary="Search cases and get statistics for a specific Act/Section in the dataset"
)
def search_dataset_by_statute(request: StatuteSearchRequest):
    try:
        results = rag_service.search_by_statute(
            act_query=request.act,
            section_query=request.section,
            query=request.query
        )
        return results
    except FileNotFoundError as fnf:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(fnf)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during dataset statute search: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)

