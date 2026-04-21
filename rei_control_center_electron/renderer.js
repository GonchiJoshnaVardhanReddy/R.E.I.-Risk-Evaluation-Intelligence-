// ═════════════════════════════════════════════════════════════════
//  R.E.I. Control Center — Renderer (all page logic)
// ═════════════════════════════════════════════════════════════════

const API_BASE = 'http://127.0.0.1:8000';

// ── Routing ──────────────────────────────────────────────────────
const navItems = typeof document !== "undefined" ? document.querySelectorAll('.nav-item') : [];
const pages    = typeof document !== "undefined" ? document.querySelectorAll('.page') : [];
let activePage = 'dashboard';
const intervals = {};

function navigateTo(page) {
  activePage = page;
  navItems.forEach(n => n.classList.toggle('active', n.dataset.page === page));
  pages.forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  clearAllIntervals();
  initPage(page);
}

if (typeof document !== "undefined") {
  navItems.forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
  });
}

function clearAllIntervals() {
  Object.keys(intervals).forEach(k => { clearInterval(intervals[k]); delete intervals[k]; });
}

// ── Helpers ──────────────────────────────────────────────────────
function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function timeAgo(isoStr) {
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function badgeHtml(level) {
  const l = (level || 'low').toLowerCase();
  const icon = l === 'high' ? '🔴' : l === 'medium' ? '🟠' : '🟢';
  return `<span class="badge ${l}">${icon} ${level}</span>`;
}

function riskyRowClass(level) {
  const l = (level || '').toUpperCase();
  if (l === 'HIGH') return 'risk-high';
  if (l === 'MEDIUM') return 'risk-medium';
  return '';
}

// ── Page Init Dispatch ───────────────────────────────────────────
function initPage(page) {
  switch (page) {
    case 'dashboard':  initDashboard();  break;
    case 'protection': initProtection(); break;
    case 'history':    initHistory();    break;
    case 'reputation': initReputation(); break;
    case 'scan':       initScan();       break;
    case 'status':     initStatus();     break;
    case 'settings':   initSettings();   break;
  }
}

// ═════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═════════════════════════════════════════════════════════════════
function initDashboard() {
  const el = document.getElementById('page-dashboard');
  el.innerHTML = `
    <div class="page-header">
      <h1>Dashboard</h1>
      <p>Real-time threat intelligence overview</p>
    </div>
    <div id="dash-banner"></div>
    <div class="stats-grid" id="dash-stats"></div>
    <div class="two-col">
      <div class="card">
        <div class="card-title">Risk Distribution</div>
        <div class="chart-container" id="dash-chart"></div>
      </div>
      <div class="card">
        <div class="card-title">Recent Detections</div>
        <div class="table-wrapper" style="max-height:340px;overflow-y:auto">
          <table><thead><tr>
            <th>Time</th><th>Platform</th><th>Sender</th><th>Risk</th>
          </tr></thead><tbody id="dash-recent"></tbody></table>
        </div>
      </div>
    </div>`;
  refreshDashboard();
  intervals.dashboard = setInterval(refreshDashboard, 5000);
}

async function refreshDashboard() {
  if (activePage !== 'dashboard') return;
  try {
    const logs = await window.rei.readDetectionLog();
    const scannerSt = await window.rei.scannerStatus();

    // Banner
    const banner = document.getElementById('dash-banner');
    if (scannerSt.running) {
      banner.innerHTML = `<div class="status-banner online"><div class="pulse"></div> Protection Active — R.E.I. Scanner Online</div>`;
    } else {
      banner.innerHTML = `<div class="status-banner offline"><div class="pulse"></div> Protection Offline — Scanner Unreachable</div>`;
    }

    // Count today
    const todayStr = new Date().toISOString().slice(0,10);
    const todayLogs = logs.filter(l => l.timestamp && l.timestamp.startsWith(todayStr));
    const highCount  = logs.filter(l => l.risk_level === 'HIGH').length;
    const medCount   = logs.filter(l => l.risk_level === 'MEDIUM').length;
    const todayCount = todayLogs.length;

    document.getElementById('dash-stats').innerHTML = `
      <div class="stat-card accent">
        <div class="stat-icon accent">📡</div>
        <div class="stat-info">
          <div class="stat-value">${todayCount}</div>
          <div class="stat-label">Threats Today</div>
        </div>
      </div>
      <div class="stat-card danger">
        <div class="stat-icon danger">🔴</div>
        <div class="stat-info">
          <div class="stat-value">${highCount}</div>
          <div class="stat-label">High Risk (All Time)</div>
        </div>
      </div>
      <div class="stat-card warning">
        <div class="stat-icon warning">🟠</div>
        <div class="stat-info">
          <div class="stat-value">${medCount}</div>
          <div class="stat-label">Medium Risk (All Time)</div>
        </div>
      </div>
      <div class="stat-card success">
        <div class="stat-icon success">📋</div>
        <div class="stat-info">
          <div class="stat-value">${logs.length}</div>
          <div class="stat-label">Total Detections</div>
        </div>
      </div>`;

    // Donut chart
    const lowCount = logs.filter(l => l.risk_level === 'LOW').length;
    const total = logs.length || 1;
    const circ = 2 * Math.PI * 64;
    const highPct = highCount / total;
    const medPct  = medCount  / total;
    const lowPct  = lowCount  / total;

    document.getElementById('dash-chart').innerHTML = `
      <div class="donut-chart">
        <svg viewBox="0 0 160 160">
          <circle class="donut-bg" />
          <circle class="donut-low" stroke-dasharray="${lowPct*circ} ${circ}" stroke-dashoffset="0" />
          <circle class="donut-med" stroke-dasharray="${medPct*circ} ${circ}" stroke-dashoffset="${-lowPct*circ}" />
          <circle class="donut-high" stroke-dasharray="${highPct*circ} ${circ}" stroke-dashoffset="${-(lowPct+medPct)*circ}" />
        </svg>
        <div class="donut-label">
          <span class="total">${logs.length}</span>
          <span class="total-text">Total</span>
        </div>
      </div>
      <div class="chart-legend">
        <div class="legend-item"><span class="legend-dot high"></span> High <span class="legend-count">${highCount}</span></div>
        <div class="legend-item"><span class="legend-dot medium"></span> Medium <span class="legend-count">${medCount}</span></div>
        <div class="legend-item"><span class="legend-dot low"></span> Low <span class="legend-count">${lowCount}</span></div>
      </div>`;

    // Recent table (last 15)
    const recent = [...logs].reverse().slice(0, 15);
    document.getElementById('dash-recent').innerHTML = recent.map(l => `
      <tr class="${riskyRowClass(l.risk_level)}">
        <td title="${escHtml(l.timestamp)}">${timeAgo(l.timestamp)}</td>
        <td>${escHtml(l.platform)}</td>
        <td>${escHtml(l.sender)}</td>
        <td>${badgeHtml(l.risk_level)}</td>
      </tr>`).join('');
  } catch (e) {
    console.error('Dashboard refresh error:', e);
  }
}

// ═════════════════════════════════════════════════════════════════
//  LIVE PROTECTION
// ═════════════════════════════════════════════════════════════════
function initProtection() {
  const el = document.getElementById('page-protection');
  el.innerHTML = `
    <div class="page-header">
      <h1>Live Protection</h1>
      <p>Real-time status of R.E.I. protection services</p>
    </div>
    <div class="indicator-grid" id="prot-indicators"></div>
    <div class="mt-24 text-sm text-muted">Auto-refreshing every 3 seconds</div>`;
  refreshProtection();
  intervals.protection = setInterval(refreshProtection, 3000);
}

async function refreshProtection() {
  if (activePage !== 'protection') return;
  try {
    const [scanner, monitor] = await Promise.all([
      window.rei.scannerStatus(),
      window.rei.monitorStatus(),
    ]);
    // Extension is considered connected if scanner API is up (it relies on the same backend)
    const extensionUp = scanner.running;

    document.getElementById('prot-indicators').innerHTML = `
      <div class="indicator-card">
        <div class="indicator-dot ${scanner.running ? 'green' : 'red'}"></div>
        <div>
          <div class="indicator-label">Scanner API</div>
          <div class="indicator-sub">${scanner.running ? 'Running on port 8000' : 'Unreachable — not responding'}</div>
        </div>
      </div>
      <div class="indicator-card">
        <div class="indicator-dot ${monitor.running ? 'green' : 'red'}"></div>
        <div>
          <div class="indicator-label">File Monitor</div>
          <div class="indicator-sub">${monitor.running ? 'Watching Downloads folder' : 'Process not running'}</div>
        </div>
      </div>
      <div class="indicator-card">
        <div class="indicator-dot ${extensionUp ? 'green' : 'red'}"></div>
        <div>
          <div class="indicator-label">Extension Connectivity</div>
          <div class="indicator-sub">${extensionUp ? 'Backend reachable by browser extension' : 'Backend offline — extension disconnected'}</div>
        </div>
      </div>`;
  } catch (e) {
    console.error('Protection refresh error:', e);
  }
}

// ═════════════════════════════════════════════════════════════════
//  THREAT HISTORY
// ═════════════════════════════════════════════════════════════════
let historyLogs = [];
let historySortCol = 'timestamp';
let historySortAsc = false;
let historyFilter = '';
let historyLevelFilter = 'all';

function initHistory() {
  const el = document.getElementById('page-history');
  el.innerHTML = `
    <div class="page-header">
      <h1>Threat History</h1>
      <p>Complete log of all detected threats</p>
    </div>
    <div class="filter-bar">
      <input class="form-input" id="hist-search" placeholder="Search sender, platform, text…" />
      <select id="hist-level-filter">
        <option value="all">All Levels</option>
        <option value="HIGH">High</option>
        <option value="MEDIUM">Medium</option>
        <option value="LOW">Low</option>
      </select>
    </div>
    <div class="table-wrapper" style="max-height:calc(100vh - 260px);overflow-y:auto">
      <table>
        <thead>
          <tr>
            <th data-col="timestamp">Timestamp <span class="sort-arrow" id="sort-timestamp">▼</span></th>
            <th data-col="platform">Platform</th>
            <th data-col="sender">Sender</th>
            <th data-col="risk_score">Score</th>
            <th data-col="risk_level">Level</th>
          </tr>
        </thead>
        <tbody id="hist-body"></tbody>
      </table>
    </div>`;

  document.getElementById('hist-search').addEventListener('input', e => {
    historyFilter = e.target.value.toLowerCase();
    renderHistory();
  });
  document.getElementById('hist-level-filter').addEventListener('change', e => {
    historyLevelFilter = e.target.value;
    renderHistory();
  });
  document.querySelectorAll('#page-history th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (historySortCol === col) { historySortAsc = !historySortAsc; }
      else { historySortCol = col; historySortAsc = true; }
      renderHistory();
    });
  });

  loadHistory();
}

