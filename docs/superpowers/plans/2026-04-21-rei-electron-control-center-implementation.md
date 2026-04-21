# R.E.I. Electron Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `rei_control_center_electron/` as the new primary multi-page Electron GUI for R.E.I., with safe backend service orchestration and shared real-time state.

**Architecture:** A single BrowserWindow hosts a persistent SPA shell (`index.html`) and renderer router (`renderer.js`) that loads page fragments (`pages/*.html`) without reload. `main.js` owns process lifecycle, health checks, file access, and IPC; `preload.js` exposes a narrow bridge API. Shared renderer state (`stateBus`) feeds all pages with polling + pushed status updates.

**Tech Stack:** Electron, Node.js (`node:test`), electron-store, native fetch, HTML/CSS/JS.

---

## File Structure and Responsibilities

- Create: `rei_control_center_electron/package.json`  
  Dependency/scripts/build config (`npm start`, `electron-builder` windows target).
- Create: `rei_control_center_electron/main.js`  
  BrowserWindow setup, scanner/file-monitor process management, IPC handlers, status broadcast loop.
- Create: `rei_control_center_electron/preload.js`  
  Safe `contextBridge` API (`window.rei`) only.
- Create: `rei_control_center_electron/index.html`  
  Persistent shell layout: sidebar + dynamic main content region.
- Create: `rei_control_center_electron/renderer.js`  
  Router, shared state bus, page mount/unmount lifecycle, polling orchestration.
- Create: `rei_control_center_electron/styles.css`  
  SOC dark theme variables and shared component styles.
- Create: `rei_control_center_electron/pages/dashboard.html`  
  Threat counters, recent detections, risk distribution chart container.
- Create: `rei_control_center_electron/pages/protection.html`  
  Scanner/file monitor/extension connectivity status indicators.
- Create: `rei_control_center_electron/pages/history.html`  
  Full detection table + filter/sort controls.
- Create: `rei_control_center_electron/pages/reputation.html`  
  Reputation table sorted by count.
- Create: `rei_control_center_electron/pages/scan.html`  
  Manual scan form for text/url/file with result panel.
- Create: `rei_control_center_electron/pages/status.html`  
  System status checks panel.
- Create: `rei_control_center_electron/pages/settings.html`  
  VirusTotal API key + feature toggles.
- Create: `rei_control_center_electron/tests/package-config.test.mjs`  
  Validates package scripts, builder config, and security-related defaults.
- Create: `rei_control_center_electron/tests/main-ipc.test.mjs`  
  Validates pure helper behavior for connectivity inference/settings normalization.
- Create: `rei_control_center_electron/tests/renderer-router.test.mjs`  
  Validates route registration, mount/unmount cleanup, and state propagation.

---

### Task 1: Scaffold Electron app and packaging contract

**Files:**
- Create: `rei_control_center_electron/tests/package-config.test.mjs`
- Create: `rei_control_center_electron/package.json`

- [ ] **Step 1: Write the failing test**

```js
// rei_control_center_electron/tests/package-config.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const pkgPath = join(process.cwd(), "rei_control_center_electron", "package.json");

test("package.json defines start script and electron-builder windows target", async () => {
  const raw = await readFile(pkgPath, "utf8");
  const pkg = JSON.parse(raw);

  assert.equal(pkg.main, "main.js");
  assert.equal(pkg.scripts.start, "electron .");
  assert.ok(pkg.scripts.build);
  assert.equal(pkg.build.productName, "REI_Control_Center");
  assert.ok(pkg.build.win?.target?.includes("nsis"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test rei_control_center_electron/tests/package-config.test.mjs`  
Expected: FAIL because `rei_control_center_electron/package.json` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```json
{
  "name": "rei-control-center-electron",
  "version": "1.0.0",
  "description": "R.E.I. Control Center Electron GUI",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test tests/*.test.mjs",
    "build": "electron-builder --win"
  },
  "dependencies": {
    "electron-store": "^10.0.1"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-builder": "^24.13.3"
  },
  "build": {
    "appId": "com.rei.controlcenter",
    "productName": "REI_Control_Center",
    "win": {
      "target": ["nsis"]
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test rei_control_center_electron/tests/package-config.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rei_control_center_electron/package.json rei_control_center_electron/tests/package-config.test.mjs
git commit -m "feat: scaffold electron package and build config" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Implement main process service ownership + IPC contract

**Files:**
- Create: `rei_control_center_electron/main.js`
- Create: `rei_control_center_electron/preload.js`
- Create: `rei_control_center_electron/tests/main-ipc.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// rei_control_center_electron/tests/main-ipc.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  inferExtensionConnectivity,
  mergeSettings,
  isSupportedPlatformEvent
} = require("../main.js");

