# R.E.I. Extension VirusTotal Upgrade Design

## Problem
The Chrome extension in `extension/` needs a metadata rename and a robust VirusTotal website scanning flow that runs on page-load events, stores latest URL risk results for popup display, and does not break existing WhatsApp/Gmail/Outlook/local scanner behavior.

## Scope
- In scope:
  - Rename extension name/description in `manifest.json` (version unchanged).
  - Store/retrieve VirusTotal API key via popup settings (`chrome.storage.local`).
  - Add URL auto-scan via `chrome.tabs.onUpdated` on `status === "complete"`.
  - Submit URL to VirusTotal, poll analysis, compute LOW/MEDIUM/HIGH from `malicious/suspicious`.
  - Keep existing HIGH-risk redirect to `blocked.html`.
  - Store latest URL scan result in storage for popup display.
  - Add safe duplicate-scan prevention.
  - Add warning-only error handling for missing key and request failures.
  - Update required manifest permissions and host permissions.
- Out of scope:
  - Changes to local message/email scanner pipeline (`/analyze-text`) and extraction logic.
  - UI redesign of popup beyond settings/result wiring.

## Chosen Approach
Implement VirusTotal functionality in `background.js` only (no extra module), with popup-side settings/result display handled by current `popup.js` and `popup.html`.

## Design

### 1. Manifest updates
- File: `extension/extension/manifest.json`
- Changes:
  - `name` → `R.E.I. Risk Evaluation Intelligence`
  - `description` → `Offline multi-channel scam detection and website risk intelligence assistant powered by local AI and VirusTotal URL analysis.`
  - Keep `version` unchanged.
  - Ensure permissions include:
    - `storage`, `tabs`, `activeTab`, `scripting`
  - Ensure host permissions include:
    - `https://www.virustotal.com/*`
    - `http://127.0.0.1:8000/*`
    - `<all_urls>`

### 2. VirusTotal settings in popup
- Files: `extension/extension/popup.html`, `extension/extension/scripts/popup.js`
- Behavior:
  - Use existing API key input in settings panel.
  - Save key with `chrome.storage.local.set({ vt_api_key: key })`.
  - Load key with `chrome.storage.local.get(["vt_api_key"])`.
  - No hardcoded key anywhere.
  - If key absent, URL scanner remains silently disabled in runtime.

### 3. Automatic URL scan flow
- File: `extension/extension/scripts/background.js`
- Trigger:
  - `chrome.tabs.onUpdated.addListener(...)`
  - Run only when `changeInfo.status === "complete"` and URL starts with `http://` or `https://`.
  - Ignore `chrome://`, `chrome-extension://`, `file://`.
- Flow:
  1. Read `vt_api_key` from storage.
  2. If missing, `console.warn("VirusTotal API key not configured")` and stop.
  3. Enforce global cooldown (~20 seconds between scans). If cooldown active, skip silently.
  4. Skip if same URL as last scanned URL key.
  5. Encode URL before submission:
     - `const encodedUrl = btoa(url).replace(/=+$/, '');`
  6. Submit URL:
     - `POST https://www.virustotal.com/api/v3/urls`
     - Use encoded value in request body.
  7. Poll result:
     - `GET https://www.virustotal.com/api/v3/analyses/{analysis_id}`
  8. Extract counts:
     - `malicious`, `suspicious`, `harmless`
  9. Compute risk:
     - malicious > 0 → HIGH
     - else suspicious > 0 → MEDIUM
     - else LOW
  10. Save latest URL result:
     - `chrome.storage.local.set({ latest_url_scan_result: { ... } })`
  11. If HIGH, keep current redirect behavior to `blocked.html`.

### 4. Existing scanner isolation
- Preserve existing `/analyze-text` request structure and message/email detection logic.
- VirusTotal logic remains independent in background event path.
- No mutation observer or sender tracking modifications.

### 5. Error handling and stability
- Missing key:
  - `console.warn("VirusTotal API key not configured")`
- Request/poll failure:
  - `console.warn("VirusTotal scan failed")`
- Do not throw fatal errors or disrupt existing extension behavior.

### 6. Popup URL result display
- File: `extension/extension/scripts/popup.js` (+ minimal target element in `popup.html` if needed)
- Display latest result object:
  - `url`
  - `risk_level`
  - `malicious_count`
  - `suspicious_count`

## Validation plan
1. Confirm manifest rename/description/version and permission blocks.
2. Save/reload VT key in popup settings.
3. Open/switch to new http/https pages; verify scans trigger once per unique URL.
4. Confirm cooldown prevents scans more frequently than once per ~20 seconds.
5. Confirm VT result parsing and risk mapping.
6. Confirm latest URL result is stored and visible in popup.
7. Confirm existing WhatsApp/Gmail/Outlook + local API flow still operates unchanged.
8. Confirm warning logs appear for missing key/failures without breaking extension runtime.