async function loadHistory() {
  historyLogs = await window.rei.readDetectionLog();
  renderHistory();
}

function renderHistory() {
  let filtered = [...historyLogs];

  if (historyLevelFilter !== 'all') {
    filtered = filtered.filter(l => l.risk_level === historyLevelFilter);
  }
  if (historyFilter) {
    filtered = filtered.filter(l =>
      (l.sender || '').toLowerCase().includes(historyFilter) ||
      (l.platform || '').toLowerCase().includes(historyFilter) ||
      (l.text || '').toLowerCase().includes(historyFilter)
    );
  }

  filtered.sort((a, b) => {
    let va = a[historySortCol], vb = b[historySortCol];
    if (typeof va === 'number' && typeof vb === 'number') return historySortAsc ? va - vb : vb - va;
    va = String(va || '').toLowerCase();
    vb = String(vb || '').toLowerCase();
    return historySortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  // Update sort arrows
  document.querySelectorAll('#page-history th .sort-arrow').forEach(el => el.remove());
  const activeHeader = document.querySelector(`#page-history th[data-col="${historySortCol}"]`);
  if (activeHeader) {
    const arrow = document.createElement('span');
    arrow.className = 'sort-arrow';
    arrow.textContent = historySortAsc ? ' ▲' : ' ▼';
    activeHeader.appendChild(arrow);
  }

  document.getElementById('hist-body').innerHTML = filtered.map(l => `
    <tr class="${riskyRowClass(l.risk_level)}">
      <td class="mono text-xs" title="${escHtml(l.timestamp)}">${escHtml(l.timestamp?.replace('T',' ').slice(0,19))}</td>
      <td>${escHtml(l.platform)}</td>
      <td title="${escHtml(l.sender)}">${escHtml(l.sender)}</td>
      <td class="mono">${(l.risk_score || 0).toFixed(4)}</td>
      <td>${badgeHtml(l.risk_level)}</td>
    </tr>`).join('');
}

// ═════════════════════════════════════════════════════════════════
//  SENDER REPUTATION
// ═════════════════════════════════════════════════════════════════
function initReputation() {
  const el = document.getElementById('page-reputation');
  el.innerHTML = `
    <div class="page-header">
      <h1>Sender Reputation</h1>
      <p>Known sender risk profiles based on detection history</p>
    </div>
    <div class="table-wrapper" style="max-height:calc(100vh - 220px);overflow-y:auto">
      <table>
        <thead><tr>
          <th>Sender ID</th>
          <th>Detection Count</th>
          <th>Risk Boost</th>
        </tr></thead>
        <tbody id="rep-body"></tbody>
      </table>
    </div>
    <div class="mt-16 text-sm text-muted">Auto-refreshing every 10 seconds</div>`;
  refreshReputation();
  intervals.reputation = setInterval(refreshReputation, 10000);
}

async function refreshReputation() {
  if (activePage !== 'reputation') return;
  try {
    const db = await window.rei.readReputationDb();
    const entries = Object.entries(db).map(([id, v]) => ({ id, count: v.count || 0, risk_boost: v.risk_boost || 0 }));
    entries.sort((a, b) => b.count - a.count);

    document.getElementById('rep-body').innerHTML = entries.map(e => {
      const boostClass = e.risk_boost >= 0.4 ? 'danger' : e.risk_boost >= 0.1 ? 'warning' : 'success';
      return `<tr>
        <td class="mono">${escHtml(e.id)}</td>
        <td><strong>${e.count}</strong></td>
        <td><span class="badge ${boostClass}">${e.risk_boost.toFixed(2)}</span></td>
      </tr>`;
    }).join('');
  } catch (e) {
    console.error('Reputation refresh error:', e);
  }
}

// ═════════════════════════════════════════════════════════════════
//  MANUAL SCAN
// ═════════════════════════════════════════════════════════════════
function initScan() {
  const el = document.getElementById('page-scan');
  el.innerHTML = `
    <div class="page-header">
      <h1>Manual Scan</h1>
      <p>Analyze messages, URLs, and files for risk assessment</p>
    </div>
    <div class="scan-grid">
      <div class="card">
        <div class="card-title">Text Analysis</div>
        <div class="form-group">
          <label for="scan-text">Message Content</label>
          <textarea class="form-textarea" id="scan-text" placeholder="Paste suspicious message content here…"></textarea>
        </div>
        <button class="btn btn-primary" id="btn-scan-text">🔍 Analyze Text</button>
      </div>
      <div class="card">
        <div class="card-title">URL Analysis</div>
        <div class="form-group">
          <label for="scan-url">URL</label>
          <input class="form-input" id="scan-url" placeholder="https://example.com/suspicious-link" />
        </div>
        <button class="btn btn-primary" id="btn-scan-url">🔗 Analyze URL</button>
      </div>
    </div>
    <div class="mt-16">
      <div class="card">
        <div class="card-title">File Analysis</div>
        <p class="text-sm text-muted mb-16">Supported: .txt, .pdf, .docx, .html, .eml</p>
        <button class="btn btn-file" id="btn-scan-file">📁 Choose File to Scan</button>
        <div id="scan-file-name" class="mt-8 text-sm text-muted"></div>
      </div>
    </div>
    <div id="scan-result" class="result-box"></div>`;

  document.getElementById('btn-scan-text').addEventListener('click', scanText);
  document.getElementById('btn-scan-url').addEventListener('click', scanUrl);
  document.getElementById('btn-scan-file').addEventListener('click', scanFile);
}

async function showScanResult(data) {
  const box = document.getElementById('scan-result');
  if (!data || data.detail) {
    box.className = 'result-box visible';
    box.innerHTML = `<div class="text-muted">❌ Error: ${escHtml(data?.detail || 'Unknown error')}</div>`;
    return;
  }
  const level = (data.risk_level || 'LOW').toLowerCase();
  box.className = 'result-box visible';
  box.innerHTML = `
    <div class="result-score ${level}">${(data.risk_score || 0).toFixed(4)}</div>
    <div class="result-level">${badgeHtml(data.risk_level)}</div>
    <ul class="result-explanations">
      ${(data.explanations || []).map(e => `<li>${escHtml(e)}</li>`).join('')}
    </ul>`;
}

async function scanText() {
  const text = document.getElementById('scan-text').value.trim();
  if (!text) return;
  const btn = document.getElementById('btn-scan-text');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Analyzing…';
  try {
    const res = await fetch(`${API_BASE}/analyze-text`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    showScanResult(await res.json());
  } catch (e) {
    showScanResult({ detail: e.message });
  }
  btn.disabled = false; btn.innerHTML = '🔍 Analyze Text';
}

async function scanUrl() {
  const url = document.getElementById('scan-url').value.trim();
  if (!url) return;
  const btn = document.getElementById('btn-scan-url');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Analyzing…';
  try {
    const res = await fetch(`${API_BASE}/analyze-url`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    showScanResult(await res.json());
  } catch (e) {
    showScanResult({ detail: e.message });
  }
  btn.disabled = false; btn.innerHTML = '🔗 Analyze URL';
}

async function scanFile() {
  const filePath = await window.rei.openFileDialog();
  if (!filePath) return;
  document.getElementById('scan-file-name').textContent = `Selected: ${filePath}`;
  const btn = document.getElementById('btn-scan-file');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Uploading & Analyzing…';
  try {
    // Read file through fetch from local path — we use the Electron IPC-opened dialog
    // then construct a FormData with the file
    const response = await fetch(filePath);
    const blob = await response.blob();
    const fileName = filePath.split(/[\\/]/).pop();
    const formData = new FormData();
    formData.append('file', blob, fileName);
    const res = await fetch(`${API_BASE}/analyze-file`, { method: 'POST', body: formData });
    showScanResult(await res.json());
  } catch (e) {
    showScanResult({ detail: e.message });
  }
  btn.disabled = false; btn.innerHTML = '📁 Choose File to Scan';
}

// ═════════════════════════════════════════════════════════════════
//  SYSTEM STATUS
// ═════════════════════════════════════════════════════════════════
function initStatus() {
  const el = document.getElementById('page-status');
  el.innerHTML = `
    <div class="page-header">
      <h1>System Status</h1>
      <p>Infrastructure health check for all R.E.I. components</p>
    </div>
    <div class="indicator-grid" id="sys-indicators"></div>
    <div class="mt-16">
      <button class="btn btn-outline" id="btn-refresh-status">🔄 Refresh Now</button>
    </div>`;
  document.getElementById('btn-refresh-status').addEventListener('click', refreshStatus);
  refreshStatus();
}

async function refreshStatus() {
  try {
    const st = await window.rei.systemStatus();
    document.getElementById('sys-indicators').innerHTML = `
      <div class="indicator-card">
        <div class="indicator-dot ${st.scannerUp ? 'green' : 'red'}"></div>
        <div>
          <div class="indicator-label">Scanner API</div>
          <div class="indicator-sub">${st.scannerUp ? 'Reachable at http://127.0.0.1:8000' : 'Not reachable'}</div>
        </div>
      </div>
      <div class="indicator-card">
        <div class="indicator-dot ${st.monitorUp ? 'green' : 'red'}"></div>
        <div>
          <div class="indicator-label">File Monitor Process</div>
          <div class="indicator-sub">${st.monitorUp ? 'Running' : 'Not running'}</div>
        </div>
      </div>
      <div class="indicator-card">
        <div class="indicator-dot ${st.detLogExists ? 'green' : 'red'}"></div>
        <div>
          <div class="indicator-label">detection_log.json</div>
          <div class="indicator-sub">${st.detLogExists ? 'Present' : 'Missing'}</div>
        </div>
      </div>
      <div class="indicator-card">
        <div class="indicator-dot ${st.repDbExists ? 'green' : 'red'}"></div>
        <div>
          <div class="indicator-label">reputation_db.json</div>
          <div class="indicator-sub">${st.repDbExists ? 'Present' : 'Missing'}</div>
        </div>
      </div>`;
  } catch (e) {
    console.error('Status refresh error:', e);
  }
}

// ═════════════════════════════════════════════════════════════════
//  SETTINGS
// ═════════════════════════════════════════════════════════════════
function initSettings() {
  const el = document.getElementById('page-settings');
  el.innerHTML = `
    <div class="page-header">
      <h1>Settings</h1>
      <p>Configure R.E.I. system preferences</p>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-title">API Configuration</div>
        <div class="form-group">
          <label for="set-vt-key">VirusTotal API Key</label>
          <input class="form-input mono" id="set-vt-key" type="password" placeholder="Enter your VirusTotal API key" />
        </div>
        <button class="btn btn-primary" id="btn-save-settings">💾 Save Settings</button>
        <div id="settings-msg" class="mt-8 text-sm"></div>
      </div>
      <div class="card">
        <div class="card-title">Protection Toggles</div>
        <div class="toggle-group">
          <div>
            <div class="toggle-label">URL Scanning</div>
            <div class="toggle-desc">Analyze URLs in messages for phishing domains</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="tog-url" />
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="toggle-group">
          <div>
            <div class="toggle-label">File Scanning</div>
            <div class="toggle-desc">Automatically scan downloaded files</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="tog-file" />
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="toggle-group">
          <div>
            <div class="toggle-label">Reputation Tracking</div>
            <div class="toggle-desc">Track sender risk history across detections</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="tog-rep" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>`;

  loadSettings();

  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
}

async function loadSettings() {
  try {
    const s = await window.rei.getSettings();
    document.getElementById('set-vt-key').value = s.virustotalApiKey || '';
    document.getElementById('tog-url').checked  = s.enableUrlScanning !== false;
    document.getElementById('tog-file').checked  = s.enableFileScanning !== false;
    document.getElementById('tog-rep').checked   = s.enableReputationTracking !== false;
  } catch (e) {
    console.error('Load settings error:', e);
  }
}

async function saveSettings() {
  const data = {
    virustotalApiKey: document.getElementById('set-vt-key').value,
    enableUrlScanning: document.getElementById('tog-url').checked,
    enableFileScanning: document.getElementById('tog-file').checked,
    enableReputationTracking: document.getElementById('tog-rep').checked,
  };
  try {
    await window.rei.saveSettings(data);
    const msg = document.getElementById('settings-msg');
    msg.style.color = 'var(--success)';
    msg.textContent = '✓ Settings saved successfully';
    setTimeout(() => msg.textContent = '', 3000);
  } catch (e) {
    const msg = document.getElementById('settings-msg');
    msg.style.color = 'var(--danger)';
    msg.textContent = '✗ Failed to save settings';
  }
}

// ── Boot ─────────────────────────────────────────────────────────
if (typeof document !== "undefined" && document.getElementById) {
  initPage('dashboard');
}

// ── Testable factories ──────────────────────────────────────────

function createRouter(pages) {
  let currentPage = null;
  let currentLifecycle = null;

  return {
    async navigate(name) {
      // Unmount previous page
      if (currentPage && pages[currentPage]) {
        if (typeof pages[currentPage].unmount === "function") {
          pages[currentPage].unmount();
        }
        // Destroy lifecycle cleanups
        if (currentLifecycle) {
          currentLifecycle._runCleanups();
          currentLifecycle = null;
        }
      }

      currentPage = name;

      // Mount new page
      if (pages[name]) {
        const lifecycle = createLifecycle();
        currentLifecycle = lifecycle;
        if (typeof pages[name].mount === "function") {
          await pages[name].mount({ lifecycle });
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

// ── Module exports (for testing) ────────────────────────────────
if (typeof module !== "undefined" && module.exports) {
  module.exports = { createRouter, createStateBus };
}
