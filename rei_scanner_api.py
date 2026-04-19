from __future__ import annotations

import json
import re
import threading
import zipfile
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel
from transformers import DistilBertForSequenceClassification, DistilBertTokenizerFast

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "rei_model"
REPUTATION_DB_PATH = BASE_DIR / "reputation_db.json"
DETECTION_LOG_PATH = BASE_DIR / "detection_log.json"
MAX_DETECTION_LOG_ENTRIES = 200

SUSPICIOUS_KEYWORDS = [
    "otp",
    "verify",
    "login",
    "urgent",
    "account",
    "update",
    "bank",
    "secure",
    "suspend",
]
SUSPICIOUS_DOMAIN_WORDS = ["login", "secure", "verify", "update"]
URL_ENDPOINT_DOMAIN_WORDS = ["login", "secure", "verify", "update", "account"]

URL_REGEX = re.compile(
    r"((?:https?://|www\.)[^\s<>()]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:/[^\s<>()]*)?)"
)
EMAIL_REGEX = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
PHONE_REGEX = re.compile(r"\+?\d[\d\-\s]{6,}\d")
DOMAIN_REGEX = re.compile(r"(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}")

JSON_LOCK = threading.Lock()
MODEL_LOCK = threading.Lock()
TOKENIZER: Optional[DistilBertTokenizerFast] = None
MODEL: Optional[DistilBertForSequenceClassification] = None
SCAM_CLASS_INDEX = 1

app = FastAPI(title="R.E.I. Scanner API")


class AnalyzeTextRequest(BaseModel):
    text: str
    sender: Optional[str] = None
    platform: Optional[str] = None


class AnalyzeUrlRequest(BaseModel):
    url: str


def _safe_read_json(path: Path, default_value: Any) -> Any:
    if not path.exists():
        return default_value
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (json.JSONDecodeError, OSError, ValueError, TypeError):
        return default_value


