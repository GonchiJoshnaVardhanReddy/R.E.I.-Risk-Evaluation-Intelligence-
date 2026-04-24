# R.E.I. Extension VirusTotal Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `extension/` Chrome extension with renamed metadata, popup-managed VirusTotal API key, `tabs.onUpdated` URL auto-scan, result storage/display, cooldown/rate-limiting, and safe error handling while preserving existing WhatsApp/Gmail/Outlook/local scanner behavior.

**Architecture:** Keep all VirusTotal logic inside `extension/extension/scripts/background.js` as an independent path from existing `/analyze-text` message/email scanning. Use small pure helper functions in `background.js` and `popup.js` so Node tests can verify behavior without loading Chrome runtime. Wire popup settings/result UI using existing settings tab with one additional read-only latest URL result block.

**Tech Stack:** Chrome Extension Manifest V3, JavaScript (service worker + popup scripts), Chrome storage/tabs APIs, VirusTotal REST API, Node built-in test runner (`node --test`)

---

## File Structure

- Modify: `extension/extension/manifest.json`
  - Rename extension metadata.
  - Ensure required permissions and host permissions include `<all_urls>`.
- Modify: `extension/extension/scripts/background.js`
  - Add URL scan helpers (eligibility, cooldown, submit/poll/parse/risk mapping).
  - Add `chrome.tabs.onUpdated` scan trigger and storage of latest VT result.
  - Preserve existing `/analyze-text` logic unchanged.
- Modify: `extension/extension/scripts/popup.js`
  - Save/load VirusTotal key in settings.
  - Read and render latest URL scan result.
- Modify: `extension/extension/popup.html`
  - Add latest URL scan result display container in settings tab.
- Create: `tests/extension/background.vt.test.mjs`
  - Unit tests for risk mapping, URL eligibility, cooldown skip, and form-encoded submit body.
- Create: `tests/extension/popup.vt.test.mjs`
  - Unit tests for popup URL result rendering helper.
- Create: `tests/extension/manifest.vt.test.mjs`
  - Manifest field tests (name, description, unchanged version, permissions/hosts).

---

### Task 1: Add failing tests for VirusTotal/background behavior

**Files:**
- Create: `tests/extension/background.vt.test.mjs`
- Modify: `extension/extension/scripts/background.js` (none in this task)
- Test: `tests/extension/background.vt.test.mjs`

- [ ] **Step 1: Write the failing test for URL risk mapping**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeUrlRiskLevel } from '../../extension/extension/scripts/background.js';

test('computeUrlRiskLevel returns HIGH when malicious > 0', () => {
  assert.equal(computeUrlRiskLevel({ malicious: 2, suspicious: 0, harmless: 0 }), 'HIGH');
});

test('computeUrlRiskLevel returns MEDIUM when suspicious > 0 and malicious == 0', () => {
  assert.equal(computeUrlRiskLevel({ malicious: 0, suspicious: 3, harmless: 7 }), 'MEDIUM');
});

