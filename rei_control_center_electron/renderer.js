// ═════════════════════════════════════════════════════════════════
//  R.E.I. Control Center — Renderer
// ═════════════════════════════════════════════════════════════════

const API_BASE = "http://127.0.0.1:8000";

const navItems = typeof document !== "undefined" ? document.querySelectorAll(".nav-item") : [];
const pages = typeof document !== "undefined" ? document.querySelectorAll(".page") : [];
let activePage = "dashboard";
const intervals = {};
let latestSystemStatus = null;
let latestDetectionLog = [];
let latestReputationDb = {};
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

function normalizeSystemStatus(statusPayload = {}) {
  const scannerOnline = Boolean(statusPayload.scannerOnline ?? statusPayload.scannerUp);
  const monitorRunning = Boolean(statusPayload.monitorRunning ?? statusPayload.monitorUp);
  const extensionActive = Boolean(statusPayload.extensionActive ?? statusPayload.extensionConnected);
  return {
    scannerOnline,
    monitorRunning,
    extensionActive,
    scannerUp: scannerOnline,
    monitorUp: monitorRunning,
    extensionConnected: extensionActive,
    lastExtensionEventAt: statusPayload.lastExtensionEventAt || null,
    detLogExists: Boolean(statusPayload.detLogExists),
    repDbExists: Boolean(statusPayload.repDbExists),
  };
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
  if (statusPayload?.extensionActive && !last) {
    return { label: "Active", cls: "running", subtitle: "Recent activity detected" };
  }
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
  const reader = window.rei.getSystemStatus || window.rei.systemStatus;
  const status = await reader();
  latestSystemStatus = normalizeSystemStatus(status);
  return latestSystemStatus;
}

async function getDetectionLog() {
  const logs = await window.rei.readDetectionLog();
  latestDetectionLog = Array.isArray(logs) ? logs : [];
  return latestDetectionLog;
}

async function getReputationDb() {
  const db = await window.rei.readReputationDb();
  latestReputationDb = db && typeof db === "object" ? db : {};
  return latestReputationDb;
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
  const _t = window.reiI18n ? window.reiI18n.t : (k) => k;
  try {
    const status = await getSystemStatus();
    const scanner = document.getElementById("scanner-indicator");
    if (!scanner) return;
    if (status.scannerOnline) {
      scanner.className = "status-pill running";
      scanner.textContent = _t("scanner_online");
    } else {
      scanner.className = "status-pill offline";
      scanner.textContent = _t("scanner_offline");
    }
  } catch (_error) {
    const scanner = document.getElementById("scanner-indicator");
    if (!scanner) return;
    scanner.className = "status-pill offline";
    scanner.textContent = _t("scanner_offline");
  }
}

function startHeaderServices() {
  updateClock();
  updateHeaderStatus();
  intervals.clock = setInterval(updateClock, 1000);
  intervals.headerStatus = setInterval(updateHeaderStatus, 3000);
}

function sortDetectionsDescending(entries) {
  const safeEntries = Array.isArray(entries) ? [...entries] : [];
  return safeEntries.sort((left, right) => {
    const leftTs = toDate(left?.timestamp)?.getTime();
    const rightTs = toDate(right?.timestamp)?.getTime();
    if (Number.isFinite(leftTs) && Number.isFinite(rightTs)) {
      return rightTs - leftTs;
    }
    if (Number.isFinite(rightTs)) return 1;
    if (Number.isFinite(leftTs)) return -1;
    return 0;
  });
}

function getLatestDetections(entries, limit = 50) {
  return sortDetectionsDescending(entries).slice(0, limit);
}

function buildRiskDistribution(entries) {
  const distribution = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const level = String(entry?.risk_level || "LOW").toUpperCase();
    if (level in distribution) distribution[level] += 1;
  });
  return distribution;
}

function buildPlatformDistribution(entries) {
  const distribution = {};
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const platform = String(entry?.platform || "unknown").trim() || "unknown";
    distribution[platform] = (distribution[platform] || 0) + 1;
  });
  return distribution;
}

