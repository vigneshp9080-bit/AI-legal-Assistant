import os
from typing import List, Dict, Any
import pandas as pd
# pyrefly: ignore [missing-import]
from langchain_core.documents import Document
# pyrefly: ignore [missing-import]
from langchain_text_splitters import RecursiveCharacterTextSplitter
# pyrefly: ignore [missing-import]
from langchain_core.embeddings import Embeddings
from google import genai
# pyrefly: ignore [missing-import]
from google.genai import types
# pyrefly: ignore [missing-import]
from langchain_community.vectorstores import FAISS
from app.config import settings

class GeminiEmbeddings(Embeddings):
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.model = "gemini-embedding-2"

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        embeddings = []
        for i in range(0, len(texts), 100):
            batch_texts = texts[i:i+100]
            contents = [
                types.Content(parts=[types.Part.from_text(text=text)])
                for text in batch_texts
            ]
            result = self.client.models.embed_content(
                model=self.model,
                contents=contents
            )
            for emb in result.embeddings:
                embeddings.append(emb.values)
        return embeddings

    def embed_query(self, text: str) -> list[float]:
        result = self.client.models.embed_content(
            model=self.model,
            contents=text
        )
        return result.embeddings[0].values

def convert_row_to_doc(row) -> Document:
    # Handle potentially empty values in rows
    row_dict = {k: ("" if pd.isna(v) else str(v).strip()) for k, v in row.items()}
    
    petitioner = row_dict.get('petitioner', 'Unknown')
    respondent = row_dict.get('respondent', 'Unknown')
    case_title = f"{petitioner} vs. {respondent}"
    
    # Structure the page content for optimal RAG semantic matching
    page_content = (
        f"Case Title: {case_title}\n"
        f"Case ID: {row_dict.get('case_id', 'N/A')}\n"
        f"Citation: {row_dict.get('citation', 'N/A')}\n"
        f"Court: {row_dict.get('court_name', 'N/A')}\n"
        f"State Location: {row_dict.get('state', 'N/A')}\n"
        f"Presiding Judge: {row_dict.get('judge_name', 'N/A')}\n"
        f"Advocate: {row_dict.get('advocate_name', 'N/A')}\n"
        f"Filing Date: {row_dict.get('filing_date', 'N/A')}\n"
        f"Judgment Date: {row_dict.get('judgment_date', 'N/A')}\n"
        f"Governing Act: {row_dict.get('act_name', 'N/A')}\n"
        f"Relevant Legal Section: {row_dict.get('section_no_title', 'N/A')}\n"
        f"Originating Forum/Station: {row_dict.get('police_station_or_forum', 'N/A')}\n"
        f"Case Outcome: {row_dict.get('outcome', 'N/A')}\n"
        f"Outcome Reason: {row_dict.get('judgment_reason', 'N/A')}\n"
        f"Case Summary: {row_dict.get('case_summary', 'N/A')}\n\n"
        f"Case Facts Detail:\n{row_dict.get('case_facts', '')}"
    )
    
    metadata = {
        "case_id": row_dict.get('case_id', ''),
        "citation": row_dict.get('citation', ''),
        "court": row_dict.get('court_name', ''),
        "judge": row_dict.get('judge_name', ''),
        "lawyer": row_dict.get('advocate_name', ''),
        "outcome": row_dict.get('outcome', ''),
        "act": row_dict.get('act_name', ''),
        "section": row_dict.get('section_no_title', ''),
        "state": row_dict.get('state', ''),
    }
    
    return Document(page_content=page_content, metadata=metadata)

