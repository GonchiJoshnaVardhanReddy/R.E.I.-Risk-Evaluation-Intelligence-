// ═══════════════════════════════════════════════════════════════════
//  R.E.I. Risk Evaluation Intelligence — Popup Script
// ═══════════════════════════════════════════════════════════════════

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = String(str || "");
  return d.innerHTML;
}

// ── URL Scan Result Formatting ──────────────────────────────────

function renderUrlScanResult(result) {
  if (!result || !result.url) {
    return `<div class="empty-state">No URL scanned yet. Browse any website to trigger a scan.</div>`;
  }

  const level = (result.combined_risk_level || result.risk_level || "LOW").toLowerCase();
  const maliciousCount = Number(result.vt_malicious ?? result.malicious_count ?? 0);
  const suspiciousCount = Number(result.vt_suspicious ?? result.suspicious_count ?? 0);
  const harmlessCount = Number(result.vt_harmless ?? result.harmless_count ?? 0);
  const localModelScore = Number(result.local_model_score ?? 0);
  const localScoreLevel = localModelScore >= 0.75 ? "high" : localModelScore >= 0.55 ? "medium" : "low";
  const vtLevel = (result.virustotal_risk_level || result.sources?.virustotal || "LOW").toLowerCase();
  const localLevel = (result.local_risk_level || result.sources?.rei_local_model || "LOW").toLowerCase();

  return `
    <div class="url-result-card risk-${level}">
      <div class="url-result-url">${escHtml(result.url)}</div>
      <div class="url-result-risk ${level}">${(result.combined_risk_level || result.risk_level || "LOW")} RISK</div>
      <div class="url-result-stats">
        <div class="url-stat">
          <span class="url-stat-value mal">${maliciousCount}</span>
          <span class="url-stat-label">Malicious</span>
        </div>
        <div class="url-stat">
          <span class="url-stat-value sus">${suspiciousCount}</span>
          <span class="url-stat-label">Suspicious</span>
        </div>
        <div class="url-stat">
          <span class="url-stat-value safe">${harmlessCount}</span>
          <span class="url-stat-label">Harmless</span>
        </div>
      </div>
      <div class="url-sources">
        <h4>Source Attribution</h4>
        <div class="source-row">
          <span class="source-name">VirusTotal</span>
          <span class="source-badge ${vtLevel}">${(result.virustotal_risk_level || result.sources?.virustotal || "LOW").toUpperCase()}</span>
        </div>
        <div class="source-row">
          <span class="source-name">R.E.I. Local Model</span>
          <span class="source-badge ${localLevel}">${(result.local_risk_level || result.sources?.rei_local_model || "LOW").toUpperCase()}</span>
        </div>
        <div class="source-row">
          <span class="source-name">Local Model Score</span>
          <span class="source-badge ${localScoreLevel}">${localModelScore.toFixed(2)}</span>
        </div>
      </div>
    </div>
  `;
}

function formatLatestUrlScanResult(result) {
  if (!result || !result.url) {
    return "No URL scan result yet.";
  }
  return [
    `URL: ${result.url}`,
    `Risk: ${result.combined_risk_level || result.risk_level || "LOW"}`,
    `Malicious: ${Number(result.vt_malicious ?? result.malicious_count ?? 0)}`,
    `Suspicious: ${Number(result.vt_suspicious ?? result.suspicious_count ?? 0)}`,
    `Harmless: ${Number(result.vt_harmless ?? result.harmless_count ?? 0)}`,
    `Local Model Score: ${Number(result.local_model_score ?? 0).toFixed(2)}`,
  ].join("\n");
}

// ── Load data from storage ──────────────────────────────────────

function loadLatestUrlScanResult() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  chrome.storage.local.get(["latest_url_scan_result"], (result) => {
    const container = document.getElementById("url-scan-display");
    if (!container) return;
    container.innerHTML = renderUrlScanResult(result.latest_url_scan_result);
  });
}

function checkBackendStatus() {
  const badge = document.getElementById("service-status");
  const statusText = document.getElementById("status-text");
  const heroTitle = document.getElementById("hero-title");
  const heroDesc = document.getElementById("hero-desc");

  fetch("http://127.0.0.1:8000/docs", { method: "GET", signal: AbortSignal.timeout(3000) })
    .then((res) => {
      if (res.ok) {
        badge.classList.remove("offline");
        statusText.textContent = "ENGINE ONLINE";
        heroTitle.textContent = "All Channels Protected";
        heroDesc.textContent = "Real-time AI monitoring active for WhatsApp, Gmail & Outlook.";
      } else {
        setOffline();
      }
    })
    .catch(() => setOffline());

  function setOffline() {
    badge.classList.add("offline");
    statusText.textContent = "ENGINE OFFLINE";
    heroTitle.textContent = "Scanner Offline";
    heroDesc.textContent = "Start the R.E.I. Scanner API to enable protection.";
  }
}

