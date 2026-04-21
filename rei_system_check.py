from __future__ import annotations

import importlib
import json
import subprocess
import sys
import time
import traceback
import types
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "rei_model"
API_BASE = "http://127.0.0.1:8000"
ANALYZE_TEXT_URL = f"{API_BASE}/analyze-text"
ANALYZE_URL_URL = f"{API_BASE}/analyze-url"
ANALYZE_FILE_URL = f"{API_BASE}/analyze-file"
DOCS_URL = f"{API_BASE}/docs"

REPUTATION_DB_PATH = BASE_DIR / "reputation_db.json"
DETECTION_LOG_PATH = BASE_DIR / "detection_log.json"

PASS = "PASS"
WARNING = "WARNING"
FAIL = "FAIL"
STATUS_ORDER = {PASS: 0, WARNING: 1, FAIL: 2}


@dataclass
class SectionResult:
    name: str
    status: str
    notes: list[str]


def print_section_header(title: str) -> None:
    print("\n" + "=" * 80)
    print(title)
    print("=" * 80)


def print_check(status: str, message: str) -> None:
    print(f"[{status}] {message}")


def degrade_status(current: str, candidate: str) -> str:
    return candidate if STATUS_ORDER[candidate] > STATUS_ORDER[current] else current


def to_json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload).encode("utf-8")


