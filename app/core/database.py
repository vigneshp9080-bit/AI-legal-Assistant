import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Configurable database URI, default to local SQLite file for immediate runnability
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/ai_legal")

try:
    # Attempt to connect to PostgreSQL
    engine = create_engine(DATABASE_URL)
    # Test connection
    with engine.connect() as conn:
        pass
    print("Successfully connected to PostgreSQL database.")
except Exception as e:
    # Fallback to local SQLite database if Postgres is not accessible
    print(f"PostgreSQL connection failed: {e}. Falling back to SQLite local database.")
    DATABASE_URL = "sqlite:///./ai_legal.db"
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    """FastAPI dependency injection to yield database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
