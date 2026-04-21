// ─────────────────────────────────────────────────────────────
//  R.E.I. Control Center — Electron Main Process
// ─────────────────────────────────────────────────────────────

const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, execFile } = require("child_process");

// ── Testable helpers (exported at bottom) ───────────────────

const SETTINGS_DEFAULTS = {
  virustotalApiKey: "",
  enableUrlScanning: true,
  enableFileScanning: true,
  enableReputationTracking: true,
};
const MONITOR_ACTIVITY_WINDOW_SECONDS = 10;
const EXTENSION_ACTIVITY_WINDOW_MINUTES = 2;
const STATUS_BROADCAST_INTERVAL_MS = 3000;

function isSupportedPlatformEvent(platform) {
  return platform === "whatsapp" || platform === "email";
}

function inferExtensionConnectivity(entries, nowMs, minutesThreshold) {
  const thresholdMs = minutesThreshold * 60 * 1000;
  let latestExtTs = null;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    const metadataTs = typeof entry?.metadata?.last_extension_activity === "string"
      ? new Date(entry.metadata.last_extension_activity).getTime()
      : NaN;
    if (Number.isFinite(metadataTs)) {
      if (latestExtTs === null || metadataTs > latestExtTs) {
        latestExtTs = metadataTs;
      }
      continue;
    }

    if (!isSupportedPlatformEvent(entry.platform)) continue;
    const ts = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;
    if (latestExtTs === null || ts > latestExtTs) {
      latestExtTs = ts;
    }
  }

  if (latestExtTs === null) {
    return { connected: false, lastExtensionEventAt: null };
  }

  const connected = (nowMs - latestExtTs) <= thresholdMs;
  return {
    connected,
    lastExtensionEventAt: new Date(latestExtTs).toISOString(),
  };
}

function detectionLogRecentlyUpdated(mtimeMs, nowMs = Date.now(), thresholdSeconds = MONITOR_ACTIVITY_WINDOW_SECONDS) {
  if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return false;
  return (nowMs - mtimeMs) <= thresholdSeconds * 1000;
}

function mergeSettings(overrides) {
  const result = { ...SETTINGS_DEFAULTS };
  if (overrides && typeof overrides === "object") {
    for (const [key, value] of Object.entries(overrides)) {
      if (key in SETTINGS_DEFAULTS) {
        result[key] = value;
      }
    }
  }
  return result;
}

function canStopExternalProcess({ externalPid, startedByApp }) {
  if (!startedByApp) return false;
  if (externalPid === null || externalPid === undefined) return false;
  if (typeof externalPid !== "number" || externalPid < 0) return false;
  return true;
}

function resolveProjectRoot(isPackaged, resourcesPath) {
  const devRoot = path.resolve(__dirname, "..");
  if (!isPackaged) return devRoot;
  if (resourcesPath && fs.existsSync(resourcesPath)) return resourcesPath;
  return devRoot;
}

async function startService(service) {
  if (service.process) return true;
  try {
    const cmd = service.command[0];
    const args = service.command.slice(1);
    const child = spawn(cmd, args, {
      cwd: resolveProjectRoot(false, ""),
      shell: true,
      stdio: "pipe",
    });

    // Wait briefly to check for immediate spawn errors
    const started = await new Promise((resolve) => {
      let settled = false;
      child.on("error", () => {
        if (!settled) { settled = true; resolve(false); }
      });
      child.on("exit", (code) => {
        if (!settled && code !== null) { settled = true; resolve(false); }
      });
      setTimeout(() => {
        if (!settled) { settled = true; resolve(true); }
      }, 300);
    });

    if (!started) {
      service.process = null;
      service.startedByApp = false;
      return false;
    }

    service.process = child;
    service.externalPid = child.pid;
    service.startedByApp = true;
    return true;
  } catch {
    service.process = null;
    service.startedByApp = false;
    return false;
  }
}

function stopService(service, helpers) {
  if (!service.process) return;
  if (helpers && typeof helpers.stopProcessTreeByPid === "function" && service.externalPid) {
    helpers.stopProcessTreeByPid(service.externalPid);
  } else if (service.process.kill) {
    service.process.kill();
  }
  service.process = null;
  service.externalPid = null;
  service.startedByApp = false;
}

