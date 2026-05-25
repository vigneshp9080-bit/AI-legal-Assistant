from pydantic import BaseModel, Field
from typing import List

class IPCRef(BaseModel):
    section: str = Field(..., description="The section number (e.g., 'Section 302', 'Section 420')")
    title: str = Field(..., description="The brief title of the section (e.g., 'Punishment for murder', 'Cheating')")
    description: str = Field(..., description="A quick summary of what this section penalizes or details")

class LegalQueryRequest(BaseModel):
    query: str = Field(..., description="The legal issue, query or factual scenario to analyze")

class LegalQueryResponse(BaseModel):
    direct_answer: str = Field(..., description="A clear, direct answer summarizing the legal conclusion")
    explanation: str = Field(..., description="A detailed explanation of the legal context and implications in simple, non-legal language")
    ipc_sections: List[IPCRef] = Field(..., description="List of relevant Indian Penal Code (IPC) sections applicable to the query")
    pro_tip: str = Field(..., description="A practical, tactical, or procedural tip for the user (e.g., document preservation, filing timeline)")

class SimilarCasesRequest(BaseModel):
    query: str = Field(..., description="The query to search matching case laws for")
    k: int = Field(3, description="Number of matches to return")

