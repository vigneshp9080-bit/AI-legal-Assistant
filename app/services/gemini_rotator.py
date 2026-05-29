import random
from typing import List, Dict
from google import genai
from app.config import settings


class GeminiKeyRotator:
    def __init__(self):
        self.keys = self._collect_keys()
        self._clients: Dict[str, genai.Client] = {}

    def _collect_keys(self) -> List[str]:
        keys = []
        if settings.GEMINI_API_KEY and not settings.GEMINI_API_KEY.startswith("your_"):
            keys.append(settings.GEMINI_API_KEY.strip())

        if settings.GEMINI_API_KEYS:
            parsed = [key.strip() for key in settings.GEMINI_API_KEYS.split(",") if key.strip() and not key.strip().startswith("your_")]
            keys.extend(parsed)

        # Remove duplicates while preserving order
        return list(dict.fromkeys(keys))

    def get_api_key(self) -> str:
        if not self.keys:
            self.keys = self._collect_keys()
        if not self.keys:
            raise ValueError(
                "No Gemini API key is configured. Please set GEMINI_API_KEY or GEMINI_API_KEYS."
            )
        return random.choice(self.keys)

    def get_client(self) -> genai.Client:
        key = self.get_api_key()
        return self.get_client_for_key(key)

    def get_client_for_key(self, key: str) -> genai.Client:
        if key not in self._clients:
            self._clients[key] = genai.Client(api_key=key)
        return self._clients[key]