class RAGService:
    def __init__(self):
        self.embeddings = None
        self.db = None
        self.is_initialized = False

    def initialize(self):
        if self.is_initialized:
            return

        if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your_gemini_api_key_here":
            raise ValueError("GEMINI_API_KEY is not configured. Please set a valid Gemini key in your environment or .env file.")

        self.embeddings = GeminiEmbeddings(api_key=settings.GEMINI_API_KEY)

        # Check if local FAISS index exists on disk
        if os.path.exists(settings.FAISS_INDEX_PATH):
            print(f"Loading local FAISS index from directory: {settings.FAISS_INDEX_PATH}")
            self.db = FAISS.load_local(
                settings.FAISS_INDEX_PATH,
                self.embeddings,
                allow_dangerous_deserialization=True
            )
            self.is_initialized = True
        else:
            print("FAISS local index not found. RAG queries will fail until index is built via build_index_from_csv().")

    def build_index_from_csv(self, csv_path: str = None) -> int:
        """Loads the CSV file, splits into text documents, runs embeddings, and creates the FAISS index."""
        path = csv_path or settings.DATASET_PATH
        if not os.path.exists(path):
            raise FileNotFoundError(f"Indian legal dataset CSV not found at: {path}")

        if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your_gemini_api_key_here":
            raise ValueError("GEMINI_API_KEY is not configured. Cannot build FAISS index without Gemini API access.")

        df = pd.read_csv(path)
        # Limit to first 50 rows to avoid API rate limits during development
        df = df.head(50)
        
        print(f"Parsing {len(df)} rows into LangChain Document formats...")
        documents = [convert_row_to_doc(row) for _, row in df.iterrows()]

        print("Splitting documents using RecursiveCharacterTextSplitter...")
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )
        split_docs = text_splitter.split_documents(documents)
        print(f"Document splitting complete. Generated {len(split_docs)} text chunks.")

        print("Generating embeddings using gemini-embedding-2 and building FAISS vector store...")
        self.embeddings = GeminiEmbeddings(api_key=settings.GEMINI_API_KEY)
        self.db = FAISS.from_documents(split_docs, self.embeddings)

        print(f"Saving vector database locally to: {settings.FAISS_INDEX_PATH}")
        self.db.save_local(settings.FAISS_INDEX_PATH)
        self.is_initialized = True
        
        return len(split_docs)

    def retrieve_context(self, query: str, k: int = 4) -> str:
        """Performs similarity search on the FAISS index and builds contextual prompt block."""
        if not self.is_initialized:
            self.initialize()

        if not self.db:
            raise RuntimeError(
                "RAG database is uninitialized. The local index folder is missing. "
                "Please call the index build operation first."
            )

        print(f"Retrieving top {k} matching document chunks for query: '{query}'")
        docs = self.db.similarity_search(query, k=k)

        context_blocks = []
        for i, doc in enumerate(docs, 1):
            source = doc.metadata.get("citation") or doc.metadata.get("case_id") or "Unknown Source"
            block = f"[Reference Case {i}: {source}]\n{doc.page_content}"
            context_blocks.append(block)

        return "\n\n---\n\n".join(context_blocks)

    def add_text_to_index(self, text: str, source_name: str) -> int:
        """Splits raw text, converts to Documents, adds them to the active FAISS index, and saves it to disk."""
        if not self.is_initialized:
            self.initialize()

        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )
        chunks = text_splitter.split_text(text)
        
        split_docs = []
        for i, chunk in enumerate(chunks):
            doc = Document(
                page_content=chunk,
                metadata={
                    "source": source_name,
                    "case_id": f"Uploaded_{source_name}",
                    "chunk_id": str(i)
                }
            )
            split_docs.append(doc)

        if not self.db:
            print("Vector store does not exist. Initializing a new FAISS index for uploaded text...")
            self.db = FAISS.from_documents(split_docs, self.embeddings)
        else:
            print(f"Adding {len(split_docs)} documents to existing FAISS index...")
            self.db.add_documents(split_docs)

        # Save updated index back to disk
        print(f"Saving updated FAISS index to: {settings.FAISS_INDEX_PATH}")
        self.db.save_local(settings.FAISS_INDEX_PATH)
        self.is_initialized = True

        return len(split_docs)

    def search_similar_cases(self, query: str, k: int = 3) -> List[Dict[str, Any]]:
        """Returns a list of structured dictionary objects for similar cases."""
        if not self.is_initialized:
            try:
                self.initialize()
            except Exception:
                return []
        if not self.db:
            return []
        
        docs = self.db.similarity_search(query, k=k)
        results = []
        for doc in docs:
            lines = doc.page_content.split("\n")
            title = "Case Law Match"
            citation = "N/A"
            court = "N/A"
            summary = ""
            for line in lines:
                if line.startswith("Case Title:"):
                    title = line.replace("Case Title:", "").strip()
                elif line.startswith("Citation:"):
                    citation = line.replace("Citation:", "").strip()
                elif line.startswith("Court:"):
                    court = line.replace("Court:", "").strip()
                elif line.startswith("Case Summary:"):
                    summary = line.replace("Case Summary:", "").strip()

            if not summary and len(doc.page_content) > 100:
                summary = doc.page_content[:150] + "..."
            
            results.append({
                "title": title,
                "citation": citation,
                "court": court,
                "summary": summary,
                "raw_text": doc.page_content,
                "metadata": doc.metadata
            })
        return results
