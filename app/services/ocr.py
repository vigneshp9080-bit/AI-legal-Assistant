import os
# pyrefly: ignore [missing-import]
import pypdf
# pyrefly: ignore [missing-import]
from mistralai.client import Mistral
# pyrefly: ignore [missing-import]
from mistralai.client.models import DocumentURLChunk
from app.config import settings

class OCRService:
    def __init__(self):
        self.api_key = settings.MISTRAL_API_KEY
        self.client = None
        if self.api_key and self.api_key != "your_mistral_api_key_here":
            self.client = Mistral(api_key=self.api_key)

    def _get_client(self) -> Mistral:
        # Re-check/initialize client if API key changed dynamically
        if settings.MISTRAL_API_KEY != self.api_key:
            self.api_key = settings.MISTRAL_API_KEY
            if self.api_key and self.api_key != "your_mistral_api_key_here":
                self.client = Mistral(api_key=self.api_key)
            else:
                self.client = None

        if not self.client:
            raise ValueError("MISTRAL_API_KEY is not configured or holds a placeholder value. Please set a valid API key.")
        return self.client

    def is_pdf_scanned(self, file_path: str) -> bool:
        """Checks if a PDF has selectable digital text. Returns True if scanned/image-only, False if digital."""
        try:
            reader = pypdf.PdfReader(file_path)
            total_text = ""
            # Check up to first 5 pages for text content
            for i in range(min(5, len(reader.pages))):
                page_text = reader.pages[i].extract_text() or ""
                total_text += page_text

            # If average text length per page is extremely low, it's a scanned document
            return len(total_text.strip()) < 50
        except Exception as e:
            print(f"Error analyzing PDF content: {str(e)}. Defaulting to scanned mode.")
            return True

    def extract_text_from_pdf(self, file_path: str) -> str:
        """Extracts native text from a digital PDF."""
        try:
            reader = pypdf.PdfReader(file_path)
            full_text = ""
            for page in reader.pages:
                full_text += (page.extract_text() or "") + "\n"
            return full_text.strip()
        except Exception as e:
            raise RuntimeError(f"Failed to extract native text from digital PDF: {str(e)}")

    def run_mistral_ocr(self, file_path: str) -> str:
        """Uploads a local file to Mistral, runs Mistral OCR, and returns the parsed markdown text."""
        client = self._get_client()
        filename = os.path.basename(file_path)

        print(f"Uploading file for Mistral OCR: {filename}")
        with open(file_path, "rb") as f:
            uploaded_file = client.files.upload(
                file={"file_name": filename, "content": f.read()},
                purpose="ocr"
            )

        try:
            print(f"Generating temporary signed URL for file ID: {uploaded_file.id}")
            signed_url = client.files.get_signed_url(file_id=uploaded_file.id)

            print(f"Triggering Mistral OCR processing (mistral-ocr-latest) on file...")
            ocr_response = client.ocr.process(
                model="mistral-ocr-latest",
                document=DocumentURLChunk(document_url=signed_url.url)
            )

            # Accumulate the pages content
            markdown_content = []
            for page in ocr_response.pages:
                markdown_content.append(page.markdown or "")
            
            return "\n\n".join(markdown_content).strip()

        finally:
            # Always delete the temporary file from Mistral storage
            try:
                print(f"Deleting temporary file on Mistral server: {uploaded_file.id}")
                client.files.delete(file_id=uploaded_file.id)
            except Exception as del_err:
                print(f"Warning: Failed to clean up file {uploaded_file.id} on Mistral storage: {str(del_err)}")
