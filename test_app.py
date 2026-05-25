import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.schemas.legal import LegalQueryResponse, IPCRef

client = TestClient(app)

class TestLegalAssistant(unittest.TestCase):
    def test_root_endpoint(self):
        response = client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "online")
        self.assertEqual(response.json()["endpoints"]["ask"], "/api/ask")
        self.assertEqual(response.json()["endpoints"]["build_index"], "/api/rag/build")
        self.assertEqual(response.json()["endpoints"]["upload_document"], "/api/upload")

    @patch('app.services.gemini.GeminiService.ask_legal_question')
    def test_ask_endpoint_success(self, mock_ask):
        mock_response = LegalQueryResponse(
            direct_answer="Yes, shoplifting constitutes the offense of theft under Indian Penal Code.",
            explanation="Shoplifting involves taking someone else's movable property without their consent.",
            ipc_sections=[
                IPCRef(
                    section="Section 378",
                    title="Theft",
                    description="Defines theft as moving movable property out of the possession of any person without consent."
                )
            ],
            pro_tip="Always maintain clear transaction receipts and shop security footage as evidence."
        )
        mock_ask.return_value = mock_response

        with patch('app.main.settings.GEMINI_API_KEY', 'fake_key_for_testing'):
            response = client.post("/api/ask", json={"query": "What is shoplifting under Indian law?"})
            
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["direct_answer"], "Yes, shoplifting constitutes the offense of theft under Indian Penal Code.")

    def test_ask_endpoint_missing_api_key(self):
        with patch('app.main.settings.GEMINI_API_KEY', 'your_gemini_api_key_here'):
            response = client.post("/api/ask", json={"query": "What is Section 302?"})
        self.assertEqual(response.status_code, 500)
        self.assertIn("Gemini API Key is not configured", response.json()["detail"])

    def test_build_rag_index_missing_gemini_key(self):
        with patch('app.main.settings.GEMINI_API_KEY', 'your_gemini_api_key_here'):
            response = client.post("/api/rag/build")
        self.assertEqual(response.status_code, 400)
        self.assertIn("GEMINI_API_KEY is not configured", response.json()["detail"])

    @patch('app.services.rag.RAGService.build_index_from_csv')
    def test_build_rag_index_success(self, mock_build):
        mock_build.return_value = 1450
        
        with patch('app.main.settings.GEMINI_API_KEY', 'fake_gemini_key'):
            response = client.post("/api/rag/build")
            
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "success")

    def test_upload_unsupported_file(self):
        # Uploading unsupported text file, should fail with 400
        response = client.post(
            "/api/upload",
            files={"file": ("document.txt", b"plain text data", "text/plain")}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid file type", response.json()["detail"])

    @patch('app.services.ocr.OCRService.is_pdf_scanned')
    @patch('app.services.ocr.OCRService.extract_text_from_pdf')
    @patch('app.services.rag.RAGService.add_text_to_index')
    def test_upload_digital_pdf_success(self, mock_add_index, mock_extract, mock_is_scanned):
        mock_is_scanned.return_value = False
        mock_extract.return_value = "Extracted digital text content about Indian Contract Act."
        mock_add_index.return_value = 1

        with patch('app.main.settings.GEMINI_API_KEY', 'fake_gemini_key'):
            response = client.post(
                "/api/upload",
                files={"file": ("case_report.pdf", b"pdf_binary_content", "application/pdf")}
            )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["filename"], "case_report.pdf")
        self.assertEqual(data["is_scanned"], False)
        self.assertEqual(data["chunks_added"], 1)

    @patch('app.services.ocr.OCRService.is_pdf_scanned')
    @patch('app.services.ocr.OCRService.run_mistral_ocr')
    @patch('app.services.rag.RAGService.add_text_to_index')
    def test_upload_scanned_pdf_success(self, mock_add_index, mock_ocr, mock_is_scanned):
        mock_is_scanned.return_value = True
        mock_ocr.return_value = "Scanned text from Mistral OCR API."
        mock_add_index.return_value = 3

        with patch('app.main.settings.GEMINI_API_KEY', 'fake_gemini_key'):
            response = client.post(
                "/api/upload",
                files={"file": ("scanned_case.pdf", b"pdf_binary_content", "application/pdf")}
            )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["is_scanned"], True)
        self.assertEqual(data["chunks_added"], 3)

    @patch('app.services.ocr.OCRService.run_mistral_ocr')
    @patch('app.services.rag.RAGService.add_text_to_index')
    def test_upload_image_success(self, mock_add_index, mock_ocr):
        mock_ocr.return_value = "OCR text extracted from case photo."
        mock_add_index.return_value = 2

        with patch('app.main.settings.GEMINI_API_KEY', 'fake_gemini_key'):
            response = client.post(
                "/api/upload",
                files={"file": ("case_photo.png", b"image_binary_content", "image/png")}
            )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["is_scanned"], True)
        self.assertEqual(data["chunks_added"], 2)

if __name__ == '__main__':
    unittest.main()
