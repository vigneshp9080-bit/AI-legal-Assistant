from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class EntityItem(BaseModel):
    entity_type: str
    entity_value: str
    context_text: Optional[str] = None
    confidence_score: float = 1.0

class RelationshipItem(BaseModel):
    source: str
    target: str
    type: str

class TimelineEvent(BaseModel):
    date: str
    event: str

class EntityExtractionResponse(BaseModel):
    document_id: str
    judges: List[str] = []
    lawyers: List[str] = []
    ipc_sections: List[str] = []
    fir_numbers: List[str] = []
    courts: List[str] = []
    companies: List[str] = []
    organizations: List[str] = []
    persons: List[str] = []
    locations: List[str] = []
    dates: List[str] = []
    case_numbers: List[str] = []
    raw_entities: List[EntityItem] = []
    relationships: List[RelationshipItem] = []
    timeline: List[TimelineEvent] = []

class DocumentAnalysisResponse(BaseModel):
    status: str
    message: str
    document_id: str
    filename: str
    entities: EntityExtractionResponse

class TextExtractionRequest(BaseModel):
    text: str
    filename: Optional[str] = "raw_text_input.txt"
