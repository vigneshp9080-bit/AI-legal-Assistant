from pydantic import BaseModel, Field
from typing import List, Optional

class IPCRef(BaseModel):
    section: str = Field(..., description="The section number (e.g., 'Section 302', 'Section 420')")
    title: str = Field(..., description="The brief title of the section (e.g., 'Punishment for murder', 'Cheating')")
    description: str = Field(..., description="A quick summary of what this section penalizes or details")

class LegalQueryRequest(BaseModel):
    query: str = Field(..., description="The legal issue, query or factual scenario to analyze")
    context: Optional[str] = Field(None, description="Optional case text or legal context to ground the answer")
    use_rag: Optional[bool] = Field(None, description="Whether to also retrieve and use context from the RAG database")

class LegalQueryResponse(BaseModel):
    direct_answer: str = Field(..., description="A clear, direct answer summarizing the legal conclusion")
    explanation: str = Field(..., description="A detailed explanation of the legal context and implications in simple, non-legal language")
    ipc_sections: List[IPCRef] = Field(..., description="List of relevant Indian Penal Code (IPC) sections applicable to the query")
    pro_tip: str = Field(..., description="A practical, tactical, or procedural tip for the user (e.g., document preservation, filing timeline)")

class SimilarCasesRequest(BaseModel):
    query: str = Field(..., description="The query to search matching case laws for")
    k: int = Field(3, description="Number of matches to return")


class DocumentStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="The new status of the document")


class StatuteSearchRequest(BaseModel):
    act: Optional[str] = Field(None, description="The governing act name to filter by")
    section: Optional[str] = Field(None, description="The specific section number or text")
    query: Optional[str] = Field(None, description="Optional search term to filter case details")


class StatuteSearchResponse(BaseModel):
    total_cases: int = Field(..., description="Total count of matching cases")
    outcome_counts: dict = Field(..., description="Counts of outcomes")
    common_courts: List[str] = Field(..., description="Top courts")
    common_judges: List[str] = Field(..., description="Top judges")
    cases: List[dict] = Field(..., description="List of matching cases")


