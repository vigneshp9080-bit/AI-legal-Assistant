import os
import re
import spacy
from spacy.pipeline import EntityRuler
from typing import Dict, List, Any, Optional

# Attempt to load PyTorch and HuggingFace Transformers
HAS_TRANSFORMERS = False
try:
    import torch
    from transformers import AutoTokenizer, AutoModel
    HAS_TRANSFORMERS = True
except ImportError:
    pass

class InLegalBERTClassifier:
    """Uses InLegalBERT embeddings to extract contextual features and tag sentences."""
    def __init__(self):
        self.enabled = HAS_TRANSFORMERS
        self.device = "cuda" if (HAS_TRANSFORMERS and torch.cuda.is_available()) else "cpu"
        self.tokenizer = None
        self.model = None

        if self.enabled:
            try:
                print("Loading InLegalBERT tokenizer and model...")
                self.tokenizer = AutoTokenizer.from_pretrained("law-ai/InLegalBERT")
                self.model = AutoModel.from_pretrained("law-ai/InLegalBERT").to(self.device)
                print("InLegalBERT loaded successfully.")
            except Exception as e:
                print(f"Error loading InLegalBERT: {e}. Disabling transformer helper.")
                self.enabled = False

    def get_sentence_embedding(self, sentence: str) -> Optional[List[float]]:
        if not self.enabled or not self.model or not self.tokenizer:
            return None
        try:
            inputs = self.tokenizer(sentence, return_tensors="pt", truncation=True, max_length=512).to(self.device)
            with torch.no_grad():
                outputs = self.model(**inputs)
            # Take CLS token values representing the sentence embedding
            cls_emb = outputs.last_hidden_state[0][0].cpu().tolist()
            return cls_emb
        except Exception as e:
            print(f"Failed to generate embedding: {e}")
            return None

