import os
import re
from typing import List, Dict, Any
import pandas as pd
# pyrefly: ignore [missing-import]
from langchain_core.documents import Document
# pyrefly: ignore [missing-import]
from langchain_text_splitters import RecursiveCharacterTextSplitter
# pyrefly: ignore [missing-import]
from langchain_core.embeddings import Embeddings
# pyrefly: ignore [missing-import]
from langchain_community.vectorstores import FAISS
from google import genai
from google.genai import types
from app.config import settings
from app.services.gemini_rotator import GeminiKeyRotator


class GeminiEmbeddings(Embeddings):
    def __init__(self):
        self.model = "gemini-embedding-001"
        self.key_rotator = GeminiKeyRotator()

    def _get_client(self):
        return self.key_rotator.get_client()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        embeddings = []
        for i in range(0, len(texts), 100):
            batch_texts = texts[i:i + 100]
            response = self._get_client().models.embed_content(
                model=self.model,
                contents=batch_texts,
                config=types.EmbedContentConfig(output_dimensionality=768)
            )
            if response.embeddings:
                for emb in response.embeddings:
                    if emb.values:
                        embeddings.append(emb.values)
        return embeddings

    def embed_query(self, text: str) -> list[float]:
        response = self._get_client().models.embed_content(
            model=self.model,
            contents=text,
            config=types.EmbedContentConfig(output_dimensionality=768)
        )
        if response.embeddings and len(response.embeddings) > 0:
            if response.embeddings[0].values:
                return response.embeddings[0].values
        return []


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

        if not settings.has_valid_gemini_key:
            raise ValueError("GEMINI_API_KEY is not configured. Please set a valid Gemini key in your environment or .env file.")

        self.embeddings = GeminiEmbeddings()

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

        if not settings.has_valid_gemini_key:
            raise ValueError("GEMINI_API_KEY is not configured. Cannot build FAISS index without Gemini access.")

        df = pd.read_csv(path)
        
        print(f"Parsing {len(df)} rows into LangChain Document formats...")
        documents = [convert_row_to_doc(row) for _, row in df.iterrows()]

        print("Splitting documents using RecursiveCharacterTextSplitter...")
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )
        split_docs = text_splitter.split_documents(documents)
        print(f"Document splitting complete. Generated {len(split_docs)} text chunks.")

        print("Generating embeddings using Gemini text-embedding model and building FAISS vector store...")
        self.embeddings = GeminiEmbeddings()
        self.db = FAISS.from_documents(split_docs, self.embeddings)

        print(f"Saving vector database locally to: {settings.FAISS_INDEX_PATH}")
        self.db.save_local(settings.FAISS_INDEX_PATH)
        self.is_initialized = True
        
        return len(split_docs)

    def retrieve_context(self, query: str, k: int = 4, doc_context: str = None) -> str:
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

        # Extract specific statutes/sections mentioned in the query or the uploaded case context
        combined_scan = query
        if doc_context:
            combined_scan = f"{query} {doc_context}"

        sections_found = self.extract_statutes_from_query(combined_scan)
        exact_statute_context = []
        if sections_found:
            for item in sections_found:
                try:
                    res = self.search_by_statute(section_query=item["section"])
                    if res["total_cases"] > 0:
                        exact_statute_context.append(
                            f"=== EXACT MATCHING CASES & LAWS FOR {item['section']} IN DATASET ==="
                        )
                        for idx, case in enumerate(res["cases"][:3], 1):
                            exact_statute_context.append(
                                f"Dataset Precedent Case {idx}: {case.get('petitioner', 'Unknown')} vs. {case.get('respondent', 'Unknown')}\n"
                                f"Act & Section: {case.get('act_name', 'N/A')} — {case.get('section_no_title', 'N/A')}\n"
                                f"Citation: {case.get('citation', 'N/A')} • Court: {case.get('court_name', 'N/A')}\n"
                                f"Outcome: {case.get('outcome', 'N/A')}\n"
                                f"Judgment Reason: {case.get('judgment_reason', 'N/A')}\n"
                                f"Facts: {case.get('case_facts', 'N/A')[:400]}..."
                            )
                except Exception as e:
                    print(f"Error querying exact statutes in retrieve_context: {e}")

        if exact_statute_context:
            statute_block = "\n\n---\n\n".join(exact_statute_context)
            return statute_block + "\n\n---\n\n" + "\n\n---\n\n".join(context_blocks)

        return "\n\n---\n\n".join(context_blocks)

    def extract_statutes_from_query(self, query: str) -> List[Dict[str, str]]:
        """Parses references to sections (e.g. 'Section 420') or concept keywords (e.g. 'killed') from a user query."""
        ipc_sec_regex = r"(?:Section|Sec|Sec\.)\s*(\d+[A-Z]?)"
        found = []
        seen = set()
        
        # 1. Direct regex matches
        for match in re.finditer(ipc_sec_regex, query, re.IGNORECASE):
            sec_no = match.group(1)
            canon_sec = f"Section {sec_no}"
            if canon_sec.lower() not in seen:
                seen.add(canon_sec.lower())
                found.append({
                    "section": canon_sec,
                    "number": sec_no
                })
                
        # 2. Concept/Keyword mappings
        concept_mappings = {
            r"\b(kill|killed|killing|murder|homicide|death|slay|slain)\b": {"section": "Section 302", "number": "302"},
            r"\b(cheat|cheated|cheating|fraud|deceive|swindle)\b": {"section": "Section 420", "number": "420"},
            r"\b(breach\s+of\s+trust|misappropriate|embezzle|trust\s+breach)\b": {"section": "Section 406", "number": "406"},
            r"\b(theft|steal|stole|rob|robbery|shoplift)\b": {"section": "Section 379", "number": "379"},
            r"\b(quash|quashing)\b": {"section": "Section 482", "number": "482"},
            r"\b(anticipatory\s+bail|apprehend\s+arrest)\b": {"section": "Section 438", "number": "438"},
            r"\b(helmet|bike|motorcycle|two-wheeler)\b": [
                {"section": "Section 129", "number": "129"},
                {"section": "Section 194D", "number": "194D"}
            ],
            r"\b(drive|driving|riding|speeding)\b": {"section": "Section 279", "number": "279"},
            r"\b(accident|negligence)\b": {"section": "Section 304A", "number": "304A"},
            r"\b(fir|report)\b": {"section": "Section 154", "number": "154"},
            r"\b(gst|tax)\b": {"section": "GST Act", "number": "GST"},
            r"\b(online|offensive)\b": {"section": "Section 66A", "number": "66A"}
        }
        
        for pattern, mapping_val in concept_mappings.items():
            if re.search(pattern, query, re.IGNORECASE):
                mappings = [mapping_val] if isinstance(mapping_val, dict) else mapping_val
                for m in mappings:
                    canon_sec = m["section"]
                    if canon_sec.lower() not in seen:
                        seen.add(canon_sec.lower())
                        found.append(m)
                    
        return found

    def search_by_statute(self, act_query: str = None, section_query: str = None, query: str = None) -> Dict[str, Any]:
        """Loads and searches the synthetic Indian legal dataset CSV for cases matching act, section, or general text."""
        path = settings.DATASET_PATH
        if not os.path.exists(path):
            raise FileNotFoundError(f"Indian legal dataset CSV not found at: {path}")

        df = pd.read_csv(path)
        filtered_df = df

        # Filter by Act
        if act_query and act_query.strip():
            filtered_df = filtered_df[filtered_df['act_name'].str.contains(act_query.strip(), case=False, na=False)]

        # Filter by Section
        if section_query and section_query.strip():
            sec_term = section_query.strip()
            # Extract digits if any
            sec_digits = re.sub(r'\D', '', sec_term)
            if sec_digits:
                # Look for section number matching in section_no_title (e.g., Section 420)
                filtered_df = filtered_df[filtered_df['section_no_title'].str.contains(rf'\b{sec_digits}\b', case=False, na=False, regex=True)]
            else:
                filtered_df = filtered_df[filtered_df['section_no_title'].str.contains(sec_term, case=False, na=False)]

        # Filter by full-text search
        if query and query.strip():
            q_term = query.strip()
            content_mask = (
                filtered_df['case_facts'].str.contains(q_term, case=False, na=False) |
                filtered_df['case_summary'].str.contains(q_term, case=False, na=False) |
                filtered_df['legal_text'].str.contains(q_term, case=False, na=False)
            )
            filtered_df = filtered_df[content_mask]

        # Calculate statistics
        total_cases = len(filtered_df)
        outcome_counts = {}
        if 'outcome' in filtered_df.columns:
            outcome_counts = filtered_df['outcome'].fillna('Unknown').value_counts().to_dict()
        
        common_courts = []
        if 'court_name' in filtered_df.columns:
            common_courts = filtered_df['court_name'].fillna('Unknown').value_counts().head(3).index.tolist()
            
        common_judges = []
        if 'judge_name' in filtered_df.columns:
            common_judges = filtered_df['judge_name'].fillna('Unknown').value_counts().head(3).index.tolist()

        # Select matching cases
        cases = []
        for _, row in filtered_df.head(20).iterrows():
            row_dict = {k: ("" if pd.isna(v) else str(v).strip()) for k, v in row.items()}
            cases.append(row_dict)

        return {
            "total_cases": total_cases,
            "outcome_counts": outcome_counts,
            "common_courts": common_courts,
            "common_judges": common_judges,
            "cases": cases
        }

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