function buildDashboardMetrics(entries, now = new Date()) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const todayPrefix = now.toISOString().slice(0, 10);
  const todaysEntries = safeEntries.filter((entry) => String(entry?.timestamp || "").startsWith(todayPrefix));
  const senderCounts = {};

  todaysEntries.forEach((entry) => {
    const sender = String(entry?.sender || "unknown_sender").trim() || "unknown_sender";
    senderCounts[sender] = (senderCounts[sender] || 0) + 1;
  });

  const topSender = Object.entries(senderCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || "—";

  return {
    detectionsToday: todaysEntries.length,
    mediumRiskCount: todaysEntries.filter((entry) => String(entry?.risk_level).toUpperCase() === "MEDIUM").length,
    highRiskCount: todaysEntries.filter((entry) => String(entry?.risk_level).toUpperCase() === "HIGH").length,
    topSender,
    platformDistribution: buildPlatformDistribution(todaysEntries),
    riskDistribution: buildRiskDistribution(todaysEntries),
  };
}

function reputationLevelFromBoost(riskBoost) {
  const numericBoost = Number(riskBoost || 0);
  if (numericBoost >= 0.25) return "HIGH";
  if (numericBoost >= 0.10) return "MEDIUM";
  return "LOW";
}

function buildReputationSummary(db) {
  const rows = Object.entries(db || {})
    .map(([id, value]) => {
      const count = Number(value?.count || 0);
      const riskBoost = Number(value?.risk_boost || 0);
      return {
        id,
        count,
        riskBoost,
        riskLevel: reputationLevelFromBoost(riskBoost),
      };
    })
    .sort((left, right) => right.count - left.count || right.riskBoost - left.riskBoost || left.id.localeCompare(right.id));

  const senderRiskCounts = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  rows.forEach((row) => {
    senderRiskCounts[row.riskLevel] += 1;
  });

  return {
    rows,
    senderRiskCounts,
    topSuspiciousSenders: rows.slice(0, 10),
  };
}

function primaryExplanation(entry) {
  const explanations = Array.isArray(entry?.explanations) ? entry.explanations.filter(Boolean) : [];
  return explanations.length ? explanations.join(" | ") : "No explanation provided";
}

function renderRecentDetectionsTable(containerId, entries, { emptyMessage = "No detections yet.", limit = 8 } = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const recentDetections = getLatestDetections(entries, limit);

  if (!recentDetections.length) {
    container.innerHTML = `<div class="empty-state">${escHtml(emptyMessage)}</div>`;
    return;
  }

  const rows = recentDetections.map((entry) => {
    const level = String(entry?.risk_level || "LOW").toUpperCase();
    return `
      <div class="alert-row ${levelClass(level)}">
        <div class="alert-time">${escHtml(formatTimestamp(entry?.timestamp))}</div>
        <div class="alert-platform">${escHtml(entry?.platform || "unknown")}</div>
        <div class="alert-risk">${badgeHtml(level)}</div>
        <div class="alert-reason">${escHtml(primaryExplanation(entry))}</div>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="alert-header">
      <span>Timestamp</span>
      <span>Platform</span>
      <span>Risk</span>
      <span>Reason</span>
    </div>
    ${rows}
  `;
}

function renderPlatformDistribution(containerId, distribution) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const rows = Object.entries(distribution || {}).sort((left, right) => right[1] - left[1]);
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">No platform activity yet.</div>`;
    return;
  }

  container.innerHTML = rows.map(([platform, count]) => `
    <div class="alert-row">
      <div class="alert-platform">${escHtml(platform)}</div>
      <div class="alert-reason">${count} detections</div>
    </div>
  `).join("");
}

