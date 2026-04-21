// ═════════════════════════════════════════════════════════════════
//  R.E.I. Control Center — Renderer
// ═════════════════════════════════════════════════════════════════

const API_BASE = "http://127.0.0.1:8000";

const navItems = typeof document !== "undefined" ? document.querySelectorAll(".nav-item") : [];
const pages = typeof document !== "undefined" ? document.querySelectorAll(".page") : [];
let activePage = "dashboard";
const intervals = {};
let latestSystemStatus = null;
const chartState = {
  timeline: null,
  risk: null,
};
const PERSISTENT_INTERVAL_KEYS = new Set(["clock", "headerStatus"]);
const STATUS_ICON_MAP = {
  scanner: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 4 8v8l8 5 8-5V8l-8-5Zm0 2.2L18 8.7v6.6l-6 3.8-6-3.8V8.7l6-3.5ZM8.5 12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0Z"/>
    </svg>
  `,
  monitor: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h16v12H4V4Zm2 2v8h12V6H6Zm4 12h4v2h-4v-2Z"/>
    </svg>
  `,
  extension: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6v4h3a3 3 0 0 1 3 3v4h-2v-4a1 1 0 0 0-1-1h-3v2H9V9H6a1 1 0 0 0-1 1v4H3v-4a3 3 0 0 1 3-3h3V3Zm2 2v4h2V5h-2Zm-2 8h6v8H9v-8Z"/>
    </svg>
  `,
  stores: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h16v5H4V4Zm0 7h16v9H4v-9Zm2-5v1h12V6H6Zm0 7v5h12v-5H6Z"/>
    </svg>
  `,
};

// ── Base Helpers ────────────────────────────────────────────────
function clearAllIntervals({ preservePersistent = false } = {}) {
  Object.keys(intervals).forEach((key) => {
    if (preservePersistent && PERSISTENT_INTERVAL_KEYS.has(key)) return;
    clearInterval(intervals[key]);
    delete intervals[key];
  });
}

function destroyOverviewCharts() {
  Object.keys(chartState).forEach((key) => {
    const chart = chartState[key];
    if (chart && typeof chart.destroy === "function") {
      chart.destroy();
    }
    chartState[key] = null;
  });
}

function escHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeAgo(isoStr) {
  const date = toDate(isoStr);
  if (!date) return "—";
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return `${Math.max(diffSeconds, 0)}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function formatTimestamp(isoStr) {
  const date = toDate(isoStr);
  if (!date) return "—";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function levelClass(level) {
  const normalized = String(level || "LOW").toUpperCase();
  if (normalized === "HIGH") return "critical";
  if (normalized === "MEDIUM") return "warning";
  return "safe";
}

function badgeHtml(level) {
  const normalized = String(level || "LOW").toUpperCase();
  return `<span class="risk-badge ${levelClass(normalized)}">${normalized}</span>`;
}

function statusModel({ online, degraded = false }) {
  if (online) return { label: "Running", cls: "running" };
  if (degraded) return { label: "Degraded", cls: "degraded" };
  return { label: "Offline", cls: "offline" };
}

function extensionHealthFromStatus(statusPayload) {
  const last = statusPayload?.lastExtensionEventAt;
  if (!last) return { label: "Offline", cls: "offline", subtitle: "No activity detected" };
  const lastTs = toDate(last);
  if (!lastTs) return { label: "Offline", cls: "offline", subtitle: "Invalid activity timestamp" };
  const ageSeconds = (Date.now() - lastTs.getTime()) / 1000;
  if (ageSeconds <= 120) return { label: "Active", cls: "running", subtitle: `Last activity ${timeAgo(last)}` };
  if (ageSeconds <= 600) return { label: "Idle", cls: "degraded", subtitle: `Last activity ${timeAgo(last)}` };
  return { label: "Offline", cls: "offline", subtitle: `Last activity ${timeAgo(last)}` };
}

async function getSystemStatus() {
  if (latestSystemStatus) return latestSystemStatus;
  return window.rei.systemStatus();
}

async function getMetricsSnapshot() {
  if (window.reiSystemMetrics && typeof window.reiSystemMetrics.getSnapshot === "function") {
    return window.reiSystemMetrics.getSnapshot();
  }
  return {
    cpuPercent: 0,
    ramPercent: 0,
    networkThroughputMbps: 0,
  };
}

// ── Header ──────────────────────────────────────────────────────
function updateClock() {
  const clock = document.getElementById("system-clock");
  if (!clock) return;
  clock.textContent = new Date().toLocaleTimeString();
}

async function updateHeaderStatus() {
  try {
    const status = await getSystemStatus();
    const scanner = document.getElementById("scanner-indicator");
    if (!scanner) return;
    if (status.scannerUp) {
      scanner.className = "status-pill running";
      scanner.textContent = "Scanner Online";
    } else {
      scanner.className = "status-pill offline";
      scanner.textContent = "Scanner Offline";
    }
  } catch (_error) {
    const scanner = document.getElementById("scanner-indicator");
    if (!scanner) return;
    scanner.className = "status-pill offline";
    scanner.textContent = "Scanner Offline";
  }
}

function startHeaderServices() {
  updateClock();
  updateHeaderStatus();
  intervals.clock = setInterval(updateClock, 1000);
  intervals.headerStatus = setInterval(updateHeaderStatus, 3000);
}

// ── Routing ─────────────────────────────────────────────────────
function navigateTo(page) {
  const previousPage = activePage;
  activePage = page;
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  pages.forEach((section) => section.classList.toggle("active", section.id === `page-${page}`));
  if (previousPage === "dashboard" && page !== "dashboard") {
    destroyOverviewCharts();
  }
  clearAllIntervals({ preservePersistent: true });
  initPage(page);
}

if (typeof document !== "undefined") {
  navItems.forEach((item) => {
    item.addEventListener("click", () => navigateTo(item.dataset.page));
  });
}

function initPage(page) {
  switch (page) {
    case "dashboard":
      initOverview();
      break;
    case "protection":
      initProtection();
      break;
    case "history":
      initHistory();
      break;
    case "reputation":
      initReputation();
      break;
    case "scan":
      initScanCenter();
      break;
    case "reports":
      initReports();
      break;
    case "settings":
      initSettings();
      break;
    default:
      initOverview();
      break;
  }
}

// ── Charts ──────────────────────────────────────────────────────
function ensureTimelineChart(labels, values) {
  const canvas = document.getElementById("overview-timeline-chart");
  if (!canvas || typeof Chart === "undefined") return;
  if (chartState.timeline && chartState.timeline.canvas !== canvas) {
    chartState.timeline.destroy();
    chartState.timeline = null;
  }

  if (!chartState.timeline) {
    chartState.timeline = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Detections / minute",
            data: values,
            borderColor: "#22c55e",
            backgroundColor: "rgba(34,197,94,0.20)",
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.06)" } },
          y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.06)" }, beginAtZero: true },
        },
      },
    });
    return;
  }

  chartState.timeline.data.labels = labels;
  chartState.timeline.data.datasets[0].data = values;
  chartState.timeline.update("none");
}

function ensureRiskChart(values) {
  const canvas = document.getElementById("overview-risk-chart");
  if (!canvas || typeof Chart === "undefined") return;
  if (chartState.risk && chartState.risk.canvas !== canvas) {
    chartState.risk.destroy();
    chartState.risk = null;
  }

  if (!chartState.risk) {
    chartState.risk = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["LOW", "MEDIUM", "HIGH"],
        datasets: [
          {
            data: values,
            backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"],
            borderColor: "#111a2e",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#94a3b8" } },
        },
      },
    });
    return;
  }

  chartState.risk.data.datasets[0].data = values;
  chartState.risk.update("none");
}

function detectionsPerMinute(logs, minutes = 10) {
  const now = new Date();
  now.setSeconds(0, 0);
  const labels = [];
  const values = [];

  for (let i = minutes - 1; i >= 0; i -= 1) {
    const slot = new Date(now.getTime() - i * 60_000);
    const slotKey = slot.toISOString().slice(11, 16);
    labels.push(slotKey);
    values.push(0);
  }

  const firstSlot = new Date(now.getTime() - (minutes - 1) * 60_000).getTime();
  logs.forEach((entry) => {
    const ts = toDate(entry?.timestamp);
    if (!ts) return;
    const tsMs = ts.getTime();
    if (tsMs < firstSlot || tsMs > now.getTime() + 59_999) return;
    const index = Math.floor((tsMs - firstSlot) / 60_000);
    if (index >= 0 && index < values.length) values[index] += 1;
  });

  return { labels, values };
}

// ── Overview (SOC Dashboard) ────────────────────────────────────
function initOverview() {
  const page = document.getElementById("page-dashboard");
  page.innerHTML = `
    <div class="page-header">
      <h1>Overview</h1>
      <p>Security operations center view for platform health and active threats.</p>
    </div>

    <div class="soc-grid dashboard-row dashboard-row-metrics">
      <div class="soc-card metric-card">
        <div class="metric-label">CPU Usage</div>
        <div class="metric-value" id="metric-cpu-value">0%</div>
        <div class="metric-bar"><div id="metric-cpu-bar" class="metric-fill safe"></div></div>
      </div>
      <div class="soc-card metric-card">
        <div class="metric-label">RAM Usage</div>
        <div class="metric-value" id="metric-ram-value">0%</div>
        <div class="metric-bar"><div id="metric-ram-bar" class="metric-fill warning"></div></div>
      </div>
      <div class="soc-card metric-card">
        <div class="metric-label">Network Activity</div>
        <div class="metric-value" id="metric-net-value">0 Mbps</div>
        <div class="metric-bar"><div id="metric-net-bar" class="metric-fill accent"></div></div>
      </div>
      <div class="soc-card metric-card">
        <div class="metric-label">Threats Blocked Today</div>
        <div class="metric-value" id="metric-threats-value">0</div>
        <div class="metric-sub">MEDIUM + HIGH detections</div>
      </div>
    </div>

    <div class="soc-grid dashboard-row dashboard-row-status">
      <div class="soc-card status-card" id="status-card-scanner"></div>
      <div class="soc-card status-card" id="status-card-monitor"></div>
      <div class="soc-card status-card" id="status-card-extension"></div>
    </div>

    <div class="soc-grid dashboard-row dashboard-row-charts">
      <div class="soc-card chart-card">
        <div class="card-title">Detection Timeline (Last 10 Minutes)</div>
        <div class="chart-box"><canvas id="overview-timeline-chart"></canvas></div>
      </div>
      <div class="soc-card chart-card">
        <div class="card-title">Risk Distribution</div>
        <div class="chart-box"><canvas id="overview-risk-chart"></canvas></div>
      </div>
    </div>

    <div class="soc-card alerts-card dashboard-row dashboard-row-alerts">
      <div class="card-title">Live Alerts Stream</div>
      <div id="alerts-stream" class="alerts-stream"></div>
    </div>
  `;

  refreshOverview();
  intervals.overviewData = setInterval(refreshOverview, 5000);
  intervals.overviewMetrics = setInterval(refreshMetricsOnly, 2000);
}

function renderStatusCard(id, title, iconKey, statusValue, subtitle) {
  const element = document.getElementById(id);
  if (!element) return;
  const icon = STATUS_ICON_MAP[iconKey] || STATUS_ICON_MAP.scanner;
  element.innerHTML = `
    <div class="status-icon">${icon}</div>
    <div class="status-content">
      <div class="status-title">${title}</div>
      <div class="status-line">
        <span class="status-dot ${statusValue.cls}"></span>
        <span class="status-label">${statusValue.label}</span>
      </div>
      <div class="status-sub">${escHtml(subtitle)}</div>
    </div>
  `;
}

function metricFillClass(value) {
  if (value >= 85) return "critical";
  if (value >= 65) return "warning";
  return "safe";
}

async function refreshMetricsOnly() {
  if (activePage !== "dashboard") return;
  const metrics = await getMetricsSnapshot();
  const cpu = Number(metrics.cpuPercent || 0);
  const ram = Number(metrics.ramPercent || 0);
  const net = Number(metrics.networkThroughputMbps || 0);

  const cpuValue = document.getElementById("metric-cpu-value");
  const cpuBar = document.getElementById("metric-cpu-bar");
  const ramValue = document.getElementById("metric-ram-value");
  const ramBar = document.getElementById("metric-ram-bar");
  const netValue = document.getElementById("metric-net-value");
  const netBar = document.getElementById("metric-net-bar");

  if (cpuValue) cpuValue.textContent = `${cpu.toFixed(1)}%`;
  if (cpuBar) {
    cpuBar.style.width = `${Math.min(cpu, 100)}%`;
    cpuBar.className = `metric-fill ${metricFillClass(cpu)}`;
  }

  if (ramValue) ramValue.textContent = `${ram.toFixed(1)}%`;
  if (ramBar) {
    ramBar.style.width = `${Math.min(ram, 100)}%`;
    ramBar.className = `metric-fill ${metricFillClass(ram)}`;
  }

  if (netValue) netValue.textContent = `${net.toFixed(1)} Mbps`;
  if (netBar) netBar.style.width = `${Math.min(Math.max(net, 0), 100)}%`;
}

async function refreshOverview() {
  if (activePage !== "dashboard") return;
  try {
    const [logs, status] = await Promise.all([
      window.rei.readDetectionLog(),
      getSystemStatus(),
    ]);

    const safeLogs = Array.isArray(logs) ? logs : [];
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const blockedToday = safeLogs.filter((entry) => {
      const ts = String(entry?.timestamp || "");
      const level = String(entry?.risk_level || "").toUpperCase();
      return ts.startsWith(todayPrefix) && (level === "MEDIUM" || level === "HIGH");
    }).length;
    const blockedElement = document.getElementById("metric-threats-value");
    if (blockedElement) blockedElement.textContent = String(blockedToday);

    await refreshMetricsOnly();

    renderStatusCard(
      "status-card-scanner",
      "Scanner API",
      "scanner",
      statusModel({ online: !!status.scannerUp }),
      status.scannerUp ? "Model endpoint reachable" : "No response from scanner endpoint",
    );
    renderStatusCard(
      "status-card-monitor",
      "File Monitor",
      "monitor",
      statusModel({ online: !!status.monitorUp }),
      status.monitorUp ? "File monitor is running" : "No active file monitor process",
    );
    const extHealth = extensionHealthFromStatus(status);
    renderStatusCard(
      "status-card-extension",
      "Extension Activity",
      "extension",
      { label: extHealth.label, cls: extHealth.cls },
      extHealth.subtitle,
    );

    const minuteData = detectionsPerMinute(safeLogs, 10);
    ensureTimelineChart(minuteData.labels, minuteData.values);

    const high = safeLogs.filter((entry) => String(entry?.risk_level).toUpperCase() === "HIGH").length;
    const medium = safeLogs.filter((entry) => String(entry?.risk_level).toUpperCase() === "MEDIUM").length;
    const low = safeLogs.filter((entry) => String(entry?.risk_level).toUpperCase() === "LOW").length;
    ensureRiskChart([low, medium, high]);

    const alertsStream = document.getElementById("alerts-stream");
    if (alertsStream) {
      const recentAlerts = [...safeLogs].reverse().slice(0, 10);
      const streamRows = recentAlerts.map((entry) => {
        const level = String(entry?.risk_level || "LOW").toUpperCase();
        const reasonList = Array.isArray(entry?.explanations) ? entry.explanations : [];
        const reason = reasonList[0] || "No explanation provided";
        return `
          <div class="alert-row ${levelClass(level)}">
            <div class="alert-time">${escHtml(formatTimestamp(entry?.timestamp))}</div>
            <div class="alert-platform">${escHtml(entry?.platform || "unknown")}</div>
            <div class="alert-risk">${badgeHtml(level)}</div>
            <div class="alert-reason">${escHtml(reason)}</div>
          </div>
        `;
      }).join("");
      alertsStream.innerHTML = streamRows
        ? `
          <div class="alert-header">
            <span>Timestamp</span>
            <span>Platform</span>
            <span>Risk</span>
            <span>Reason</span>
          </div>
          ${streamRows}
        `
        : `<div class="empty-state">No detections yet.</div>`;
    }
  } catch (error) {
    console.error("Overview refresh error:", error);
  }
}

// ── Live Protection ─────────────────────────────────────────────
function initProtection() {
  const page = document.getElementById("page-protection");
  page.innerHTML = `
    <div class="page-header">
      <h1>Live Protection</h1>
      <p>Current scanner, monitor, and extension runtime posture.</p>
    </div>
    <div class="soc-grid">
      <div class="soc-card status-card" id="protection-scanner"></div>
      <div class="soc-card status-card" id="protection-monitor"></div>
      <div class="soc-card status-card" id="protection-extension"></div>
    </div>
  `;
  refreshProtection();
  intervals.protection = setInterval(refreshProtection, 3000);
}

async function refreshProtection() {
  if (activePage !== "protection") return;
  try {
    const status = await getSystemStatus();
    renderStatusCard(
      "protection-scanner",
      "Scanner Engine",
      "scanner",
      statusModel({ online: !!status.scannerUp }),
      status.scannerUp ? "Running" : "Offline",
    );
    renderStatusCard(
      "protection-monitor",
      "File Monitor",
      "monitor",
      statusModel({ online: !!status.monitorUp }),
      status.monitorUp ? "Running" : "Offline",
    );
    const ext = extensionHealthFromStatus(status);
    renderStatusCard(
      "protection-extension",
      "Extension Connectivity",
      "extension",
      { label: ext.label, cls: ext.cls },
      ext.subtitle,
    );
  } catch (error) {
    console.error("Protection refresh error:", error);
  }
}

// ── Threat Timeline ─────────────────────────────────────────────
let historyLogs = [];
function initHistory() {
  const page = document.getElementById("page-history");
  page.innerHTML = `
    <div class="page-header">
      <h1>Threat Timeline</h1>
      <p>Chronological detection records across all channels.</p>
    </div>
    <div class="soc-card">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr><th>Timestamp</th><th>Platform</th><th>Sender</th><th>Score</th><th>Level</th></tr>
          </thead>
          <tbody id="history-body"></tbody>
        </table>
      </div>
    </div>
  `;
  loadHistory();
}

async function loadHistory() {
  historyLogs = await window.rei.readDetectionLog();
  const body = document.getElementById("history-body");
  if (!body) return;
  const safeLogs = Array.isArray(historyLogs) ? [...historyLogs].reverse() : [];
  body.innerHTML = safeLogs.slice(0, 200).map((entry) => `
    <tr class="${levelClass(entry?.risk_level)}">
      <td>${escHtml(String(entry?.timestamp || "").replace("T", " ").slice(0, 19))}</td>
      <td>${escHtml(entry?.platform || "")}</td>
      <td>${escHtml(entry?.sender || "")}</td>
      <td>${Number(entry?.risk_score || 0).toFixed(4)}</td>
      <td>${badgeHtml(entry?.risk_level || "LOW")}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="empty-row">No threat history available.</td></tr>`;
}

// ── Reputation Intelligence ─────────────────────────────────────
function initReputation() {
  const page = document.getElementById("page-reputation");
  page.innerHTML = `
    <div class="page-header">
      <h1>Reputation Intelligence</h1>
      <p>Persistent sender risk memory and escalations.</p>
    </div>
    <div class="soc-card">
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Sender ID</th><th>Detections</th><th>Risk Boost</th></tr></thead>
          <tbody id="reputation-body"></tbody>
        </table>
      </div>
    </div>
  `;
  refreshReputation();
  intervals.reputation = setInterval(refreshReputation, 10000);
}

async function refreshReputation() {
  if (activePage !== "reputation") return;
  try {
    const db = await window.rei.readReputationDb();
    const rows = Object.entries(db || {})
      .map(([id, value]) => ({ id, count: Number(value?.count || 0), riskBoost: Number(value?.risk_boost || 0) }))
      .sort((a, b) => b.count - a.count);
    const body = document.getElementById("reputation-body");
    if (!body) return;
    body.innerHTML = rows.map((row) => `
      <tr>
        <td>${escHtml(row.id)}</td>
        <td>${row.count}</td>
        <td>${row.riskBoost.toFixed(2)}</td>
      </tr>
    `).join("") || `<tr><td colspan="3" class="empty-row">No reputation intelligence entries available.</td></tr>`;
  } catch (error) {
    console.error("Reputation refresh error:", error);
  }
}

// ── Scan Center ─────────────────────────────────────────────────
function initScanCenter() {
  const page = document.getElementById("page-scan");
  page.innerHTML = `
    <div class="page-header">
      <h1>Scan Center</h1>
      <p>Manual analysis for message text, URLs, and files.</p>
    </div>
    <div class="soc-grid">
      <div class="soc-card">
        <div class="card-title">Text Scan</div>
        <textarea id="scan-text" class="form-textarea" placeholder="Paste suspicious message"></textarea>
        <button class="btn btn-primary mt-12" id="btn-scan-text">Analyze Text</button>
      </div>
      <div class="soc-card">
        <div class="card-title">URL Scan</div>
        <input id="scan-url" class="form-input" placeholder="https://example.com" />
        <button class="btn btn-primary mt-12" id="btn-scan-url">Analyze URL</button>
      </div>
    </div>
    <div class="soc-card mt-16">
      <div class="card-title">File Scan</div>
      <button class="btn btn-outline" id="btn-scan-file">Choose File</button>
      <div id="scan-file-name" class="muted mt-8"></div>
    </div>
    <div class="soc-card mt-16" id="scan-result-box"></div>
  `;

  document.getElementById("btn-scan-text").addEventListener("click", scanText);
  document.getElementById("btn-scan-url").addEventListener("click", scanUrl);
  document.getElementById("btn-scan-file").addEventListener("click", scanFile);
}

function showScanResult(result) {
  const box = document.getElementById("scan-result-box");
  if (!box) return;
  if (!result || result.detail) {
    box.innerHTML = `<div class="error-text">Error: ${escHtml(result?.detail || "Unknown error")}</div>`;
    return;
  }
  box.innerHTML = `
    <div class="scan-result-head">
      ${badgeHtml(result.risk_level || "LOW")}
      <span class="scan-score">${Number(result.risk_score || 0).toFixed(4)}</span>
    </div>
    <ul class="scan-reasons">
      ${(result.explanations || []).map((x) => `<li>${escHtml(x)}</li>`).join("")}
    </ul>
  `;
}

async function scanText() {
  const text = document.getElementById("scan-text").value.trim();
  if (!text) return;
  try {
    const response = await fetch(`${API_BASE}/analyze-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    showScanResult(await response.json());
  } catch (error) {
    showScanResult({ detail: error.message });
  }
}

