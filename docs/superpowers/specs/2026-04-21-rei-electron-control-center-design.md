# R.E.I. Electron Control Center Design

## Problem Statement

Replace the current Python desktop control panel as the primary GUI with a modern Electron application that controls and monitors existing backend services (`rei_scanner_api.py`, `file_monitor.py`) without changing backend Python logic.

## Goals

1. Deliver a single-window, multi-page SPA shell with persistent navigation and dynamic page content loading.
2. Keep service/process ownership in Electron `main.js` and presentation/state orchestration in renderer modules.
3. Provide real-time monitoring and manual scan workflows over existing local API endpoints.
4. Preserve offline-first operation with local JSON data sources (`detection_log.json`, `reputation_db.json`).
5. Prepare structure for packaging with `electron-builder` into `REI_Control_Center.exe`.

## Non-Goals

1. No backend logic changes in `rei_scanner_api.py` or `file_monitor.py`.
2. No migration to frontend frameworks (React/Vue/etc.).
3. No cloud dependencies.

## Target Structure

```
rei_control_center_electron/
  main.js
  preload.js
  package.json
  index.html
  renderer.js
  styles.css
  pages/
    dashboard.html
    protection.html
    history.html
    reputation.html
    scan.html
    status.html
    settings.html
```

## Runtime Architecture

### 1. Main Process (`main.js`)

Responsibilities:

1. Create BrowserWindow (`1200x800`, dark theme, `nodeIntegration: false`, `contextIsolation: true`, title `R.E.I. Control Center`).
2. Start and monitor background services:
   - Scanner: `python -m uvicorn rei_scanner_api:app --reload`
   - File monitor: `python file_monitor.py`
3. Prevent duplicate launches by checking for existing matching processes before spawning.
4. Track ownership and only terminate services started by this app instance during shutdown.
5. Expose IPC handlers for:
   - service status/control
   - API health checks
   - JSON data reads
   - scan requests
   - settings read/write (`electron-store`)
6. Push status snapshots to renderer at fixed cadence (3s loop).

### 2. Preload (`preload.js`)

Expose strict `window.rei` API via `contextBridge`:

1. `getServiceStatus()`
2. `startServices()`
3. `restartScanner()`
4. `restartMonitor()`
5. `getApiHealth()`
6. `readDetectionLog()`
7. `readReputationDb()`
8. `getSystemStatus()`
9. `analyzeText(payload)`
10. `analyzeUrl(payload)`
11. `analyzeFile(filePath)`
12. `getSettings()`
13. `setSettings(nextSettings)`
14. `onStatusUpdate(callback)`

No direct Node/Electron primitives are exposed to renderer.

### 3. Renderer SPA Shell (`index.html` + `renderer.js`)

1. `index.html` provides persistent shell:
   - left sidebar navigation
   - top title area
   - dynamic `<main id="page-root">`
2. `renderer.js` implements hash/router-state navigation and fragment loading from `pages/*.html`.
3. Each page has isolated controller lifecycle:
   - `mount(ctx)` initializes listeners/timers and initial render
   - `unmount()` clears timers/listeners and transient state
4. Shared renderer service layer (`stateBus`) caches and publishes:
   - scanner API health
   - file monitor status
   - extension connectivity inference
   - latest detection/reputation snapshots
   - persisted settings

## Shared State Model

```js
{
  health: {
    scannerApiReachable: boolean,
    fileMonitorRunning: boolean,
    scannerRunning: boolean
  },
  connectivity: {
    extensionConnected: boolean, // whatsapp/email event in last 10 min
    lastExtensionEventAt: string | null
  },
  data: {
    detections: DetectionEntry[],
    reputation: ReputationEntry[]
  },
  settings: {
    virustotalApiKey: string,
    enableUrlScanning: boolean,
    enableFileScanning: boolean,
    enableReputationTracking: boolean
  },
  meta: {
    updatedAt: string
  }
}
```

## Page Designs

### Dashboard (`pages/dashboard.html`)

Displays:

1. Protection status banner
2. Threat counters:
   - Threats Today
   - High Risk
   - Medium Risk