function renderOverview(logs, status) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const normalizedStatus = normalizeSystemStatus(status);
  const metrics = buildDashboardMetrics(safeLogs);
  const riskDistribution = buildRiskDistribution(safeLogs);

  const totalDetections = document.getElementById("metric-total-detections");
  const mediumDetections = document.getElementById("metric-medium-detections");
  const highDetections = document.getElementById("metric-high-detections");
  const topSender = document.getElementById("metric-top-sender");

  if (totalDetections) totalDetections.textContent = String(metrics.detectionsToday);
  if (mediumDetections) mediumDetections.textContent = String(metrics.mediumRiskCount);
  if (highDetections) highDetections.textContent = String(metrics.highRiskCount);
  if (topSender) topSender.textContent = metrics.topSender;

  renderStatusCard(
    "status-card-scanner",
    "Scanner API",
    "scanner",
    statusModel({ online: normalizedStatus.scannerOnline }),
    normalizedStatus.scannerOnline ? "FastAPI documentation endpoint is reachable" : "No response from /docs",
  );
  renderStatusCard(
    "status-card-monitor",
    "File Monitor",
    "monitor",
    statusModel({ online: normalizedStatus.monitorRunning }),
    normalizedStatus.monitorRunning ? "File monitor activity detected" : "Monitor is inactive",
  );
  const extensionHealth = extensionHealthFromStatus(normalizedStatus);
  renderStatusCard(
    "status-card-extension",
    "Extension Activity",
    "extension",
    { label: extensionHealth.label, cls: extensionHealth.cls },
    extensionHealth.subtitle,
  );

  const minuteData = detectionsPerMinute(safeLogs, 10);
  ensureTimelineChart(minuteData.labels, minuteData.values);
  ensureRiskChart([riskDistribution.LOW, riskDistribution.MEDIUM, riskDistribution.HIGH]);
  renderPlatformDistribution("overview-platform-distribution", metrics.platformDistribution);
  renderRecentDetectionsTable("alerts-stream", safeLogs, { limit: 10 });
}

function renderThreatTimeline(logs) {
  const body = document.getElementById("history-body");
  if (!body) return;
  const recentDetections = getLatestDetections(logs, 50);
  body.innerHTML = recentDetections.map((entry) => `
    <tr class="${levelClass(entry?.risk_level)}">
      <td>${escHtml(formatTimestamp(entry?.timestamp))}</td>
      <td>${escHtml(entry?.platform || "unknown")}</td>
      <td>${badgeHtml(entry?.risk_level || "LOW")}</td>
      <td>${escHtml(entry?.sender || "unknown_sender")}</td>
      <td>${escHtml(primaryExplanation(entry))}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="empty-row">No threat history available.</td></tr>`;
}

function renderProtection(logs, status) {
  const normalizedStatus = normalizeSystemStatus(status);
  renderStatusCard(
    "protection-scanner",
    "Scanner Engine",
    "scanner",
    statusModel({ online: normalizedStatus.scannerOnline }),
    normalizedStatus.scannerOnline ? "Online" : "Offline",
  );
  renderStatusCard(
    "protection-monitor",
    "File Monitor",
    "monitor",
    statusModel({ online: normalizedStatus.monitorRunning }),
    normalizedStatus.monitorRunning ? "Online" : "Offline",
  );
  const extensionHealth = extensionHealthFromStatus(normalizedStatus);
  renderStatusCard(
    "protection-extension",
    "Extension Connectivity",
    "extension",
    { label: extensionHealth.label, cls: extensionHealth.cls },
    extensionHealth.subtitle,
  );
  renderRecentDetectionsTable("protection-recent-detections", logs, {
    emptyMessage: "No recent detections available.",
    limit: 8,
  });
}

function renderReputation(db) {
  const summary = buildReputationSummary(db);
  const high = document.getElementById("reputation-high-count");
  const medium = document.getElementById("reputation-medium-count");
  const low = document.getElementById("reputation-low-count");
  const body = document.getElementById("reputation-body");
  const list = document.getElementById("reputation-top-senders");

  if (high) high.textContent = String(summary.senderRiskCounts.HIGH);
  if (medium) medium.textContent = String(summary.senderRiskCounts.MEDIUM);
  if (low) low.textContent = String(summary.senderRiskCounts.LOW);

  if (body) {
    body.innerHTML = summary.rows.map((row) => `
      <tr>
        <td>${escHtml(row.id)}</td>
        <td>${row.count}</td>
        <td>${row.riskBoost.toFixed(2)}</td>
        <td>${badgeHtml(row.riskLevel)}</td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="empty-row">No reputation intelligence entries available.</td></tr>`;
  }

  if (list) {
    list.innerHTML = summary.topSuspiciousSenders.map((row) => `
      <div class="alert-row ${levelClass(row.riskLevel)}">
        <div class="alert-platform">${escHtml(row.id)}</div>
        <div class="alert-risk">${badgeHtml(row.riskLevel)}</div>
        <div class="alert-reason">${row.count} detections | boost ${row.riskBoost.toFixed(2)}</div>
      </div>
    `).join("") || `<div class="empty-state">No suspicious senders recorded.</div>`;
  }
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
  const _t = window.reiI18n ? window.reiI18n.t : (k) => k;
  page.innerHTML = `
    <div class="page-header">
      <h1 data-i18n="overview">${_t("overview")}</h1>
      <p>Security operations center view for platform health and active threats.</p>
    </div>

    <div class="soc-grid dashboard-row dashboard-row-metrics">
      <div class="soc-card metric-card">
        <div class="metric-label">Total Detections Today</div>
        <div class="metric-value" id="metric-total-detections">0</div>
        <div class="metric-sub">Live count from detection log</div>
      </div>
      <div class="soc-card metric-card">
        <div class="metric-label">Medium Risk Today</div>
        <div class="metric-value" id="metric-medium-detections">0</div>
        <div class="metric-sub">Entries marked MEDIUM</div>
      </div>
      <div class="soc-card metric-card">
        <div class="metric-label">High Risk Today</div>
        <div class="metric-value" id="metric-high-detections">0</div>
        <div class="metric-sub">Entries marked HIGH</div>
      </div>
      <div class="soc-card metric-card">
        <div class="metric-label">Top Sender</div>
        <div class="metric-value" id="metric-top-sender">—</div>
        <div class="metric-sub">Most frequent sender today</div>
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

    <div class="soc-grid dashboard-row dashboard-row-alerts">
      <div class="soc-card alerts-card">
        <div class="card-title">Platform Distribution</div>
        <div id="overview-platform-distribution" class="alerts-stream"></div>
      </div>
      <div class="soc-card alerts-card">
        <div class="card-title">Live Alerts Stream</div>
        <div id="alerts-stream" class="alerts-stream"></div>
      </div>
    </div>
  `;

  refreshOverview();
  intervals.overviewData = setInterval(refreshOverview, 5000);
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
      getDetectionLog(),
      getSystemStatus(),
    ]);
    renderOverview(logs, status);
  } catch (error) {
    console.error("Overview refresh error:", error);
  }
}

