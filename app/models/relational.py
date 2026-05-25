import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, Float, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

class DbDocument(Base):
    __tablename__ = "documents_relational"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=True)
    status = Column(String, default="pending")
    ocr_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    entities = relationship("DbExtractedEntity", back_populates="document", cascade="all, delete-orphan")

class DbExtractedEntity(Base):
    __tablename__ = "extracted_entities"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id = Column(String, ForeignKey("documents_relational.id", ondelete="CASCADE"), nullable=False)
    entity_type = Column(String, nullable=False)   # e.g., "judges", "lawyers", "ipc_sections", etc.
    entity_value = Column(String, nullable=False)  # The extracted string content
    context_text = Column(Text, nullable=True)     # Surrounding snippet
    confidence_score = Column(Float, default=1.0)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    document = relationship("DbDocument", back_populates="entities")