def _safe_write_json(path: Path, data: Any) -> None:
    temp_path = path.with_name(f"{path.name}.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    temp_path.replace(path)


def _clamp_score(score: float) -> float:
    return max(0.0, min(1.0, score))


def _risk_level(score: float) -> str:
    if score >= 0.75:
        return "HIGH"
    if score >= 0.40:
        return "MEDIUM"
    return "LOW"


def _extract_domain(value: str) -> str:
    candidate = value.strip().lower()
    if not candidate:
        return ""
    if "://" not in candidate:
        candidate = f"http://{candidate}"
    parsed = urlparse(candidate)
    domain = parsed.netloc or parsed.path.split("/")[0]
    if "@" in domain:
        domain = domain.split("@", 1)[1]
    if ":" in domain:
        domain = domain.split(":", 1)[0]
    if domain.startswith("www."):
        domain = domain[4:]
    return domain.strip(".")


def _contains_domain_words(domain: str, keywords: list[str]) -> list[str]:
    return [word for word in keywords if word in domain]


def _pick_sender_id(sender: Optional[str], text: str, urls: list[str]) -> Optional[str]:
    if sender:
        sender_lower = sender.lower()
        email_match = EMAIL_REGEX.search(sender_lower)
        if email_match:
            return email_match.group(0)
        phone_match = PHONE_REGEX.search(sender_lower)
        if phone_match:
            return re.sub(r"\s+", "", phone_match.group(0))
        domain_match = DOMAIN_REGEX.search(sender_lower)
        if domain_match:
            return domain_match.group(0).lower()
        parsed_sender = parseaddr(sender)[1]
        if parsed_sender:
            return parsed_sender.lower()

    for url in urls:
        domain = _extract_domain(url)
        if domain:
            return domain

    text_email = EMAIL_REGEX.search(text.lower())
    if text_email:
        return text_email.group(0)
    return None


def load_model() -> tuple[DistilBertTokenizerFast, DistilBertForSequenceClassification]:
    global TOKENIZER, MODEL, SCAM_CLASS_INDEX

    if TOKENIZER is not None and MODEL is not None:
        return TOKENIZER, MODEL

    with MODEL_LOCK:
        if TOKENIZER is not None and MODEL is not None:
            return TOKENIZER, MODEL
        if not MODEL_DIR.exists():
            raise RuntimeError(f"Model directory not found: {MODEL_DIR}")

        TOKENIZER = DistilBertTokenizerFast.from_pretrained(str(MODEL_DIR))
        MODEL = DistilBertForSequenceClassification.from_pretrained(str(MODEL_DIR))
        MODEL.eval()

        id2label = getattr(MODEL.config, "id2label", {}) or {}
        for idx, label in id2label.items():
            if isinstance(label, str) and "scam" in label.lower():
                SCAM_CLASS_INDEX = int(idx)
                break
        else:
            SCAM_CLASS_INDEX = 1 if getattr(MODEL.config, "num_labels", 2) > 1 else 0

    return TOKENIZER, MODEL


def predict_text(text: str) -> float:
    tokenizer, model = load_model()

    encoded = tokenizer(
        text,
        truncation=True,
        padding=True,
        max_length=512,
        return_tensors="pt",
    )
    with torch.no_grad():
        logits = model(**encoded).logits
        probs = torch.softmax(logits, dim=-1)[0]
    return float(probs[SCAM_CLASS_INDEX].item())


def extract_urls(text: str) -> list[str]:
    found: list[str] = []
    for match in URL_REGEX.findall(text):
        cleaned = match.strip(".,;:!?()[]{}\"'")
        if cleaned and cleaned not in found:
            found.append(cleaned)
    return found


def calculate_keyword_score(text: str) -> tuple[float, list[str]]:
    score = 0.0
    explanations: list[str] = []
    lowered = text.lower()
    for keyword in SUSPICIOUS_KEYWORDS:
        if re.search(rf"\b{re.escape(keyword)}\b", lowered):
            score += 0.03
            explanations.append(f"Suspicious keyword detected: {keyword}")
    return score, explanations


def calculate_reputation_boost(sender_id: Optional[str], reputation_db: Optional[dict[str, Any]] = None) -> float:
    if not sender_id:
        return 0.0

    db = reputation_db
    if db is None:
        with JSON_LOCK:
            loaded = _safe_read_json(REPUTATION_DB_PATH, {})
        db = loaded if isinstance(loaded, dict) else {}

    entry = db.get(sender_id, {})
    count = int(entry.get("count", 0))
    current_detection_count = count + 1
    if current_detection_count == 1:
        return 0.0
    if current_detection_count == 2:
        return 0.10
    if current_detection_count == 3:
        return 0.25
    return 0.40


def update_reputation(sender_id: Optional[str]) -> float:
    if not sender_id:
        return 0.0

    with JSON_LOCK:
        raw_db = _safe_read_json(REPUTATION_DB_PATH, {})
        db = raw_db if isinstance(raw_db, dict) else {}
        existing_entry = db.get(sender_id, {})
        new_count = int(existing_entry.get("count", 0)) + 1
        boost = calculate_reputation_boost(sender_id, db)
        db[sender_id] = {"count": new_count, "risk_boost": boost}
        _safe_write_json(REPUTATION_DB_PATH, db)
    return boost


def log_detection(
    text: str,
    sender: Optional[str],
    platform: Optional[str],
    risk_score: float,
    risk_level: str,
    explanations: list[str],
) -> None:
    log_entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "text": text,
        "sender": sender or "",
        "platform": platform or "",
        "risk_score": round(risk_score, 4),
        "risk_level": risk_level,
        "explanations": explanations,
    }
    with JSON_LOCK:
        raw_logs = _safe_read_json(DETECTION_LOG_PATH, [])
        logs = raw_logs if isinstance(raw_logs, list) else []
        logs.append(log_entry)
        logs = logs[-MAX_DETECTION_LOG_ENTRIES:]
        _safe_write_json(DETECTION_LOG_PATH, logs)


def _html_to_text(html_content: str) -> str:
    cleaned = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html_content)

    class _Collector(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.parts: list[str] = []

        def handle_data(self, data: str) -> None:
            stripped = data.strip()
            if stripped:
                self.parts.append(stripped)

    parser = _Collector()
    parser.feed(cleaned)
    return " ".join(parser.parts)


def _extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        from PyPDF2 import PdfReader
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="PDF support requires PyPDF2 to be installed.") from exc

    reader = PdfReader(BytesIO(file_bytes))
    return "\n".join((page.extract_text() or "") for page in reader.pages).strip()


def _extract_text_from_docx(file_bytes: bytes) -> str:
    try:
        import docx

        document = docx.Document(BytesIO(file_bytes))
        return "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()).strip()
    except ImportError:
        pass

    with zipfile.ZipFile(BytesIO(file_bytes)) as archive:
        document_xml = archive.read("word/document.xml")
    root = ET.fromstring(document_xml)
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    text_nodes = [node.text for node in root.findall(".//w:t", namespace) if node.text]
    return " ".join(text_nodes).strip()


def _extract_text_from_eml(file_bytes: bytes) -> tuple[str, Optional[str]]:
    message = BytesParser(policy=policy.default).parsebytes(file_bytes)
    sender = parseaddr(message.get("from", ""))[1] or None
    subject = message.get("subject", "")
    chunks: list[str] = []

    def _collect(part_content: Any, content_type: str) -> None:
        if isinstance(part_content, bytes):
            text_value = part_content.decode("utf-8", errors="ignore")
        else:
            text_value = str(part_content)
        if content_type == "text/html":
            chunks.append(_html_to_text(text_value))
        else:
            chunks.append(text_value)

    if message.is_multipart():
        for part in message.walk():
            if part.get_content_maintype() == "multipart":
                continue
            content_type = part.get_content_type()
            if content_type in {"text/plain", "text/html"}:
                _collect(part.get_content(), content_type)
    else:
        content_type = message.get_content_type()
        if content_type in {"text/plain", "text/html"}:
            _collect(message.get_content(), content_type)

    combined = "\n".join(filter(None, [subject, *chunks])).strip()
    return combined, sender