// Optimized refresh using pre-pushed data (avoids extra IPC calls)
function refreshOverviewWithData(logs, status) {
  if (activePage !== "dashboard") return;
  try {
    latestDetectionLog = Array.isArray(logs) ? logs : [];
    renderOverview(latestDetectionLog, status);
  } catch (error) {
    console.error("Overview refresh (pushed data) error:", error);
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
    <div class="soc-card alerts-card mt-16">
      <div class="card-title">Recent Detections</div>
      <div id="protection-recent-detections" class="alerts-stream"></div>
    </div>
  `;
  refreshProtection();
  intervals.protection = setInterval(refreshProtection, 3000);
}

async function refreshProtection() {
  if (activePage !== "protection") return;
  try {
    const [status, logs] = await Promise.all([getSystemStatus(), getDetectionLog()]);
    renderProtection(logs, status);
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
            <tr><th>Timestamp</th><th>Platform</th><th>Risk</th><th>Sender</th><th>Explanation</th></tr>
          </thead>
          <tbody id="history-body"></tbody>
        </table>
      </div>
    </div>
  `;
  loadHistory();
  intervals.history = setInterval(loadHistory, 5000);
}

async function loadHistory() {
  historyLogs = await getDetectionLog();
  renderThreatTimeline(historyLogs);
}

// Optimized history refresh using pre-pushed data
function refreshHistoryWithData(logs) {
  if (activePage !== "history") return;
  historyLogs = Array.isArray(logs) ? logs : [];
  renderThreatTimeline(historyLogs);
}

// ── Reputation Intelligence ─────────────────────────────────────
function initReputation() {
  const page = document.getElementById("page-reputation");
  page.innerHTML = `
    <div class="page-header">
      <h1>Reputation Intelligence</h1>
      <p>Persistent sender risk memory and escalations.</p>
    </div>
    <div class="soc-grid dashboard-row dashboard-row-metrics">
      <div class="soc-card metric-card">
        <div class="metric-label">High Risk Senders</div>
        <div class="metric-value" id="reputation-high-count">0</div>
        <div class="metric-sub">Risk boost 0.25 and above</div>
      </div>
      <div class="soc-card metric-card">
        <div class="metric-label">Medium Risk Senders</div>
        <div class="metric-value" id="reputation-medium-count">0</div>
        <div class="metric-sub">Risk boost between 0.10 and 0.24</div>
      </div>
      <div class="soc-card metric-card">
        <div class="metric-label">Low Risk Senders</div>
        <div class="metric-value" id="reputation-low-count">0</div>
        <div class="metric-sub">Risk boost below 0.10</div>
      </div>
    </div>
    <div class="soc-card alerts-card mt-16">
      <div class="card-title">Top Suspicious Senders</div>
      <div id="reputation-top-senders" class="alerts-stream"></div>
    </div>
    <div class="soc-card">
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Sender ID</th><th>Detections</th><th>Risk Boost</th><th>Risk</th></tr></thead>
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
    const db = await getReputationDb();
    renderReputation(db);
  } catch (error) {
    console.error("Reputation refresh error:", error);
  }
}

// Optimized refresh using pre-pushed reputation data
function refreshReputationWithData(db) {
  if (activePage !== "reputation") return;
  try {
    latestReputationDb = db && typeof db === "object" ? db : {};
    renderReputation(latestReputationDb);
  } catch (error) {
    console.error("Reputation refresh (pushed data) error:", error);
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
    const result = await window.rei.analyzeFile(filePath);
    showScanResult(result);
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
    renderStatusCard("reports-scanner", "Scanner API", "scanner", statusModel({ online: !!status.scannerOnline }), "Port 8000 health");
    renderStatusCard("reports-monitor", "File Monitor", "monitor", statusModel({ online: !!status.monitorRunning }), "Process/watchdog status");
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
  const _t = window.reiI18n ? window.reiI18n.t : (k) => k;
  const page = document.getElementById("page-settings");
  page.innerHTML = `
    <div class="page-header">
      <h1 data-i18n="settings">${_t("settings")}</h1>
      <p data-i18n="configure_preferences">${_t("configure_preferences")}</p>
    </div>
    <div class="soc-card">
      <div class="form-group">
        <label for="set-vt-key" data-i18n="vt_api_key">${_t("vt_api_key")}</label>
        <input id="set-vt-key" class="form-input" type="password" />
      </div>
      <div class="toggle-grid">
        <label class="toggle-item"><span data-i18n="url_scanning">${_t("url_scanning")}</span><input type="checkbox" id="tog-url" /></label>
        <label class="toggle-item"><span data-i18n="file_scanning">${_t("file_scanning")}</span><input type="checkbox" id="tog-file" /></label>
        <label class="toggle-item"><span data-i18n="reputation_tracking">${_t("reputation_tracking")}</span><input type="checkbox" id="tog-rep" /></label>
      </div>
      <button class="btn btn-primary mt-12" id="btn-save-settings" data-i18n="save_settings">${_t("save_settings")}</button>
      <div id="settings-msg" class="muted mt-8"></div>
    </div>
    <div class="soc-card mt-16">
      <div class="card-title" data-i18n="language">${_t("language")}</div>
      <p class="text-sm text-muted mb-8" data-i18n="language_desc">${_t("language_desc")}</p>
      <select id="panelLanguageSelector" class="form-input" style="max-width:260px">
        <option value="en">English</option>
        <option value="hi">हिन्दी (Hindi)</option>
        <option value="kn">ಕನ್ನಡ (Kannada)</option>
        <option value="te">తెలుగు (Telugu)</option>
        <option value="ml">മലയാളം (Malayalam)</option>
        <option value="ta">தமிழ் (Tamil)</option>
      </select>
    </div>
  `;
  loadSettings();
  document.getElementById("btn-save-settings").addEventListener("click", saveSettings);

  // Language switcher
  const langSel = document.getElementById("panelLanguageSelector");
  if (langSel && window.reiI18n) {
    langSel.value = window.reiI18n.getActiveLanguage();
    langSel.addEventListener("change", async (e) => {
      const lang = e.target.value;
      await window.reiI18n.loadLanguage(lang);
      await window.reiI18n.saveLanguagePreference(lang);
      // Re-init current page to reflect new language
      initSettings();
    });
  }
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

// ── Demo Scam Data Injection ────────────────────────────────
const DEMO_SCAM_ENTRIES = [
  {
    sender: "+919876543210",
    email: "alerts@sbi-secure-support.in",
    platform: "whatsapp",
    risk_level: "HIGH",
    risk_score: 0.9412,
    explanations: [
      "Impersonates SBI bank — fake domain sbi-secure-support.in",
      "Urgency language: 'Your account will be blocked'",
      "Phishing link to steal banking credentials",
    ],
    label: "SBI Phishing Scam",
  },
  {
    sender: "+919812345678",
    email: "kyc@upi-verification-help.in",
    platform: "whatsapp",
    risk_level: "HIGH",
    risk_score: 0.8837,
    explanations: [
      "Fake KYC verification — domain upi-verification-help.in is not official",
      "Requests sensitive personal documents (Aadhaar, PAN)",
      "Threatens UPI account suspension to create panic",
    ],
    label: "KYC Verification Scam",
  },
  {
    sender: "+918888123456",
    email: "post@indiapost-delivery-help.in",
    platform: "email",
    risk_level: "MEDIUM",
    risk_score: 0.7201,
    explanations: [
      "Impersonates India Post — fraudulent domain indiapost-delivery-help.in",
      "Demands small payment to release a fake parcel",
      "Payment link leads to credential-harvesting page",
    ],
    label: "India Post Payment Scam",
  },
  {
    sender: "+917777654321",
    email: "jobs@daily-earning-alerts.in",
    platform: "whatsapp",
    risk_level: "HIGH",
    risk_score: 0.9105,
    explanations: [
      "Fake part-time job offer — promises unrealistic daily earnings",
      "Domain daily-earning-alerts.in is newly registered",
      "Requires upfront registration fee — classic advance-fee fraud",
    ],
    label: "Fake Part-Time Job Scam",
  },
];

let demoInjected = false;

function showDemoToast(entry) {
  const existing = document.querySelector(".demo-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "demo-toast";
  toast.innerHTML = `
    <div class="demo-toast-icon">⚠️</div>
    <div class="demo-toast-text">
      <div class="demo-toast-title">Threat Detected: ${escHtml(entry.label)}</div>
      <div class="demo-toast-sub">${escHtml(entry.sender)} · ${escHtml(entry.email)}</div>
    </div>
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 500);
  }, 2500);
}

