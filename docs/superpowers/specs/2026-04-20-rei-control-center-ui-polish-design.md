# R.E.I. Control Center UI Polish Design

## Problem
The current `rei_control_center.py` interface is functionally complete but visually basic. The goal is to improve visual quality and readability while preserving all existing behavior (service management, health checks, scans, timers, and logging).

## Scope
- In scope:
  - Visual polish only for the existing UI structure.
  - Security-operations dark theme.
  - Balanced readability (clear hierarchy, moderate density).
  - App-wide stylesheet-driven approach.
- Out of scope:
  - Functional logic changes.
  - Workflow changes.
  - Additional panels, features, or navigation.

## Chosen Approach
Use a centralized app-wide stylesheet with design tokens (color, typography, spacing, radius) and apply semantic object names/classes where needed for targeted styling. This keeps styling maintainable and consistent while minimizing code churn.

## Design Decisions

### 1. Theme Foundation
- Base palette:
  - Background: deep navy/charcoal tones.
  - Surface layers: slightly lighter cards/panels.
  - Accent: cyan/blue for active controls.
  - Status colors:
    - Success/active: green
    - Warning: orange
    - Critical/high-risk: red
- Typography:
  - Clear hierarchy for title, section headers, table text, and logs.
  - Balanced readability with moderate sizes and line spacing.

### 2. Layout and Visual Hierarchy
- Keep current sidebar + main panel layout.
- Increase spacing consistency:
  - Shared margins/paddings for all group boxes.
  - Uniform vertical rhythm between panels.
- Improve scan/action button prominence while preserving labels and actions.

### 3. Component Styling
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

### 4. Maintainability
- Add one `_apply_theme()` method in `REIControlCenter` called during initialization.
- Prefer global stylesheet; use targeted object names sparingly where widget-specific styles are required.
- Avoid inline styles unless they represent dynamic state coloring already required by logic.

## Data/Behavior Safety
- No changes to:
  - subprocess lifecycle
  - API request flow
  - timers/refresh cadence
  - file parsing logic
  - restart/close behavior
- UI updates must be appearance-only.

## Error Handling
- Existing warning dialogs and logging remain unchanged.
- Styling should degrade gracefully if a specific selector does not apply.

## Validation Plan
1. Launch `python rei_control_center.py`.
2. Confirm all panels/buttons/dialogs render in dark theme.
3. Verify service status labels still update normally.
4. Verify threat/reputation tables still refresh and highlight appropriately.
5. Verify manual scan buttons and restart buttons remain fully functional.

## Implementation Notes
- Keep edits isolated to `rei_control_center.py`.
- Use a single source of style truth to simplify future refinements.
