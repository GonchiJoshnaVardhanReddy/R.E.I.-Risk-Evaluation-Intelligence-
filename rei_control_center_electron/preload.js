// ─────────────────────────────────────────────────────────────
//  R.E.I. Control Center — Preload (Context Bridge)
// ─────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rei', {

  /* ── Data ─────────────────────────────────────────────── */
  readDetectionLog:  () => ipcRenderer.invoke('read-detection-log'),
  readReputationDb:  () => ipcRenderer.invoke('read-reputation-db'),
  getDetectionLog:   () => ipcRenderer.invoke('readDetectionLog'),
  getReputationDb:   () => ipcRenderer.invoke('readReputationDb'),

  /* ── Service Status ───────────────────────────────────── */
  scannerStatus:     () => ipcRenderer.invoke('scanner-status'),
  monitorStatus:     () => ipcRenderer.invoke('monitor-status'),
  extensionStatus:   () => ipcRenderer.invoke('extension-status'),
  getSystemStatus:   () => ipcRenderer.invoke('get-system-status'),
  systemStatus:      () => ipcRenderer.invoke('system-status'),
  onStatusUpdate:    (callback) => {
    const listener = (_event, payload) => {
      if (typeof callback === "function") callback(payload);
    };
    ipcRenderer.on("status-update", listener);
    return () => ipcRenderer.removeListener("status-update", listener);
  },
  onDashboardRefresh: (callback) => {
    const listener = (_event, payload) => {
      if (typeof callback === "function") callback(payload);
    };
    ipcRenderer.on("dashboard-refresh", listener);
    return () => ipcRenderer.removeListener("dashboard-refresh", listener);
  },

  /* ── Settings ─────────────────────────────────────────── */
  getSettings:       () => ipcRenderer.invoke('get-settings'),
  saveSettings:      (data) => ipcRenderer.invoke('save-settings', data),
  getSystemMetrics:  () => ({
    cpuPercent: 0,
    ramPercent: 0,
    networkThroughputMbps: null,
  }),

  /* ── File dialog ──────────────────────────────────────── */
  openFileDialog:    () => ipcRenderer.invoke('open-file-dialog'),
  analyzeFile:       (filePath) => ipcRenderer.invoke('analyze-file-path', filePath),
});
