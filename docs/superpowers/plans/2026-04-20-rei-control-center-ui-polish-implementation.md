# R.E.I. Control Center UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a security-operations dark visual polish to `rei_control_center.py` (appearance-only), adding a top status banner, standardized severity tokens, and threat summary counters without changing any existing service/API/timer behavior.

**Architecture:** Keep all existing runtime logic in `REIControlCenter` and add a focused presentation layer: a global stylesheet + display-only widgets. Use helper methods for theme tokens and threat-summary computation so tests can validate the polish layer without touching process-management logic.

**Tech Stack:** Python 3, PySide6, unittest (stdlib), requests, existing JSON files (`detection_log.json`, `reputation_db.json`)

---

## File Structure

- Modify: `rei_control_center.py`
  - Add UI-only theme token map.
  - Add top status banner widgets (display-only).
  - Add threat summary counter widgets (display-only).
  - Add centralized stylesheet application method.
  - Keep service/process/API logic unchanged.
- Create: `tests/test_rei_control_center_ui.py`
  - Validate design tokens.
  - Validate threat summary computation from detection log payloads.
  - Validate new display widgets exist and update text as expected.

---

### Task 1: Add failing UI-polish tests first (TDD RED)

**Files:**
- Create: `tests/test_rei_control_center_ui.py`
- Modify: `rei_control_center.py` (none in this task)
- Test: `tests/test_rei_control_center_ui.py`

- [ ] **Step 1: Write the failing test for theme tokens**

```python
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication
from rei_control_center import REIControlCenter


class TestREIControlCenterUIPolish(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.window = REIControlCenter()

    def tearDown(self):
        self.window.close()

    def test_theme_tokens_match_spec(self):
        tokens = self.window._theme_tokens()
        self.assertEqual(tokens["HIGH"], "#ff4d4f")
        self.assertEqual(tokens["MEDIUM"], "#fa8c16")
        self.assertEqual(tokens["SUCCESS"], "#52c41a")
        self.assertEqual(tokens["PRIMARY"], "#3daee9")
        self.assertEqual(tokens["BACKGROUND"], "#0f172a")
        self.assertEqual(tokens["SURFACE"], "#1e293b")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests.test_rei_control_center_ui.TestREIControlCenterUIPolish.test_theme_tokens_match_spec -v`  
Expected: `ERROR`/`FAIL` because `_theme_tokens()` does not exist yet.

- [ ] **Step 3: Write the failing test for threat summary counters**

```python
    def test_compute_threat_summary_counts_today_high_medium(self):
        logs = [
            {"timestamp": "2030-01-10T08:00:00+00:00", "risk_level": "HIGH"},
            {"timestamp": "2030-01-10T09:00:00+00:00", "risk_level": "MEDIUM"},
            {"timestamp": "2030-01-10T10:00:00+00:00", "risk_level": "LOW"},
        ]
        summary = self.window._compute_threat_summary(logs, "2030-01-10")
        self.assertEqual(summary["threats_today"], 3)
        self.assertEqual(summary["high_risk"], 1)
        self.assertEqual(summary["medium_risk"], 1)
```

- [ ] **Step 4: Run test to verify it fails**

Run: `python -m unittest tests.test_rei_control_center_ui.TestREIControlCenterUIPolish.test_compute_threat_summary_counts_today_high_medium -v`  
Expected: `ERROR`/`FAIL` because `_compute_threat_summary()` does not exist yet.

- [ ] **Step 5: Write the failing test for top status banner and counters**

```python
    def test_display_only_banner_and_counters_exist(self):
        self.assertTrue(hasattr(self.window, "top_status_banner"))
        self.assertTrue(hasattr(self.window, "scanner_banner_label"))
        self.assertTrue(hasattr(self.window, "monitor_banner_label"))
        self.assertTrue(hasattr(self.window, "reputation_banner_label"))
        self.assertTrue(hasattr(self.window, "threats_today_value"))
        self.assertTrue(hasattr(self.window, "high_risk_value"))
        self.assertTrue(hasattr(self.window, "medium_risk_value"))
```

- [ ] **Step 6: Run test to verify it fails**

Run: `python -m unittest tests.test_rei_control_center_ui.TestREIControlCenterUIPolish.test_display_only_banner_and_counters_exist -v`  
Expected: `FAIL` because those UI attributes do not exist yet.

- [ ] **Step 7: Commit**

```bash
git add tests/test_rei_control_center_ui.py
git commit -m "test: add failing UI polish tests for control center"
```

---

### Task 2: Implement minimal display-only UI additions to pass tests (TDD GREEN)

**Files:**
- Modify: `rei_control_center.py`
- Test: `tests/test_rei_control_center_ui.py`

- [ ] **Step 1: Add minimal token helper**

```python
def _theme_tokens(self) -> dict[str, str]:
    return {
        "HIGH": "#ff4d4f",
        "MEDIUM": "#fa8c16",
        "SUCCESS": "#52c41a",
        "PRIMARY": "#3daee9",
        "BACKGROUND": "#0f172a",
        "SURFACE": "#1e293b",
    }
```

- [ ] **Step 2: Add minimal threat summary helper**

```python
def _compute_threat_summary(self, logs: list[dict[str, Any]], date_prefix: str | None = None) -> dict[str, int]:
    from datetime import datetime

    target_prefix = date_prefix or datetime.utcnow().date().isoformat()
    today_logs = [entry for entry in logs if str(entry.get("timestamp", "")).startswith(target_prefix)]
    high = sum(1 for entry in today_logs if str(entry.get("risk_level", "")).upper() == "HIGH")
    medium = sum(1 for entry in today_logs if str(entry.get("risk_level", "")).upper() == "MEDIUM")
    return {"threats_today": len(today_logs), "high_risk": high, "medium_risk": medium}
```

