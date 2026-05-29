# Indian Legal Assistant - Backend

A modular, structured FastAPI backend that acts as an Indian Legal Assistant. It processes legal questions and returns detailed, structured responses incorporating relevant Indian Penal Code (IPC) sections, simple translations of the law, and actionable pro tips.

This version supports **RAG (Retrieval-Augmented Generation)** using LangChain and a FAISS vector database to retrieve matching cases from the `synthetic_indian_legal_dataset.csv` and inject them as context.

## Tech Stack

* **Language**: Python 3.10+
* **Framework**: FastAPI
* **RAG Framework**: LangChain
* **AI Model**: Google Gemini (via `google-genai`)
* **Embeddings**: Gemini text embeddings (via `google-genai`)
* **Vector DB**: FAISS (via `faiss-cpu`)
* **Database**: MongoDB (via `pymongo`)
* **Validation**: Pydantic (v2)

---

## Folder Structure

```text
d:\PROJECT FILES\AI legal\
├── app/
│   ├── __init__.py
│   ├── main.py           # FastAPI entry point & API endpoints
│   ├── config.py         # Config parsing using Pydantic Settings
│   ├── schemas/          # Data validation schemas (Request/Response)
│   │   ├── __init__.py
│   │   └── legal.py
│   └── services/         # Integrations with external services (Gemini, RAG, OCR)
│       ├── __init__.py
│       ├── gemini_service.py   # Gemini LLM Integration
│       ├── gemini_rotator.py   # Gemini API key rotation
│       └── rag.py        # CSV Loader, Text Splitter, Gemini Embeddings & FAISS
├── .env                  # Environment configurations
├── requirements.txt      # List of dependencies
├── test_app.py           # Unit tests for endpoints and services
└── README.md             # Project documentation
```

---

## Installation & Setup

1. **Create and Activate a Virtual Environment**
   ```bash
   python -m venv .venv
   .venv\Scripts\activate     # On Windows
   # source .venv/bin/activate  # On macOS/Linux
   ```

2. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Environment Variables**
   Open the `.env` file and replace the placeholders with your actual API keys. Ensure the `DATASET_PATH` points to the correct location of your `synthetic_indian_legal_dataset.csv` file:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   MISTRAL_API_KEY=your_mistral_api_key_here
   MONGO_URI=mongodb://localhost:27017
   MONGO_DB_NAME=ai_legal
   DATASET_PATH=C:\Users\Vicky\Downloads\synthetic_indian_legal_dataset.csv
   FAISS_INDEX_PATH=faiss_index
   PORT=8000
   HOST=127.0.0.1
   ```

4. **Build the Vector Database Index (Required for RAG)**
   Before asking questions that utilize search context, build your local FAISS vector index by starting the server and executing the index builder route:
   ```bash
   python -m app.main
   ```
   Then trigger the build using a `POST` request to `http://127.0.0.1:8000/api/rag/build` (via Swagger UI or cURL):
   ```bash
   curl -X POST http://127.0.0.1:8000/api/rag/build
   ```
   *This loads the CSV file, splits the cases into text segments, creates Gemini embeddings, and writes the `faiss_index` folder to disk.*

5. **Run the Server**
   ```bash
   python -m app.main
   ```
   Or run using Uvicorn directly:
   ```bash
   uvicorn app.main:app --reload
   ```

---

## API Endpoints

Navigate to [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) to access the interactive Swagger documentation.

### 1. `POST /api/rag/build`
* **Description**: Builds the local FAISS index from the CSV dataset.
* **Response**:
  ```json
  {
    "status": "success",
    "message": "Successfully parsed and indexed 1450 chunks into FAISS vector database.",
    "index_path": "faiss_index"
  }
  ```

### 2. `POST /api/ask`
* **Description**: Analyze a legal question. If the FAISS index is built and `GEMINI_API_KEY` is configured, it will retrieve matching case laws, construct a context block, and supply it to Gemini.
* **Request Payload**:
  ```json
  {
    "query": "What are the legal consequences under Indian law if someone commits corporate fraud and cheats investors?"
  }
  ```
* **Response Payload (Structured JSON)**:
  ```json
  {
    "direct_answer": "Corporate fraud and cheating investors attract severe penalties under Indian law...",
    "explanation": "If someone deceives investors to gain money or property wrongfully...",
    "ipc_sections": [
      {
        "section": "Section 420",
        "title": "Cheating and dishonestly inducing delivery of property",
        "description": "Deals with cheating that involves dishonestly inducing the person deceived to deliver any property..."
      }
    ],
    "pro_tip": "If you are an investor who has been defrauded, gather all transaction receipts, email communication..."
  }
  ```
