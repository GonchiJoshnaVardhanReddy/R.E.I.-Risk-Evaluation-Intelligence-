from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Float, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from datetime import datetime
import uvicorn
import re
import json

# Database Setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./scam_detections.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class ScanRecord(Base):
    __tablename__ = "scans"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    text = Column(Text)
    score = Column(Integer)
    risk_level = Column(String)
    reasons = Column(Text) # JSON string

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Aegis AI - Real Intelligence")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class AnalysisRequest(BaseModel):
    text: str

class AnalysisResponse(BaseModel):
    score: int
    risk_level: str
    reasons: list[str]

# Logic with real heuristics (Simulating ML confidence)
def analyze_content(text: str):
    lower_text = text.lower()
    score = 0
    reasons = []

    if any(k in lower_text for k in ["immediately", "suspended", "today", "urgent", "action required"]):
        score += 35
        reasons.append("High-urgency language detected")

    if any(k in lower_text for k in ["bank", "sbi", "hdfc", "paypal", "kyc", "verification", "account block"]):
        score += 30
        reasons.append("Institutional impersonation markers")

    if "otp" in lower_text or "one time password" in lower_text:
        score += 45
        reasons.append("Sensitive authentication (OTP) request")

    urls = re.findall(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\(\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', lower_text)
    for url in urls:
        if any(bad in url for bad in ["bit.ly", "t.co", "tinyurl"]):
            score += 25
            reasons.append(f"Suspicious shortlink: {url}")

    final_score = min(max(score, 5), 100)
    risk_level = "HIGH" if final_score >= 70 else "MEDIUM" if final_score >= 40 else "LOW"
    
    if not reasons:
        reasons = ["Organic message - no risk patterns found"]

    return {
        "score": final_score,
        "risk_level": risk_level,
        "reasons": reasons
    }

@app.post("/analyze", response_model=AnalysisResponse)
async def analyze(request: AnalysisRequest, db: Session = Depends(get_db)):
    if not request.text:
        raise HTTPException(status_code=400, detail="Text empty")
    
    result = analyze_content(request.text)
    
    # Save to REAL database
    db_record = ScanRecord(
        text=request.text,
        score=result["score"],
        risk_level=result["risk_level"],
        reasons=json.dumps(result["reasons"])
    )
    db.add(db_record)
    db.commit()
    
    return result

@app.get("/stats")
async def get_stats(db: Session = Depends(get_db)):
    total = db.query(ScanRecord).count()
    threats = db.query(ScanRecord).filter(ScanRecord.risk_level == "HIGH").count()
    recent = db.query(ScanRecord).order_by(ScanRecord.timestamp.desc()).limit(10).all()
    
    return {
        "total_scanned": total,
        "threats_blocked": threats,
        "recent_history": [
            {
                "time": r.timestamp.isoformat(),
                "snippet": r.text[:100],
                "risk": r.risk_level,
                "score": r.score
            } for r in recent
        ]
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