class LegalEntityExtractor:
    """Extracts Indian legal entities using a combination of spaCy, Custom Regex, and Transformer models."""
    def __init__(self):
        # 1. Initialize spaCy pipeline
        self.nlp = self._setup_spacy()
        
        # 2. Initialize InLegalBERT Helper
        self.bert_helper = InLegalBERTClassifier()

    def _setup_spacy(self) -> spacy.language.Language:
        try:
            nlp = spacy.load("en_core_web_sm")
        except OSError:
            print("spaCy model 'en_core_web_sm' not found. Downloading...")
            spacy.cli.download("en_core_web_sm")
            nlp = spacy.load("en_core_web_sm")

        # 3. Add Custom EntityRuler for legal patterns
        ruler = nlp.add_pipe("entity_ruler", before="ner")
        
        patterns = [
            # Courts
            {"label": "COURT", "pattern": [{"LOWER": "supreme"}, {"LOWER": "court"}]},
            {"label": "COURT", "pattern": [{"LOWER": "high"}, {"LOWER": "court"}]},
            {"label": "COURT", "pattern": [{"LOWER": "district"}, {"LOWER": "court"}]},
            {"label": "COURT", "pattern": [{"LOWER": "sessions"}, {"LOWER": "court"}]},
            
            # Legal Roles
            {"label": "ROLE_JUDGE", "pattern": [{"LOWER": "justice"}]},
            {"label": "ROLE_JUDGE", "pattern": [{"LOWER": "hon'ble"}]},
            {"label": "ROLE_JUDGE", "pattern": [{"LOWER": "judge"}]},
            {"label": "ROLE_LAWYER", "pattern": [{"LOWER": "advocate"}]},
            {"label": "ROLE_LAWYER", "pattern": [{"LOWER": "counsel"}]},
            {"label": "ROLE_LAWYER", "pattern": [{"LOWER": "solicitor"}]},
            
            # Statutory References
            {"label": "LAW_BODY", "pattern": [{"LOWER": "indian"}, {"LOWER": "penal"}, {"LOWER": "code"}]},
            {"label": "LAW_BODY", "pattern": [{"LOWER": "ipc"}]},
            {"label": "LAW_BODY", "pattern": [{"LOWER": "crpc"}]},
            {"label": "LAW_BODY", "pattern": [{"LOWER": "cpc"}]},
            {"label": "LAW_BODY", "pattern": [{"LOWER": "constitution"}]}
        ]
        
        ruler.add_patterns(patterns)
        return nlp

    def extract(self, text: str) -> Dict[str, List[Dict[str, Any]]]:
        """Runs the complete extraction pipeline on raw legal text."""
        results = {
            "judges": [],
            "lawyers": [],
            "ipc_sections": [],
            "fir_numbers": [],
            "courts": [],
            "companies": [],
            "organizations": [],
            "persons": [],
            "locations": [],
            "dates": [],
            "case_numbers": [],
            "raw_entities": []
        }

        # Step 1: spaCy NER processing
        doc = self.nlp(text)
        
        # Track duplicate extractions
        seen = set()

        def add_entity(category: str, value: str, context: str, confidence: float):
            clean_val = value.strip().strip(",.").replace("\n", " ")
            if not clean_val or len(clean_val) < 2:
                return
            key = (category, clean_val.lower())
            if key not in seen:
                seen.add(key)
                results[category].append(clean_val)
                results["raw_entities"].append({
                    "entity_type": category,
                    "entity_value": clean_val,
                    "context_text": context,
                    "confidence_score": confidence
                })

        # Step 2: Extract using spaCy NER entities
        for ent in doc.ents:
            context = ent.sent.text.strip().replace("\n", " ") if ent.sent else ""
            
            # Filter and assign standard NER tags
            if ent.label_ == "PERSON":
                # Check context for titles suggesting roles
                prev_tokens = text[max(0, ent.start_char-20):ent.start_char].lower()
                if any(t in prev_tokens for t in ["justice", "judge", "coram", "hon'ble"]):
                    add_entity("judges", ent.text, context, 0.9)
                elif any(t in prev_tokens for t in ["advocate", "counsel", "appearing for"]):
                    add_entity("lawyers", ent.text, context, 0.9)
                else:
                    # Clean title abbreviations
                    name = re.sub(r'^(Mr\.|Mrs\.|Ms\.|Shri|Smt\.)\s*', '', ent.text)
                    add_entity("persons", name, context, 0.8)
            elif ent.label_ == "ORG":
                if "court" in ent.text.lower():
                    add_entity("courts", ent.text, context, 0.9)
                elif any(c in ent.text.lower() for c in ["pvt", "ltd", "corp", "limited", "company"]):
                    add_entity("companies", ent.text, context, 0.85)
                else:
                    add_entity("organizations", ent.text, context, 0.8)
            elif ent.label_ == "GPE" or ent.label_ == "LOC":
                add_entity("locations", ent.text, context, 0.8)
            elif ent.label_ == "DATE":
                add_entity("dates", ent.text, context, 0.85)

        # Step 3: Extract Indian Legal Patterns using custom Regex
        # A. IPC Sections & Statutes
        ipc_sec_regex = r"(?:Section|Sec|Sec\.)\s*(\d+[A-Z]?)\s*(?:of|in|under)?\s*(?:the\s+)?(?:IPC|Indian\s+Penal\s+Code|CrPC|CPC|Contract\s+Act)?"
        for match in re.finditer(ipc_sec_regex, text, re.IGNORECASE):
            section_no = match.group(1)
            full_match = match.group(0)
            start, end = match.span()
            context = text[max(0, start-50):min(len(text), end+50)].strip().replace("\n", " ")
            add_entity("ipc_sections", f"Section {section_no}", context, 0.95)

        # B. FIR Numbers
        fir_regex = r"FIR\s*(?:No\.|Number)?\s*(\d+\s*/\s*\d{4}|\d+\s*of\s*\d{4})"
        for match in re.finditer(fir_regex, text, re.IGNORECASE):
            fir_no = match.group(1)
            start, end = match.span()
            context = text[max(0, start-50):min(len(text), end+50)].strip().replace("\n", " ")
            add_entity("fir_numbers", f"FIR No. {fir_no}", context, 0.98)

        # C. Case Numbers / Petitions
        case_regex = r"(?:W\.P\.|Writ\s+Petition|Crl\.A\.|Criminal\s+Appeal|C\.A\.|Civil\s+Appeal)\s*(?:No\.|Number)?\s*(\d+\s*/\s*\d{4}|\d+\s*of\s*\d{4})"
        for match in re.finditer(case_regex, text, re.IGNORECASE):
            case_no = match.group(0)
            start, end = match.span()
            context = text[max(0, start-50):min(len(text), end+50)].strip().replace("\n", " ")
            add_entity("case_numbers", case_no, context, 0.95)

        # D. Courts (Heuristic check)
        court_regex = r"(?:Supreme\s+Court\s+of\s+India|[\w\s]+\s+High\s+Court|District\s+Court\s+of\s+[\w\s]+|Sessions\s+Court)"
        for match in re.finditer(court_regex, text, re.IGNORECASE):
            court_name = match.group(0)
            start, end = match.span()
            context = text[max(0, start-50):min(len(text), end+50)].strip().replace("\n", " ")
            add_entity("courts", court_name, context, 0.95)

        # Step 4: Extract Relationships and Timeline
        results["relationships"] = []
        results["timeline"] = []

        # Split text into sentences for co-occurrence analysis
        sentences = [s.strip() for s in text.split(".") if s.strip()]

        # Helper lists for matching
        all_lawyers = results["lawyers"]
        all_judges = results["judges"]
        all_courts = results["courts"]
        all_companies = results["companies"]
        all_persons = results["persons"]
        all_fir = results["fir_numbers"]
        all_cases = results["case_numbers"]
        all_sections = results["ipc_sections"]

        # Build litigants list
        litigants = all_companies + all_persons

        # Relation Extraction via proximity
        for sent in sentences:
            sent_lower = sent.lower()
            
            # 1. LAWYER -> LITIGANT (REPRESENTS)
            for lawyer in all_lawyers:
                if lawyer.lower() in sent_lower:
                    for litigant in litigants:
                        if litigant.lower() in sent_lower and lawyer.lower() != litigant.lower():
                            if any(k in sent_lower for k in ["appearing for", "represented by", "counsel for", "advocate for", "appeared for"]):
                                results["relationships"].append({
                                    "source": lawyer,
                                    "target": litigant,
                                    "type": "REPRESENTS"
                                })
            
            # 2. JUDGE -> COURT (PRESIDES_OVER)
            for judge in all_judges:
                if judge.lower() in sent_lower:
                    for court in all_courts:
                        if court.lower() in sent_lower:
                            results["relationships"].append({
                                "source": judge,
                                "target": court,
                                "type": "PRESIDES_OVER"
                            })

            # 3. LITIGANT -> SECTION (ACCUSED_UNDER)
            for litigant in litigants:
                if litigant.lower() in sent_lower:
                    for sec in all_sections:
                        if sec.lower() in sent_lower:
                            if any(k in sent_lower for k in ["accused", "cheating", "breach", "under section", "charged", "violating"]):
                                results["relationships"].append({
                                    "source": litigant,
                                    "target": sec,
                                    "type": "ACCUSED_UNDER"
                                })

            # 4. CASE/FIR -> COURT (FILED_IN)
            for court in all_courts:
                if court.lower() in sent_lower:
                    for fir in all_fir:
                        if fir.lower() in sent_lower:
                            results["relationships"].append({
                                "source": fir,
                                "target": court,
                                "type": "FILED_IN"
                            })
                    for case in all_cases:
                        if case.lower() in sent_lower:
                            results["relationships"].append({
                                "source": case,
                                "target": court,
                                "type": "FILED_IN"
                            })

        # Remove duplicate relationships
        unique_rels = []
        rel_seen = set()
        for r in results["relationships"]:
            rkey = (r["source"], r["target"], r["type"])
            if rkey not in rel_seen:
                rel_seen.add(rkey)
                unique_rels.append(r)
        results["relationships"] = unique_rels

        # C. Timeline Extraction
        date_pattern = r"\b(?:\d{1,2}[-/\s]\d{1,2}[-/\s]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}|\d{4})\b"
        for sent in sentences:
            match = re.search(date_pattern, sent)
            if match:
                date_str = match.group(0)
                event_desc = sent.replace("\n", " ").strip()
                if len(event_desc) > 120:
                    event_desc = event_desc[:117] + "..."
                results["timeline"].append({
                    "date": date_str,
                    "event": event_desc
                })

        # Sort timeline events by date string
        def parse_date_key(t):
            try:
                year_match = re.search(r"\b(19|20)\d{2}\b", t["date"])
                if year_match:
                    return int(year_match.group(0))
            except Exception:
                pass
            return 9999
        
        results["timeline"] = sorted(results["timeline"], key=parse_date_key)

        return results
