from __future__ import annotations

import threading
import time
from email import policy
from email.parser import BytesParser
from pathlib import Path
from typing import Any, Optional

import requests
from bs4 import BeautifulSoup
from docx import Document
from pdfminer.high_level import extract_text as pdf_extract_text
from watchdog.events import FileCreatedEvent, FileMovedEvent, FileSystemEventHandler
from watchdog.observers import Observer

try:
    from win10toast import ToastNotifier
except Exception:  # pragma: no cover - environment-dependent optional dependency
    ToastNotifier = None  # type: ignore[assignment]

API_URL = "http://127.0.0.1:8000/analyze-file"
SUPPORTED_EXTENSIONS = {".txt", ".pdf", ".docx", ".html", ".eml"}
FILE_READY_TIMEOUT_SECONDS = 90
FILE_READY_CHECK_INTERVAL_SECONDS = 1
FILE_READY_STABLE_CHECKS = 3


class ConsoleNotifier:
    def show_toast(self, title: str, message: str, duration: int = 7, threaded: bool = True) -> None:
        print(f"[REI] Notification unavailable: {title} | {message}")


def extract_txt_text(file_path: Path) -> str:
    try:
        extracted = file_path.read_text(encoding="utf-8", errors="ignore").strip()
    except OSError as exc:
        print(f"[REI] TXT extraction failed ({file_path.name}): {exc}")
        return ""

    if extracted:
        print(f"[REI] TXT extraction successful ({file_path.name})")
    else:
        print(f"[REI] TXT extraction produced empty text ({file_path.name})")
    return extracted


def extract_pdf_text(file_path: Path) -> str:
    try:
        extracted = pdf_extract_text(str(file_path)).strip()
    except Exception as exc:
        print(f"[REI] PDF extraction failed ({file_path.name}): {exc}")
        return ""

    if extracted:
        print(f"[REI] PDF extraction successful ({file_path.name})")
    else:
        print(f"[REI] PDF extraction produced empty text ({file_path.name})")
    return extracted


def extract_docx_text(file_path: Path) -> str:
    try:
        document = Document(str(file_path))
        extracted = "\n".join(
            paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text and paragraph.text.strip()
        ).strip()
    except Exception as exc:
        print(f"[REI] DOCX extraction failed ({file_path.name}): {exc}")
        return ""

    if extracted:
        print(f"[REI] DOCX extraction successful ({file_path.name})")
    else:
        print(f"[REI] DOCX extraction produced empty text ({file_path.name})")
    return extracted


def extract_html_text(file_path: Path) -> str:
    try:
        html_content = file_path.read_text(encoding="utf-8", errors="ignore")
        soup = BeautifulSoup(html_content, "html.parser")
        for blocked in soup(["script", "style"]):
            blocked.decompose()
        extracted = " ".join(soup.stripped_strings).strip()
    except Exception as exc:
        print(f"[REI] HTML extraction failed ({file_path.name}): {exc}")
        return ""

    if extracted:
        print(f"[REI] HTML extraction successful ({file_path.name})")
    else:
        print(f"[REI] HTML extraction produced empty text ({file_path.name})")
    return extracted


def extract_eml_text(file_path: Path) -> str:
    try:
        file_bytes = file_path.read_bytes()
    except OSError as exc:
        print(f"[REI] EML extraction failed ({file_path.name}): {exc}")
        return ""

    message = BytesParser(policy=policy.default).parsebytes(file_bytes)
    subject = message.get("subject", "")
    chunks: list[str] = []

    if message.is_multipart():
        for part in message.walk():
            if part.get_content_maintype() == "multipart":
                continue
            content_type = part.get_content_type()
            if content_type not in {"text/plain", "text/html"}:
                continue
            content = part.get_content()
            if isinstance(content, bytes):
                decoded = content.decode("utf-8", errors="ignore")
            else:
                decoded = str(content)
            if content_type == "text/html":
                soup = BeautifulSoup(decoded, "html.parser")
                for blocked in soup(["script", "style"]):
                    blocked.decompose()
                decoded = " ".join(soup.stripped_strings).strip()
            chunks.append(decoded)
    else:
        content = message.get_content()
        if isinstance(content, bytes):
            chunks.append(content.decode("utf-8", errors="ignore"))
        else:
            chunks.append(str(content))

    extracted = "\n".join(filter(None, [subject, *chunks])).strip()
    if extracted:
        print(f"[REI] EML extraction successful ({file_path.name})")
    else:
        print(f"[REI] EML extraction produced empty text ({file_path.name})")
    return extracted


def extract_readable_text(file_path: Path) -> str:
    extension = file_path.suffix.lower()
    if extension == ".txt":
        return extract_txt_text(file_path)
    if extension == ".pdf":
        return extract_pdf_text(file_path)
    if extension == ".docx":
        return extract_docx_text(file_path)
    if extension == ".html":
        return extract_html_text(file_path)
    if extension == ".eml":
        return extract_eml_text(file_path)
    return ""


