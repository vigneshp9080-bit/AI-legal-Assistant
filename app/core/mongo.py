try:
    import pymongo
    from app.config import settings
    
    MONGO_URI = settings.MONGO_URI if hasattr(settings, 'MONGO_URI') else "mongodb://localhost:27017"
    MONGO_DB_NAME = settings.MONGO_DB_NAME if hasattr(settings, 'MONGO_DB_NAME') else "ai_legal"
    
    client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    
    try:
        client.admin.command("ping")
        print("[OK] Successfully connected to MongoDB.")
        db = client[MONGO_DB_NAME]
        mongo_available = True
    except Exception as e:
        print(f"[WARN] MongoDB connection failed (will skip MongoDB features): {e}")
        db = None
        mongo_available = False
except ImportError:
    print("[WARN] pymongo not installed - MongoDB features disabled")
    db = None
    mongo_available = False


def get_db():
    """FastAPI dependency that yields the MongoDB database object."""
    if db is not None:
        yield db
    else:
        yield None
