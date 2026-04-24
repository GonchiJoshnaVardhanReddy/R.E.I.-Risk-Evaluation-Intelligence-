# R.E.I. (Risk Evaluation Intelligence)

**Advanced Cybersecurity Threat Detection & Prevention System**

A comprehensive, AI-powered security suite that protects users from phishing, malware, scams, and other cyber threats across multiple communication channels and file types.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [System Architecture](#system-architecture)
- [Components](#components)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Technology Stack](#technology-stack)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)
- [License](#license)

---

## 🎯 Overview

**R.E.I.** is a sophisticated cybersecurity threat detection and prevention system that uses machine learning and advanced heuristics to identify and mitigate various cyber threats. The platform operates across multiple channels including:

- **Email Protection** - Detects phishing, malware, and suspicious email patterns
- **WhatsApp Protection** - Analyzes messages and media for threats
- **URL Analysis** - Checks URLs against reputation databases
- **File Scanning** - Scans files for malware and suspicious content
- **Real-time Monitoring** - Continuous threat detection and logging

The system combines **deep learning models** (DistilBERT) with **pattern matching** and **heuristic analysis** to provide comprehensive protection.

---

## ✨ Features

### Core Detection Capabilities
- 🤖 **AI-Powered Threat Detection** - DistilBERT-based text classification for threat identification
- 🔗 **URL Analysis** - Domain reputation checks, suspicious pattern detection
- 📧 **Email Threat Detection** - Phishing, spoofing, malware analysis
- 💬 **Message Analysis** - Real-time scanning of text communications
- 📁 **File Security** - Archive inspection, binary analysis, metadata scanning
- 🌍 **Domain Reputation** - Cross-referenced reputation database
- 📊 **Real-time Logging** - Comprehensive detection event tracking
- 🔄 **Continuous Monitoring** - Background file system watching

### Protection Layers
- **Text Analysis** - Keyword matching, suspicious content detection
- **Domain Analysis** - Homograph detection, domain age verification
- **Heuristic Scoring** - Risk scoring based on multiple indicators
- **Database Cross-Reference** - Reputation scoring against known threats
- **Archive Analysis** - ZIP file extraction and nested file inspection

### User Interfaces
- 🖥️ **Electron Desktop Application** - Full-featured desktop control center
- 🌐 **Browser Extension** - Integrated protection in Chrome/Firefox
- 📡 **REST API** - FastAPI backend for programmatic access
- 📈 **Web Dashboard** - Real-time monitoring and statistics

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interfaces                          │
├──────────────────┬────────────────┬────────────────────────┤
│ Browser          │ Electron       │ Web Dashboard          │
│ Extension        │ Control Center │ (TBD)                  │
└──────────────────┴────────────────┴────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              REST API (FastAPI Backend)                     │
├──────────────┬────────────────┬──────────────────────────────┤
│ /analyze-url │ /analyze-text  │ /analyze-file              │
└──────────────┴────────────────┴──────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
    ┌─────────┐    ┌─────────────┐    ┌──────────────┐
    │   ML    │    │  Heuristic  │    │  Reputation  │
    │  Model  │    │   Analysis  │    │   Database   │
    │(BERT)   │    │             │    │              │
    └─────────┘    └─────────────┘    └──────────────┘
         │                 │                 │
         └─────────────────┼─────────────────┘
                           ▼
        ┌──────────────────────────────────┐
        │   Detection & Risk Scoring       │
        └──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
    ┌──────────┐   ┌──────────────┐   ┌────────────┐
    │Detection │   │File Monitor  │   │Email/WA    │
    │Log       │   │              │   │Protectors  │
    └──────────┘   └──────────────┘   └────────────┘
```

---

## 📦 Components

### 1. **Backend (Python/FastAPI)**

#### `rei_scanner_api.py`
- Main FastAPI application
- RESTful endpoints for threat analysis
- Multi-threaded processing
- Async file handling

**Key Endpoints:**
```
POST /analyze-text       - Analyze text for threats
POST /analyze-url        - Analyze URLs for threats
POST /analyze-file       - Analyze files and archives
GET  /docs              - Interactive API documentation
GET  /reputation/{url}  - Check URL reputation
```

#### `train_rei_model.py`
- Model training pipeline
- DistilBERT fine-tuning
- Dataset processing
- Model evaluation

#### `file_monitor.py`
- Real-time file system monitoring
- Automatic threat detection
- Event logging

#### `merge_datasets.py`
- Training data management
- Dataset consolidation

### 2. **Desktop Application (Electron)**

**Directory:** `rei_control_center_electron/`

- **main.js** - Electron main process, window management
- **renderer.js** - UI logic and event handling
- **preload.js** - Secure IPC bridge
- **pages/** - UI pages (dashboard, scan, settings, etc.)
- **styles.css** - Global styling
- **locales/** - Multi-language support (EN, HI, KN, ML, TA, TE)

**Pages:**
- 📊 **Dashboard** - Real-time threat overview
- 🔍 **Scan** - File/text analysis interface
- ⚙️ **Settings** - Configuration and preferences
- 📈 **Status** - System status monitoring
- 🛡️ **Protection** - Protection settings
- 📜 **History** - Detection history log
- ⭐ **Reputation** - Threat database information

### 3. **Browser Extension**

**Directory:** `extension/extension/`

- **manifest.json** - Extension configuration
- **content.js** - Page content analysis
- **popup.js** - User interface
- **scripts/i18n.js** - Localization support
- **blocked.html** - Threat blocking page

**Features:**
- Real-time link analysis
- Suspicious site blocking
- User notifications
- Multi-language support

### 4. **Email & WhatsApp Protection**

**Directories:** `rei_email_protector/`, `rei_whatsapp_protector/`

- Email header analysis
- Phishing detection
- Suspicious attachment scanning
- Message content analysis
- Media file inspection

### 5. **Machine Learning Model**

**Directory:** `rei_model/`

- Pre-trained DistilBERT model
- Tokenizer configuration
- Model weights and vocabulary

### 6. **Databases**

- **reputation_db.json** - Known threat database
- **detection_log.json** - Detection event history
- **rei_training_dataset.csv** - Training data

---

## 🚀 Installation

### Prerequisites

- **Python 3.9+**
- **Node.js 16+**
- **npm or yarn**
- **Git**

### Step 1: Clone Repository

```bash
git clone https://github.com/GonchiJoshnaVardhanReddy/R.E.I.-Risk-Evaluation-Intelligence-.git
cd R.E.I.-Risk-Evaluation-Intelligence-
```

### Step 2: Setup Python Backend

```bash
# Install Python dependencies
pip install -r requirements.txt

# The main dependencies include:
# - FastAPI & Uvicorn
# - PyTorch & Transformers (for ML model)
# - PySide6 (for desktop UI)
# - Requests (for API calls)
```

### Step 3: Setup Electron Desktop App

```bash
cd rei_control_center_electron

# Install dependencies
npm install

# Or with yarn
yarn install
```

### Step 4: Download ML Model

The pre-trained model should be in `rei_model/` directory. If missing:

```bash
# The model will be downloaded automatically on first API call
# Or manually place the DistilBERT model files in rei_model/
```

---

## 💻 Usage

### Run the FastAPI Backend

```bash
# Start the scanner API server
python rei_scanner_api.py

# Server runs on http://127.0.0.1:8000
# Interactive docs available at http://127.0.0.1:8000/docs
```

### Run Desktop Application

```bash
cd rei_control_center_electron

# Development mode
npm start

# Build executable (Windows)
npm run build
```

### Run Control Center (PyQt6 Version)

```bash
# Alternative desktop UI
python rei_control_center.py
```

### Run System Check

```bash
# Full system diagnostics
python rei_full_system_check.py

# Or basic check
python rei_system_check.py
```

### Monitor File System

```bash
# Start real-time file monitoring
python file_monitor.py
```

### Train ML Model

```bash
# Train/retrain the DistilBERT model
python train_rei_model.py
```

---

## ⚙️ Configuration

### API Configuration

**File:** `rei_scanner_api.py`

```python
# API Server Settings
SCANNER_ANALYZE_TEXT_URL = "http://127.0.0.1:8000/analyze-text"
SCANNER_ANALYZE_URL = "http://127.0.0.1:8000/analyze-url"
SCANNER_ANALYZE_FILE_URL = "http://127.0.0.1:8000/analyze-file"

# Model Settings
MODEL_DIR = BASE_DIR / "rei_model"
REPUTATION_DB_PATH = BASE_DIR / "reputation_db.json"
DETECTION_LOG_PATH = BASE_DIR / "detection_log.json"
```

### Suspicious Keywords Configuration

```python
SUSPICIOUS_KEYWORDS = [
    "otp", "verify", "login", "urgent", "account",
    "update", "bank", "secure", "suspend", ...
]

SUSPICIOUS_DOMAIN_WORDS = [
    "login", "secure", "verify", "update", ...
]
```

### Localization

Supported languages:
- 🇬🇧 English (en)
- 🇮🇳 Hindi (hi)
- 🇮🇳 Kannada (kn)
- 🇮🇳 Malayalam (ml)
- 🇮🇳 Tamil (ta)
- 🇮🇳 Telugu (te)

---

## 📚 API Documentation

### Analyze Text

```http
POST /analyze-text
Content-Type: application/json

{
  "text": "Click here to verify your account: https://phishing.site"
}

Response:
{
  "threat_level": "high",
  "risk_score": 0.87,
  "detected_threats": ["phishing_attempt", "suspicious_links"],
  "details": {...}
}
```

### Analyze URL

```http
POST /analyze-url
Content-Type: application/json

{
  "url": "https://example.com"
}

Response:
{
  "url": "https://example.com",
  "reputation": "clean",
  "threat_indicators": [],
  "domain_age": 3650,
  "score": 0.95
}
```

### Analyze File

```http
POST /analyze-file
Content-Type: multipart/form-data

file: <binary-file-data>

Response:
{
  "filename": "document.pdf",
  "file_size": 2048576,
  "threat_detected": false,
  "file_type": "pdf",
  "details": {...}
}
```

### Get API Documentation

Visit `http://127.0.0.1:8000/docs` for interactive Swagger UI

---

## 🔧 Technology Stack

### Backend
- **FastAPI** - Modern web framework
- **PyTorch** - Deep learning framework
- **Transformers (Hugging Face)** - Pre-trained models
- **Uvicorn** - ASGI server
- **Pydantic** - Data validation

### Frontend (Desktop)
- **Electron** - Desktop application framework
- **JavaScript/HTML/CSS** - UI components
- **IPC (Inter-Process Communication)** - Process bridge

### Frontend (Alternative PyQt)
- **PySide6** - Qt bindings for Python
- **PyQt6** - Python Qt framework

### Frontend (Browser Extension)
- **Manifest V3** - Extension framework
- **Content Scripts** - DOM manipulation
- **Background Service Worker** - Event handling

### Database
- **JSON** - File-based storage (reputation_db, detection_log)

### ML/AI
- **DistilBERT** - Lightweight BERT variant
- **Tokenizers** - Fast tokenization

---

## 📊 Directory Structure

```
R.E.I.-Risk-Evaluation-Intelligence-/
├── README.md                          # This file
├── rei_scanner_api.py                # FastAPI backend
├── rei_control_center.py             # PyQt6 desktop UI
├── train_rei_model.py                # Model training
├── file_monitor.py                   # File system monitoring
├── merge_datasets.py                 # Dataset management
│
├── rei_model/                        # ML Model files
│   ├── config.json
│   ├── pytorch_model.bin
│   └── tokenizer files
│
├── rei_control_center_electron/      # Electron desktop app
│   ├── main.js
│   ├── renderer.js
│   ├── preload.js
│   ├── package.json
│   ├── pages/
│   ├── styles.css
│   ├── locales/                      # Translations
│   ├── tests/                        # Unit tests
│   └── renderer/
│
├── extension/                        # Browser extension
│   └── extension/
│       ├── manifest.json
│       ├── popup.html
│       ├── blocked.html
│       ├── scripts/
│       └── _locales/                 # Translations
│
├── rei_email_protector/              # Email threat detection
│   └── (components for email analysis)
│
├── rei_whatsapp_protector/           # WhatsApp threat detection
│   └── (components for message analysis)
│
├── dataset/                          # Training datasets
├── detection_log.json                # Detection history
├── reputation_db.json                # Threat database
├── rei_training_dataset.csv          # Training data
│
├── tests/                            # Test suite
├── docs/                             # Documentation
└── results/                          # Analysis results
```

---

## 🧪 Testing

### Run Electron Tests

```bash
cd rei_control_center_electron

# Run all tests
npm test

# Run with specific pattern
npm test -- tests/main-helpers.test.mjs
```

### Test Files
- `rei_control_center_electron/tests/main-helpers.test.mjs`
- `rei_control_center_electron/tests/package-config.test.mjs`
- `rei_control_center_electron/tests/renderer-router.test.mjs`

---

## 🔐 Security Features

- **Threat Detection** - Multiple detection layers
- **Heuristic Analysis** - Pattern-based threat identification
- **ML-Based Classification** - Deep learning threat detection
- **Reputation Database** - Cross-referenced threat intelligence
- **Real-time Monitoring** - Continuous threat surveillance
- **Secure IPC** - Electron preload bridge isolation
- **Content Script Isolation** - Browser extension sandboxing

---

## 🐛 Troubleshooting

### API Not Responding
```bash
# Ensure FastAPI server is running
python rei_scanner_api.py

# Check if port 8000 is available
# Modify port in rei_scanner_api.py if needed
```

### Model Not Found
```bash
# Ensure rei_model/ directory exists with model files
# Model will auto-download on first API call from Hugging Face
```

### Electron App Won't Start
```bash
# Install dependencies
cd rei_control_center_electron
npm install

# Clear cache and rebuild
npm cache clean --force
npm install
```

### Extension Not Loading
- Go to `chrome://extensions/` (Chrome) or `about:debugging` (Firefox)
- Enable "Developer mode"
- Click "Load unpacked" and select `extension/extension/` folder

---

## 📈 Performance Optimization

- **Async Processing** - Non-blocking API calls
- **Multi-threading** - Parallel threat analysis
- **Model Caching** - Pre-loaded ML models
- **Incremental Detection** - Streaming file analysis
- **Request Batching** - Efficient API usage

---

## 🤝 Contributing

We welcome contributions! To contribute:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit with clear messages (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

Please ensure:
- Code follows existing style conventions
- Tests pass (`npm test` for Electron)
- Documentation is updated
- Commit includes co-author trailer

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 👥 Authors

**Gonchi Joshna Vardhan Reddy**
- GitHub: [@GonchiJoshnaVardhanReddy](https://github.com/GonchiJoshnaVardhanReddy)

---

## 📞 Support & Contact

For issues, questions, or feedback:
- **GitHub Issues** - Report bugs and request features
- **GitHub Discussions** - Ask questions and share ideas

---

## 🎯 Roadmap

### Future Enhancements
- [ ] Integration with VirusTotal API
- [ ] Enhanced mobile app support
- [ ] Real-time threat intelligence feeds
- [ ] Advanced behavioral analysis
- [ ] Cloud-based threat detection
- [ ] Multi-user enterprise deployment
- [ ] Machine learning model improvements

---

## ⭐ Acknowledgments

- **Hugging Face** - Pre-trained transformer models
- **PyTorch** - Deep learning framework
- **Electron** - Desktop application framework
- **FastAPI** - Web framework

---

**Last Updated:** April 24, 2026

**Status:** Active Development

