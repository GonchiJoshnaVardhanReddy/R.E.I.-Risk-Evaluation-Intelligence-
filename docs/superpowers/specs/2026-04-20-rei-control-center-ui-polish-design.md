# R.E.I. Control Center UI Polish Design

## Problem
The current `rei_control_center.py` interface is functionally complete but visually basic. The goal is to improve visual quality and readability while preserving all existing behavior (service management, health checks, scans, timers, and logging).

## Scope
- In scope:
  - Visual polish only for the existing UI structure.
  - Security-operations dark theme.
  - Balanced readability (clear hierarchy, moderate density).
  - App-wide stylesheet-driven approach.
  - Add a top display-only protection status banner in the main panel.
  - Add display-only dashboard threat summary counters sourced from existing `detection_log.json` data.
- Out of scope:
  - Functional logic changes.
  - Workflow changes.
  - Additional panels, features, or navigation.

## Chosen Approach
Use a centralized app-wide stylesheet with design tokens (color, typography, spacing, radius) and apply semantic object names/classes where needed for targeted styling. This keeps styling maintainable and consistent while minimizing code churn.

## Design Decisions

### 1. Theme Foundation
- Base palette:
  - HIGH risk: `#ff4d4f`
  - MEDIUM risk: `#fa8c16`
  - SUCCESS / ACTIVE: `#52c41a`
  - PRIMARY accent: `#3daee9`
  - BACKGROUND: `#0f172a`
  - SURFACE panels: `#1e293b`
- Typography:
  - Clear hierarchy for title, section headers, table text, and logs.
  - Balanced readability with moderate sizes and line spacing.

### 2. Layout and Visual Hierarchy
- Keep current sidebar + main panel layout.
- Add a horizontal top status strip in the main panel showing:
  - `Real-Time Protection Active`
  - `Scanner Engine Running`
  - `File Monitor Active`
  - `Reputation Engine Active`
- Banner is display-only and reflects existing runtime state without changing backend logic.
- Increase spacing consistency:
  - Shared margins/paddings for all group boxes.
  - Uniform vertical rhythm between panels.
- Improve scan/action button prominence while preserving labels and actions.

### 3. Threat Summary Counters
- Add a compact summary row near the top of the main panel:
  - `Threats Today`
  - `High Risk`
  - `Medium Risk`
- Populate counters from already loaded `detection_log.json` data.
- No timer cadence changes and no API/service logic changes.

### 4. Component Styling
- Sidebar:
  - Distinct background panel and stronger title treatment.
- Group boxes:
  - Unified card look with border, radius, and title style.
- Status indicators:
  - Visual chips/badges with better contrast.
- Tables:
  - Header contrast, row hover/selection polish.
  - Preserve HIGH/MEDIUM row highlighting semantics.
- Log panel:
  - Console-like dark surface and monospace text for events.
- Dialogs:
  - Consistent theme for message/result popups.

### 5. Maintainability
- Add one `_apply_theme()` method in `REIControlCenter` called during initialization.
- Prefer global stylesheet; use targeted object names sparingly where widget-specific styles are required.
- Avoid inline styles unless they represent dynamic state coloring already required by logic.

## Data/Behavior Safety
- No changes to:
  - API request flow
  - timers/refresh cadence
  - restart behavior (except external-process safety on close)
- UI updates must be appearance-only.
- The banner and threat summary counters are display-only and reuse existing state/data flows.
- Defensive parsing is allowed only to prevent UI refresh crashes on malformed local JSON rows.
- Service lifecycle safety exception (approved): closing the control center must not stop externally managed scanner/file-monitor processes.

## Error Handling
- Existing warning dialogs and logging remain unchanged.
- Styling should degrade gracefully if a specific selector does not apply.

## Validation Plan
1. Launch `python rei_control_center.py`.
2. Confirm top status banner is present and styled with active success state.
3. Confirm threat summary counters render and update from detection log data.
4. Confirm all panels/buttons/dialogs render in dark theme.
5. Verify service status labels still update normally.
6. Verify threat/reputation tables still refresh and highlight appropriately.
7. Verify manual scan buttons and restart buttons remain fully functional.

## Implementation Notes
- Keep application behavior edits isolated to `rei_control_center.py`; adding focused tests under `tests/` is allowed.
- Use a single source of style truth to simplify future refinements.