def _extract_text_from_file(file_extension: str, file_bytes: bytes) -> tuple[str, Optional[str]]:
    ext = file_extension.lower()
    if ext == ".txt":
        return file_bytes.decode("utf-8", errors="ignore").strip(), None
    if ext == ".pdf":
        return _extract_text_from_pdf(file_bytes), None
    if ext == ".docx":
        return _extract_text_from_docx(file_bytes), None
    if ext == ".html":
        html_text = file_bytes.decode("utf-8", errors="ignore")
        return _html_to_text(html_text), None
    if ext == ".eml":
        return _extract_text_from_eml(file_bytes)
    raise HTTPException(status_code=400, detail="Unsupported file type.")


def _analyze_text_pipeline(text: str, sender: Optional[str], platform: Optional[str]) -> dict[str, Any]:
    model_probability = predict_text(text)
    score = model_probability
    explanations: list[str] = [f"Model scam probability: {model_probability:.2f}"]

    keyword_score, keyword_explanations = calculate_keyword_score(text)
    if keyword_score > 0:
        score += keyword_score
        explanations.extend(keyword_explanations)

    urls = extract_urls(text)
    domains = [_extract_domain(url) for url in urls]
    domains = [domain for domain in domains if domain]
    if urls:
        score += 0.10
        explanations.append("URL detected in content")
    if any(_contains_domain_words(domain, SUSPICIOUS_DOMAIN_WORDS) for domain in domains):
        score += 0.10
        explanations.append("Suspicious domain detected")

    sender_id = _pick_sender_id(sender, text, urls) or "anonymous_sender"
    reputation_boost = update_reputation(sender_id)
    if reputation_boost > 0:
        score += reputation_boost
        explanations.append("Sender reputation risk boost applied")

    final_score = _clamp_score(score)
    level = _risk_level(final_score)
    log_detection(
        text=text,
        sender=sender_id or sender,
        platform=platform or "",
        risk_score=final_score,
        risk_level=level,
        explanations=explanations,
    )
    return {"risk_score": round(final_score, 4), "risk_level": level, "explanations": explanations}


@app.on_event("startup")
def _startup() -> None:
    load_model()


@app.post("/analyze-text")
def analyze_text(payload: AnalyzeTextRequest) -> dict[str, Any]:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Field 'text' cannot be empty.")
    return _analyze_text_pipeline(text=text, sender=payload.sender, platform=payload.platform)


@app.post("/analyze-url")
def analyze_url(payload: AnalyzeUrlRequest) -> dict[str, Any]:
    raw_url = payload.url.strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="Field 'url' cannot be empty.")
    domain = _extract_domain(raw_url)
    if not domain:
        raise HTTPException(status_code=400, detail="Could not extract a valid domain from the URL.")

    score = 0.0
    explanations: list[str] = []
    matches = _contains_domain_words(domain, URL_ENDPOINT_DOMAIN_WORDS)
    for keyword in matches:
        score += 0.15
        explanations.append(f"Suspicious domain keyword detected: {keyword}")

    reputation_boost = update_reputation(domain)
    if reputation_boost > 0:
        score += reputation_boost
        explanations.append("Sender reputation risk boost applied")

    final_score = _clamp_score(score)
    level = _risk_level(final_score)
    log_detection(
        text=raw_url,
        sender=domain,
        platform="url",
        risk_score=final_score,
        risk_level=level,
        explanations=explanations,
    )

    return {
        "risk_score": round(final_score, 4),
        "risk_level": level,
        "domain": domain,
        "explanations": explanations,
    }


@app.post("/analyze-file")
async def analyze_file(file: UploadFile = File(...)) -> dict[str, Any]:
    filename = file.filename or "uploaded_file"
    extension = Path(filename).suffix.lower()
    if extension not in {".txt", ".pdf", ".docx", ".html", ".eml"}:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Allowed: .txt, .pdf, .docx, .html, .eml",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    text_content, eml_sender = _extract_text_from_file(extension, file_bytes)
    if not text_content.strip():
        raise HTTPException(status_code=400, detail="No readable text could be extracted from the file.")

    result = _analyze_text_pipeline(
        text=text_content,
        sender=eml_sender,
        platform=f"file:{extension[1:]}",
    )
    return {"filename": filename, **result}
