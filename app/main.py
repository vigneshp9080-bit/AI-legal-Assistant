import os
import shutil
from fastapi import FastAPI, HTTPException, status, UploadFile, File, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from app.config import settings
from app.schemas.legal import LegalQueryRequest, LegalQueryResponse, SimilarCasesRequest
from app.services.gemini import GeminiService
from app.services.rag import RAGService
from app.services.ocr import OCRService

# Import database and entity extraction models/services
from app.core.database import Base, engine, get_db
from app.models.relational import DbDocument, DbExtractedEntity
from app.schemas.entity import TextExtractionRequest, EntityExtractionResponse, DocumentAnalysisResponse, EntityItem
from app.services.entity_extractor import LegalEntityExtractor

app = FastAPI(
    title="Indian Legal Assistant API",
    description="A simple, structured FastAPI backend that answers Indian legal queries using Gemini 1.5 Flash, RAG context from FAISS, and OCR using Mistral AI.",
    version="1.2.0"
)

# Initialize database tables on startup
Base.metadata.create_all(bind=engine)

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
    description="Loads the configured CSV dataset of case laws, splits it into text documents, computes OpenAI embeddings using text-embedding-3-small, and saves a local FAISS index on the server disk."
)
def build_rag_index():
    if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your_gemini_api_key_here":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GEMINI_API_KEY is not configured on the server. Please set a valid Gemini key."
        )

    try:
        total_chunks = rag_service.build_index_from_csv()
        return {
            "status": "success",
            "message": f"Successfully parsed and indexed {total_chunks} chunks into FAISS vector database.",
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
        # Verify Gemini Key is present before calling embeddings model
        if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your_gemini_api_key_here":
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
    description="Analyzes the input legal query. If the RAG index is available, retrieves matching court cases from FAISS to pass as context alongside the query to Gemini 1.5 Flash."
)
def ask_legal_question(request: LegalQueryRequest):
    # Verify Gemini API key configuration
    if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your_gemini_api_key_here":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Gemini API Key is not configured on the server. Please set GEMINI_API_KEY in the environment or .env file."
        )

    # 1. Attempt to Retrieve RAG Context
    context = None
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here":
        try:
            # Check if vector DB is initialized (loads from disk if index exists)
            rag_service.initialize()
            if rag_service.is_initialized:
                context = rag_service.retrieve_context(request.query)
        except Exception as e:
            # Log/print warning, but don't fail completely if RAG is just uninitialized
            print(f"RAG Context retrieval skipped: {str(e)}. Proceeding with pure LLM response.")

    # 2. Call Gemini Service with query and context
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
    description="Analyzes the input text using spaCy, InLegalBERT, and custom regex patterns. Persists the document and its extracted entities in PostgreSQL, and returns the structured legal categories."
)
def extract_entities(request: TextExtractionRequest, db: Session = Depends(get_db)):
    # 1. Create document record in database
    db_doc = DbDocument(
        filename=request.filename,
        ocr_text=request.text,
        status="extracted"
    )
    db.add(db_doc)
    db.commit()
    db.refresh(db_doc)

    # 2. Run extraction pipeline
    extracted = entity_extractor.extract(request.text)

    # 3. Store entities in DB
    raw_entity_items = []
    for ent in extracted["raw_entities"]:
        db_ent = DbExtractedEntity(
            document_id=db_doc.id,
            entity_type=ent["entity_type"],
            entity_value=ent["entity_value"],
            context_text=ent["context_text"],
            confidence_score=ent["confidence_score"]
        )
        db.add(db_ent)
        
        # Build schema item
        raw_entity_items.append(EntityItem(
            entity_type=ent["entity_type"],
            entity_value=ent["entity_value"],
            context_text=ent["context_text"],
            confidence_score=ent["confidence_score"]
        ))
    db.commit()

    return EntityExtractionResponse(
        document_id=db_doc.id,
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
    description="Uploads a legal file (PDF/image), extracts text via OCR or digital parsing, cleans the content, extracts legal entities, saves all state to PostgreSQL, and returns the structured investigation details."
)
def analyze_document(file: UploadFile = File(...), db: Session = Depends(get_db)):
    filename = file.filename
    ext = os.path.splitext(filename)[1].lower()
    
    if ext not in [".pdf", ".png", ".jpg", ".jpeg"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Only PDF documents and PNG/JPG/JPEG images are supported."
        )

    # Save to temp uploads folder
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

    # 1. Create document record in database
    db_doc = DbDocument(
        filename=filename,
        ocr_text=extracted_text,
        status="analyzed"
    )
    db.add(db_doc)
    db.commit()
    db.refresh(db_doc)

    # 2. Extract entities
    extracted = entity_extractor.extract(extracted_text)

    # 3. Store entities in DB
    raw_entity_items = []
    for ent in extracted["raw_entities"]:
        db_ent = DbExtractedEntity(
            document_id=db_doc.id,
            entity_type=ent["entity_type"],
            entity_value=ent["entity_value"],
            context_text=ent["context_text"],
            confidence_score=ent["confidence_score"]
        )
        db.add(db_ent)
        
        # Build schema item
        raw_entity_items.append(EntityItem(
            entity_type=ent["entity_type"],
            entity_value=ent["entity_value"],
            context_text=ent["context_text"],
            confidence_score=ent["confidence_score"]
        ))
    db.commit()

    # Also automatically add text to RAG index if Gemini Key is available
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here":
        try:
            rag_service.initialize()
            if rag_service.is_initialized:
                rag_service.add_text_to_index(extracted_text, filename)
        except Exception as e:
            print(f"Auto indexing in vector DB failed: {e}")

    extracted_resp = EntityExtractionResponse(
        document_id=db_doc.id,
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
        document_id=db_doc.id,
        filename=filename,
        entities=extracted_resp
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
