// ─────────────────────────────────────────────────────────────
//  R.E.I. Control Center — Electron Main Process
// ─────────────────────────────────────────────────────────────

const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

// ── Testable helpers (exported at bottom) ───────────────────

const SETTINGS_DEFAULTS = {
  virustotalApiKey: "",
  enableUrlScanning: true,
  enableFileScanning: true,
  enableReputationTracking: true,
};

function isSupportedPlatformEvent(platform) {
  return platform === "whatsapp" || platform === "email";
}

function inferExtensionConnectivity(entries, nowMs, minutesThreshold) {
  const thresholdMs = minutesThreshold * 60 * 1000;
  let latestExtTs = null;

  for (const entry of entries) {
    if (!isSupportedPlatformEvent(entry.platform)) continue;
    const ts = new Date(entry.timestamp).getTime();
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
    const reachable = await isPortReachable(8000);
    return { running: reachable };
  });
  ipcMain.handle("monitor-status", () => {
    return { running: monitorProcess !== null && monitorProcess.exitCode === null };
  });
  ipcMain.handle("system-status", async () => {
    const scannerUp = await isPortReachable(8000);
    const monitorUp = monitorProcess !== null && monitorProcess.exitCode === null;
    const detLogExists = fs.existsSync(DETECTION_LOG);
    const repDbExists = fs.existsSync(REPUTATION_DB);
    return { scannerUp, monitorUp, detLogExists, repDbExists };
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
    mergeSettings,
    isSupportedPlatformEvent,
    canStopExternalProcess,
    resolveProjectRoot,
    startService,
    stopService,
    analyzeFile,
  };
}