async function analyzeFile(filePath) {
  const fileBuffer = await fs.promises.readFile(filePath);
  const fileName = path.basename(filePath);
  const blob = new Blob([fileBuffer]);
  const formData = new FormData();
  formData.append("file", blob, fileName);

  const response = await fetch("http://127.0.0.1:8000/analyze-file", {
    method: "POST",
    body: formData,
  });
  return response.json();
}

// ── Electron-only code (guarded) ────────────────────────────

let app, BrowserWindow, ipcMain, dialog, nativeTheme;
try {
  const electron = require("electron");
  app = electron.app;
  BrowserWindow = electron.BrowserWindow;
  ipcMain = electron.ipcMain;
  dialog = electron.dialog;
  nativeTheme = electron.nativeTheme;
} catch {
  // Running in Node (test mode) — no Electron available
}

// ── Paths ───────────────────────────────────────────────────
const PROJECT_ROOT = resolveProjectRoot(false, "");
const DETECTION_LOG = path.join(PROJECT_ROOT, "detection_log.json");
const REPUTATION_DB = path.join(PROJECT_ROOT, "reputation_db.json");
const FILE_MONITOR = path.join(PROJECT_ROOT, "file_monitor.py");

// ── electron-store (ESM module — lazy loaded) ───────────────
let store = null;
async function getStore() {
  if (store) return store;
  const Store = (await import("electron-store")).default;
  store = new Store({ defaults: SETTINGS_DEFAULTS });
  return store;
}

// ── Child processes ─────────────────────────────────────────
let scannerProcess = null;
let monitorProcess = null;
let mainWindow = null;
let statusBroadcastTimer = null;

// ── Helpers ─────────────────────────────────────────────────
function readJsonSafe(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isPortReachable(port, host = "127.0.0.1", timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/docs", timeout }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function processListContains(marker) {
  if (!marker || typeof marker !== "string") {
    return Promise.resolve(false);
  }

  if (process.platform === "win32") {
    const escaped = marker.replace(/'/g, "''");
    const script = `$needle='${escaped}'; $hit = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'python' -and $_.CommandLine -like "*$needle*" } | Select-Object -First 1; if ($null -ne $hit) { 'true' } else { 'false' }`;
    return new Promise((resolve) => {
      execFile("powershell", ["-NoProfile", "-Command", script], { windowsHide: true, timeout: 2500 }, (error, stdout) => {
        if (error) return resolve(false);
        resolve(String(stdout).trim().toLowerCase().includes("true"));
      });
    });
  }

  return new Promise((resolve) => {
    execFile("ps", ["-ax", "-o", "command="], { timeout: 2500 }, (error, stdout) => {
      if (error) return resolve(false);
      resolve(String(stdout).toLowerCase().includes(marker.toLowerCase()));
    });
  });
}

function detectionLogRecentlyUpdatedFromDisk() {
  try {
    const mtimeMs = fs.statSync(DETECTION_LOG).mtimeMs;
    return detectionLogRecentlyUpdated(mtimeMs, Date.now(), MONITOR_ACTIVITY_WINDOW_SECONDS);
  } catch {
    return false;
  }
}

async function isFileMonitorRunning() {
  const hasMonitorProcess = await processListContains("file_monitor.py");
  if (hasMonitorProcess) return true;
  return detectionLogRecentlyUpdatedFromDisk();
}

async function buildSystemStatus() {
  const scannerUp = await isPortReachable(8000);
  const monitorUp = await isFileMonitorRunning();
  const detLogExists = fs.existsSync(DETECTION_LOG);
  const repDbExists = fs.existsSync(REPUTATION_DB);
  const detectionEntries = detLogExists ? readJsonSafe(DETECTION_LOG, []) : [];
  const extensionConnectivity = inferExtensionConnectivity(
    Array.isArray(detectionEntries) ? detectionEntries : [],
    Date.now(),
    EXTENSION_ACTIVITY_WINDOW_MINUTES,
  );
  return {
    scannerUp,
    monitorUp,
    detLogExists,
    repDbExists,
    extensionConnected: extensionConnectivity.connected,
    lastExtensionEventAt: extensionConnectivity.lastExtensionEventAt,
  };
}

async function pushStatusUpdate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const payload = await buildSystemStatus();
    mainWindow.webContents.send("status-update", payload);
  } catch (error) {
    console.error("[Status] push failed:", error);
  }
}

function startStatusBroadcast() {
  if (statusBroadcastTimer) {
    clearInterval(statusBroadcastTimer);
  }
  statusBroadcastTimer = setInterval(pushStatusUpdate, STATUS_BROADCAST_INTERVAL_MS);
}

