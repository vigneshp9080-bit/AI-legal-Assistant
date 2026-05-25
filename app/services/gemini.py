from google import genai
# pyrefly: ignore [missing-import]
from google.genai import types
from app.config import settings
from app.schemas.legal import LegalQueryResponse
import json

class GeminiService:
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY
        self.client = None
        if self.api_key and self.api_key != "your_gemini_api_key_here":
            self.client = genai.Client(api_key=self.api_key)
        self.model_name = "gemini-2.5-flash"

    def _get_client(self) -> genai.Client:
        # Re-initialize client if API key was updated dynamically since startup
        if settings.GEMINI_API_KEY != self.api_key:
            self.api_key = settings.GEMINI_API_KEY
            if self.api_key and self.api_key != "your_gemini_api_key_here":
                self.client = genai.Client(api_key=self.api_key)
            else:
                self.client = None

        if not self.client:
            raise ValueError("GEMINI_API_KEY is not configured or holds a placeholder value. Please set a valid API key.")
        return self.client

    def ask_legal_question(self, query: str, context: str = None) -> LegalQueryResponse:
        client = self._get_client()

        # Setup system instructions for the LLM
        system_instruction = (
            "You are a professional Indian Legal Assistant and an expert in Indian laws, including the Indian Penal Code (IPC).\n"
            "Your task is to analyze the user's legal question or scenario.\n"
            "If relevant case law context from a database is provided, you must prioritize and incorporate findings, details, "
            "and citations from that context to generate your response.\n\n"
            "Provide a structured response that strictly conforms to the requested JSON schema. The response must include:\n"
            "- direct_answer: A clear and concise legal response or conclusion.\n"
            "- explanation: A simple, step-by-step breakdown of the law and legal concepts without dense legalese, making it easy for a layperson to understand.\n"
            "- ipc_sections: A list of relevant sections from the Indian Penal Code (IPC) that apply to the query, providing the section, its brief title, and description.\n"
            "- pro_tip: Actionable, tactical, or procedural advice for the user's next steps (e.g. documentation, evidence preservation, or timelines).\n"
            "Keep the response factual and specific to Indian Penal Code (IPC) or general Indian legal standards."
        )

        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=LegalQueryResponse,
            temperature=0.2, # Lower temperature for more factual and grounded legal reasoning
        )

        # Build prompt using retrieved context if available
        prompt_content = f"Legal query to analyze: {query}"
        if context:
            prompt_content = (
                f"Context from Indian Case Law Database:\n"
                f"{context}\n"
                f"==================================================\n"
                f"Legal query to analyze: {query}"
            )

        try:
            response = client.models.generate_content(
                model=self.model_name,
                contents=prompt_content,
                config=config,
            )
            
            # The response.text is structured as a JSON string matching LegalQueryResponse
            data = json.loads(response.text)
            return LegalQueryResponse(**data)
        except Exception as e:
            # Handle API and JSON parsing errors gracefully
            raise RuntimeError(f"Failed to generate structured response from Gemini API: {str(e)}")