async function scanUrl() {
  const url = document.getElementById("scan-url").value.trim();
  if (!url) return;
  try {
    const response = await fetch(`${API_BASE}/analyze-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    showScanResult(await response.json());
  } catch (error) {
    showScanResult({ detail: error.message });
  }
}

async function scanFile() {
  const filePath = await window.rei.openFileDialog();
  if (!filePath) return;
  const fileNameElement = document.getElementById("scan-file-name");
  if (fileNameElement) fileNameElement.textContent = filePath;

  try {
    const response = await fetch(filePath);
    const blob = await response.blob();
    const fileName = filePath.split(/[\\/]/).pop();
    const formData = new FormData();
    formData.append("file", blob, fileName);
    const analyzeResponse = await fetch(`${API_BASE}/analyze-file`, { method: "POST", body: formData });
    showScanResult(await analyzeResponse.json());
  } catch (error) {
    showScanResult({ detail: error.message });
  }
}

// ── Reports ─────────────────────────────────────────────────────
function initReports() {
  const page = document.getElementById("page-reports");
  page.innerHTML = `
    <div class="page-header">
      <h1>Reports</h1>
      <p>Operational service readiness and data store integrity.</p>
    </div>
    <div class="soc-grid">
      <div class="soc-card status-card" id="reports-scanner"></div>
      <div class="soc-card status-card" id="reports-monitor"></div>
      <div class="soc-card status-card" id="reports-extension"></div>
      <div class="soc-card status-card" id="reports-stores"></div>
    </div>
  `;
  refreshReports();
  intervals.reports = setInterval(refreshReports, 5000);
}

async function refreshReports() {
  if (activePage !== "reports") return;
  try {
    const status = await getSystemStatus();
    renderStatusCard("reports-scanner", "Scanner API", "scanner", statusModel({ online: !!status.scannerUp }), "Port 8000 health");
    renderStatusCard("reports-monitor", "File Monitor", "monitor", statusModel({ online: !!status.monitorUp }), "Process/watchdog status");
    const ext = extensionHealthFromStatus(status);
    renderStatusCard("reports-extension", "Extension", "extension", { label: ext.label, cls: ext.cls }, ext.subtitle);
    renderStatusCard(
      "reports-stores",
      "JSON Data Stores",
      "stores",
      statusModel({ online: !!status.detLogExists && !!status.repDbExists, degraded: !!status.detLogExists || !!status.repDbExists }),
      `${status.detLogExists ? "detection_log.json" : "missing detection_log"} | ${status.repDbExists ? "reputation_db.json" : "missing reputation_db"}`,
    );
  } catch (error) {
    console.error("Reports refresh error:", error);
  }
}

// ── Settings ────────────────────────────────────────────────────
function initSettings() {
  const page = document.getElementById("page-settings");
  page.innerHTML = `
    <div class="page-header">
      <h1>Settings</h1>
      <p>Runtime controls for scanner integrations.</p>
    </div>
    <div class="soc-card">
      <div class="form-group">
        <label for="set-vt-key">VirusTotal API Key</label>
        <input id="set-vt-key" class="form-input" type="password" />
      </div>
      <div class="toggle-grid">
        <label class="toggle-item"><span>URL Scanning</span><input type="checkbox" id="tog-url" /></label>
        <label class="toggle-item"><span>File Scanning</span><input type="checkbox" id="tog-file" /></label>
        <label class="toggle-item"><span>Reputation Tracking</span><input type="checkbox" id="tog-rep" /></label>
      </div>
      <button class="btn btn-primary mt-12" id="btn-save-settings">Save Settings</button>
      <div id="settings-msg" class="muted mt-8"></div>
    </div>
  `;
  loadSettings();
  document.getElementById("btn-save-settings").addEventListener("click", saveSettings);
}

async function loadSettings() {
  try {
    const settings = await window.rei.getSettings();
    document.getElementById("set-vt-key").value = settings.virustotalApiKey || "";
    document.getElementById("tog-url").checked = settings.enableUrlScanning !== false;
    document.getElementById("tog-file").checked = settings.enableFileScanning !== false;
    document.getElementById("tog-rep").checked = settings.enableReputationTracking !== false;
  } catch (error) {
    console.error("Load settings error:", error);
  }
}

async function saveSettings() {
  const payload = {
    virustotalApiKey: document.getElementById("set-vt-key").value,
    enableUrlScanning: document.getElementById("tog-url").checked,
    enableFileScanning: document.getElementById("tog-file").checked,
    enableReputationTracking: document.getElementById("tog-rep").checked,
  };
  try {
    await window.rei.saveSettings(payload);
    document.getElementById("settings-msg").textContent = "Settings saved";
  } catch (_error) {
    document.getElementById("settings-msg").textContent = "Failed to save settings";
  }
}

// ── Boot ────────────────────────────────────────────────────────
if (typeof document !== "undefined" && document.getElementById) {
  if (window.rei && typeof window.rei.onStatusUpdate === "function") {
    window.rei.onStatusUpdate((payload) => {
      latestSystemStatus = payload;
      if (activePage === "dashboard") refreshOverview();
      if (activePage === "protection") refreshProtection();
      if (activePage === "reports") refreshReports();
      updateHeaderStatus();
    });
  }
  startHeaderServices();
  initPage("dashboard");
}

// ── Testable factories ──────────────────────────────────────────
function createRouter(routePages) {
  let currentPage = null;
  let currentLifecycle = null;

  return {
    async navigate(name) {
      if (currentPage && routePages[currentPage]) {
        if (typeof routePages[currentPage].unmount === "function") {
          routePages[currentPage].unmount();
        }
        if (currentLifecycle) {
          currentLifecycle._runCleanups();
          currentLifecycle = null;
        }
      }

      currentPage = name;
      if (routePages[name]) {
        const lifecycle = createLifecycle();
        currentLifecycle = lifecycle;
        if (typeof routePages[name].mount === "function") {
          await routePages[name].mount({ lifecycle });
        }
      }
    },
  };
}

function createLifecycle() {
  const cleanups = [];
  return {
    addCleanup(fn) { cleanups.push(fn); },
    _runCleanups() { cleanups.forEach((fn) => fn()); cleanups.length = 0; },
  };
}

function createStateBus() {
  let state = {};
  const subscribers = new Set();

  function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
        result[key] = deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  return {
    update(partial) {
      state = deepMerge(state, partial);
      state.meta = { ...(state.meta || {}), updatedAt: Date.now() };
      subscribers.forEach((fn) => fn(state));
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    getState() { return state; },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createRouter, createStateBus };
}
