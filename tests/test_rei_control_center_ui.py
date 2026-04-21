from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from rei_control_center import REIControlCenter


class TestREIControlCenterUIPolish(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self) -> None:
        with (
            patch.object(REIControlCenter, "_autostart_services", lambda self: None),
            patch.object(REIControlCenter, "_refresh_health_status", lambda self: None),
            patch.object(REIControlCenter, "_refresh_threat_feed", lambda self: None),
            patch.object(REIControlCenter, "_refresh_reputation_panel", lambda self: None),
        ):
            self.window = REIControlCenter()

    def tearDown(self) -> None:
        self.window.close()

    def test_theme_tokens_match_spec(self) -> None:
        tokens = self.window._theme_tokens()
        self.assertEqual(tokens["HIGH"], "#ff4d4f")
        self.assertEqual(tokens["MEDIUM"], "#fa8c16")
        self.assertEqual(tokens["SUCCESS"], "#52c41a")
        self.assertEqual(tokens["PRIMARY"], "#3daee9")
        self.assertEqual(tokens["BACKGROUND"], "#0f172a")
        self.assertEqual(tokens["SURFACE"], "#1e293b")

    def test_compute_threat_summary_counts_today_high_medium(self) -> None:
        logs = [
            {"timestamp": "2030-01-10T08:00:00+00:00", "risk_level": "HIGH"},
            {"timestamp": "2030-01-10T09:00:00+00:00", "risk_level": "MEDIUM"},
            {"timestamp": "2030-01-10T10:00:00+00:00", "risk_level": "LOW"},
        ]
        summary = self.window._compute_threat_summary(logs, "2030-01-10")
        self.assertEqual(summary["threats_today"], 3)
        self.assertEqual(summary["high_risk"], 1)
        self.assertEqual(summary["medium_risk"], 1)

    def test_display_only_banner_and_counters_exist(self) -> None:
        self.assertTrue(hasattr(self.window, "top_status_banner"))
        self.assertTrue(hasattr(self.window, "scanner_banner_label"))
        self.assertTrue(hasattr(self.window, "monitor_banner_label"))
        self.assertTrue(hasattr(self.window, "reputation_banner_label"))
        self.assertTrue(hasattr(self.window, "threats_today_value"))
        self.assertTrue(hasattr(self.window, "high_risk_value"))
        self.assertTrue(hasattr(self.window, "medium_risk_value"))

    def test_compute_threat_summary_ignores_non_dict_entries(self) -> None:
        logs = [
            {"timestamp": "2030-01-10T08:00:00+00:00", "risk_level": "HIGH"},
            "bad_entry",
            42,
            {"timestamp": "2030-01-10T09:00:00+00:00", "risk_level": "MEDIUM"},
        ]
        summary = self.window._compute_threat_summary(logs, "2030-01-10")
        self.assertEqual(summary["threats_today"], 2)
        self.assertEqual(summary["high_risk"], 1)
        self.assertEqual(summary["medium_risk"], 1)

    def test_refresh_threat_feed_handles_malformed_log_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            detection_path = Path(temp_dir) / "detection_log.json"
            today = datetime.now().date().isoformat()
            detection_path.write_text(
                json.dumps(
                    [
                        "bad_entry",
                        {"timestamp": f"{today}T08:00:00+00:00", "platform": "email", "risk_level": "HIGH", "sender": "a"},
                        {"timestamp": f"{today}T09:00:00+00:00", "platform": "email", "risk_level": "MEDIUM", "sender": "b"},
                    ]
                ),
                encoding="utf-8",
            )
            self.window.detection_log_path = detection_path
            self.window._refresh_threat_feed()

            self.assertEqual(self.window.threat_table.rowCount(), 2)
            self.assertEqual(self.window.high_risk_value.text(), "1")
            self.assertEqual(self.window.medium_risk_value.text(), "1")

    def test_refresh_reputation_panel_handles_non_numeric_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            reputation_path = Path(temp_dir) / "reputation_db.json"
            reputation_path.write_text(
                json.dumps(
                    {
                        "sender-a": {"count": "abc", "risk_boost": "bad"},
                        "sender-b": {"count": 2, "risk_boost": 0.1},
                    }
                ),
                encoding="utf-8",
            )
            self.window.reputation_db_path = reputation_path
            self.window._refresh_reputation_panel()

            self.assertEqual(self.window.reputation_table.rowCount(), 2)
            self.assertEqual(self.window.reputation_table.item(0, 0).text(), "sender-b")

    def test_stop_service_does_not_kill_external_process_on_close(self) -> None:
        service = self.window.services["scanner"]
        service.process = None
        service.external_pid = 12345
        service.started_by_app = False
        with patch.object(self.window, "_stop_external_pid") as stop_external:
            self.window._stop_service("scanner", force=False)
            stop_external.assert_not_called()

    def test_stop_service_force_can_restart_external_process(self) -> None:
        service = self.window.services["scanner"]
        service.process = None
        service.external_pid = 12345
        service.started_by_app = False
        with patch.object(self.window, "_stop_external_pid") as stop_external:
            self.window._stop_service("scanner", force=True)
            stop_external.assert_called_once_with(12345)