test("inferExtensionConnectivity marks connected when whatsapp/email event is recent", () => {
  const now = new Date("2026-04-21T00:00:00Z").getTime();
  const data = [
    { platform: "url", timestamp: "2026-04-20T23:20:00Z" },
    { platform: "whatsapp", timestamp: "2026-04-20T23:55:00Z" }
  ];
  const result = inferExtensionConnectivity(data, now, 10);
  assert.equal(result.connected, true);
});

test("mergeSettings enforces defaults for missing keys", () => {
  const result = mergeSettings({ virustotalApiKey: "abc" });
  assert.equal(result.enableUrlScanning, true);
  assert.equal(result.enableFileScanning, true);
  assert.equal(result.enableReputationTracking, true);
});

test("isSupportedPlatformEvent accepts only whatsapp and email", () => {
  assert.equal(isSupportedPlatformEvent("whatsapp"), true);
  assert.equal(isSupportedPlatformEvent("email"), true);
  assert.equal(isSupportedPlatformEvent("url"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test rei_control_center_electron/tests/main-ipc.test.mjs`  
Expected: FAIL because exports/functions are not implemented yet.

- [ ] **Step 3: Write minimal implementation**

```js
// main.js (exported helpers section)
function isSupportedPlatformEvent(platform) {
  return platform === "whatsapp" || platform === "email";
}

function inferExtensionConnectivity(entries, nowMs = Date.now(), windowMinutes = 10) {
  const threshold = nowMs - windowMinutes * 60_000;
  let latest = null;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isSupportedPlatformEvent(String(entry?.platform || "").toLowerCase())) continue;
    const ts = Date.parse(String(entry?.timestamp || ""));
    if (Number.isNaN(ts)) continue;
    if (latest === null || ts > latest) latest = ts;
  }
  return {
    connected: latest !== null && latest >= threshold,
    lastExtensionEventAt: latest ? new Date(latest).toISOString() : null
  };
}

function mergeSettings(input = {}) {
  return {
    virustotalApiKey: String(input.virustotalApiKey || ""),
    enableUrlScanning: input.enableUrlScanning !== false,
    enableFileScanning: input.enableFileScanning !== false,
    enableReputationTracking: input.enableReputationTracking !== false
  };
}

module.exports = {
  inferExtensionConnectivity,
  mergeSettings,
  isSupportedPlatformEvent
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test rei_control_center_electron/tests/main-ipc.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rei_control_center_electron/main.js rei_control_center_electron/preload.js rei_control_center_electron/tests/main-ipc.test.mjs
git commit -m "feat: add main process helpers and IPC bridge skeleton" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Build SPA shell, router, and lifecycle-safe page mounting

**Files:**
- Create: `rei_control_center_electron/index.html`
- Create: `rei_control_center_electron/renderer.js`
- Create: `rei_control_center_electron/styles.css`
- Create: `rei_control_center_electron/tests/renderer-router.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// rei_control_center_electron/tests/renderer-router.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createRouter } = require("../renderer.js");

test("router unmounts previous page before mounting next page", async () => {
  const calls = [];
  const router = createRouter({
    dashboard: { mount: async () => calls.push("mount:dashboard"), unmount: () => calls.push("unmount:dashboard") },
    status: { mount: async () => calls.push("mount:status"), unmount: () => calls.push("unmount:status") }
  });
  await router.navigate("dashboard");
  await router.navigate("status");
  assert.deepEqual(calls, ["mount:dashboard", "unmount:dashboard", "mount:status"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test rei_control_center_electron/tests/renderer-router.test.mjs`  
Expected: FAIL because `createRouter` is not implemented/exported.

- [ ] **Step 3: Write minimal implementation**

```js
// renderer.js (router core)
function createRouter(controllers) {
  let activeKey = null;
  return {
    async navigate(key, ctx = {}) {
      if (!controllers[key]) throw new Error(`Unknown route: ${key}`);
      if (activeKey && controllers[activeKey]?.unmount) controllers[activeKey].unmount();
      activeKey = key;
      await controllers[key].mount(ctx);
    },
    getActiveRoute() {
      return activeKey;
    }
  };
}

module.exports = { createRouter };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test rei_control_center_electron/tests/renderer-router.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rei_control_center_electron/index.html rei_control_center_electron/renderer.js rei_control_center_electron/styles.css rei_control_center_electron/tests/renderer-router.test.mjs
git commit -m "feat: add SPA shell and route lifecycle engine" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Add page partials and shared state bus wiring

**Files:**
- Create: `rei_control_center_electron/pages/dashboard.html`
- Create: `rei_control_center_electron/pages/protection.html`
- Create: `rei_control_center_electron/pages/history.html`
- Create: `rei_control_center_electron/pages/reputation.html`
- Create: `rei_control_center_electron/pages/scan.html`
- Create: `rei_control_center_electron/pages/status.html`
- Create: `rei_control_center_electron/pages/settings.html`
- Modify: `rei_control_center_electron/renderer.js`

- [ ] **Step 1: Write the failing test**

```js
// append to renderer-router.test.mjs
test("state bus publishes updates to subscribers", () => {
  const { createStateBus } = require("../renderer.js");
  const bus = createStateBus();
  let snapshot = null;
  const unsub = bus.subscribe((state) => { snapshot = state; });
  bus.update({ health: { scannerApiReachable: true } });
  assert.equal(snapshot.health.scannerApiReachable, true);
  unsub();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test rei_control_center_electron/tests/renderer-router.test.mjs`  
Expected: FAIL because `createStateBus` is missing.

- [ ] **Step 3: Write minimal implementation**

```js
// renderer.js (state bus core)
function createStateBus() {
  let state = {
    health: {},
    connectivity: {},
    data: { detections: [], reputation: [] },
    settings: {},
    meta: {}
  };
  const listeners = new Set();
  return {
    getState: () => state,
    update: (patch) => {
      state = { ...state, ...patch, meta: { ...(state.meta || {}), updatedAt: new Date().toISOString() } };
      listeners.forEach((cb) => cb(state));
    },
    subscribe: (cb) => {
      listeners.add(cb);
      cb(state);
      return () => listeners.delete(cb);
    }
  };
}

module.exports = { createRouter, createStateBus };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test rei_control_center_electron/tests/renderer-router.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rei_control_center_electron/pages/*.html rei_control_center_electron/renderer.js rei_control_center_electron/tests/renderer-router.test.mjs
git commit -m "feat: add page partials and shared renderer state bus" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Implement service control, polling loops, and status propagation

**Files:**
- Modify: `rei_control_center_electron/main.js`
- Modify: `rei_control_center_electron/preload.js`
- Modify: `rei_control_center_electron/renderer.js`

- [ ] **Step 1: Write the failing test**

```js
// append to main-ipc.test.mjs
test("inferExtensionConnectivity reports disconnected when no recent event in 10 minutes", () => {
  const now = new Date("2026-04-21T00:00:00Z").getTime();
  const data = [{ platform: "email", timestamp: "2026-04-20T23:30:00Z" }];
  const result = inferExtensionConnectivity(data, now, 10);
  assert.equal(result.connected, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test rei_control_center_electron/tests/main-ipc.test.mjs`  
Expected: FAIL until time-window logic and status updates are correctly wired.

- [ ] **Step 3: Write minimal implementation**

```js
// main.js (status loop sketch)
setInterval(async () => {
  const detection = readDetectionLogSafe(projectRoot);
  const connectivity = inferExtensionConnectivity(detection, Date.now(), 10);
  const snapshot = {
    scannerApiReachable: await isScannerApiReachable(),
    fileMonitorRunning: isChildRunning(fileMonitorProc, externalFileMonitorPid),
    scannerRunning: isChildRunning(scannerProc, externalScannerPid),
    detectionLogPresent: detectionLogExists(projectRoot),
    reputationDbPresent: reputationDbExists(projectRoot),
    connectivity
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("rei:status-update", snapshot);
  }
}, 3000);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test rei_control_center_electron/tests/main-ipc.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rei_control_center_electron/main.js rei_control_center_electron/preload.js rei_control_center_electron/renderer.js rei_control_center_electron/tests/main-ipc.test.mjs
git commit -m "feat: wire status polling and IPC event propagation" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Implement Manual Scan + Settings persistence behavior

**Files:**
- Modify: `rei_control_center_electron/main.js`
- Modify: `rei_control_center_electron/preload.js`
- Modify: `rei_control_center_electron/renderer.js`
- Modify: `rei_control_center_electron/pages/scan.html`
- Modify: `rei_control_center_electron/pages/settings.html`

- [ ] **Step 1: Write the failing test**

```js
// append to main-ipc.test.mjs
test("mergeSettings keeps explicit false toggles and key", () => {
  const result = mergeSettings({
    virustotalApiKey: "vt-key",
    enableUrlScanning: false,
    enableFileScanning: false,
    enableReputationTracking: false
  });
  assert.equal(result.virustotalApiKey, "vt-key");
  assert.equal(result.enableUrlScanning, false);
  assert.equal(result.enableFileScanning, false);
  assert.equal(result.enableReputationTracking, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test rei_control_center_electron/tests/main-ipc.test.mjs`  
Expected: FAIL until settings persistence/normalization supports explicit false.

- [ ] **Step 3: Write minimal implementation**

```js
// main.js IPC handlers sketch
ipcMain.handle("rei:get-settings", () => mergeSettings(store.get("settings", {})));
ipcMain.handle("rei:set-settings", (_evt, payload) => {
  const merged = mergeSettings(payload || {});
  store.set("settings", merged);
  return merged;
});

ipcMain.handle("rei:manual-scan-text", async (_evt, payload) => postJson("/analyze-text", payload));
ipcMain.handle("rei:manual-scan-url", async (_evt, payload) => postJson("/analyze-url", payload));
ipcMain.handle("rei:manual-scan-file", async (_evt, filePath) => postFile("/analyze-file", filePath));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test rei_control_center_electron/tests/main-ipc.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rei_control_center_electron/main.js rei_control_center_electron/preload.js rei_control_center_electron/renderer.js rei_control_center_electron/pages/scan.html rei_control_center_electron/pages/settings.html rei_control_center_electron/tests/main-ipc.test.mjs
git commit -m "feat: add manual scan IPC and electron-store settings flow" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: End-to-end validation and startup readiness

**Files:**
- Modify: `rei_control_center_electron/main.js`
- Modify: `rei_control_center_electron/renderer.js`
- Modify: `rei_control_center_electron/styles.css`

- [ ] **Step 1: Write the failing test**

```js
// append to package-config.test.mjs
test("package scripts include start, test, and build", async () => {
  const raw = await readFile(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  assert.equal(typeof pkg.scripts.start, "string");
  assert.equal(typeof pkg.scripts.test, "string");
  assert.equal(typeof pkg.scripts.build, "string");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test rei_control_center_electron/tests/package-config.test.mjs`  
Expected: FAIL if any required script was missed.

- [ ] **Step 3: Write minimal implementation**

```bash
npm --prefix rei_control_center_electron install
npm --prefix rei_control_center_electron test
```

```js
// renderer.js startup call
window.addEventListener("DOMContentLoaded", async () => {
  await window.rei.startServices();
  await router.navigate("dashboard");
});
```

- [ ] **Step 4: Run verification commands**

Run:

```bash
node --test rei_control_center_electron/tests/*.test.mjs
npm --prefix rei_control_center_electron start
```

Expected:

1. All tests PASS.
2. App opens with sidebar and page routing.
3. Services start without duplicate spawns.
4. Closing app stops only app-owned child processes.

- [ ] **Step 5: Commit**

```bash
git add rei_control_center_electron
git commit -m "feat: finalize electron control center startup and validation" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Plan Self-Review

### 1. Spec coverage check

Covered:

1. Single-window SPA shell and dynamic page loading (`index.html`, `renderer.js`).
2. Required pages and refresh intervals (dashboard/protection/history/reputation/scan/status/settings).
3. Main process responsibilities (service lifecycle, IPC bridge, settings persistence, safe shutdown).
4. Shared cross-page state (detections, reputation, connectivity inference, API/process health, settings).
5. Packaging support for `electron-builder` and `REI_Control_Center.exe`.

### 2. Placeholder scan

No `TBD`/`TODO` placeholders. Each task includes concrete files, commands, and minimal code snippets.

### 3. Type/signature consistency

Consistent names across tasks:

1. `inferExtensionConnectivity`
2. `mergeSettings`
3. `createRouter`
4. `createStateBus`
5. IPC channels prefixed with `rei:`

