from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    GEMINI_API_KEY: str = ""
    GEMINI_API_KEYS: str = ""
    MISTRAL_API_KEY: str = ""
    MONGO_URI: str = "mongodb://localhost:27017"
    MONGO_DB_NAME: str = "ai_legal"
    DATASET_PATH: str = r"C:\Users\Vicky\Downloads\synthetic_indian_legal_dataset.csv"
    FAISS_INDEX_PATH: str = "faiss_index"
    PORT: int = 8000
    HOST: str = "127.0.0.1"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def has_valid_gemini_key(self) -> bool:
        if self.GEMINI_API_KEY and not self.GEMINI_API_KEY.startswith("your_"):
            return True

        if self.GEMINI_API_KEYS:
            keys = [key.strip() for key in self.GEMINI_API_KEYS.split(",") if key.strip()]
            return any(key and not key.startswith("your_") for key in keys)

        return False

settings = Settings()
