// ─────────────────────────────────────────────────────────────
//  R.E.I. Control Center — Preload (Context Bridge)
// ─────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rei', {

  /* ── Data ─────────────────────────────────────────────── */
  readDetectionLog:  () => ipcRenderer.invoke('read-detection-log'),
  readReputationDb:  () => ipcRenderer.invoke('read-reputation-db'),

  /* ── Service Status ───────────────────────────────────── */
  scannerStatus:     () => ipcRenderer.invoke('scanner-status'),
  monitorStatus:     () => ipcRenderer.invoke('monitor-status'),
  systemStatus:      () => ipcRenderer.invoke('system-status'),

  /* ── Settings ─────────────────────────────────────────── */
  getSettings:       () => ipcRenderer.invoke('get-settings'),
  saveSettings:      (data) => ipcRenderer.invoke('save-settings', data),

  /* ── File dialog ──────────────────────────────────────── */
  openFileDialog:    () => ipcRenderer.invoke('open-file-dialog'),
});
