function normalizeRiskLevel(level) {
  const normalized = typeof level === "string" ? level.toUpperCase() : "LOW";
  return ["LOW", "MEDIUM", "HIGH"].includes(normalized) ? normalized : "LOW";
}

function levelFromScore(score) {
  const numeric = Number.isFinite(Number(score)) ? Number(score) : 0;
  if (numeric >= 0.75) return "HIGH";
  if (numeric >= 0.55) return "MEDIUM";
  return "LOW";
}

function setBadge(id, level) {
  const element = document.getElementById(id);
  if (!element) return;
  const normalizedLevel = normalizeRiskLevel(level);
  element.textContent = normalizedLevel;
  element.className = `attr-badge ${normalizedLevel.toLowerCase()}`;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = String(value);
}

function renderResult(data, fallbackUrl) {
  const scannedUrl = data?.url || fallbackUrl;
  const combinedRisk = normalizeRiskLevel(data?.combined_risk_level || data?.risk_level);
  const vtRisk = normalizeRiskLevel(data?.virustotal_risk_level || data?.sources?.virustotal);
  const localRisk = normalizeRiskLevel(data?.local_risk_level || data?.sources?.rei_local_model);
  const localScore = Number.isFinite(Number(data?.local_model_score)) ? Number(data.local_model_score) : 0;
  const maliciousCount = Number(data?.vt_malicious ?? data?.malicious_count ?? 0);
  const suspiciousCount = Number(data?.vt_suspicious ?? data?.suspicious_count ?? 0);

  setText("target-url", scannedUrl);
  setBadge("attr-combined", combinedRisk);
  setBadge("attr-vt", vtRisk);
  setBadge("attr-local", localRisk);
  setText("attr-vt-malicious", maliciousCount);
  setText("attr-vt-suspicious", suspiciousCount);

  const localScoreBadgeLevel = levelFromScore(localScore);
  setText("attr-local-score", localScore.toFixed(2));
  const localScoreEl = document.getElementById("attr-local-score");
  if (localScoreEl) {
    localScoreEl.className = `attr-badge ${localScoreBadgeLevel.toLowerCase()}`;
  }
}

function initBlockedPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const currentUrl = urlParams.get("url") || "Unknown URL";
  setText("target-url", currentUrl);

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(["latest_url_scan_result"], (result) => {
      renderResult(result.latest_url_scan_result || null, currentUrl);
    });
  }

  const goBackButton = document.getElementById("go-back-btn");
  if (goBackButton) {
    goBackButton.addEventListener("click", () => {
      window.history.back();
    });
  }

  const proceedButton = document.getElementById("proceed-btn");
  if (proceedButton) {
    proceedButton.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ rei_user_override_url: currentUrl }, () => {
          window.location.href = currentUrl;
        });
        return;
      }
      window.location.href = currentUrl;
    });
  }
}

document.addEventListener("DOMContentLoaded", initBlockedPage);