function bumpMetricCounters() {
  const ids = ["metric-total-detections", "metric-medium-detections", "metric-high-detections"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("demo-bump");
    void el.offsetWidth; // force reflow
    el.classList.add("demo-bump");
    setTimeout(() => el.classList.remove("demo-bump"), 600);
  });
}

function injectDemoReputationEntry(entry) {
  const senderId = entry.sender;
  const emailId = entry.email;
  const boost = entry.risk_score >= 0.8 ? 0.35 : 0.18;

  if (!latestReputationDb[senderId]) {
    latestReputationDb[senderId] = { count: 0, risk_boost: 0 };
  }
  latestReputationDb[senderId].count += 1;
  latestReputationDb[senderId].risk_boost = Math.min(1, latestReputationDb[senderId].risk_boost + boost);

  if (!latestReputationDb[emailId]) {
    latestReputationDb[emailId] = { count: 0, risk_boost: 0 };
  }
  latestReputationDb[emailId].count += 1;
  latestReputationDb[emailId].risk_boost = Math.min(1, latestReputationDb[emailId].risk_boost + boost);
}

function injectSingleDemoEntry(entry, index) {
  const now = new Date();
  now.setSeconds(now.getSeconds() - (DEMO_SCAM_ENTRIES.length - index));

  const logEntry = {
    timestamp: now.toISOString(),
    sender: `${entry.sender} (${entry.email})`,
    platform: entry.platform,
    risk_level: entry.risk_level,
    risk_score: entry.risk_score,
    explanations: entry.explanations,
  };

  latestDetectionLog.unshift(logEntry);
  injectDemoReputationEntry(entry);
  showDemoToast(entry);
  bumpMetricCounters();

  // Re-render whichever page is active
  if (activePage === "dashboard") {
    renderOverview(latestDetectionLog, latestSystemStatus || {});
    // Add animation class to newest alert row
    requestAnimationFrame(() => {
      const stream = document.getElementById("alerts-stream");
      if (stream) {
        const firstRow = stream.querySelector(".alert-row");
        if (firstRow) firstRow.classList.add("demo-entry-animate");
      }
    });
  }
  if (activePage === "history") {
    renderThreatTimeline(latestDetectionLog);
    requestAnimationFrame(() => {
      const body = document.getElementById("history-body");
      if (body && body.firstElementChild) {
        body.firstElementChild.classList.add("demo-entry-animate");
      }
    });
  }
  if (activePage === "reputation") {
    renderReputation(latestReputationDb);
  }
  if (activePage === "protection") {
    renderProtection(latestDetectionLog, latestSystemStatus || {});
    requestAnimationFrame(() => {
      const container = document.getElementById("protection-recent-detections");
      if (container) {
        const firstRow = container.querySelector(".alert-row");
        if (firstRow) firstRow.classList.add("demo-entry-animate");
      }
    });
  }
}