def http_get_status(url: str, timeout: float = 5.0) -> int | None:
    try:
        request = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def http_post_json(url: str, payload: dict[str, Any], timeout: float = 30.0) -> tuple[int | None, Any]:
    try:
        request = urllib.request.Request(
            url,
            data=to_json_bytes(payload),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return response.status, json.loads(body)
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", errors="replace")
            return exc.code, json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return exc.code, body if "body" in locals() else ""
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None, None


def http_post_multipart_file(url: str, field_name: str, file_path: Path) -> tuple[int | None, Any]:
    boundary = f"----REI-DIAG-{uuid.uuid4().hex}"
    content = file_path.read_bytes()
    content_type = "text/html" if file_path.suffix.lower() == ".html" else "application/octet-stream"

    chunks: list[bytes] = []
    chunks.append(f"--{boundary}\r\n".encode("utf-8"))
    chunks.append(
        (
            f'Content-Disposition: form-data; name="{field_name}"; filename="{file_path.name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
    )
    chunks.append(content)
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)

    try:
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read().decode("utf-8", errors="replace")
            return response.status, json.loads(payload)
    except urllib.error.HTTPError as exc:
        try:
            payload = exc.read().decode("utf-8", errors="replace")
            return exc.code, json.loads(payload)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return exc.code, None
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None, None


def safe_read_json(path: Path, default_value: Any) -> Any:
    if not path.exists():
        return default_value
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (json.JSONDecodeError, OSError, ValueError, TypeError):
        return default_value


def safe_write_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def risk_boost_for_count(next_count: int) -> float:
    if next_count <= 1:
        return 0.0
    if next_count == 2:
        return 0.10
    if next_count == 3:
        return 0.25
    return 0.40


def verify_response_fields(payload: Any, required_fields: list[str]) -> bool:
    if not isinstance(payload, dict):
        return False
    return all(field in payload for field in required_fields)


def wait_for_api(timeout_seconds: float = 25.0) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if http_get_status(DOCS_URL, timeout=3) == 200:
            return True
        time.sleep(1)
    return False


def start_local_api() -> tuple[subprocess.Popen[str] | None, str]:
    launch_variants: list[list[str]] = [
        ["uvicorn", "rei_scanner_api:app", "--reload"],
        [sys.executable, "-m", "uvicorn", "rei_scanner_api:app", "--reload"],
    ]

    for command in launch_variants:
        try:
            process = subprocess.Popen(  # noqa: S603
                command,
                cwd=str(BASE_DIR),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            if wait_for_api(timeout_seconds=25):
                return process, " ".join(command)
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
        except OSError:
            continue
    return None, ""


def stop_process(process: subprocess.Popen[str] | None) -> None:
    if process is None:
        return
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def section_environment_check() -> SectionResult:
    section_name = "SECTION 1 — ENVIRONMENT CHECK"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    python_ok = sys.version_info >= (3, 8)
    if python_ok:
        print_check(PASS, f"Python version: {sys.version.split()[0]}")
    else:
        print_check(FAIL, f"Python version too old: {sys.version.split()[0]} (requires 3.8+)")
        status = degrade_status(status, FAIL)

    dependencies = [
        ("torch", "torch"),
        ("transformers", "transformers"),
        ("fastapi", "fastapi"),
        ("uvicorn", "uvicorn"),
        ("streamlit", "streamlit"),
        ("watchdog", "watchdog"),
        ("pdfminer.six", "pdfminer"),
        ("python-docx", "docx"),
        ("beautifulsoup4", "bs4"),
    ]
    for package_name, module_name in dependencies:
        try:
            importlib.import_module(module_name)
            print_check(PASS, f"Dependency installed: {package_name}")
        except Exception:
            print_check(FAIL, f"Dependency missing: {package_name}")
            notes.append(f"Missing dependency: {package_name}")
            status = degrade_status(status, FAIL)

    return SectionResult(name=section_name, status=status, notes=notes)


def section_model_loading_test() -> SectionResult:
    section_name = "SECTION 2 — MODEL LOADING TEST"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    config_path = MODEL_DIR / "config.json"
    if config_path.exists():
        print_check(PASS, f"Model config found: {config_path}")
    else:
        print_check(FAIL, f"Model config missing: {config_path}")
        return SectionResult(name=section_name, status=FAIL, notes=["config.json missing"])

    try:
        import torch
        from transformers import DistilBertForSequenceClassification, DistilBertTokenizerFast
    except Exception as exc:
        print_check(FAIL, f"Required model libraries not importable: {exc}")
        return SectionResult(name=section_name, status=FAIL, notes=[str(exc)])

    try:
        tokenizer = DistilBertTokenizerFast.from_pretrained(str(MODEL_DIR))
        print_check(PASS, "Tokenizer loaded")
    except Exception as exc:
        print_check(FAIL, f"Tokenizer failed to load: {exc}")
        return SectionResult(name=section_name, status=FAIL, notes=[str(exc)])

    try:
        model = DistilBertForSequenceClassification.from_pretrained(str(MODEL_DIR))
        model.eval()
        print_check(PASS, "Model loaded")
    except Exception as exc:
        print_check(FAIL, f"Model failed to load: {exc}")
        return SectionResult(name=section_name, status=FAIL, notes=[str(exc)])

    try:
        sample_text = "verify your account immediately"
        encoded = tokenizer(sample_text, truncation=True, padding=True, max_length=512, return_tensors="pt")
        with torch.no_grad():
            logits = model(**encoded).logits
            probabilities = torch.softmax(logits, dim=-1)[0]
        class_index = 1 if probabilities.shape[0] > 1 else 0
        risk_score = float(probabilities[class_index].item())
        print_check(PASS, f"Forward inference successful | test risk score: {risk_score:.4f}")
    except Exception as exc:
        print_check(FAIL, f"Forward inference failed: {exc}")
        status = degrade_status(status, FAIL)
        notes.append(str(exc))

    return SectionResult(name=section_name, status=status, notes=notes)


def section_scanner_api_test() -> tuple[SectionResult, subprocess.Popen[str] | None, bool]:
    section_name = "SECTION 3 — SCANNER API TEST"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []
    started_process: subprocess.Popen[str] | None = None
    started_here = False

    if http_get_status(DOCS_URL, timeout=4) == 200:
        print_check(PASS, f"API docs reachable: {DOCS_URL}")
    else:
        print_check(WARNING, "API appears offline, attempting auto-start via uvicorn rei_scanner_api:app --reload")
        started_process, command_used = start_local_api()
        started_here = started_process is not None
        if started_process is None:
            print_check(FAIL, "Failed to auto-start scanner API")
            notes.append("API offline and auto-start failed")
            return SectionResult(name=section_name, status=FAIL, notes=notes), None, False
        print_check(PASS, f"Scanner API auto-started using: {command_used}")

    if wait_for_api(timeout_seconds=10):
        print_check(PASS, "Scanner API reachable after check/start")
    else:
        print_check(FAIL, "Scanner API is still unreachable")
        notes.append("API unreachable after start attempt")
        return SectionResult(name=section_name, status=FAIL, notes=notes), started_process, started_here

    payload = {
        "text": "urgent verify your bank account",
        "sender": "[test@secure-login.xyz](mailto:test@secure-login.xyz)",
        "platform": "diagnostic",
    }
    http_status, response = http_post_json(ANALYZE_TEXT_URL, payload, timeout=45)
    if http_status == 200 and verify_response_fields(response, ["risk_score", "risk_level", "explanations"]):
        print_check(PASS, "POST /analyze-text returned required fields")
    else:
        print_check(FAIL, f"POST /analyze-text failed or malformed response (status={http_status})")
        notes.append(f"Unexpected analyze-text response: status={http_status}, body={response}")
        status = degrade_status(status, FAIL)

    return SectionResult(name=section_name, status=status, notes=notes), started_process, started_here


def section_url_analyzer_test() -> SectionResult:
    section_name = "SECTION 4 — URL ANALYZER TEST"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    payload = {"url": "secure-login-update.xyz"}
    http_status, response = http_post_json(ANALYZE_URL_URL, payload, timeout=45)
    if http_status == 200 and verify_response_fields(response, ["risk_score", "risk_level", "explanations"]):
        print_check(PASS, "POST /analyze-url returned required structure")
    else:
        print_check(FAIL, f"POST /analyze-url failed or malformed response (status={http_status})")
        notes.append(f"Unexpected analyze-url response: status={http_status}, body={response}")
        status = degrade_status(status, FAIL)

    return SectionResult(name=section_name, status=status, notes=notes)


def section_file_analyzer_test() -> SectionResult:
    section_name = "SECTION 5 — FILE ANALYZER TEST"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    temp_file = BASE_DIR / "test_phishing.html"
    try:
        temp_file.write_text(
            "Verify your account immediately at secure-login-update.xyz",
            encoding="utf-8",
        )
        print_check(PASS, f"Temporary file created: {temp_file.name}")
        http_status, response = http_post_multipart_file(ANALYZE_FILE_URL, "file", temp_file)
        if http_status == 200 and verify_response_fields(response, ["risk_score", "risk_level"]):
            print_check(PASS, "POST /analyze-file returned risk_score and risk_level")
        else:
            print_check(FAIL, f"POST /analyze-file failed or malformed response (status={http_status})")
            notes.append(f"Unexpected analyze-file response: status={http_status}, body={response}")
            status = degrade_status(status, FAIL)
    except Exception as exc:
        print_check(FAIL, f"File analyzer test crashed: {exc}")
        notes.append(str(exc))
        status = degrade_status(status, FAIL)
    finally:
        if temp_file.exists():
            try:
                temp_file.unlink()
                print_check(PASS, "Temporary file deleted")
            except OSError as exc:
                print_check(WARNING, f"Could not delete temporary file: {exc}")
                status = degrade_status(status, WARNING)

    return SectionResult(name=section_name, status=status, notes=notes)


def section_reputation_database_test() -> SectionResult:
    section_name = "SECTION 6 — REPUTATION DATABASE TEST"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []
    sender = "test@secure-login.xyz"

    if not REPUTATION_DB_PATH.exists():
        safe_write_json(REPUTATION_DB_PATH, {})
        print_check(WARNING, "reputation_db.json missing; created empty structure")
        status = degrade_status(status, WARNING)
    else:
        print_check(PASS, "reputation_db.json exists")

    db = safe_read_json(REPUTATION_DB_PATH, {})
    if not isinstance(db, dict):
        print_check(WARNING, "reputation_db.json invalid; reset to empty structure")
        db = {}
        status = degrade_status(status, WARNING)

    previous_count = int((db.get(sender, {}) or {}).get("count", 0))
    next_count = previous_count + 1
    expected_boost = risk_boost_for_count(next_count)
    db[sender] = {"count": next_count, "risk_boost": expected_boost}
    safe_write_json(REPUTATION_DB_PATH, db)

    verified = safe_read_json(REPUTATION_DB_PATH, {})
    entry = verified.get(sender, {}) if isinstance(verified, dict) else {}
    count_ok = int(entry.get("count", -1)) == next_count
    boost_ok = abs(float(entry.get("risk_boost", -1.0)) - expected_boost) < 1e-9

    if count_ok and boost_ok:
        print_check(PASS, f"Sender reputation updated | count: {previous_count} -> {next_count}, risk_boost: {expected_boost:.2f}")
    else:
        print_check(FAIL, "Sender reputation update verification failed")
        notes.append(f"Expected count={next_count}, boost={expected_boost}; got {entry}")
        status = degrade_status(status, FAIL)

    return SectionResult(name=section_name, status=status, notes=notes)


def section_detection_log_test() -> SectionResult:
    section_name = "SECTION 7 — DETECTION LOG TEST"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    if not DETECTION_LOG_PATH.exists():
        safe_write_json(DETECTION_LOG_PATH, [])
        print_check(WARNING, "detection_log.json missing; created empty log")
        status = degrade_status(status, WARNING)
    else:
        print_check(PASS, "detection_log.json exists")

    logs = safe_read_json(DETECTION_LOG_PATH, [])
    if not isinstance(logs, list):
        logs = []
        print_check(WARNING, "detection_log.json invalid; reset to empty list")
        status = degrade_status(status, WARNING)

    marker = f"rei_diagnostic_entry_{int(time.time())}"
    sample_entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "text": marker,
        "sender": "diagnostic@rei.local",
        "platform": "diagnostic",
        "risk_score": 0.42,
        "risk_level": "MEDIUM",
        "explanations": ["Diagnostic log append verification"],
    }
    logs.append(sample_entry)
    logs = logs[-200:]
    safe_write_json(DETECTION_LOG_PATH, logs)

    persisted_logs = safe_read_json(DETECTION_LOG_PATH, [])
    if not isinstance(persisted_logs, list):
        print_check(FAIL, "Detection log is unreadable after write")
        return SectionResult(name=section_name, status=FAIL, notes=["Detection log unreadable"])

    entry_saved = any(isinstance(item, dict) and item.get("text") == marker for item in persisted_logs)
    trimmed_ok = len(persisted_logs) <= 200

    if entry_saved:
        print_check(PASS, "Sample detection entry saved")
    else:
        print_check(FAIL, "Sample detection entry not found after write")
        status = degrade_status(status, FAIL)
        notes.append("Sample detection entry missing")

    if trimmed_ok:
        print_check(PASS, f"Detection log length within limit ({len(persisted_logs)}/200)")
    else:
        print_check(FAIL, f"Detection log exceeds 200 entries ({len(persisted_logs)})")
        status = degrade_status(status, FAIL)
        notes.append("Detection log trim failed")

    return SectionResult(name=section_name, status=status, notes=notes)


def section_file_monitor_service_test() -> SectionResult:
    section_name = "SECTION 8 — FILE MONITOR SERVICE TEST"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    monitor_path = BASE_DIR / "file_monitor.py"
    if not monitor_path.exists():
        print_check(FAIL, "file_monitor.py not found")
        return SectionResult(name=section_name, status=FAIL, notes=["file_monitor.py missing"])
    print_check(PASS, "file_monitor.py exists")

    downloads_path = Path.home() / "Downloads"
    if not downloads_path.exists():
        print_check(FAIL, f"Downloads folder not found: {downloads_path}")
        return SectionResult(name=section_name, status=FAIL, notes=["Downloads path missing"])

    try:
        from watchdog.observers import Observer
    except Exception as exc:
        print_check(FAIL, f"watchdog import failed: {exc}")
        return SectionResult(name=section_name, status=FAIL, notes=[str(exc)])

    try:
        import file_monitor  # noqa: PLC0415
    except ModuleNotFoundError as exc:
        if exc.name != "win10toast":
            print_check(FAIL, f"File monitor import failed: {exc}")
            return SectionResult(name=section_name, status=FAIL, notes=[str(exc)])

        stub_module = types.ModuleType("win10toast")

        class _ToastNotifierStub:
            def show_toast(self, *args: Any, **kwargs: Any) -> None:  # noqa: ANN401
                return

        stub_module.ToastNotifier = _ToastNotifierStub  # type: ignore[attr-defined]
        sys.modules["win10toast"] = stub_module
        import file_monitor  # noqa: PLC0415

        print_check(WARNING, "win10toast missing; using diagnostic stub notifier")
        status = degrade_status(status, WARNING)
    except Exception as exc:
        print_check(FAIL, f"File monitor import failed: {exc}")
        return SectionResult(name=section_name, status=FAIL, notes=[str(exc)])

    log_before = safe_read_json(DETECTION_LOG_PATH, [])
    before_count = len(log_before) if isinstance(log_before, list) else 0

    class _SilentNotifier:
        def show_toast(self, *args: Any, **kwargs: Any) -> None:  # noqa: ANN401
            return

    handler = file_monitor.REIFileMonitorHandler(_SilentNotifier())
    observer = Observer()
    observer.schedule(handler, str(downloads_path), recursive=False)
    observer.start()

    test_file = downloads_path / f"rei_test_file_{int(time.time())}.txt"
    target_key = str(test_file.resolve()).lower()
    try:
        test_file.write_text("verify account urgently", encoding="utf-8")
        print_check(PASS, f"Simulated file created: {test_file.name}")

        scan_triggered = False
        api_called = False
        deadline = time.time() + 45
        while time.time() < deadline:
            with handler._lock:
                if target_key in handler._scanned:
                    scan_triggered = True
            current_log = safe_read_json(DETECTION_LOG_PATH, [])
            current_count = len(current_log) if isinstance(current_log, list) else 0
            if current_count > before_count:
                api_called = True
            if scan_triggered and api_called:
                break
            time.sleep(1)

        if scan_triggered:
            print_check(PASS, "File monitor scan triggered")
        else:
            print_check(FAIL, "File monitor did not report scan completion")
            status = degrade_status(status, FAIL)
            notes.append("Scan not triggered")

        if api_called:
            print_check(PASS, "File monitor API call succeeded (detection log updated)")
        else:
            print_check(FAIL, "File monitor API call could not be confirmed")
            status = degrade_status(status, FAIL)
            notes.append("API call not confirmed from detection log")
    except Exception as exc:
        print_check(FAIL, f"File monitor test crashed: {exc}")
        notes.append(str(exc))
        status = degrade_status(status, FAIL)
    finally:
        observer.stop()
        observer.join(timeout=5)
        if test_file.exists():
            try:
                test_file.unlink()
            except OSError:
                pass

    return SectionResult(name=section_name, status=status, notes=notes)


def section_extension_connectivity_test() -> SectionResult:
    section_name = "SECTION 9 — EXTENSION CONNECTIVITY TEST (SIMULATION)"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    test_payloads = [
        {
            "text": "Your OTP expired verify now",
            "sender": "+911234567890",
            "platform": "whatsapp",
        },
        {
            "text": "Your OTP expired verify now",
            "sender": "[test@secure-login.xyz](mailto:test@secure-login.xyz)",
            "platform": "email",
        },
    ]

    for payload in test_payloads:
        http_status, response = http_post_json(ANALYZE_TEXT_URL, payload, timeout=45)
        platform = payload["platform"]
        if http_status == 200 and verify_response_fields(response, ["risk_score", "risk_level", "explanations"]):
            print_check(PASS, f"{platform} simulation request passed")
        else:
            print_check(FAIL, f"{platform} simulation request failed (status={http_status})")
            notes.append(f"{platform} response invalid: status={http_status}, body={response}")
            status = degrade_status(status, FAIL)

    return SectionResult(name=section_name, status=status, notes=notes)


def section_dashboard_data_pipeline_test() -> SectionResult:
    section_name = "SECTION 10 — DASHBOARD DATA PIPELINE TEST"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    if DETECTION_LOG_PATH.exists():
        print_check(PASS, "detection_log.json exists")
    else:
        print_check(FAIL, "detection_log.json missing")
        status = degrade_status(status, FAIL)

    if REPUTATION_DB_PATH.exists():
        print_check(PASS, "reputation_db.json exists")
    else:
        print_check(FAIL, "reputation_db.json missing")
        status = degrade_status(status, FAIL)

    detection_log = safe_read_json(DETECTION_LOG_PATH, [])
    reputation_db = safe_read_json(REPUTATION_DB_PATH, {})
    detection_ok = isinstance(detection_log, list)
    reputation_ok = isinstance(reputation_db, dict)

    if detection_ok and reputation_ok:
        print_check(PASS, "Dashboard source files loaded successfully")
    else:
        print_check(FAIL, "Dashboard source file parsing failed")
        status = degrade_status(status, FAIL)
        notes.append("Could not parse dashboard data files")
        return SectionResult(name=section_name, status=status, notes=notes)

    has_minimum_entries = len(detection_log) >= 1 and len(reputation_db) >= 1
    if has_minimum_entries:
        print_check(PASS, f"Minimum entries present | detections={len(detection_log)}, reputation={len(reputation_db)}")
    else:
        print_check(FAIL, f"Minimum 1 entry check failed | detections={len(detection_log)}, reputation={len(reputation_db)}")
        status = degrade_status(status, FAIL)
        notes.append("Insufficient dashboard source data")

    return SectionResult(name=section_name, status=status, notes=notes)


def print_system_status_summary(subsystem_statuses: dict[str, str]) -> None:
    print_section_header("SECTION 11 — SYSTEM STATUS SUMMARY")
    for subsystem, subsystem_status in subsystem_statuses.items():
        print(f"{subsystem}: [{subsystem_status}]")


def print_readiness_score(subsystem_statuses: dict[str, str], section_results: list[SectionResult]) -> None:
    print_section_header("SECTION 12 — READINESS SCORE")
    score_map = {PASS: 1.0, WARNING: 0.5, FAIL: 0.0}
    values = [score_map.get(result.status, 0.0) for result in section_results]
    readiness = round((sum(values) / len(values)) * 100) if values else 0
    print(f"System Readiness Score: {readiness}%")

    if readiness >= 85 and all(result.status != FAIL for result in section_results):
        print("READY FOR DEMO")
    else:
        print("NEEDS FIXES BEFORE DEMO")


def main() -> int:
    print("\nR.E.I. SYSTEM INTEGRITY AUDIT")
    print(f"Project Root: {BASE_DIR}")
    print(f"Timestamp (UTC): {datetime.now(timezone.utc).isoformat()}")

    section_results: list[SectionResult] = []
    api_process: subprocess.Popen[str] | None = None
    started_api_here = False

    try:
        section_results.append(section_environment_check())
        section_results.append(section_model_loading_test())

        section3, api_process, started_api_here = section_scanner_api_test()
        section_results.append(section3)
        section_results.append(section_url_analyzer_test())
        section_results.append(section_file_analyzer_test())
        section_results.append(section_reputation_database_test())
        section_results.append(section_detection_log_test())
        section_results.append(section_file_monitor_service_test())
        section_results.append(section_extension_connectivity_test())
        section_results.append(section_dashboard_data_pipeline_test())
    except Exception as exc:
        print_check(FAIL, f"Diagnostic run crashed: {exc}")
        print(traceback.format_exc())
        return 1
    finally:
        if started_api_here:
            stop_process(api_process)

    subsystem_statuses = {
        "MODEL STATUS": section_results[1].status if len(section_results) > 1 else FAIL,
        "API STATUS": degrade_status(
            section_results[2].status if len(section_results) > 2 else FAIL,
            degrade_status(
                section_results[3].status if len(section_results) > 3 else FAIL,
                section_results[4].status if len(section_results) > 4 else FAIL,
            ),
        ),
        "FILE MONITOR STATUS": section_results[7].status if len(section_results) > 7 else FAIL,
        "EXTENSION SIMULATION STATUS": section_results[8].status if len(section_results) > 8 else FAIL,
        "REPUTATION ENGINE STATUS": section_results[5].status if len(section_results) > 5 else FAIL,
        "DETECTION LOG STATUS": section_results[6].status if len(section_results) > 6 else FAIL,
        "DASHBOARD DATA STATUS": section_results[9].status if len(section_results) > 9 else FAIL,
    }

    print_system_status_summary(subsystem_statuses)
    print_readiness_score(subsystem_statuses, section_results)

    overall_status = PASS
    for result in section_results:
        overall_status = degrade_status(overall_status, result.status)
    return 0 if overall_status != FAIL else 1


if __name__ == "__main__":
    raise SystemExit(main())