function stopStatusBroadcast() {
  if (!statusBroadcastTimer) return;
  clearInterval(statusBroadcastTimer);
  statusBroadcastTimer = null;
}

// ── Service Management ──────────────────────────────────────
function startScannerApi() {
  if (scannerProcess) return;
  try {
    scannerProcess = spawn("uvicorn", ["rei_scanner_api:app", "--reload", "--host", "127.0.0.1", "--port", "8000"], {
      cwd: PROJECT_ROOT,
      shell: true,
      stdio: "pipe",
    });
    scannerProcess.stdout?.on("data", (d) => console.log("[Scanner]", d.toString().trim()));
    scannerProcess.stderr?.on("data", (d) => console.error("[Scanner]", d.toString().trim()));
    scannerProcess.on("close", (code) => { console.log(`[Scanner] exited ${code}`); scannerProcess = null; });
    scannerProcess.on("error", (err) => { console.error("[Scanner] spawn error:", err); scannerProcess = null; });
  } catch (e) {
    console.error("[Scanner] Failed to start:", e);
  }
}

function startFileMonitor() {
  if (monitorProcess) return;
  try {
    monitorProcess = spawn("python", [FILE_MONITOR], {
      cwd: PROJECT_ROOT,
      shell: true,
      stdio: "pipe",
    });
    monitorProcess.stdout?.on("data", (d) => console.log("[Monitor]", d.toString().trim()));
    monitorProcess.stderr?.on("data", (d) => console.error("[Monitor]", d.toString().trim()));
    monitorProcess.on("close", (code) => { console.log(`[Monitor] exited ${code}`); monitorProcess = null; });
    monitorProcess.on("error", (err) => { console.error("[Monitor] spawn error:", err); monitorProcess = null; });
  } catch (e) {
    console.error("[Monitor] Failed to start:", e);
  }
}

function stopServices() {
  stopStatusBroadcast();
  if (scannerProcess) {
    try { process.kill(scannerProcess.pid, "SIGTERM"); } catch { /* ignore */ }
    scannerProcess = null;
  }
  if (monitorProcess) {
    try { process.kill(monitorProcess.pid, "SIGTERM"); } catch { /* ignore */ }
    monitorProcess = null;
  }
}

// ── Window ──────────────────────────────────────────────────
function createWindow() {
  if (!BrowserWindow) return;
  nativeTheme.themeSource = "dark";

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: "R.E.I. Control Center",
    backgroundColor: "#0f172a",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── IPC Handlers ────────────────────────────────────────────
function registerIpc() {
  if (!ipcMain) return;

  ipcMain.handle("read-detection-log", () => readJsonSafe(DETECTION_LOG, []));
  ipcMain.handle("read-reputation-db", () => readJsonSafe(REPUTATION_DB, {}));

  ipcMain.handle("scanner-status", async () => {
    const status = await buildSystemStatus();
    return { running: status.scannerUp };
  });
  ipcMain.handle("monitor-status", async () => {
    const status = await buildSystemStatus();
    return { running: status.monitorUp };
  });
  ipcMain.handle("extension-status", async () => {
    const status = await buildSystemStatus();
    return {
      connected: status.extensionConnected,
      lastExtensionEventAt: status.lastExtensionEventAt,
    };
  });
  ipcMain.handle("system-status", async () => {
    return buildSystemStatus();
  });

  ipcMain.handle("get-settings", async () => {
    const s = await getStore();
    return s.store;
  });
  ipcMain.handle("save-settings", async (_e, data) => {
    const s = await getStore();
    for (const [key, value] of Object.entries(data)) {
      s.set(key, value);
    }
    return true;
  });

  ipcMain.handle("open-file-dialog", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [
        { name: "Supported Files", extensions: ["txt", "pdf", "docx", "html", "eml"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
}

// ── App lifecycle ───────────────────────────────────────────
if (app) {
  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    startScannerApi();
    startFileMonitor();
    startStatusBroadcast();
    pushStatusUpdate();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    stopServices();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    stopServices();
  });
}

// ── Module exports (for testing) ────────────────────────────
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    inferExtensionConnectivity,
    detectionLogRecentlyUpdated,
    mergeSettings,
    isSupportedPlatformEvent,
    canStopExternalProcess,
    resolveProjectRoot,
    startService,
    stopService,
    analyzeFile,
  };
}