3. Recent detections table (latest subset)
4. Risk distribution chart (lightweight native HTML/CSS bar chart; no external chart library)

Data source: `detection_log.json` via IPC.
Refresh cadence: every 5 seconds.

### Live Protection (`pages/protection.html`)

Displays:

1. Scanner API status (`/docs` reachability)
2. File monitor status (process liveness)
3. Extension connectivity status (activity inference)

Refresh cadence: every 3 seconds (push-first via status event, pull fallback).

### Threat History (`pages/history.html`)

Displays full detection table:

Columns:

1. `timestamp`
2. `platform`
3. `sender`
4. `risk_score`
5. `risk_level`

Features:

1. sort (column-based)
2. filter (risk/platform/search)
3. row highlighting:
   - HIGH => red treatment
   - MEDIUM => orange treatment

### Sender Reputation (`pages/reputation.html`)

Displays `reputation_db.json` table:

1. `sender_id`
2. `count`
3. `risk_boost`

Sorted by `count` descending.
Refresh cadence: every 10 seconds.

### Manual Scan (`pages/scan.html`)

Inputs:

1. message text
2. URL
3. file picker path

Actions:

1. `POST /analyze-text`
2. `POST /analyze-url`
3. `POST /analyze-file`

Outputs:

1. `risk_score`
2. `risk_level`
3. `explanations` list

### System Status (`pages/status.html`)

Aggregated checks:

1. scanner API reachable
2. file monitor process running
3. JSON databases present/readable

Displays green/red indicators and last refresh timestamp.

### Settings (`pages/settings.html`)

Fields:

1. VirusTotal API key (stored via `electron-store`)
2. Toggle: enable URL scanning
3. Toggle: enable file scanning
4. Toggle: enable reputation tracking

Save path is IPC -> main -> electron-store.

## Extension Connectivity Inference

Logic:

1. Read detections and find entries where `platform` is `whatsapp` or `email`.
2. Compute most recent timestamp.
3. Mark connected if latest qualifying event is within last 10 minutes.

This status is informational and does not alter scanner/file monitor behavior.

## Service Lifecycle Rules

1. App start:
   - inspect existing processes
   - spawn missing services
2. Restart actions:
   - terminate targeted owned process
   - spawn replacement
3. App close:
   - stop only processes spawned by this Electron instance
   - do not kill externally managed processes

## IPC Contract (High-Level)

1. `rei:get-status` -> status snapshot object
2. `rei:start-services` -> start attempt result
3. `rei:restart-service` (`scanner`|`file_monitor`) -> operation result
4. `rei:read-detection-log` -> array of detections
5. `rei:read-reputation-db` -> normalized reputation array
6. `rei:manual-scan-text` -> scanner response
7. `rei:manual-scan-url` -> scanner response
8. `rei:manual-scan-file` -> scanner response
9. `rei:get-settings` -> settings object
10. `rei:set-settings` -> saved settings object
11. `rei:status-update` (event push) -> periodic health snapshot

## UI Theme

SOC-style dark palette via CSS variables:

1. `--bg: #0f172a`
2. `--surface: #1e293b`
3. `--accent: #3daee9`
4. `--success: #52c41a`
5. `--warning: #fa8c16`
6. `--danger: #ff4d4f`

Applied consistently across sidebar, panels, badges, tables, and status indicators.

## Packaging Readiness

`package.json` includes:

1. `npm start` entry (`electron .`)
2. builder config for Windows target
3. executable product name: `REI_Control_Center`
4. output artifact includes `REI_Control_Center.exe`

Paths for backend scripts and JSON files resolve from project root to avoid packaged relative path failures.

## Validation Plan

1. Launch app using `npm start`.
2. Confirm sidebar navigation switches pages without full reload.
3. Confirm scanner and file monitor autostart without duplicates.
4. Confirm dashboard/history/reputation polling intervals.
5. Confirm manual scan endpoints return and render risk fields.
6. Confirm settings persist and reload via electron-store.
7. Confirm close event stops only app-owned services.
8. Confirm build configuration is accepted by `electron-builder`.