function scheduleDemoInjection() {
  if (demoInjected) return;
  demoInjected = true;

  const BASE_DELAY = 2000; // 2 seconds after boot
  const STAGGER   = 700;   // 700ms between each entry

  DEMO_SCAM_ENTRIES.forEach((entry, index) => {
    setTimeout(() => {
      injectSingleDemoEntry(entry, index);
    }, BASE_DELAY + index * STAGGER);
  });
}

// ── Boot ────────────────────────────────────────────────────────
if (typeof document !== "undefined" && document.getElementById) {
  // Initialize i18n first, then boot the app
  const bootApp = async () => {
    if (window.reiI18n && typeof window.reiI18n.initI18n === "function") {
      await window.reiI18n.initI18n();
    }

    if (window.rei && typeof window.rei.onStatusUpdate === "function") {
      window.rei.onStatusUpdate((payload) => {
        latestSystemStatus = normalizeSystemStatus(payload);
        if (activePage === "protection") renderProtection(latestDetectionLog, latestSystemStatus);
        if (activePage === "reports") refreshReports();
        if (activePage === "dashboard") renderOverview(latestDetectionLog, latestSystemStatus);
        updateHeaderStatus();
      });
    }

    // Subscribe to dashboard-refresh for live data push (log + reputation + status)
    if (window.rei && typeof window.rei.onDashboardRefresh === "function") {
      window.rei.onDashboardRefresh((data) => {
        latestSystemStatus = normalizeSystemStatus(data);
        latestDetectionLog = Array.isArray(data.log) ? data.log : [];
        latestReputationDb = data.reputation && typeof data.reputation === "object" ? data.reputation : {};
        updateHeaderStatus();

        if (activePage === "dashboard") {
          refreshOverviewWithData(latestDetectionLog, latestSystemStatus);
        }
        if (activePage === "reputation") {
          refreshReputationWithData(latestReputationDb);
        }
        if (activePage === "history") {
          refreshHistoryWithData(latestDetectionLog);
        }
        if (activePage === "protection") {
          renderProtection(latestDetectionLog, latestSystemStatus);
        }
      });
    }

    startHeaderServices();
    initPage("dashboard");

    // Inject demo scam data after 2-3 seconds
    scheduleDemoInjection();
  };
  bootApp();
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
  module.exports = {
    createRouter,
    createStateBus,
    sortDetectionsDescending,
    buildDashboardMetrics,
    buildReputationSummary,
  };
}
