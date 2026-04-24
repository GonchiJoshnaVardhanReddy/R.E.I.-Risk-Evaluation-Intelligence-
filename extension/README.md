# Aegis AI: Offline Scam Detection & Risk Intelligence

Aegis AI is a privacy-first security system designed to detect phishing, scams, and fraudulent messages in real-time across multiple communication platforms (WhatsApp, Gmail, Telegram, Outlook).

## Key Components

1.  **Chrome Extension**: Monitors browser DOM for incoming messages and provides real-time warning overlays.
2.  **Website Scanning (NEW)**: Integrates with **VirusTotal API** to scan every URL you visit. If a site is flagged as malicious, Aegis blocks access and shows a security warning.
3.  **FastAPI Backend**: The local "brain" that analyzes text using heuristics and machine learning.
4.  **Risk Intelligence Dashboard**: A Streamlit interface for manual scanning, history review, and system monitoring.

## Installation & Setup

### 1. Requirements
- Python 3.8+
- Chrome Browser

### 2. Backend Setup
Navigate to the `backend` folder and install dependencies:
```bash
pip install fastapi uvicorn streamlit requests pydantic
```

Run the API server:
```bash
python main.py
```
The server will run at `http://localhost:8000`.

### 3. Dashboard Setup
In a new terminal:
```bash
streamlit run dashboard.py
```

### 4. Extension Setup
1. Open Chrome and go to `chrome://extensions/`.
2. Enable "Developer mode" (toggle in the top right).
3. Click "Load unpacked".
4. Select the `extension` folder from this project.

## How it Works
- The **Content Script** detects message elements on supported sites.
- It extracts the text and sends it to the **Background Script**.
- The Background Script calls the **Local API** (`localhost:8000/analyze`).
- If a risk is detected (High/Medium), a **Warning Overlay** is injected directly into the web page next to the suspicious message.
- All detections are logged to the local dashboard.

## Supported Platforms
- WhatsApp Web
- Gmail
- Outlook Web
- Telegram Web

## Privacy Note
Aegis AI operates **100% offline**. No message content ever leaves your machine. All analysis is performed by the local Python engine.