// ── DOM Ready ───────────────────────────────────────────────────

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    checkBackendStatus();
    updateStats();
    loadSettings();
    loadLatestUrlScanResult();

    // Tab switching
    const tabs = document.querySelectorAll(".tab-btn");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const targetId = `tab-${tab.dataset.tab}`;
        document.querySelectorAll("main").forEach((m) => m.classList.add("hidden"));
        const target = document.getElementById(targetId);
        if (target) target.classList.remove("hidden");

        // Refresh URL scan when that tab opens
        if (tab.dataset.tab === "url-scan") loadLatestUrlScanResult();
      });
    });

    // Manual scan
    const scanBtn = document.getElementById("scan-btn");
    const scanInput = document.getElementById("scan-input");

    scanBtn.addEventListener("click", async () => {
      const text = scanInput.value.trim();
      if (!text) return;
      scanBtn.disabled = true;
      scanBtn.innerText = "Analyzing…";

      chrome.runtime.sendMessage({ action: "analyzeMessage", text }, (response) => {
        scanBtn.disabled = false;
        scanBtn.innerText = "🔍 Analyze Message";

        if (response && response.status === "success") {
          showResult(response.data);
          updateStats();
        } else {
          showError("Scanner offline. Start the R.E.I. backend first.");
        }
      });
    });

    // Save VT API Key
    const saveBtn = document.getElementById("save-vt-key");
    const apiKeyInput = document.getElementById("vt-api-key");

    saveBtn.addEventListener("click", () => {
      const key = apiKeyInput.value.trim();
      chrome.storage.local.set({ vt_api_key: key }, () => {
        const msg = document.getElementById("vt-save-msg");
        msg.className = "save-msg success";
        msg.textContent = "✓ API key saved";
        setTimeout(() => { msg.textContent = ""; }, 3000);
      });
    });

    // Toggle clicks
    document.querySelectorAll(".toggle").forEach((toggle) => {
      toggle.addEventListener("click", () => toggle.classList.toggle("active"));
    });
  });
}

// ── Settings ────────────────────────────────────────────────────

function loadSettings() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  chrome.storage.local.get(["vt_api_key"], (result) => {
    if (result.vt_api_key) {
      const input = document.getElementById("vt-api-key");
      if (input) input.value = result.vt_api_key;
    }
  });
}

// ── Stats ───────────────────────────────────────────────────────

function updateStats() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  chrome.storage.local.get(["history"], (result) => {
    const history = result.history || [];
    const scanned = document.getElementById("messages-scanned");
    const threats = document.getElementById("threats-blocked");
    const safety = document.getElementById("trust-score");

    if (scanned) scanned.innerText = history.length;
    if (threats) threats.innerText = history.filter((h) => h.risk_level === "HIGH" || h.risk_level === "MEDIUM").length;
    if (safety) {
      const risky = history.filter((h) => h.risk_level === "HIGH").length;
      const pct = history.length === 0 ? 100 : Math.round((1 - risky / history.length) * 100);
      safety.innerText = pct + "%";
    }

    updateHistoryUI(history);
  });
}

function updateHistoryUI(history) {
  const list = document.getElementById("history-list");
  if (!list) return;
  if (!history || history.length === 0) {
    list.innerHTML = `<div class="empty-state">No scans yet — browse WhatsApp, Gmail, or Outlook to start.</div>`;
    return;
  }

  list.innerHTML = "";
  history.slice(0, 8).forEach((entry) => {
    const level = (entry.risk_level || "low").toLowerCase();
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `
      <div class="history-meta">
        <span class="risk-tag ${level}">${(entry.risk_level || "LOW").toUpperCase()}</span>
        <span class="history-time">${entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
      </div>
      <div class="history-text">${escHtml(entry.text || "")}</div>
    `;
    list.appendChild(item);
  });
}

// ── Result display ──────────────────────────────────────────────

function showResult(data) {
  const container = document.getElementById("scan-result");
  if (!container) return;
  const level = (data.risk_level || "LOW").toLowerCase();
  container.className = `result-container ${level === "high" ? "high-risk" : level === "medium" ? "medium-risk" : ""}`;
  container.classList.remove("hidden");

  const levelClass = `risk-${level}`;
  const reasons = data.reasons || data.explanations || ["No red flags detected"];

  container.innerHTML = `
    <div class="result-header">
      <strong class="${levelClass}">${(data.risk_level || "LOW").toUpperCase()} RISK</strong>
      <span class="score-badge">${data.score || 0}% confidence</span>
    </div>
    <ul class="reasons">
      ${reasons.map((r) => `<li>${escHtml(r)}</li>`).join("")}
    </ul>
  `;
}

function showError(msg) {
  const container = document.getElementById("scan-result");
  if (!container) return;
  container.className = "result-container error";
  container.classList.remove("hidden");
  container.textContent = msg;
}

// ── Module exports for testing ──────────────────────────────────

if (typeof module !== "undefined" && module.exports) {
  module.exports = { formatLatestUrlScanResult };
}