- [ ] **Step 3: Add top status banner widgets in `_build_ui()`**

```python
self.top_status_banner = QWidget()
banner_layout = QHBoxLayout(self.top_status_banner)
self.banner_title_label = QLabel("Real-Time Protection Active")
self.scanner_banner_label = QLabel("Scanner Engine Running")
self.monitor_banner_label = QLabel("File Monitor Active")
self.reputation_banner_label = QLabel("Reputation Engine Active")
for item in (self.banner_title_label, self.scanner_banner_label, self.monitor_banner_label, self.reputation_banner_label):
    banner_layout.addWidget(item)
dashboard_layout.addWidget(self.top_status_banner)
```

- [ ] **Step 4: Add threat summary counter widgets in `_build_ui()`**

```python
self.threats_today_value = QLabel("0")
self.high_risk_value = QLabel("0")
self.medium_risk_value = QLabel("0")
```

- [ ] **Step 5: Run focused tests to verify pass**

Run: `python -m unittest tests.test_rei_control_center_ui -v`  
Expected: all tests in `TestREIControlCenterUIPolish` are `OK`.

- [ ] **Step 6: Commit**

```bash
git add rei_control_center.py tests/test_rei_control_center_ui.py
git commit -m "feat: add display-only banner and threat summary counters"
```

---

### Task 3: Apply stylesheet-based dark polish with standardized tokens

**Files:**
- Modify: `rei_control_center.py`
- Test: `tests/test_rei_control_center_ui.py`

- [ ] **Step 1: Add `_apply_theme()` method and call it from `__init__`**

```python
def _apply_theme(self) -> None:
    t = self._theme_tokens()
    self.setStyleSheet(f'''
    QMainWindow, QWidget {{ background-color: {t["BACKGROUND"]}; color: #e5e7eb; }}
    QGroupBox {{ background-color: {t["SURFACE"]}; border: 1px solid #334155; border-radius: 8px; margin-top: 8px; }}
    QGroupBox::title {{ subcontrol-origin: margin; left: 10px; padding: 0 4px; color: #cbd5e1; }}
    QPushButton {{ background-color: {t["PRIMARY"]}; color: #0b1220; border-radius: 6px; padding: 8px 12px; font-weight: 600; }}
    QPushButton:hover {{ background-color: #63bff0; }}
    QTableWidget {{ background-color: {t["SURFACE"]}; gridline-color: #334155; }}
    QHeaderView::section {{ background-color: #0b1220; color: #cbd5e1; border: none; padding: 6px; }}
    QPlainTextEdit {{ background-color: #0b1220; color: #9ca3af; border: 1px solid #334155; }}
    ''')
```

- [ ] **Step 2: Style status banner/counters with success + severity colors**

```python
self.top_status_banner.setObjectName("topStatusBanner")
self.banner_title_label.setStyleSheet("color: #52c41a; font-weight: 700;")
self.scanner_banner_label.setStyleSheet("color: #52c41a;")
self.monitor_banner_label.setStyleSheet("color: #52c41a;")
self.reputation_banner_label.setStyleSheet("color: #52c41a;")
self.high_risk_value.setStyleSheet("color: #ff4d4f; font-weight: 700;")
self.medium_risk_value.setStyleSheet("color: #fa8c16; font-weight: 700;")
```

- [ ] **Step 3: Wire counter refresh into existing threat feed refresh**

```python
summary = self._compute_threat_summary(logs)
self.threats_today_value.setText(str(summary["threats_today"]))
self.high_risk_value.setText(str(summary["high_risk"]))
self.medium_risk_value.setText(str(summary["medium_risk"]))
```

- [ ] **Step 4: Keep risk-row highlighting mapped to standardized tokens**

```python
t = self._theme_tokens()
if risk_level == "HIGH":
    color = QColor(t["HIGH"])
elif risk_level == "MEDIUM":
    color = QColor(t["MEDIUM"])
else:
    color = QColor(255, 255, 255)
```

- [ ] **Step 5: Run tests and module compile checks**

Run:
- `python -m unittest tests.test_rei_control_center_ui -v`
- `python -m py_compile rei_control_center.py`

Expected:
- unittest: `OK`
- py_compile: exits with status `0`

- [ ] **Step 6: Commit**

```bash
git add rei_control_center.py tests/test_rei_control_center_ui.py
git commit -m "feat: apply app-wide dark stylesheet and standardized severity tokens"
```

---

### Task 4: Final regression checks and handoff

**Files:**
- Modify: none (verification only unless breakage found)
- Test: `tests/test_rei_control_center_ui.py`

- [ ] **Step 1: Launch app for manual visual smoke test**

Run: `python rei_control_center.py`  
Expected:
- Window opens with dark theme.
- Top status banner visible.
- Threat summary counters visible.
- Existing service controls and scan buttons still function.

- [ ] **Step 2: Verify no logic/timer/workflow regressions**

Run: `python -m unittest tests.test_rei_control_center_ui -v`  
Expected: `OK` and no changes required to service lifecycle code paths.

- [ ] **Step 3: Commit final verification (if code changed during fixes)**

```bash
git add rei_control_center.py tests/test_rei_control_center_ui.py
git commit -m "chore: finalize control center UI polish validation"
```

---

## Self-Review Checklist (Completed)

- Spec coverage:
  - Top status banner: covered in Task 2 + Task 3.
  - Explicit severity tokens: covered in Task 2 + Task 3.
  - Threat summary counters: covered in Task 2 + Task 3.
  - Appearance-only + no lifecycle/timer/API changes: enforced in Task 4 checks.
- Placeholder scan: no TBD/TODO placeholders.
- Type/signature consistency:
  - `_theme_tokens()` and `_compute_threat_summary()` names are used consistently across tasks/tests.
