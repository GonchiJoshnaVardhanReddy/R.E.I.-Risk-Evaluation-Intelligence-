from __future__ import annotations

import json
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from PySide6.QtCore import QTimer, Qt
from PySide6.QtGui import QCloseEvent, QColor
from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QInputDialog,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

SCANNER_DOCS_URL = "http://127.0.0.1:8000/docs"
SCANNER_ANALYZE_TEXT_URL = "http://127.0.0.1:8000/analyze-text"
SCANNER_ANALYZE_URL = "http://127.0.0.1:8000/analyze-url"
SCANNER_ANALYZE_FILE_URL = "http://127.0.0.1:8000/analyze-file"


@dataclass
class ServiceRuntime:
    key: str
    display_name: str
    command: list[str]
    marker: str
    process: subprocess.Popen[str] | None = None
    external_pid: int | None = None
    started_by_app: bool = False


class REIControlCenter(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.project_root = Path(__file__).resolve().parent
        if getattr(sys, "frozen", False):
            self.project_root = Path(sys.executable).resolve().parent

        self.detection_log_path = self.project_root / "detection_log.json"
        self.reputation_db_path = self.project_root / "reputation_db.json"

        self.services: dict[str, ServiceRuntime] = {
            "scanner": ServiceRuntime(
                key="scanner",
                display_name="Scanner Engine",
                command=[sys.executable, "-m", "uvicorn", "rei_scanner_api:app", "--reload"],
                marker="rei_scanner_api:app",
            ),
            "file_monitor": ServiceRuntime(
                key="file_monitor",
                display_name="File Monitor",
                command=[sys.executable, "file_monitor.py"],
                marker="file_monitor.py",
            ),
        }

        self.last_scanner_api_reachable: bool | None = None
        self.last_file_monitor_running: bool | None = None
        self.last_detection_count = 0

        self.setWindowTitle("R.E.I. Control Center")
        self.setMinimumSize(1000, 700)
        self._build_ui()
        self._apply_theme()
        self._start_timers()
        self._autostart_services()
        self._refresh_health_status()
        self._refresh_threat_feed()
        self._refresh_reputation_panel()

    def _theme_tokens(self) -> dict[str, str]:
        return {
            "HIGH": "#ff4d4f",
            "MEDIUM": "#fa8c16",
            "SUCCESS": "#52c41a",
            "PRIMARY": "#3daee9",
            "BACKGROUND": "#0f172a",
            "SURFACE": "#1e293b",
            "TEXT": "#e2e8f0",
            "MUTED_TEXT": "#94a3b8",
            "BORDER": "#334155",
            "SURFACE_ALT": "#0b1220",
        }

    def _compute_threat_summary(self, logs: list[dict[str, Any]], date_prefix: str | None = None) -> dict[str, int]:
        target_prefix = date_prefix or datetime.now().date().isoformat()
        safe_logs = [entry for entry in logs if isinstance(entry, dict)]
        today_logs = [entry for entry in safe_logs if str(entry.get("timestamp", ""))[:10] == target_prefix]
        high_count = sum(1 for entry in today_logs if str(entry.get("risk_level", "")).upper() == "HIGH")
        medium_count = sum(1 for entry in today_logs if str(entry.get("risk_level", "")).upper() == "MEDIUM")
        return {
            "threats_today": len(today_logs),
            "high_risk": high_count,
            "medium_risk": medium_count,
        }

    def _build_ui(self) -> None:
        central_widget = QWidget()
        root_layout = QHBoxLayout(central_widget)
        root_layout.setContentsMargins(10, 10, 10, 10)
        root_layout.setSpacing(12)
        self.setCentralWidget(central_widget)

        sidebar = QWidget()
        sidebar.setObjectName("sidebarPanel")
        sidebar.setFixedWidth(250)
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setSpacing(10)

        title_label = QLabel("R.E.I.\nControl Center")
        title_label.setAlignment(Qt.AlignCenter)
        title_label.setObjectName("sidebarTitle")
        sidebar_layout.addWidget(title_label)

        service_box = QGroupBox("Services")
        service_layout = QVBoxLayout(service_box)
        self.scanner_service_label = QLabel("Scanner Engine: Stopped")
        self.file_monitor_service_label = QLabel("File Monitor: Stopped")
        service_layout.addWidget(self.scanner_service_label)
        service_layout.addWidget(self.file_monitor_service_label)
        sidebar_layout.addWidget(service_box)
        sidebar_layout.addStretch()

        dashboard_container = QWidget()
        dashboard_layout = QVBoxLayout(dashboard_container)
        dashboard_layout.setSpacing(10)

        self.top_status_banner = QWidget()
        self.top_status_banner.setObjectName("topStatusBanner")
        top_status_layout = QHBoxLayout(self.top_status_banner)
        top_status_layout.setContentsMargins(12, 8, 12, 8)
        top_status_layout.setSpacing(16)

        self.banner_title_label = QLabel("Real-Time Protection Active")
        self.scanner_banner_label = QLabel("Scanner Engine Running")
        self.monitor_banner_label = QLabel("File Monitor Active")
        self.reputation_banner_label = QLabel("Reputation Engine Active")
        self.banner_title_label.setObjectName("bannerTitleLabel")
        self.scanner_banner_label.setObjectName("bannerStatusLabel")
        self.monitor_banner_label.setObjectName("bannerStatusLabel")
        self.reputation_banner_label.setObjectName("bannerStatusLabel")

        top_status_layout.addWidget(self.banner_title_label)
        top_status_layout.addStretch()
        top_status_layout.addWidget(self.scanner_banner_label)
        top_status_layout.addWidget(self.monitor_banner_label)
        top_status_layout.addWidget(self.reputation_banner_label)
        dashboard_layout.addWidget(self.top_status_banner)

        summary_box = QGroupBox("Threat Summary")
        summary_layout = QHBoxLayout(summary_box)
        summary_layout.setContentsMargins(12, 10, 12, 10)
        summary_layout.setSpacing(14)

        self.threats_today_value = QLabel("0")
        self.high_risk_value = QLabel("0")
        self.medium_risk_value = QLabel("0")

        summary_layout.addWidget(self._build_summary_chip("Threats Today", self.threats_today_value, "summaryNeutral"))
        summary_layout.addWidget(self._build_summary_chip("High Risk", self.high_risk_value, "summaryHigh"))
        summary_layout.addWidget(self._build_summary_chip("Medium Risk", self.medium_risk_value, "summaryMedium"))
        summary_layout.addStretch()
        dashboard_layout.addWidget(summary_box)

        system_box = QGroupBox("System Status")
        system_layout = QVBoxLayout(system_box)
        self.protection_status_label = QLabel("Protection Status: 🔴 Protection Inactive")
        self.protection_status_label.setObjectName("protectionStatusLabel")
        system_layout.addWidget(self.protection_status_label)

        self.indicator_labels: dict[str, QLabel] = {
            "scanner_api": QLabel("Scanner API reachable: ❌"),
            "file_monitor": QLabel("File monitor running: ❌"),
            "detection_log": QLabel("Detection logging active: ❌"),
            "reputation_db": QLabel("Reputation engine active: ❌"),
        }
        for label in self.indicator_labels.values():
            label.setObjectName("statusIndicator")
            system_layout.addWidget(label)
        dashboard_layout.addWidget(system_box)

        threat_box = QGroupBox("Live Threat Feed (Last 20)")
        threat_layout = QVBoxLayout(threat_box)
        self.threat_table = QTableWidget(0, 4)
        self.threat_table.setHorizontalHeaderLabels(["timestamp", "platform", "risk_level", "sender"])
        self.threat_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.threat_table.verticalHeader().setVisible(False)
        self.threat_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.threat_table.setSelectionBehavior(QTableWidget.SelectRows)
        threat_layout.addWidget(self.threat_table)
        dashboard_layout.addWidget(threat_box, stretch=2)

        reputation_box = QGroupBox("Sender Reputation")
        reputation_layout = QVBoxLayout(reputation_box)
        self.reputation_table = QTableWidget(0, 3)
        self.reputation_table.setHorizontalHeaderLabels(["sender_id", "count", "risk_boost"])
        self.reputation_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.reputation_table.verticalHeader().setVisible(False)
        self.reputation_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.reputation_table.setSelectionBehavior(QTableWidget.SelectRows)
        reputation_layout.addWidget(self.reputation_table)
        dashboard_layout.addWidget(reputation_box, stretch=1)

        manual_scan_box = QGroupBox("Manual Scan")
        manual_layout = QHBoxLayout(manual_scan_box)
        self.scan_message_button = QPushButton("Scan Message")
        self.scan_url_button = QPushButton("Scan URL")
        self.scan_file_button = QPushButton("Scan File")
        self.scan_message_button.clicked.connect(self._scan_message)
        self.scan_url_button.clicked.connect(self._scan_url)
        self.scan_file_button.clicked.connect(self._scan_file)
        manual_layout.addWidget(self.scan_message_button)
        manual_layout.addWidget(self.scan_url_button)
        manual_layout.addWidget(self.scan_file_button)
        dashboard_layout.addWidget(manual_scan_box)

        service_control_box = QGroupBox("Service Control")
        service_control_layout = QHBoxLayout(service_control_box)
        self.restart_scanner_button = QPushButton("Restart Scanner Engine")
        self.restart_monitor_button = QPushButton("Restart File Monitor")
        self.restart_scanner_button.clicked.connect(lambda: self._restart_service("scanner"))
        self.restart_monitor_button.clicked.connect(lambda: self._restart_service("file_monitor"))
        service_control_layout.addWidget(self.restart_scanner_button)
        service_control_layout.addWidget(self.restart_monitor_button)
        dashboard_layout.addWidget(service_control_box)

        logging_box = QGroupBox("Event Log")
        logging_layout = QVBoxLayout(logging_box)
        self.log_output = QPlainTextEdit()
        self.log_output.setReadOnly(True)
        self.log_output.setMaximumBlockCount(2000)
        logging_layout.addWidget(self.log_output)
        dashboard_layout.addWidget(logging_box, stretch=1)

        root_layout.addWidget(sidebar)
        root_layout.addWidget(dashboard_container, stretch=1)

    def _build_summary_chip(self, title: str, value_label: QLabel, chip_class: str) -> QWidget:
        chip = QWidget()
        chip.setObjectName(chip_class)
        chip_layout = QVBoxLayout(chip)
        chip_layout.setContentsMargins(12, 8, 12, 8)
        chip_layout.setSpacing(2)

        title_label = QLabel(title)
        title_label.setObjectName("summaryChipTitle")
        value_label.setObjectName("summaryChipValue")

        chip_layout.addWidget(title_label)
        chip_layout.addWidget(value_label)
        return chip

    def _apply_theme(self) -> None:
        tokens = self._theme_tokens()
        self.setStyleSheet(
            f"""
            QMainWindow, QWidget {{
                background-color: {tokens["BACKGROUND"]};
                color: {tokens["TEXT"]};
                font-size: 13px;
            }}
            QGroupBox {{
                background-color: {tokens["SURFACE"]};
                border: 1px solid {tokens["BORDER"]};
                border-radius: 10px;
                margin-top: 10px;
                padding-top: 8px;
                font-weight: 600;
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                left: 12px;
                padding: 0 4px;
                color: {tokens["MUTED_TEXT"]};
            }}
            QPushButton {{
                background-color: {tokens["PRIMARY"]};
                color: #0b1220;
                border: none;
                border-radius: 8px;
                padding: 8px 12px;
                font-weight: 700;
            }}
            QPushButton:hover {{
                background-color: #61c1ed;
            }}
            QPushButton:pressed {{
                background-color: #2d9fd9;
            }}
            #sidebarPanel {{
                background-color: {tokens["SURFACE"]};
                border: 1px solid {tokens["BORDER"]};
                border-radius: 10px;
            }}
            QTableWidget {{
                background-color: {tokens["SURFACE"]};
                alternate-background-color: #16243a;
                gridline-color: {tokens["BORDER"]};
                border: 1px solid {tokens["BORDER"]};
                border-radius: 8px;
            }}
            QTableWidget::item:hover {{
                background-color: #233554;
            }}
            QTableWidget::item:selected {{
                background-color: #2a4d7a;
                color: #ffffff;
            }}
            QHeaderView::section {{
                background-color: {tokens["SURFACE_ALT"]};
                color: {tokens["MUTED_TEXT"]};
                border: none;
                padding: 6px;
                font-weight: 600;
            }}
            QPlainTextEdit {{
                background-color: {tokens["SURFACE_ALT"]};
                color: {tokens["MUTED_TEXT"]};
                border: 1px solid {tokens["BORDER"]};
                border-radius: 8px;
                font-family: Consolas, 'Courier New', monospace;
            }}
            #topStatusBanner {{
                background-color: {tokens["SURFACE"]};
                border: 1px solid {tokens["BORDER"]};
                border-radius: 10px;
            }}
            #sidebarTitle {{
                font-size: 22px;
                font-weight: 700;
                color: {tokens["TEXT"]};
            }}
            #statusIndicator {{
                font-size: 13px;
                border-radius: 12px;
                padding: 4px 8px;
                border: 1px solid {tokens["BORDER"]};
                background-color: #132033;
            }}
            #statusIndicator[statusState="ok"] {{
                color: {tokens["SUCCESS"]};
                border: 1px solid {tokens["SUCCESS"]};
                background-color: #14281a;
            }}
            #statusIndicator[statusState="bad"] {{
                color: {tokens["HIGH"]};
                border: 1px solid {tokens["HIGH"]};
                background-color: #311a21;
            }}
            #bannerTitleLabel {{
                color: {tokens["SUCCESS"]};
                font-weight: 700;
                font-size: 14px;
            }}
            #bannerStatusLabel {{
                color: {tokens["SUCCESS"]};
                font-weight: 600;
            }}
            #summaryChipTitle {{
                color: {tokens["MUTED_TEXT"]};
                font-size: 12px;
                font-weight: 600;
            }}
            #summaryChipValue {{
                color: {tokens["TEXT"]};
                font-size: 18px;
                font-weight: 800;
            }}
            #summaryNeutral {{
                background-color: #1b2a43;
                border-radius: 8px;
            }}
            #summaryHigh {{
                background-color: #3a1f26;
                border-radius: 8px;
            }}
            #summaryMedium {{
                background-color: #3b2a1f;
                border-radius: 8px;
            }}
            #protectionStatusLabel {{
                font-size: 16px;
                font-weight: 700;
            }}
            """
        )

    def _start_timers(self) -> None:
        self.health_timer = QTimer(self)
        self.health_timer.setInterval(3000)
        self.health_timer.timeout.connect(self._refresh_health_status)
        self.health_timer.start()

        self.threat_timer = QTimer(self)
        self.threat_timer.setInterval(5000)
        self.threat_timer.timeout.connect(self._refresh_threat_feed)
        self.threat_timer.start()

        self.reputation_timer = QTimer(self)
        self.reputation_timer.setInterval(10000)
        self.reputation_timer.timeout.connect(self._refresh_reputation_panel)
        self.reputation_timer.start()

    def _append_log(self, message: str) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_output.appendPlainText(f"[{timestamp}] {message}")

    def _find_process_ids(self, marker: str) -> list[int]:
        escaped_marker = marker.replace("'", "''")
        command = (
            "Get-CimInstance Win32_Process | "
            "Where-Object { $_.Name -notlike 'powershell*' -and $_.CommandLine -and $_.CommandLine -like "
            f"\"*{escaped_marker}*\" }} | Select-Object -ExpandProperty ProcessId"
        )
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", command],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
        except (subprocess.SubprocessError, OSError):
            return []

        pids: list[int] = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                pids.append(int(line))
            except ValueError:
                continue
        return pids

    def _wait_for_scanner_api(self, timeout_seconds: int = 20) -> bool:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            if self._is_scanner_api_reachable():
                return True
            time.sleep(1)
        return False

    def _start_service(self, key: str) -> bool:
        service = self.services[key]
        existing_pids = self._find_process_ids(service.marker)
        if existing_pids:
            service.external_pid = existing_pids[0]
            service.process = None
            service.started_by_app = False
            self._append_log(f"{service.display_name} already running (PID {existing_pids[0]})")
            return True

        try:
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            process = subprocess.Popen(  # noqa: S603
                service.command,
                cwd=str(self.project_root),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
                creationflags=creationflags,
            )
        except OSError as exc:
            self._append_log(f"{service.display_name} failed to start: {exc}")
            if key == "scanner":
                QMessageBox.warning(self, "R.E.I. Warning", "Scanner engine failed to start")
            else:
                QMessageBox.warning(self, "R.E.I. Warning", "File monitor failed to start")
            return False

        service.process = process
        service.external_pid = process.pid
        service.started_by_app = True
        self._append_log(f"{service.display_name} started (PID {process.pid})")

        if key == "scanner":
            if not self._wait_for_scanner_api(timeout_seconds=20):
                self._append_log("API unreachable")
                QMessageBox.warning(self, "R.E.I. Warning", "Scanner engine failed to start")
                return False
        else:
            time.sleep(1)
            if process.poll() is not None:
                self._append_log("File monitor failed to stay alive")
                QMessageBox.warning(self, "R.E.I. Warning", "File monitor failed to start")
                return False

        return True

    def _stop_external_pid(self, pid: int) -> None:
        command = f"Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue"
        try:
            subprocess.run(
                ["powershell", "-NoProfile", "-Command", command],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
        except (subprocess.SubprocessError, OSError):
            return

    def _stop_service(self, key: str, force: bool = False) -> None:
        service = self.services[key]

        if service.process is not None and service.process.poll() is None:
            service.process.terminate()
            try:
                service.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                service.process.kill()
            self._append_log(f"{service.display_name} stopped")
        elif service.external_pid and (service.started_by_app or force):
            self._stop_external_pid(service.external_pid)
            self._append_log(f"{service.display_name} stopped")
        elif service.external_pid and not force:
            self._append_log(f"{service.display_name} left running (externally managed)")

        service.process = None
        service.external_pid = None
        service.started_by_app = False

    def _service_running(self, key: str) -> bool:
        service = self.services[key]
        if service.process is not None and service.process.poll() is None:
            return True
        pids = self._find_process_ids(service.marker)
        if pids:
            service.external_pid = pids[0]
            return True
        return False

    def _is_scanner_api_reachable(self) -> bool:
        try:
            response = requests.get(SCANNER_DOCS_URL, timeout=2)
            return response.status_code == 200
        except requests.RequestException:
            return False

    def _autostart_services(self) -> None:
        scanner_ok = self._start_service("scanner")
        monitor_ok = self._start_service("file_monitor")
        self._refresh_service_labels()
        if scanner_ok and monitor_ok:
            self._append_log("R.E.I. Protection Services Started Successfully")
            QMessageBox.information(self, "R.E.I.", "R.E.I. Protection Services Started Successfully")

    def _refresh_service_labels(self) -> None:
        scanner_running = self._service_running("scanner")
        monitor_running = self._service_running("file_monitor")

        self.scanner_service_label.setText(f"Scanner Engine: {'Running' if scanner_running else 'Stopped'}")
        self.file_monitor_service_label.setText(f"File Monitor: {'Running' if monitor_running else 'Stopped'}")
        tokens = self._theme_tokens()
        self.scanner_service_label.setStyleSheet(
            f"color: {tokens['SUCCESS']}; font-weight: 600;"
            if scanner_running
            else f"color: {tokens['HIGH']}; font-weight: 600;"
        )
        self.file_monitor_service_label.setStyleSheet(
            f"color: {tokens['SUCCESS']}; font-weight: 600;"
            if monitor_running
            else f"color: {tokens['HIGH']}; font-weight: 600;"
        )

    def _set_indicator(self, label: QLabel, text_prefix: str, is_ok: bool) -> None:
        icon = "🟢" if is_ok else "🔴"
        label.setText(f"{text_prefix}: {icon}")
        label.setProperty("statusState", "ok" if is_ok else "bad")
        label.style().unpolish(label)
        label.style().polish(label)

    def _refresh_health_status(self) -> None:
        scanner_api_reachable = self._is_scanner_api_reachable()
        file_monitor_running = self._service_running("file_monitor")
        detection_logging_active = self.detection_log_path.exists()
        reputation_engine_active = self.reputation_db_path.exists()
        protection_active = scanner_api_reachable and file_monitor_running
        tokens = self._theme_tokens()

        if protection_active:
            self.protection_status_label.setText("Protection Status: 🟢 Real-Time Protection Active")
            self.protection_status_label.setStyleSheet(
                f"font-size: 16px; font-weight: 700; color: {tokens['SUCCESS']};"
            )
            self.banner_title_label.setText("Real-Time Protection Active")
        else:
            self.protection_status_label.setText("Protection Status: 🔴 Real-Time Protection Inactive")
            self.protection_status_label.setStyleSheet(
                f"font-size: 16px; font-weight: 700; color: {tokens['HIGH']};"
            )
            self.banner_title_label.setText("Real-Time Protection Inactive")

        self.scanner_banner_label.setText("Scanner Engine Running" if scanner_api_reachable else "Scanner Engine Offline")
        self.monitor_banner_label.setText("File Monitor Active" if file_monitor_running else "File Monitor Inactive")
        self.reputation_banner_label.setText(
            "Reputation Engine Active" if reputation_engine_active else "Reputation Engine Inactive"
        )

        self._set_indicator(self.indicator_labels["scanner_api"], "Scanner API reachable", scanner_api_reachable)
        self._set_indicator(self.indicator_labels["file_monitor"], "File monitor running", file_monitor_running)
        self._set_indicator(self.indicator_labels["detection_log"], "Detection logging active", detection_logging_active)
        self._set_indicator(self.indicator_labels["reputation_db"], "Reputation engine active", reputation_engine_active)
        self._refresh_service_labels()

        if self.last_scanner_api_reachable is not None and scanner_api_reachable != self.last_scanner_api_reachable:
            self._append_log("Scanner API reachable" if scanner_api_reachable else "API unreachable")
        if self.last_file_monitor_running is not None and file_monitor_running != self.last_file_monitor_running:
            self._append_log("File monitor started" if file_monitor_running else "File monitor stopped")

        self.last_scanner_api_reachable = scanner_api_reachable
        self.last_file_monitor_running = file_monitor_running

    def _read_json(self, path: Path, default_value: Any) -> Any:
        if not path.exists():
            return default_value
        try:
            with path.open("r", encoding="utf-8") as file:
                return json.load(file)
        except (json.JSONDecodeError, OSError, ValueError, TypeError):
            return default_value

    def _refresh_threat_feed(self) -> None:
        logs = self._read_json(self.detection_log_path, [])
        if not isinstance(logs, list):
            logs = []
        safe_logs = [entry for entry in logs if isinstance(entry, dict)]
        latest_entries = list(reversed(safe_logs[-20:]))
        self.threat_table.setRowCount(len(latest_entries))
        summary = self._compute_threat_summary(safe_logs)
        self.threats_today_value.setText(str(summary["threats_today"]))
        self.high_risk_value.setText(str(summary["high_risk"]))
        self.medium_risk_value.setText(str(summary["medium_risk"]))
        tokens = self._theme_tokens()

        for row_index, entry in enumerate(latest_entries):
            timestamp = str(entry.get("timestamp", ""))
            platform = str(entry.get("platform", ""))
            risk_level = str(entry.get("risk_level", "LOW")).upper()
            sender = str(entry.get("sender", ""))

            values = [timestamp, platform, risk_level, sender]
            for col_index, value in enumerate(values):
                item = QTableWidgetItem(value)
                self.threat_table.setItem(row_index, col_index, item)

            if risk_level == "HIGH":
                color = QColor(tokens["HIGH"])
            elif risk_level == "MEDIUM":
                color = QColor(tokens["MEDIUM"])
            else:
                color = QColor(tokens["SURFACE"])

            for col_index in range(4):
                cell = self.threat_table.item(row_index, col_index)
                if cell is not None:
                    cell.setBackground(color)
                    if risk_level in {"HIGH", "MEDIUM"}:
                        cell.setForeground(QColor("#ffffff"))

        if len(logs) > self.last_detection_count:
            self._append_log(f"Detection logged (+{len(logs) - self.last_detection_count})")
        self.last_detection_count = len(logs)

    def _refresh_reputation_panel(self) -> None:
        reputation = self._read_json(self.reputation_db_path, {})
        if not isinstance(reputation, dict):
            reputation = {}

        rows: list[tuple[str, int, float]] = []
        def _to_int(value: Any, default: int = 0) -> int:
            try:
                return int(value)
            except (TypeError, ValueError):
                return default

        def _to_float(value: Any, default: float = 0.0) -> float:
            try:
                return float(value)
            except (TypeError, ValueError):
                return default

        for sender_id, payload in reputation.items():
            payload_dict = payload if isinstance(payload, dict) else {}
            count = _to_int(payload_dict.get("count", 0), default=0)
            risk_boost = _to_float(payload_dict.get("risk_boost", 0.0), default=0.0)
            rows.append((str(sender_id), count, risk_boost))

        rows.sort(key=lambda item: item[1], reverse=True)
        self.reputation_table.setRowCount(len(rows))
        for row_index, (sender_id, count, risk_boost) in enumerate(rows):
            self.reputation_table.setItem(row_index, 0, QTableWidgetItem(sender_id))
            self.reputation_table.setItem(row_index, 1, QTableWidgetItem(str(count)))
            self.reputation_table.setItem(row_index, 2, QTableWidgetItem(f"{risk_boost:.2f}"))

    def _show_scan_result(self, title: str, payload: dict[str, Any]) -> None:
        risk_score = payload.get("risk_score", "N/A")
        risk_level = payload.get("risk_level", "N/A")
        explanations = payload.get("explanations", [])
        if isinstance(explanations, list):
            explanations_text = "\n".join(f"• {line}" for line in explanations[:10]) if explanations else "• None"
        else:
            explanations_text = "• None"
        message = f"risk_score: {risk_score}\nrisk_level: {risk_level}\n\nexplanations:\n{explanations_text}"
        QMessageBox.information(self, title, message)

    def _scan_message(self) -> None:
        text, ok = QInputDialog.getMultiLineText(self, "Scan Message", "Enter message text:")
        if not ok or not text.strip():
            return
        payload = {"text": text.strip(), "sender": "manual_input", "platform": "dashboard"}
        try:
            response = requests.post(SCANNER_ANALYZE_TEXT_URL, json=payload, timeout=30)
            response.raise_for_status()
            result = response.json()
            self._show_scan_result("Message Scan Result", result)
        except requests.RequestException:
            QMessageBox.warning(self, "Scan Failed", "API unreachable")
            self._append_log("API unreachable")

    def _scan_url(self) -> None:
        url, ok = QInputDialog.getText(self, "Scan URL", "Enter URL:")
        if not ok or not url.strip():
            return
        payload = {"url": url.strip()}
        try:
            response = requests.post(SCANNER_ANALYZE_URL, json=payload, timeout=30)
            response.raise_for_status()
            result = response.json()
            self._show_scan_result("URL Scan Result", result)
        except requests.RequestException:
            QMessageBox.warning(self, "Scan Failed", "API unreachable")
            self._append_log("API unreachable")

    def _scan_file(self) -> None:
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Select File",
            str(self.project_root),
            "Supported Files (*.txt *.pdf *.docx *.html *.eml);;All Files (*.*)",
        )
        if not file_path:
            return
        try:
            with open(file_path, "rb") as selected_file:
                response = requests.post(
                    SCANNER_ANALYZE_FILE_URL,
                    files={"file": (Path(file_path).name, selected_file, "application/octet-stream")},
                    timeout=90,
                )
            response.raise_for_status()
            result = response.json()
            self._show_scan_result("File Scan Result", result)
        except (OSError, requests.RequestException):
            QMessageBox.warning(self, "Scan Failed", "API unreachable")
            self._append_log("API unreachable")

    def _restart_service(self, key: str) -> None:
        service = self.services[key]
        self._append_log(f"Restarting {service.display_name}")
        self._stop_service(key, force=True)
        time.sleep(0.5)
        started = self._start_service(key)
        if started:
            self._append_log(f"Service restarted: {service.display_name}")
        self._refresh_health_status()

    def closeEvent(self, event: QCloseEvent) -> None:  # noqa: N802
        self._stop_service("scanner")
        self._stop_service("file_monitor")
        event.accept()


def main() -> int:
    app = QApplication(sys.argv)
    window = REIControlCenter()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
