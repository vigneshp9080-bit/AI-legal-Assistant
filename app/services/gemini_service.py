import json
import re
from typing import Optional
from google import genai
from google.genai import types
from app.config import settings
from app.schemas.legal import LegalQueryResponse
from app.services.gemini_rotator import GeminiKeyRotator


class GeminiService:
    def __init__(self):
        self.model_name = "gemini-2.0-flash"
        self.key_rotator = GeminiKeyRotator()

    def _get_client(self):
        return self.key_rotator.get_client()

    def ask_legal_question(self, query: str, context: Optional[str] = None, client_mode: bool = False) -> LegalQueryResponse:
        if not settings.has_valid_gemini_key:
            raise ValueError(
                "GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY or GEMINI_API_KEYS in the environment or .env file."
            )

        if client_mode:
            system_instruction = (
                "You are a professional, compassionate AI Indian Legal Guide helping a client understand their legal case. "
                "You will receive details from the uploaded active case file as well as governing acts/precedents context from the dataset. "
                "Your primary task is to answer the user's specific question. If the user asks about general acts, laws, or crimes "
                "(such as murder, killing, theft, bail, etc.), you must identify and explain those relevant acts, laws, and punishments "
                "using the dataset context, even if they are completely different from the uploaded case file. "
                "If the user asks about the uploaded case file details, answer based on the uploaded file. "
                "Translate all complex legal procedures and jargon into extremely simple, clear terms that a layman can understand. "
                "Always respond with valid JSON containing: direct_answer, explanation, ipc_sections (list of {section, title, description}), and pro_tip."
            )
        else:
            system_instruction = (
                "You are a professional Indian Legal Assistant and an expert in Indian laws, especially the Indian Penal Code (IPC). "
                "You will receive details from the uploaded active case file context as well as governing acts and precedents from the dataset. "
                "Your primary task is to answer the user's specific question. If the user asks about general acts, laws, or crimes "
                "(such as murder, killing, theft, bail, etc.), you must identify and explain those relevant acts, laws, and punishments "
                "using the dataset context, even if they are completely different from the uploaded case file. "
                "If the user asks about the uploaded case file details, answer based on the uploaded file. "
                "Always respond with valid JSON containing: direct_answer, explanation, ipc_sections (list of {section, title, description}), and pro_tip."
            )

        user_prompt = f"Legal query: {query}"
        if context:
            user_prompt = f"Context: {context}\n\n{user_prompt}"

        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=LegalQueryResponse,
            temperature=0.2,
        )

        # Iterate through all configured API keys to retry on rate limits
        keys = self.key_rotator.keys
        if not keys:
            try:
                keys = self.key_rotator._collect_keys()
            except Exception:
                keys = []

        last_err = None
        for key in keys:
            try:
                client = self.key_rotator.get_client_for_key(key)
                response = client.models.generate_content(
                    model=self.model_name,
                    contents=user_prompt,
                    config=config,
                )
                data = json.loads(response.text)
                return LegalQueryResponse(**data)
            except json.JSONDecodeError as jde:
                print(f"JSON decode failed: {jde}")
                try:
                    return LegalQueryResponse(
                        direct_answer=response.text.strip(),
                        explanation="Response parsed directly from raw Gemini text.",
                        ipc_sections=[],
                        pro_tip="Verify case references with counsel."
                    )
                except Exception:
                    pass
            except Exception as e:
                print(f"Gemini API Key failure ({key[:10]}...): {str(e)}")
                last_err = e
                continue

        # If all keys failed, fallback to local text-mining RAG
        print("All Gemini API keys exhausted. Initiating local RAG fallback...")
        return self._get_fallback_response(query, context, client_mode)

    def _get_fallback_response(self, query: str, context: Optional[str] = None, client_mode: bool = False) -> LegalQueryResponse:
        """Fallback local search engine that answers queries based on uploaded document context when API is offline."""
        query_lower = query.lower()
        ipc_sections = []
        answer = ""
        explanation = ""
        pro_tip = "Maintain all written and digital transaction receipts, correspondence logs, and legal notifications."

        # Mapping of common IPC sections
        sections_db = {
            "Section 406": {"title": "Criminal Breach of Trust", "desc": "Punishment for criminal breach of trust (up to 3 years imprisonment or fine)."},
            "Section 420": {"title": "Cheating and Dishonestly Inducing Delivery", "desc": "Cheating and inducing delivery of property (up to 7 years imprisonment and fine)."},
            "Section 378": {"title": "Theft (IPC)", "desc": "Intending to take movable property out of possession without consent."},
            "Section 379": {"title": "Punishment for Theft (IPC)", "desc": "Imposes up to 3 years imprisonment, or fine, or both for committing theft."},
            "Section 302": {"title": "Murder (IPC)", "desc": "Punishment for murder (death or life imprisonment and fine)."},
            "Section 304A": {"title": "Causing Death by Negligence (IPC)", "desc": "Punishment for causing death by rash or negligent act (up to 2 years imprisonment or fine)."},
            "Section 279": {"title": "Rash Driving (IPC)", "desc": "Driving or riding rashly on public way endangering life (up to 6 months imprisonment or fine)."},
            "Section 129": {"title": "Helmet Requirement (Motor Vehicles Act)", "desc": "Mandates wearing a protective headgear/helmet conforming to standards for two-wheelers."},
            "Section 194D": {"title": "Helmet Violation Penalty (Motor Vehicles Act)", "desc": "Imposes a fine of ₹1,000 and license disqualification for 3 months for riding without a helmet."},
            "Section 154": {"title": "First Information Report / FIR (CrPC)", "desc": "Information in cognizable cases given to a police officer must be recorded in writing."},
            "Section 482": {"title": "CrPC - Quashing Petition", "desc": "Inherent powers of High Court to quash an FIR to prevent abuse of process."},
            "Section 438": {"title": "CrPC - Anticipatory Bail", "desc": "Direction for grant of bail to person apprehending arrest."},
            "GST Act": {"title": "GST Scope of Supply", "desc": "Section 7 of the GST Act defines 'supply', which includes sale, transfer, barter, license, rental, lease or disposal."},
            "Section 66A": {"title": "Offensive Messages (IT Act)", "desc": "Punishment for sending offensive messages through communication services (Struck down by Supreme Court in Shreya Singhal case)."}
        }

        # Concept mapping to check in query
        concept_to_sec = {
            "kill": "Section 302",
            "murder": "Section 302",
            "death": "Section 302",
            "cheat": "Section 420",
            "fraud": "Section 420",
            "breach of trust": "Section 406",
            "theft": "Section 379",
            "steal": "Section 379",
            "stole": "Section 379",
            "quash": "Section 482",
            "bail": "Section 438",
            "helmet": ["Section 129", "Section 194D"],
            "bike": ["Section 129", "Section 194D"],
            "motorcycle": ["Section 129", "Section 194D"],
            "two-wheeler": ["Section 129", "Section 194D"],
            "drive": "Section 279",
            "riding": "Section 279",
            "fir": "Section 154",
            "report": "Section 154",
            "gst": "GST Act",
            "tax": "GST Act",
            "online": "Section 66A",
            "offensive message": "Section 66A",
            "accident": "Section 304A"
        }

        # Find any query concepts
        query_sec_matches = []
        for kw, sec_val in concept_to_sec.items():
            if kw in query_lower:
                secs = [sec_val] if isinstance(sec_val, str) else sec_val
                for sec in secs:
                    if sec not in query_sec_matches:
                        query_sec_matches.append(sec)

        # Direct regex in query
        found_in_query = re.findall(r"Section\s+(\d+[A-Z]?)", query_lower)
        for s_num in found_in_query:
            sec_name = f"Section {s_num}"
            if sec_name in sections_db and sec_name not in query_sec_matches:
                query_sec_matches.append(sec_name)

        concept_answers = []
        for sec in query_sec_matches:
            if sec in sections_db:
                concept_answers.append(
                    f"Under {sec} ({sections_db[sec]['title']}): {sections_db[sec]['desc']}"
                )
                ipc_sections.append({
                    "section": sec,
                    "title": sections_db[sec]["title"],
                    "description": sections_db[sec]["desc"]
                })

        # 1. Local RAG Context Search
        if context and context.strip():
            # Clean up context lines
            lines = [line.strip() for line in context.split("\n") if line.strip()]
            
            # Identify keywords from query
            stop_words = {"what", "is", "the", "and", "a", "for", "in", "of", "to", "on", "with", "about", "describe", "explain", "summarize", "find", "show"}
            words = [w.strip(",.?!\"'") for w in query_lower.split() if w.strip(",.?!\"'") and w not in stop_words and len(w) > 3]
            if not words:
                words = [query_lower]

            # Find matching paragraphs or lines
            matches = []
            for line in lines:
                score = sum(1 for word in words if word in line.lower())
                if score > 0:
                    matches.append((score, line))

            # Sort by score (descending)
            matches.sort(key=lambda x: x[0], reverse=True)

            # Determine response type
            is_summary_request = any(kw in query_lower for kw in ["summary", "summarize", "overview", "explain", "brief"])

            if is_summary_request:
                summary_lines = lines[:6]
                doc_answer = "Here is a factual summary extracted from the uploaded document:\n\n" + "\n".join(summary_lines)
                doc_explanation = "This summary is compiled locally from the primary introductory sections of your uploaded document."
            elif matches:
                top_matches = [m[1] for m in matches[:4]]
                doc_answer = "Based on the uploaded case file, the following relevant details and findings were identified:\n\n" + "\n".join([f"- {line}" for line in top_matches])
                doc_explanation = "These matching facts were extracted locally from the document content using key terms from your query."
            else:
                overview = "\n".join(lines[:4])
                doc_answer = f"Here is the general overview from the uploaded case document:\n\n{overview}"
                doc_explanation = "A general document overview was returned as no specific keyword matches were located in the uploaded text."

            if concept_answers:
                answer = "\n\n".join(concept_answers) + "\n\n---\n\n" + doc_answer
                explanation = "We mapped your concept keywords to the relevant legal acts, and also analyzed the uploaded document context."
            else:
                answer = (
                    f"Your query '{query}' did not match any traffic, penal, or statutory rules in our local database, "
                    f"nor did it match lines in the uploaded document. Here is the general overview of the uploaded case document:\n\n{doc_answer}"
                )
                explanation = "A general document overview was returned as no specific keyword matches were located in the local legal database or the uploaded case text."

            # Extract referenced IPC sections from text
            text_to_scan = f"{query} {context}"
            found_sections = re.findall(r"Section\s+(\d+[A-Z]?)", text_to_scan, re.IGNORECASE)
            for s_num in set(found_sections):
                s = f"Section {s_num}"
                if s not in query_sec_matches:
                    if s in sections_db:
                        ipc_sections.append({
                            "section": s,
                            "title": sections_db[s]["title"],
                            "description": sections_db[s]["desc"]
                        })
                    else:
                        ipc_sections.append({
                            "section": s,
                            "title": "Statutory Provision",
                            "description": f"Section reference identified in the active case workspace."
                        })
        else:
            # 2. General Knowledge Base Fallback
            if concept_answers:
                answer = "\n\n".join(concept_answers)
                explanation = "Response compiled from the local legal knowledge base matching concept keywords."
            else:
                answer = "This is a local AI research response. To get contextual document insights, please upload a case file in the left document workspace. For legal advice, consult an advocate."
                explanation = "General local workspace fallback response."

        return LegalQueryResponse(
            direct_answer=answer,
            explanation=explanation,
            ipc_sections=ipc_sections,
            pro_tip=pro_tip
        )
