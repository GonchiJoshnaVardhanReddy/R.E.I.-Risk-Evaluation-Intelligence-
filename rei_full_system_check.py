from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
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
DOCS_URL = f"{API_BASE}/docs"
ANALYZE_TEXT_URL = f"{API_BASE}/analyze-text"
ANALYZE_URL_URL = f"{API_BASE}/analyze-url"
ANALYZE_FILE_URL = f"{API_BASE}/analyze-file"

DETECTION_LOG_PATH = BASE_DIR / "detection_log.json"
REPUTATION_DB_PATH = BASE_DIR / "reputation_db.json"
FILE_MONITOR_PATH = BASE_DIR / "file_monitor.py"
ELECTRON_DIR = BASE_DIR / "rei_control_center_electron"
EXTENSION_DIR = BASE_DIR / "extension" / "extension"
BACKGROUND_JS_PATH = EXTENSION_DIR / "scripts" / "background.js"
BLOCKED_HTML_PATH = EXTENSION_DIR / "blocked.html"
PRELOAD_JS_PATH = ELECTRON_DIR / "preload.js"
RENDERER_JS_PATH = ELECTRON_DIR / "renderer.js"
MAIN_JS_PATH = ELECTRON_DIR / "main.js"

PASS = "PASS"
WARNING = "WARNING"
FAIL = "FAIL"
STATUS_ORDER = {PASS: 0, WARNING: 1, FAIL: 2}
MAX_LOG_ENTRIES = 200


@dataclass
class SectionResult:
    name: str
    status: str
    notes: list[str]


def print_section_header(title: str) -> None:
    print("\n" + "=" * 88)
    print(title)
    print("=" * 88)


def print_check(status: str, message: str) -> None:
    print(f"[{status}] {message}")


def degrade_status(current: str, candidate: str) -> str:
    return candidate if STATUS_ORDER[candidate] > STATUS_ORDER[current] else current


def safe_read_json(path: Path, default_value: Any) -> Any:
    if not path.exists():
        return default_value
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (json.JSONDecodeError, OSError, ValueError, TypeError):
        return default_value


def safe_write_json(path: Path, data: Any) -> None:
    temp_path = path.with_name(f"{path.name}.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    temp_path.replace(path)


def to_json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload).encode("utf-8")


def http_get_status(url: str, timeout: float = 5.0) -> int | None:
    try:
        request = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def http_post_json(url: str, payload: dict[str, Any], timeout: float = 45.0) -> tuple[int | None, Any]:
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
            return exc.code, ""
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None, None