def wait_until_file_ready(file_path: Path) -> bool:
    deadline = time.time() + FILE_READY_TIMEOUT_SECONDS
    stable_checks = 0
    previous_size: Optional[int] = None

    while time.time() < deadline:
        if not file_path.exists():
            time.sleep(FILE_READY_CHECK_INTERVAL_SECONDS)
            continue

        try:
            file_size = file_path.stat().st_size
            with file_path.open("rb") as file_obj:
                file_obj.read(1)
        except OSError:
            time.sleep(FILE_READY_CHECK_INTERVAL_SECONDS)
            continue

        if previous_size == file_size:
            stable_checks += 1
        else:
            stable_checks = 0
            previous_size = file_size

        if stable_checks >= FILE_READY_STABLE_CHECKS:
            return True

        time.sleep(FILE_READY_CHECK_INTERVAL_SECONDS)

    return False


class REIFileMonitorHandler(FileSystemEventHandler):
    def __init__(self, notifier: Any) -> None:
        super().__init__()
        self.notifier = notifier
        self._lock = threading.Lock()
        self._in_progress: set[str] = set()
        self._scanned: set[str] = set()

    def _notify(self, title: str, message: str) -> None:
        try:
            self.notifier.show_toast(title, message, duration=7, threaded=True)
        except Exception:
            print("[REI] Notification unavailable")
            print(f"[REI] {title}: {message}")

    def on_created(self, event: FileCreatedEvent) -> None:
        if event.is_directory:
            return
        self._schedule_scan(Path(event.src_path))

    def on_moved(self, event: FileMovedEvent) -> None:
        if event.is_directory:
            return
        self._schedule_scan(Path(event.dest_path))

    def _schedule_scan(self, file_path: Path) -> None:
        extension = file_path.suffix.lower()
        if extension not in SUPPORTED_EXTENSIONS:
            return

        try:
            file_key = str(file_path.resolve()).lower()
        except OSError:
            return

        with self._lock:
            if file_key in self._in_progress or file_key in self._scanned:
                return
            self._in_progress.add(file_key)

        worker = threading.Thread(
            target=self._scan_file_worker,
            args=(file_path, file_key),
            daemon=True,
        )
        worker.start()

    def _scan_file_worker(self, file_path: Path, file_key: str) -> None:
        try:
            print(f"[REI] New file detected: {file_path.name}")

            if not wait_until_file_ready(file_path):
                print(f"[REI] File not ready in time: {file_path.name}")
                return

            extracted_text = extract_readable_text(file_path)
            if not extracted_text:
                print(f"[REI] Could not extract readable text: {file_path.name}")
                return

            with file_path.open("rb") as file_obj:
                response = requests.post(
                    API_URL,
                    files={"file": (file_path.name, file_obj, "application/octet-stream")},
                    data={"filename": file_path.name},
                    timeout=120,
                )

            if response.status_code != 200:
                print(f"[REI] API error for {file_path.name}: {response.status_code} {response.text}")
                return

            payload = response.json()
            risk_level = str(payload.get("risk_level", "LOW")).upper()
            risk_score = payload.get("risk_score", 0.0)
            print(f"[REI] Risk level: {risk_level}")
            print(f"[REI] Risk score: {risk_score}")

            if risk_level == "HIGH":
                self._notify(
                    "R.E.I. File Monitor",
                    f"⚠ Suspicious file detected by R.E.I.\n{file_path.name}",
                )
            elif risk_level == "MEDIUM":
                self._notify(
                    "R.E.I. File Monitor",
                    f"⚠ This file may be unsafe\n{file_path.name}",
                )
        except requests.RequestException as exc:
            print(f"[REI] Request failed for {file_path.name}: {exc}")
        except OSError as exc:
            print(f"[REI] File read failed for {file_path.name}: {exc}")
        finally:
            with self._lock:
                self._in_progress.discard(file_key)
                self._scanned.add(file_key)


def main() -> None:
    downloads_path = Path.home() / "Downloads"
    if not downloads_path.exists():
        raise FileNotFoundError(f"Downloads folder was not found: {downloads_path}")

    if ToastNotifier is None:
        print("[REI] Notification unavailable")
        notifier = ConsoleNotifier()
    else:
        try:
            notifier = ToastNotifier()
        except Exception:
            print("[REI] Notification unavailable")
            notifier = ConsoleNotifier()
    handler = REIFileMonitorHandler(notifier)
    observer = Observer()
    observer.schedule(handler, str(downloads_path), recursive=False)
    observer.start()

    print(f"[REI] Monitoring started: {downloads_path}")
    print("[REI] Waiting for new files...")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("[REI] Stopping monitor...")
    finally:
        observer.stop()
        observer.join()
        print("[REI] Monitor stopped.")


if __name__ == "__main__":
    main()
