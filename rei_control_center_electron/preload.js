// ─────────────────────────────────────────────────────────────
//  R.E.I. Control Center — Preload (Context Bridge)
// ─────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

function readSystemMetrics() {
  const cpus = os.cpus() || [];
  const cpuCount = cpus.length || 1;
  const load = os.loadavg();
  const cpuPercent = Math.max(0, Math.min((Number(load?.[0] || 0) / cpuCount) * 100, 100));
  const totalMem = os.totalmem() || 1;
  const usedMem = totalMem - (os.freemem() || 0);
  const ramPercent = Math.max(0, Math.min((usedMem / totalMem) * 100, 100));
  return {
    cpuPercent: Number(cpuPercent.toFixed(1)),
    ramPercent: Number(ramPercent.toFixed(1)),
    networkThroughputMbps: null,
  };
}

contextBridge.exposeInMainWorld('rei', {

  /* ── Data ─────────────────────────────────────────────── */
  readDetectionLog:  () => ipcRenderer.invoke('read-detection-log'),
  readReputationDb:  () => ipcRenderer.invoke('read-reputation-db'),

  /* ── Service Status ───────────────────────────────────── */
  scannerStatus:     () => ipcRenderer.invoke('scanner-status'),
  monitorStatus:     () => ipcRenderer.invoke('monitor-status'),
  extensionStatus:   () => ipcRenderer.invoke('extension-status'),
  systemStatus:      () => ipcRenderer.invoke('system-status'),
  onStatusUpdate:    (callback) => {
    const listener = (_event, payload) => {
      if (typeof callback === "function") callback(payload);
    };
    ipcRenderer.on("status-update", listener);
    return () => ipcRenderer.removeListener("status-update", listener);
  },

  /* ── Settings ─────────────────────────────────────────── */
  getSettings:       () => ipcRenderer.invoke('get-settings'),
  saveSettings:      (data) => ipcRenderer.invoke('save-settings', data),
  getSystemMetrics:  () => readSystemMetrics(),

  /* ── File dialog ──────────────────────────────────────── */
  openFileDialog:    () => ipcRenderer.invoke('open-file-dialog'),
});