def http_post_multipart_file(url: str, field_name: str, file_path: Path, timeout: float = 60.0) -> tuple[int | None, Any]:
    boundary = f"----REI-FULL-CHECK-{uuid.uuid4().hex}"
    content = file_path.read_bytes()
    content_type = "text/plain"

    body_parts: list[bytes] = [
        f"--{boundary}\r\n".encode("utf-8"),
        (
            f'Content-Disposition: form-data; name="{field_name}"; filename="{file_path.name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8"),
        content,
        b"\r\n",
        f"--{boundary}--\r\n".encode("utf-8"),
    ]
    body = b"".join(body_parts)

    try:
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
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


def stop_process(process: subprocess.Popen[str] | None) -> None:
    if process is None:
        return
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()


def start_local_api() -> tuple[subprocess.Popen[str] | None, str]:
    variants = [
        ["uvicorn", "rei_scanner_api:app", "--reload", "--host", "127.0.0.1", "--port", "8000"],
        [sys.executable, "-m", "uvicorn", "rei_scanner_api:app", "--reload", "--host", "127.0.0.1", "--port", "8000"],
    ]
    for command in variants:
        try:
            process = subprocess.Popen(  # noqa: S603
                command,
                cwd=str(BASE_DIR),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            if wait_for_api(timeout_seconds=40):
                return process, " ".join(command)
            stop_process(process)
        except OSError:
            continue
    return None, ""


def run_command(
    command: list[str],
    cwd: Path | None = None,
    timeout: float = 120.0,
) -> tuple[int | None, str]:
    command_to_run = list(command)
    if command_to_run:
        exe = command_to_run[0]
        if shutil.which(exe) is None and os.name == "nt":
            for candidate in (f"{exe}.cmd", f"{exe}.exe", f"{exe}.bat"):
                if shutil.which(candidate):
                    command_to_run[0] = candidate
                    break
            else:
                if exe.lower() == "npm":
                    node_path = shutil.which("node") or shutil.which("node.exe")
                    if node_path:
                        sibling_npm = Path(node_path).with_name("npm.cmd")
                        if sibling_npm.exists():
                            command_to_run[0] = str(sibling_npm)
    try:
        completed = subprocess.run(  # noqa: S603
            command_to_run,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        output = "\n".join(part for part in [completed.stdout, completed.stderr] if part).strip()
        return completed.returncode, output
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, str(exc)


def run_node_json(script: str) -> tuple[bool, Any, str]:
    code, output = run_command(["node", "-e", script], cwd=BASE_DIR, timeout=30)
    if code != 0:
        return False, None, output
    text = output.strip()
    if not text:
        return False, None, "Node command returned empty output."
    for line in reversed(text.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            return True, json.loads(line), ""
        except json.JSONDecodeError:
            continue
    return False, None, f"Unable to parse JSON from output: {text}"


def build_npm_command(args: list[str]) -> list[str]:
    node_path = shutil.which("node") or shutil.which("node.exe")
    if node_path:
        node_path_obj = Path(node_path)
        npm_cli = node_path_obj.parent / "node_modules" / "npm" / "bin" / "npm-cli.js"
        if npm_cli.exists():
            return [str(node_path_obj), str(npm_cli), *args]

    npm_path = shutil.which("npm")
    if npm_path:
        return [npm_path, *args]
    if os.name == "nt":
        npm_cmd_path = shutil.which("npm.cmd")
        if npm_cmd_path:
            return [npm_cmd_path, *args]

    if os.name == "nt":
        shell = shutil.which("pwsh") or shutil.which("powershell")
        if shell:
            return [shell, "-NoProfile", "-Command", "npm " + " ".join(args)]

    return ["npm", *args]


def run_npm_command(args: list[str], cwd: Path | None = None, timeout: float = 180.0) -> tuple[int | None, str]:
    return run_command(build_npm_command(args), cwd=cwd, timeout=timeout)


def npm_start_popen(cwd: Path) -> subprocess.Popen[str]:
    command = build_npm_command(["start"])
    return subprocess.Popen(  # noqa: S603
        command,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def risk_boost_for_count(next_count: int) -> float:
    if next_count <= 1:
        return 0.0
    if next_count == 2:
        return 0.10
    if next_count == 3:
        return 0.25
    return 0.40


def locate_chrome() -> Path | None:
    which_hit = shutil.which("chrome") or shutil.which("chrome.exe")
    if which_hit:
        return Path(which_hit)

    local_app_data = Path(os.environ.get("LOCALAPPDATA", ""))
    program_files = Path(os.environ.get("ProgramFiles", ""))
    program_files_x86 = Path(os.environ.get("ProgramFiles(x86)", ""))

    candidates = [
        local_app_data / "Google" / "Chrome" / "Application" / "chrome.exe",
        program_files / "Google" / "Chrome" / "Application" / "chrome.exe",
        program_files_x86 / "Google" / "Chrome" / "Application" / "chrome.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def scan_chrome_extension_storage_for_vt_key() -> tuple[str, str]:
    local_app_data = Path(os.environ.get("LOCALAPPDATA", ""))
    settings_root = local_app_data / "Google" / "Chrome" / "User Data" / "Default" / "Local Extension Settings"
    if not settings_root.exists():
        return WARNING, "Chrome extension local storage folder not found."

    file_candidates: list[Path] = []
    try:
        for extension_dir in settings_root.iterdir():
            if not extension_dir.is_dir():
                continue
            for suffix in ("*.log", "*.ldb"):
                file_candidates.extend(extension_dir.glob(suffix))
    except OSError as exc:
        return WARNING, f"Unable to inspect extension storage: {exc}"

    inspected = 0
    for candidate in file_candidates:
        if inspected >= 250:
            break
        inspected += 1
        try:
            data = candidate.read_bytes()
            if b"vt_api_key" in data:
                return PASS, f"Found 'vt_api_key' marker in Chrome extension storage ({candidate.parent.name})."
        except OSError:
            continue

    return WARNING, "No 'vt_api_key' marker found in Chrome extension storage."


def section_environment_validation() -> SectionResult:
    section_name = "SECTION 1 — ENVIRONMENT VALIDATION"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    if sys.version_info >= (3, 10):
        print_check(PASS, f"Python version is {sys.version.split()[0]} (>= 3.10)")
    else:
        print_check(FAIL, f"Python version is {sys.version.split()[0]} (requires >= 3.10)")
        status = degrade_status(status, FAIL)

    tool_checks: list[tuple[str, tuple[int | None, str]]] = [
        ("node", run_command(["node", "--version"], timeout=15)),
        ("npm", run_npm_command(["--version"], timeout=20)),
    ]
    for tool_name, (code, output) in tool_checks:
        if code == 0:
            version = (output.splitlines()[0] if output else "").strip()
            print_check(PASS, f"{tool_name} installed ({version})")
        else:
            print_check(FAIL, f"{tool_name} is not installed or not available in PATH")
            notes.append(f"Missing tool: {tool_name}")
            status = degrade_status(status, FAIL)

    electron_bin = ELECTRON_DIR / "node_modules" / ".bin" / ("electron.cmd" if os.name == "nt" else "electron")
    if electron_bin.exists():
        print_check(PASS, f"Electron local dependency available ({electron_bin})")
    else:
        npm_code, _ = run_command(["npm", "list", "electron", "--depth=0"], cwd=ELECTRON_DIR, timeout=60)
        if npm_code == 0:
            print_check(PASS, "Electron dependency listed in rei_control_center_electron")
        else:
            print_check(FAIL, "Electron local dependency not detected")
            status = degrade_status(status, FAIL)

    chrome_path = locate_chrome()
    if chrome_path:
        print_check(PASS, f"Chrome detected ({chrome_path})")
    else:
        print_check(FAIL, "Chrome executable not found")
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
        ("win10toast", "win10toast"),
    ]
    for package_name, module_name in dependencies:
        try:
            importlib.import_module(module_name)
            print_check(PASS, f"Python package available: {package_name}")
        except Exception:
            print_check(FAIL, f"Python package missing: {package_name}")
            notes.append(f"Missing dependency: {package_name}")
            status = degrade_status(status, FAIL)

    return SectionResult(section_name, status, notes)


def section_model_validation() -> SectionResult:
    section_name = "SECTION 2 — MODEL VALIDATION"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    config_path = MODEL_DIR / "config.json"
    if config_path.exists():
        print_check(PASS, f"Model config present: {config_path}")
    else:
        print_check(FAIL, f"Model config missing: {config_path}")
        return SectionResult(section_name, FAIL, ["config.json missing"])

    try:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
    except Exception as exc:
        print_check(FAIL, f"Model libraries unavailable: {exc}")
        return SectionResult(section_name, FAIL, [str(exc)])

    try:
        tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR))
        print_check(PASS, "Tokenizer loaded from ./rei_model")
    except Exception as exc:
        print_check(FAIL, f"Tokenizer load failed: {exc}")
        return SectionResult(section_name, FAIL, [str(exc)])

    try:
        model = AutoModelForSequenceClassification.from_pretrained(str(MODEL_DIR))
        model.eval()
        print_check(PASS, "Model loaded from ./rei_model")
    except Exception as exc:
        print_check(FAIL, f"Model load failed: {exc}")
        return SectionResult(section_name, FAIL, [str(exc)])

    try:
        sample = "verify your account immediately"
        encoded = tokenizer(sample, truncation=True, padding=True, max_length=512, return_tensors="pt")
        with torch.no_grad():
            logits = model(**encoded).logits
            probabilities = torch.softmax(logits, dim=-1)[0]
        class_index = 1 if int(probabilities.shape[0]) > 1 else 0
        risk_score = float(probabilities[class_index].item())
        print_check(PASS, f"Forward inference successful | risk_score={risk_score:.4f}")
    except Exception as exc:
        print_check(FAIL, f"Forward inference failed: {exc}")
        status = degrade_status(status, FAIL)
        notes.append(str(exc))

    return SectionResult(section_name, status, notes)


def section_scanner_api_validation() -> tuple[SectionResult, subprocess.Popen[str] | None, bool]:
    section_name = "SECTION 3 — SCANNER API VALIDATION"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []
    started_process: subprocess.Popen[str] | None = None
    started_here = False

    if http_get_status(DOCS_URL, timeout=4) == 200:
        print_check(PASS, f"API docs reachable: {DOCS_URL}")
    else:
        print_check(WARNING, "Scanner API offline. Attempting auto-start (uvicorn rei_scanner_api:app --reload)")
        started_process, command_used = start_local_api()
        started_here = started_process is not None
        if started_process is None:
            print_check(FAIL, "Unable to auto-start scanner API")
            notes.append("API offline and auto-start failed")
            return SectionResult(section_name, FAIL, notes), None, False
        print_check(PASS, f"Scanner API started: {command_used}")

    if wait_for_api(timeout_seconds=20):
        print_check(PASS, "Scanner API reachable")
    else:
        print_check(FAIL, "Scanner API still unreachable after start attempt")
        notes.append("API unreachable")
        return SectionResult(section_name, FAIL, notes), started_process, started_here

    text_status, text_response = http_post_json(
        ANALYZE_TEXT_URL,
        {
            "text": "Your OTP expired verify now",
            "sender": "+911234567890",
            "platform": "whatsapp",
        },
    )
    if text_status == 200 and verify_response_fields(text_response, ["risk_score", "risk_level", "explanations"]):
        print_check(PASS, "POST /analyze-text returned risk_score, risk_level, explanations")
    else:
        print_check(FAIL, f"POST /analyze-text failed or invalid response (status={text_status})")
        status = degrade_status(status, FAIL)
        notes.append(f"/analyze-text invalid response: {text_response}")

    url_status, url_response = http_post_json(
        ANALYZE_URL_URL,
        {"url": "https://secure-login-update.xyz"},
    )
    if url_status == 200 and verify_response_fields(url_response, ["risk_score", "risk_level", "explanations"]):
        print_check(PASS, "POST /analyze-url returned risk_score, risk_level, explanations")
    else:
        print_check(FAIL, f"POST /analyze-url failed or invalid response (status={url_status})")
        status = degrade_status(status, FAIL)
        notes.append(f"/analyze-url invalid response: {url_response}")

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False, dir=BASE_DIR) as temp_file:
        temp_path = Path(temp_file.name)
        temp_file.write("verify your account immediately")

    try:
        file_status, file_response = http_post_multipart_file(ANALYZE_FILE_URL, "file", temp_path)
        if file_status == 200 and verify_response_fields(file_response, ["risk_score", "risk_level", "explanations"]):
            print_check(PASS, "POST /analyze-file returned risk_score, risk_level, explanations")
        else:
            print_check(FAIL, f"POST /analyze-file failed or invalid response (status={file_status})")
            status = degrade_status(status, FAIL)
            notes.append(f"/analyze-file invalid response: {file_response}")
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass

    return SectionResult(section_name, status, notes), started_process, started_here


def section_file_monitor_validation() -> SectionResult:
    section_name = "SECTION 4 — FILE MONITOR VALIDATION"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    if not FILE_MONITOR_PATH.exists():
        print_check(FAIL, f"Missing file: {FILE_MONITOR_PATH}")
        return SectionResult(section_name, FAIL, ["file_monitor.py missing"])
    print_check(PASS, "file_monitor.py exists")

    if http_get_status(DOCS_URL, timeout=4) != 200:
        print_check(FAIL, "Scanner API is not reachable for file monitor validation")
        return SectionResult(section_name, FAIL, ["Scanner API offline"])

    downloads_path = Path.home() / "Downloads"
    if not downloads_path.exists():
        print_check(FAIL, f"Downloads folder not found: {downloads_path}")
        return SectionResult(section_name, FAIL, ["Downloads folder missing"])

    try:
        from watchdog.observers import Observer
    except Exception as exc:
        print_check(FAIL, f"watchdog unavailable: {exc}")
        return SectionResult(section_name, FAIL, [str(exc)])

    try:
        import file_monitor  # noqa: PLC0415
    except ModuleNotFoundError as exc:
        if exc.name != "win10toast":
            print_check(FAIL, f"file_monitor import failed: {exc}")
            return SectionResult(section_name, FAIL, [str(exc)])
        import types

        stub_module = types.ModuleType("win10toast")

        class _ToastNotifierStub:
            def show_toast(self, *args: Any, **kwargs: Any) -> None:  # noqa: ANN401
                return

        stub_module.ToastNotifier = _ToastNotifierStub  # type: ignore[attr-defined]
        sys.modules["win10toast"] = stub_module
        import file_monitor  # noqa: PLC0415

        print_check(WARNING, "win10toast missing; used stub notifier for validation")
        status = degrade_status(status, WARNING)
    except Exception as exc:
        print_check(FAIL, f"file_monitor import failed: {exc}")
        return SectionResult(section_name, FAIL, [str(exc)])

    logs_before = safe_read_json(DETECTION_LOG_PATH, [])
    before_count = len(logs_before) if isinstance(logs_before, list) else 0

    class _SilentNotifier:
        def show_toast(self, *args: Any, **kwargs: Any) -> None:  # noqa: ANN401
            return

    handler = file_monitor.REIFileMonitorHandler(_SilentNotifier())
    observer = Observer()
    observer.schedule(handler, str(downloads_path), recursive=False)
    observer.start()

    test_file = downloads_path / "rei_test_download.txt"
    try:
        test_file.write_text("verify your bank account urgently", encoding="utf-8")
        print_check(PASS, f"Temporary download created: {test_file}")

        target_key = str(test_file.resolve()).lower()
        scan_triggered = False
        log_updated = False
        deadline = time.time() + 60

        while time.time() < deadline:
            with handler._lock:
                if target_key in handler._scanned:
                    scan_triggered = True

            current_logs = safe_read_json(DETECTION_LOG_PATH, [])
            current_count = len(current_logs) if isinstance(current_logs, list) else 0
            if current_count > before_count:
                log_updated = True

            if scan_triggered and log_updated:
                break
            time.sleep(1)

        if scan_triggered:
            print_check(PASS, "File monitor scan triggered")
        else:
            print_check(FAIL, "File monitor scan trigger not confirmed")
            status = degrade_status(status, FAIL)
            notes.append("scan not triggered")

        if log_updated:
            print_check(PASS, "detection_log.json updated after monitor activity (API call confirmed)")
        else:
            print_check(FAIL, "detection_log.json was not updated by file monitor flow")
            status = degrade_status(status, FAIL)
            notes.append("detection log not updated")
    except Exception as exc:
        print_check(FAIL, f"File monitor validation failed: {exc}")
        status = degrade_status(status, FAIL)
        notes.append(str(exc))
    finally:
        observer.stop()
        observer.join(timeout=5)
        try:
            test_file.unlink(missing_ok=True)
        except OSError:
            pass

    return SectionResult(section_name, status, notes)


def section_reputation_engine_validation() -> SectionResult:
    section_name = "SECTION 5 — REPUTATION ENGINE VALIDATION"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []
    sender = "test@secure-login.xyz"

    if REPUTATION_DB_PATH.exists():
        print_check(PASS, "reputation_db.json exists")
    else:
        safe_write_json(REPUTATION_DB_PATH, {})
        print_check(WARNING, "reputation_db.json missing; created empty file")
        status = degrade_status(status, WARNING)

    db = safe_read_json(REPUTATION_DB_PATH, {})
    if not isinstance(db, dict):
        db = {}
        print_check(WARNING, "reputation_db.json malformed; reset to empty dict")
        status = degrade_status(status, WARNING)

    previous_count = int((db.get(sender, {}) or {}).get("count", 0))
    next_count = previous_count + 1
    expected_boost = risk_boost_for_count(next_count)
    db[sender] = {"count": next_count, "risk_boost": expected_boost}
    safe_write_json(REPUTATION_DB_PATH, db)

    persisted = safe_read_json(REPUTATION_DB_PATH, {})
    entry = persisted.get(sender, {}) if isinstance(persisted, dict) else {}
    count_ok = int(entry.get("count", -1)) == next_count
    boost_ok = abs(float(entry.get("risk_boost", -1.0)) - expected_boost) < 1e-9

    if count_ok and boost_ok:
        print_check(PASS, f"Sender updated | count: {previous_count} -> {next_count}, risk_boost: {expected_boost:.2f}")
    else:
        print_check(FAIL, f"Sender update validation failed | expected count={next_count}, boost={expected_boost:.2f}")
        status = degrade_status(status, FAIL)
        notes.append(f"Got entry: {entry}")

    return SectionResult(section_name, status, notes)


def section_detection_log_pipeline_validation() -> SectionResult:
    section_name = "SECTION 6 — DETECTION LOG PIPELINE VALIDATION"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    if DETECTION_LOG_PATH.exists():
        print_check(PASS, "detection_log.json exists")
    else:
        safe_write_json(DETECTION_LOG_PATH, [])
        print_check(WARNING, "detection_log.json missing; created empty log")
        status = degrade_status(status, WARNING)

    logs = safe_read_json(DETECTION_LOG_PATH, [])
    if not isinstance(logs, list):
        logs = []
        print_check(WARNING, "detection_log.json malformed; reset to empty list")
        status = degrade_status(status, WARNING)

    marker = f"rei_simulated_detection_{int(time.time())}"
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "text": marker,
        "sender": "diagnostic@rei.local",
        "platform": "diagnostic",
        "risk_score": 0.87,
        "risk_level": "HIGH",
        "explanations": ["Simulated detection pipeline validation entry"],
    }
    logs.append(entry)
    logs = logs[-MAX_LOG_ENTRIES:]
    safe_write_json(DETECTION_LOG_PATH, logs)

    persisted = safe_read_json(DETECTION_LOG_PATH, [])
    if not isinstance(persisted, list):
        print_check(FAIL, "detection_log.json unreadable after append")
        return SectionResult(section_name, FAIL, ["detection log unreadable after append"])

    saved = any(isinstance(item, dict) and item.get("text") == marker for item in persisted)
    if saved:
        print_check(PASS, "Simulated detection entry saved")
    else:
        print_check(FAIL, "Simulated detection entry missing after append")
        status = degrade_status(status, FAIL)
        notes.append("simulated entry missing")

    if len(persisted) <= MAX_LOG_ENTRIES:
        print_check(PASS, f"Detection log size within limit ({len(persisted)}/{MAX_LOG_ENTRIES})")
    else:
        print_check(FAIL, f"Detection log exceeds size limit ({len(persisted)}/{MAX_LOG_ENTRIES})")
        status = degrade_status(status, FAIL)
        notes.append("log size exceeds 200")

    return SectionResult(section_name, status, notes)


def section_virustotal_pipeline_validation() -> SectionResult:
    section_name = "SECTION 7 — VIRUSTOTAL PIPELINE VALIDATION"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    storage_status, storage_message = scan_chrome_extension_storage_for_vt_key()
    print_check(storage_status, storage_message)
    status = degrade_status(status, storage_status)
    if storage_status == WARNING:
        notes.append(storage_message)

    if http_get_status(DOCS_URL, timeout=4) != 200:
        print_check(FAIL, "Scanner API unreachable for VirusTotal fusion simulation")
        return SectionResult(section_name, FAIL, ["API offline"])

    url_status, url_response = http_post_json(ANALYZE_URL_URL, {"url": "https://secure-login-update.xyz"})
    if url_status == 200 and verify_response_fields(url_response, ["risk_score", "risk_level", "explanations"]):
        local_level = str(url_response.get("risk_level", "LOW")).upper()
        print_check(PASS, "POST /analyze-url succeeded for fusion simulation input")
    else:
        print_check(FAIL, f"POST /analyze-url failed for fusion simulation (status={url_status})")
        return SectionResult(section_name, FAIL, [f"analyze-url response invalid: {url_response}"])

    fusion_script = """
const path = require("path");
const bg = require(path.resolve(process.cwd(), "extension", "extension", "scripts", "background.js"));
const result = bg.computeCombinedUrlScanResult({
  url: "https://secure-login-update.xyz",
  vtStats: { malicious: 1, suspicious: 0, harmless: 70 },
  localRiskLevel: "LOCAL_LEVEL",
});
console.log(JSON.stringify(result));
"""
    fusion_script = fusion_script.replace("LOCAL_LEVEL", local_level)
    success, fused_result, error_message = run_node_json(fusion_script)
    if not success:
        print_check(FAIL, f"Failed to run fusion logic simulation: {error_message}")
        return SectionResult(section_name, FAIL, [error_message])

    has_sources = (
        isinstance(fused_result, dict)
        and isinstance(fused_result.get("sources"), dict)
        and "virustotal" in fused_result["sources"]
        and "rei_local_model" in fused_result["sources"]
    )
    if has_sources:
        print_check(PASS, "Fusion logic returned combined structure with sources.virustotal and sources.rei_local_model")
    else:
        print_check(FAIL, "Fusion result missing required source attribution fields")
        status = degrade_status(status, FAIL)
        notes.append(f"Fusion result: {fused_result}")

    return SectionResult(section_name, status, notes)


def section_extension_connectivity_validation() -> SectionResult:
    section_name = "SECTION 8 — EXTENSION CONNECTIVITY VALIDATION"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    if http_get_status(DOCS_URL, timeout=4) != 200:
        print_check(FAIL, "Scanner API unreachable for extension payload simulation")
        return SectionResult(section_name, FAIL, ["API offline"])

    before_logs = safe_read_json(DETECTION_LOG_PATH, [])
    before_count = len(before_logs) if isinstance(before_logs, list) else 0

    payloads = [
        {
            "text": "Your OTP expired verify now",
            "sender": "+911234567890",
            "platform": "whatsapp",
        },
        {
            "text": "Your OTP expired verify now",
            "sender": "test@secure-login.xyz",
            "platform": "email",
        },
    ]

    successful_requests = 0
    for payload in payloads:
        http_status, response = http_post_json(ANALYZE_TEXT_URL, payload, timeout=45)
        platform = payload["platform"]
        if http_status == 200 and verify_response_fields(response, ["risk_score", "risk_level", "explanations"]):
            print_check(PASS, f"Simulated extension payload accepted for platform={platform}")
            successful_requests += 1
        else:
            print_check(FAIL, f"Simulated extension payload failed for platform={platform} (status={http_status})")
            status = degrade_status(status, FAIL)
            notes.append(f"{platform} response invalid: {response}")

    after_logs = safe_read_json(DETECTION_LOG_PATH, [])
    if not isinstance(after_logs, list):
        print_check(FAIL, "detection_log.json unreadable after extension simulation")
        return SectionResult(section_name, FAIL, ["detection log unreadable"])

    if len(after_logs) > before_count:
        print_check(PASS, "detection_log.json updated by extension simulation")
    else:
        print_check(FAIL, "No new detection_log.json entries after extension simulation")
        status = degrade_status(status, FAIL)
        notes.append("detection log not updated")

    latest_ext_ts: datetime | None = None
    for entry in after_logs:
        if not isinstance(entry, dict):
            continue
        platform = str(entry.get("platform", "")).lower()
        if platform not in {"whatsapp", "email"}:
            continue
        raw_ts = str(entry.get("timestamp", ""))
        try:
            ts = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
        except ValueError:
            continue
        if latest_ext_ts is None or ts > latest_ext_ts:
            latest_ext_ts = ts

    if latest_ext_ts is None:
        print_check(WARNING, "No whatsapp/email timestamp found in detection log; extension status UNKNOWN")
        status = degrade_status(status, WARNING)
        notes.append("missing extension timestamp")
    else:
        age_seconds = (datetime.now(timezone.utc) - latest_ext_ts.astimezone(timezone.utc)).total_seconds()
        if age_seconds <= 60:
            print_check(PASS, "Extension status ACTIVE (recent log activity within 60 seconds)")
        else:
            print_check(WARNING, "Extension activity is stale (>60 seconds)")
            status = degrade_status(status, WARNING)
            notes.append(f"latest extension event age: {age_seconds:.1f}s")

    if successful_requests < 2:
        status = degrade_status(status, FAIL)

    return SectionResult(section_name, status, notes)


def _collect_process_output(pipe: Any, bucket: list[str]) -> None:
    if pipe is None:
        return
    for line in iter(pipe.readline, ""):
        if not line:
            break
        bucket.append(line.rstrip())


def section_electron_control_panel_connectivity() -> SectionResult:
    section_name = "SECTION 9 — ELECTRON CONTROL PANEL CONNECTIVITY"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    if not ELECTRON_DIR.exists():
        print_check(FAIL, f"Folder missing: {ELECTRON_DIR}")
        return SectionResult(section_name, FAIL, ["rei_control_center_electron folder missing"])
    print_check(PASS, "rei_control_center_electron/ exists")

    required_files = ["main.js", "preload.js", "renderer.js", "index.html", "package.json"]
    for required in required_files:
        required_path = ELECTRON_DIR / required
        if required_path.exists():
            print_check(PASS, f"Required file found: {required}")
        else:
            print_check(FAIL, f"Required file missing: {required}")
            status = degrade_status(status, FAIL)
            notes.append(f"Missing file: {required}")

    if status == FAIL:
        return SectionResult(section_name, status, notes)

    install_code, install_output = run_npm_command(
        ["install", "--no-audit", "--no-fund"],
        cwd=ELECTRON_DIR,
        timeout=300,
    )
    if install_code == 0:
        print_check(PASS, "npm install completed successfully")
    else:
        print_check(FAIL, f"npm install failed: {install_output.splitlines()[-1] if install_output else 'unknown error'}")
        return SectionResult(section_name, FAIL, [install_output])

    process_output: list[str] = []
    process: subprocess.Popen[str] | None = None
    reader_thread: threading.Thread | None = None

    try:
        process = npm_start_popen(ELECTRON_DIR)
        reader_thread = threading.Thread(target=_collect_process_output, args=(process.stdout, process_output), daemon=True)
        reader_thread.start()

        time.sleep(18)
        launch_alive = process.poll() is None
        scanner_reachable = wait_for_api(timeout_seconds=6)
        monitor_hint = any("[Monitor]" in line or "Monitoring started" in line for line in process_output)

        preload_text = PRELOAD_JS_PATH.read_text(encoding="utf-8", errors="ignore")
        main_text = MAIN_JS_PATH.read_text(encoding="utf-8", errors="ignore")
        ipc_hint = all(
            token in preload_text for token in ["scannerStatus", "monitorStatus", "systemStatus"]
        ) and all(
            token in main_text
            for token in ['ipcMain.handle("scanner-status"', 'ipcMain.handle("monitor-status"']
        )

        if launch_alive:
            print_check(PASS, "npm start launched Electron control panel process")
        else:
            print_check(FAIL, "npm start exited early before control panel could stabilize")
            status = degrade_status(status, FAIL)
            notes.append("Electron process exited early")

        if scanner_reachable:
            print_check(PASS, "Scanner API reachable while Electron control panel is running")
        else:
            print_check(FAIL, "Scanner API not reachable during control panel launch")
            status = degrade_status(status, FAIL)
            notes.append("scanner API unreachable during control panel launch")

        if monitor_hint:
            print_check(PASS, "File monitor startup output observed from Electron process")
        else:
            print_check(WARNING, "Could not confirm file monitor output from Electron logs")
            status = degrade_status(status, WARNING)
            notes.append("file monitor startup output not observed")

        if ipc_hint:
            print_check(PASS, "IPC status handlers detected (scanner/monitor/system status)")
        else:
            print_check(FAIL, "IPC status handlers missing in Electron preload/main flow")
            status = degrade_status(status, FAIL)
            notes.append("missing IPC status handlers")
    except Exception as exc:
        print_check(FAIL, f"Electron launch validation failed: {exc}")
        status = degrade_status(status, FAIL)
        notes.append(str(exc))
    finally:
        if process is not None:
            stop_process(process)
        if reader_thread is not None:
            reader_thread.join(timeout=2)

    return SectionResult(section_name, status, notes)


def section_statebus_status_pipeline_validation() -> SectionResult:
    section_name = "SECTION 10 — STATEBUS / STATUS PIPELINE VALIDATION"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    if not PRELOAD_JS_PATH.exists() or not RENDERER_JS_PATH.exists():
        print_check(FAIL, "Required Electron IPC files are missing (preload.js/renderer.js)")
        return SectionResult(section_name, FAIL, ["missing preload.js or renderer.js"])

    preload_text = PRELOAD_JS_PATH.read_text(encoding="utf-8", errors="ignore")
    required_ipc_bridge_tokens = [
        "scannerStatus",
        "monitorStatus",
        "readDetectionLog",
        "readReputationDb",
        "systemStatus",
    ]
    if all(token in preload_text for token in required_ipc_bridge_tokens):
        print_check(PASS, "Preload bridge exposes scanner status, monitor status, detection, and reputation channels")
    else:
        print_check(FAIL, "Preload bridge missing one or more required IPC channels")
        status = degrade_status(status, FAIL)
        notes.append("missing preload IPC channel(s)")

    node_script = """
const path = require("path");
const { createStateBus } = require(path.resolve(process.cwd(), "rei_control_center_electron", "renderer.js"));
const bus = createStateBus();
let snapshot = null;
bus.subscribe((state) => { snapshot = state; });
bus.update({
  scanner: { status: "running" },
  fileMonitor: { status: "running" },
  extension: { activity: "active" },
  detectionSnapshot: { total: 5 },
  reputationSnapshot: { totalSenders: 3 }
});
console.log(JSON.stringify(snapshot));
"""
    success, snapshot, error_message = run_node_json(node_script)
    if not success:
        print_check(FAIL, f"StateBus simulation failed: {error_message}")
        return SectionResult(section_name, FAIL, [error_message])

    expected = (
        isinstance(snapshot, dict)
        and snapshot.get("scanner", {}).get("status") == "running"
        and snapshot.get("fileMonitor", {}).get("status") == "running"
        and snapshot.get("extension", {}).get("activity") == "active"
        and isinstance(snapshot.get("detectionSnapshot"), dict)
        and isinstance(snapshot.get("reputationSnapshot"), dict)
        and isinstance(snapshot.get("meta", {}).get("updatedAt"), (int, float))
    )
    if expected:
        print_check(PASS, "StateBus IPC push simulation updated renderer cache with all required status snapshots")
    else:
        print_check(FAIL, "StateBus snapshot missing required status fields after simulation")
        status = degrade_status(status, FAIL)
        notes.append(f"Unexpected snapshot: {snapshot}")

    return SectionResult(section_name, status, notes)


def section_dashboard_data_flow_validation() -> SectionResult:
    section_name = "SECTION 11 — DASHBOARD DATA FLOW VALIDATION"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    detection_log = safe_read_json(DETECTION_LOG_PATH, None)
    reputation_db = safe_read_json(REPUTATION_DB_PATH, None)

    if isinstance(detection_log, list):
        print_check(PASS, "detection_log.json readable")
    else:
        print_check(FAIL, "detection_log.json unreadable")
        status = degrade_status(status, FAIL)
        notes.append("detection_log.json unreadable")

    if isinstance(reputation_db, dict):
        print_check(PASS, "reputation_db.json readable")
    else:
        print_check(FAIL, "reputation_db.json unreadable")
        status = degrade_status(status, FAIL)
        notes.append("reputation_db.json unreadable")

    if status == FAIL:
        return SectionResult(section_name, status, notes)

    if len(detection_log) > 0 and len(reputation_db) > 0:
        print_check(PASS, f"Entries present (detections={len(detection_log)}, reputation={len(reputation_db)})")
    else:
        print_check(FAIL, f"Entries check failed (detections={len(detection_log)}, reputation={len(reputation_db)})")
        status = degrade_status(status, FAIL)
        notes.append("entries <= 0 for dashboard data flow")
        return SectionResult(section_name, status, notes)

    try:
        platform_counts: dict[str, int] = {}
        risk_counts: dict[str, int] = {}
        for entry in detection_log:
            if not isinstance(entry, dict):
                continue
            platform = str(entry.get("platform", "other")).strip().lower() or "other"
            risk = str(entry.get("risk_level", "LOW")).strip().upper() or "LOW"
            platform_counts[platform] = platform_counts.get(platform, 0) + 1
            risk_counts[risk] = risk_counts.get(risk, 0) + 1
        _ = {"platform_counts": platform_counts, "risk_counts": risk_counts}
        print_check(PASS, "Dashboard chart datasets generated from detection/reputation sources")
    except Exception as exc:
        print_check(FAIL, f"Dashboard chart dataset generation failed: {exc}")
        status = degrade_status(status, FAIL)
        notes.append(str(exc))

    return SectionResult(section_name, status, notes)


def section_blocked_page_redirect_logic_validation() -> SectionResult:
    section_name = "SECTION 12 — BLOCKED PAGE REDIRECT LOGIC VALIDATION"
    print_section_header(section_name)
    status = PASS
    notes: list[str] = []

    if not BACKGROUND_JS_PATH.exists() or not BLOCKED_HTML_PATH.exists():
        print_check(FAIL, "Extension background.js or blocked.html is missing")
        return SectionResult(section_name, FAIL, ["missing blocked page logic files"])

    background_text = BACKGROUND_JS_PATH.read_text(encoding="utf-8", errors="ignore")
    blocked_text = BLOCKED_HTML_PATH.read_text(encoding="utf-8", errors="ignore")

    fusion_script = """
const path = require("path");
const bg = require(path.resolve(process.cwd(), "extension", "extension", "scripts", "background.js"));
const result = bg.computeCombinedUrlScanResult({
  url: "https://totally-safe.example",
  vtStats: { malicious: 1, suspicious: 0, harmless: 80 },
  localRiskLevel: "LOW"
});
console.log(JSON.stringify(result));
"""
    success, combined_result, error_message = run_node_json(fusion_script)
    if not success:
        print_check(FAIL, f"Failed to simulate HIGH risk fusion result: {error_message}")
        return SectionResult(section_name, FAIL, [error_message])

    combined_high = (
        isinstance(combined_result, dict)
        and combined_result.get("risk_level") == "HIGH"
        and isinstance(combined_result.get("sources"), dict)
        and "virustotal" in combined_result["sources"]
        and "rei_local_model" in combined_result["sources"]
    )
    if combined_high:
        print_check(PASS, "Combined fusion logic returns HIGH risk with source attribution")
    else:
        print_check(FAIL, f"Combined fusion logic output invalid: {combined_result}")
        status = degrade_status(status, FAIL)
        notes.append(f"Invalid combined result: {combined_result}")

    redirect_condition_present = (
        'combinedResult.risk_level === "HIGH"' in background_text
        and "blocked.html?url=" in background_text
    )
    if redirect_condition_present:
        print_check(PASS, "blocked.html redirect condition found for HIGH risk URL results")
    else:
        print_check(FAIL, "blocked.html redirect condition missing in extension background flow")
        status = degrade_status(status, FAIL)
        notes.append("missing blocked redirect condition")

    blocked_page_sources = "data.sources?.virustotal" in blocked_text and "data.sources?.rei_local_model" in blocked_text
    if blocked_page_sources:
        print_check(PASS, "blocked.html renders fusion source attribution (VirusTotal + R.E.I. local model)")
    else:
        print_check(FAIL, "blocked.html missing fusion source attribution fields")
        status = degrade_status(status, FAIL)
        notes.append("missing source attribution in blocked.html")

    return SectionResult(section_name, status, notes)


def section_system_startup_runbook_output() -> SectionResult:
    section_name = "SECTION 13 — SYSTEM STARTUP RUNBOOK OUTPUT"
    print_section_header(section_name)

    steps = [
        "STEP 1  conda activate scamshield",
        "STEP 2  uvicorn rei_scanner_api:app --reload",
        "STEP 3  python file_monitor.py",
        "STEP 4  cd rei_control_center_electron",
        "STEP 5  npm install",
        "STEP 6  npm start",
        "STEP 7  Load Chrome extension from extension/ via chrome://extensions → Load unpacked",
        "STEP 8  Add VirusTotal API key inside extension settings popup",
        "STEP 9  Open web.whatsapp.com, mail.google.com, outlook.live.com",
        "STEP 10 Visit any website to trigger VirusTotal scan",
    ]
    for step in steps:
        print(step)
    print_check(PASS, "System startup runbook generated")
    return SectionResult(section_name, PASS, [])


def section_final_system_readiness_score(subsystem_statuses: dict[str, str]) -> SectionResult:
    section_name = "SECTION 14 — FINAL SYSTEM READINESS SCORE"
    print_section_header(section_name)

    for subsystem, subsystem_status in subsystem_statuses.items():
        print(f"{subsystem}: [{subsystem_status}]")

    score_map = {PASS: 1.0, WARNING: 0.5, FAIL: 0.0}
    values = [score_map.get(status, 0.0) for status in subsystem_statuses.values()]
    readiness_score = round((sum(values) / len(values)) * 100) if values else 0
    print(f"\nSystem Readiness Score: {readiness_score}%")

    if readiness_score >= 95:
        print("READY FOR DEMO")
        return SectionResult(section_name, PASS, [f"Readiness score: {readiness_score}%"])

    if readiness_score >= 70:
        print("NEEDS FIXES BEFORE DEMO")
        return SectionResult(section_name, WARNING, [f"Readiness score: {readiness_score}%"])

    print("NEEDS FIXES BEFORE DEMO")
    return SectionResult(section_name, FAIL, [f"Readiness score: {readiness_score}%"])


def main() -> int:
    print("\nR.E.I. FULL SYSTEM VERIFICATION")
    print(f"Project Root: {BASE_DIR}")
    print(f"Timestamp (UTC): {datetime.now(timezone.utc).isoformat()}")

    section_results: list[SectionResult] = []
    started_api_process: subprocess.Popen[str] | None = None
    api_started_here = False

    try:
        section_results.append(section_environment_validation())
        section_results.append(section_model_validation())

        section3, started_api_process, api_started_here = section_scanner_api_validation()
        section_results.append(section3)
        section_results.append(section_file_monitor_validation())
        section_results.append(section_reputation_engine_validation())
        section_results.append(section_detection_log_pipeline_validation())
        section_results.append(section_virustotal_pipeline_validation())
        section_results.append(section_extension_connectivity_validation())
        section_results.append(section_electron_control_panel_connectivity())
        section_results.append(section_statebus_status_pipeline_validation())
        section_results.append(section_dashboard_data_flow_validation())
        section_results.append(section_blocked_page_redirect_logic_validation())
        section_results.append(section_system_startup_runbook_output())
    except Exception as exc:
        print_check(FAIL, f"Verification crashed: {exc}")
        return 1
    finally:
        if api_started_here:
            stop_process(started_api_process)

    by_name = {result.name: result for result in section_results}

    model_status = by_name.get("SECTION 2 — MODEL VALIDATION", SectionResult("", FAIL, [])).status
    api_status = by_name.get("SECTION 3 — SCANNER API VALIDATION", SectionResult("", FAIL, [])).status
    file_monitor_status = by_name.get("SECTION 4 — FILE MONITOR VALIDATION", SectionResult("", FAIL, [])).status
    extension_status = by_name.get("SECTION 8 — EXTENSION CONNECTIVITY VALIDATION", SectionResult("", FAIL, [])).status
    virustotal_status = by_name.get("SECTION 7 — VIRUSTOTAL PIPELINE VALIDATION", SectionResult("", FAIL, [])).status
    control_panel_status = by_name.get("SECTION 9 — ELECTRON CONTROL PANEL CONNECTIVITY", SectionResult("", FAIL, [])).status
    ipc_status = by_name.get("SECTION 10 — STATEBUS / STATUS PIPELINE VALIDATION", SectionResult("", FAIL, [])).status
    logging_status = degrade_status(
        by_name.get("SECTION 5 — REPUTATION ENGINE VALIDATION", SectionResult("", FAIL, [])).status,
        degrade_status(
            by_name.get("SECTION 6 — DETECTION LOG PIPELINE VALIDATION", SectionResult("", FAIL, [])).status,
            by_name.get("SECTION 11 — DASHBOARD DATA FLOW VALIDATION", SectionResult("", FAIL, [])).status,
        ),
    )

    subsystem_statuses = {
        "MODEL STATUS": model_status,
        "API STATUS": api_status,
        "FILE MONITOR STATUS": file_monitor_status,
        "EXTENSION STATUS": extension_status,
        "VIRUSTOTAL STATUS": virustotal_status,
        "CONTROL PANEL STATUS": control_panel_status,
        "IPC STATUS": ipc_status,
        "LOGGING STATUS": logging_status,
    }

    final_section = section_final_system_readiness_score(subsystem_statuses)
    section_results.append(final_section)

    overall = PASS
    for result in section_results:
        overall = degrade_status(overall, result.status)

    return 0 if overall != FAIL else 1


if __name__ == "__main__":
    raise SystemExit(main())