test('computeUrlRiskLevel returns LOW when malicious and suspicious are 0', () => {
  assert.equal(computeUrlRiskLevel({ malicious: 0, suspicious: 0, harmless: 10 }), 'LOW');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/extension/background.vt.test.mjs`  
Expected: FAIL with missing export/function error for `computeUrlRiskLevel`.

- [ ] **Step 3: Write the failing test for URL eligibility and cooldown skip**

```javascript
import { shouldIgnoreUrlForScan, shouldSkipDueToCooldown } from '../../extension/extension/scripts/background.js';

test('shouldIgnoreUrlForScan ignores non-http protocols', () => {
  assert.equal(shouldIgnoreUrlForScan('chrome://extensions'), true);
  assert.equal(shouldIgnoreUrlForScan('file://C:/x.txt'), true);
  assert.equal(shouldIgnoreUrlForScan('https://example.com'), false);
});

test('shouldSkipDueToCooldown skips same URL or global cooldown hits', () => {
  const now = 100_000;
  assert.equal(shouldSkipDueToCooldown({ lastUrl: 'https://a.com', lastTs: now - 1000, currentUrl: 'https://a.com', now, cooldownMs: 20000 }), true);
  assert.equal(shouldSkipDueToCooldown({ lastUrl: 'https://a.com', lastTs: now - 1000, currentUrl: 'https://b.com', now, cooldownMs: 20000 }), true);
  assert.equal(shouldSkipDueToCooldown({ lastUrl: 'https://a.com', lastTs: now - 21000, currentUrl: 'https://b.com', now, cooldownMs: 20000 }), false);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test tests/extension/background.vt.test.mjs`  
Expected: FAIL with missing export/function errors for helpers.

- [ ] **Step 5: Write the failing test for VT submit payload format**

```javascript
import { buildVirusTotalSubmitRequest } from '../../extension/extension/scripts/background.js';

test('buildVirusTotalSubmitRequest uses form-encoded body with original URL', () => {
  const req = buildVirusTotalSubmitRequest('https://example.com/path?a=1', 'k');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.match(req.body, /^url=/);
  assert.equal(decodeURIComponent(req.body.slice(4)), 'https://example.com/path?a=1');
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test tests/extension/background.vt.test.mjs`  
Expected: FAIL with missing export/function error for `buildVirusTotalSubmitRequest`.

- [ ] **Step 7: Commit**

```bash
git add tests/extension/background.vt.test.mjs
git commit -m "test: add failing VT background behavior tests"
```

---

### Task 2: Implement background URL scan module logic (minimal to pass tests + integration)

**Files:**
- Modify: `extension/extension/scripts/background.js`
- Test: `tests/extension/background.vt.test.mjs`

- [ ] **Step 1: Implement pure helpers and test exports**

```javascript
export const VT_SCAN_COOLDOWN_MS = 20_000;

export function shouldIgnoreUrlForScan(url) {
  return !url || (!url.startsWith('http://') && !url.startsWith('https://'));
}

export function shouldSkipDueToCooldown({ lastUrl, lastTs, currentUrl, now, cooldownMs }) {
  if (lastUrl && lastUrl === currentUrl) return true;
  if (typeof lastTs === 'number' && now - lastTs < cooldownMs) return true;
  return false;
}

export function computeUrlRiskLevel({ malicious = 0, suspicious = 0 }) {
  if (malicious > 0) return 'HIGH';
  if (suspicious > 0) return 'MEDIUM';
  return 'LOW';
}

export function buildVirusTotalSubmitRequest(url, apiKey) {
  return {
    method: 'POST',
    headers: {
      'x-apikey': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `url=${encodeURIComponent(url)}`
  };
}
```

- [ ] **Step 2: Run tests to verify helpers pass**

Run: `node --test tests/extension/background.vt.test.mjs`  
Expected: PASS for helper tests in `background.vt.test.mjs`.

- [ ] **Step 3: Implement `tabs.onUpdated` URL scan flow with key/cooldown/duplicate guard**

```javascript
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const currentUrl = tab?.url || '';
  if (shouldIgnoreUrlForScan(currentUrl)) return;

  const { vt_api_key: apiKey, vt_last_scanned_url: lastUrl, vt_last_scan_ts: lastTs } =
    await chrome.storage.local.get(['vt_api_key', 'vt_last_scanned_url', 'vt_last_scan_ts']);

  if (!apiKey) {
    console.warn('VirusTotal API key not configured');
    return;
  }

  const now = Date.now();
  if (shouldSkipDueToCooldown({ lastUrl, lastTs, currentUrl, now, cooldownMs: VT_SCAN_COOLDOWN_MS })) {
    return;
  }

  await chrome.storage.local.set({ vt_last_scanned_url: currentUrl, vt_last_scan_ts: now });
  await runVirusTotalScanForTab(tabId, currentUrl, apiKey);
});
```

- [ ] **Step 4: Implement VT submit/poll/parse/store with HIGH redirect**

```javascript
async function runVirusTotalScanForTab(tabId, url, apiKey) {
  try {
    const submitReq = buildVirusTotalSubmitRequest(url, apiKey);
    const submitResponse = await fetch('https://www.virustotal.com/api/v3/urls', submitReq);
    if (!submitResponse.ok) throw new Error(`submit failed: ${submitResponse.status}`);
    const submitData = await submitResponse.json();
    const analysisId = submitData?.data?.id;
    if (!analysisId) throw new Error('missing analysis id');

    const analysis = await pollAnalysisResult(analysisId, apiKey);
    const stats = analysis?.data?.attributes?.stats || analysis?.data?.attributes?.last_analysis_stats || {};
    const malicious = Number(stats.malicious || 0);
    const suspicious = Number(stats.suspicious || 0);
    const harmless = Number(stats.harmless || 0);
    const riskLevel = computeUrlRiskLevel({ malicious, suspicious });

    await chrome.storage.local.set({
      latest_url_scan_result: {
        url,
        risk_level: riskLevel,
        malicious_count: malicious,
        suspicious_count: suspicious,
        harmless_count: harmless
      }
    });

    if (riskLevel === 'HIGH') {
      chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(url)}`)
      });
    }
  } catch (error) {
    console.warn('VirusTotal scan failed');
  }
}
```

- [ ] **Step 5: Keep local scanner pipeline untouched**

```javascript
// Ensure existing analyzeMessage/analyze-text flow remains as-is:
// - analyzeMessage(text, sender, platform)
// - normalizeApiResponse(...)
// - storeScanHistory(...)
// - /analyze-text POST payload structure unchanged
```

- [ ] **Step 6: Run tests and syntax checks**

Run:
- `node --test tests/extension/background.vt.test.mjs`
- `node --check extension/extension/scripts/background.js`

Expected:
- test output shows all tests passing
- syntax check exits 0

- [ ] **Step 7: Commit**

```bash
git add extension/extension/scripts/background.js tests/extension/background.vt.test.mjs
git commit -m "feat: add tabs-based VirusTotal auto-scan with cooldown and result storage"
```

---

### Task 3: Implement popup settings and latest URL result display

**Files:**
- Modify: `extension/extension/popup.html`
- Modify: `extension/extension/scripts/popup.js`
- Create: `tests/extension/popup.vt.test.mjs`
- Test: `tests/extension/popup.vt.test.mjs`

- [ ] **Step 1: Write failing popup helper tests**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLatestUrlScanResult } from '../../extension/extension/scripts/popup.js';

test('formatLatestUrlScanResult renders core fields', () => {
  const text = formatLatestUrlScanResult({
    url: 'https://x.test',
    risk_level: 'MEDIUM',
    malicious_count: 0,
    suspicious_count: 2
  });
  assert.match(text, /https:\/\/x\.test/);
  assert.match(text, /MEDIUM/);
  assert.match(text, /suspicious/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/extension/popup.vt.test.mjs`  
Expected: FAIL with missing export/function for `formatLatestUrlScanResult`.

- [ ] **Step 3: Add popup result container markup**

```html
<div class="settings-card">
  <h3>Latest URL Scan</h3>
  <pre id="latest-url-scan-result">No URL scan result yet.</pre>
</div>
```

- [ ] **Step 4: Implement settings load/save and result renderer**

```javascript
export function formatLatestUrlScanResult(result) {
  if (!result || !result.url) return 'No URL scan result yet.';
  return [
    `URL: ${result.url}`,
    `Risk: ${result.risk_level || 'LOW'}`,
    `Malicious: ${Number(result.malicious_count || 0)}`,
    `Suspicious: ${Number(result.suspicious_count || 0)}`,
    `Harmless: ${Number(result.harmless_count || 0)}`
  ].join('\n');
}

function loadLatestUrlScanResult() {
  chrome.storage.local.get(['latest_url_scan_result'], (stored) => {
    const el = document.getElementById('latest-url-scan-result');
    if (!el) return;
    el.textContent = formatLatestUrlScanResult(stored.latest_url_scan_result);
  });
}
```

- [ ] **Step 5: Run popup tests and syntax checks**

Run:
- `node --test tests/extension/popup.vt.test.mjs`
- `node --check extension/extension/scripts/popup.js`

Expected:
- popup tests pass
- popup syntax check exits 0

- [ ] **Step 6: Commit**

```bash
git add extension/extension/popup.html extension/extension/scripts/popup.js tests/extension/popup.vt.test.mjs
git commit -m "feat: wire VT settings storage and latest URL scan result in popup"
```

---

### Task 4: Update manifest metadata/permissions and verify integration contract

**Files:**
- Modify: `extension/extension/manifest.json`
- Create: `tests/extension/manifest.vt.test.mjs`
- Test: `tests/extension/manifest.vt.test.mjs`

- [ ] **Step 1: Write failing manifest tests**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('extension/extension/manifest.json', 'utf8'));

test('manifest name/description/version are correct', () => {
  assert.equal(manifest.name, 'R.E.I. Risk Evaluation Intelligence');
  assert.equal(
    manifest.description,
    'Offline multi-channel scam detection and website risk intelligence assistant powered by local AI and VirusTotal URL analysis.'
  );
  assert.equal(manifest.version, '1.0.0');
});

test('manifest permissions and hosts include required values', () => {
  for (const p of ['storage', 'tabs', 'activeTab', 'scripting']) {
    assert.ok(manifest.permissions.includes(p));
  }
  for (const hp of ['https://www.virustotal.com/*', 'http://127.0.0.1:8000/*', '<all_urls>']) {
    assert.ok(manifest.host_permissions.includes(hp));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/extension/manifest.vt.test.mjs`  
Expected: FAIL due to old name/description/host permissions.

- [ ] **Step 3: Update manifest fields**

```json
{
  "name": "R.E.I. Risk Evaluation Intelligence",
  "version": "1.0.0",
  "description": "Offline multi-channel scam detection and website risk intelligence assistant powered by local AI and VirusTotal URL analysis.",
  "permissions": ["storage", "tabs", "activeTab", "scripting"],
  "host_permissions": [
    "https://www.virustotal.com/*",
    "http://127.0.0.1:8000/*",
    "<all_urls>"
  ]
}
```

- [ ] **Step 4: Verify existing scanner API pipeline remains unchanged**

Run:
- `node --check extension/extension/scripts/background.js`
- `node --check extension/extension/scripts/content.js`
- `rg "http://127.0.0.1:8000/analyze-text" extension/extension/scripts/background.js`

Expected:
- syntax checks exit 0
- `analyze-text` reference still present in background message-scan flow

- [ ] **Step 5: Run final extension-focused test suite**

Run:
- `node --test tests/extension/background.vt.test.mjs`
- `node --test tests/extension/popup.vt.test.mjs`
- `node --test tests/extension/manifest.vt.test.mjs`

Expected: all tests pass with no failures.

- [ ] **Step 6: Commit**

```bash
git add extension/extension/manifest.json tests/extension/manifest.vt.test.mjs
git commit -m "chore: rename extension and finalize VT permission contract"
```

---

## Self-Review Checklist (Completed)

1. **Spec coverage:**  
   - Rename/description/version unchanged: Task 4.  
   - API key storage in settings: Task 3.  
   - `tabs.onUpdated` auto-scan, cooldown, duplicate skip, error logs, VT submit/poll/risk parse/storage: Task 2.  
   - `<all_urls>` + required host/permissions: Task 4.  
   - Existing `/analyze-text` pipeline unchanged: Task 2 + Task 4 checks.

2. **Placeholder scan:**  
   - No TODO/TBD/placeholders.

3. **Type/signature consistency:**  
   - Helper names used consistently across tasks/tests:
     - `computeUrlRiskLevel`
     - `shouldIgnoreUrlForScan`
     - `shouldSkipDueToCooldown`
     - `buildVirusTotalSubmitRequest`
     - `formatLatestUrlScanResult`
