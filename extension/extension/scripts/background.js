// ═══════════════════════════════════════════════════════════════════
//  R.E.I. Risk Evaluation Intelligence — Background Service Worker
// ═══════════════════════════════════════════════════════════════════

const API_URL = "http://127.0.0.1:8000/analyze-text";
const URL_ANALYZE_API_URL = "http://127.0.0.1:8000/analyze-url";
const VT_SUBMIT_URL = "https://www.virustotal.com/api/v3/urls";
const VT_ANALYSIS_BASE_URL = "https://www.virustotal.com/api/v3/analyses/";

const REQUEST_RETRY_DELAY_MS = 1500;
const MAX_REQUEST_ATTEMPTS = 2;
const VT_SCAN_COOLDOWN_MS = 20_000;
const VT_ANALYSIS_POLL_ATTEMPTS = 4;
const VT_ANALYSIS_POLL_DELAY_MS = 2500;
const MEDIUM_WARNING_THRESHOLD = 0.55;
const HIGH_WARNING_THRESHOLD = 0.75;
const REI_DEBUG = true;

// ── Helpers ─────────────────────────────────────────────────────

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldIgnoreUrlForScan(url) {
  if (!url) return true;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return true;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("file://")) return true;
  return false;
}

function shouldSkipDueToCooldown({ lastUrl, lastTs, currentUrl, now, cooldownMs }) {
  if (lastUrl && lastUrl === currentUrl) return true;
  if (typeof lastTs === "number" && now - lastTs < cooldownMs) return true;
  return false;
}

// ── Risk computation ────────────────────────────────────────────

function computeUrlRiskLevel({ malicious = 0, suspicious = 0 }) {
  if (malicious > 0) return "HIGH";
  if (suspicious > 0) return "MEDIUM";
  return "LOW";
}

function normalizeRiskLevel(level) {
  const normalizedLevel = typeof level === "string" ? level.toUpperCase() : "";
  return ["LOW", "MEDIUM", "HIGH"].includes(normalizedLevel) ? normalizedLevel : "LOW";
}

function combineRiskLevels(virustotalRiskLevel, localRiskLevel) {
  const vtNorm = normalizeRiskLevel(virustotalRiskLevel);
  const localNorm = normalizeRiskLevel(localRiskLevel);
  if (vtNorm === "HIGH" || localNorm === "HIGH") return "HIGH";
  if (vtNorm === "MEDIUM" || localNorm === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function mapRiskLevelFromScore(score) {
  const normalizedScore = Number.isFinite(Number(score)) ? Number(score) : 0;
  if (normalizedScore >= HIGH_WARNING_THRESHOLD) return "HIGH";
  if (normalizedScore >= MEDIUM_WARNING_THRESHOLD) return "MEDIUM";
  return "LOW";
}

function computeCombinedUrlScanResult({ url, vtStats, localRiskLevel }) {
  const malicious = Number(vtStats?.malicious || 0);
  const suspicious = Number(vtStats?.suspicious || 0);
  const harmless = Number(vtStats?.harmless || 0);
  const virustotalRiskLevel = computeUrlRiskLevel({ malicious, suspicious });
  const normalizedLocalRisk = normalizeRiskLevel(localRiskLevel);
  const finalRiskLevel = combineRiskLevels(virustotalRiskLevel, normalizedLocalRisk);

  return {
    url,
    risk_level: finalRiskLevel,
    sources: {
      virustotal: virustotalRiskLevel,
      rei_local_model: normalizedLocalRisk,
    },
    malicious_count: malicious,
    suspicious_count: suspicious,
    harmless_count: harmless,
    virustotal_risk_level: virustotalRiskLevel,
    local_risk_level: normalizedLocalRisk,
  };
}

function buildLatestUrlScanResult({
  url,
  vtStats,
  localModelScore,
  combinedRiskLevel,
  virustotalRiskLevel,
  localRiskLevel,
}) {
  const malicious = Number(vtStats?.malicious || 0);
  const suspicious = Number(vtStats?.suspicious || 0);
  const harmless = Number(vtStats?.harmless || 0);
  const scoreValue = Number.isFinite(Number(localModelScore)) ? Number(localModelScore) : 0;
  const roundedLocalScore = Math.max(0, Math.min(1, scoreValue));

  return {
    url,
    vt_malicious: malicious,
    vt_suspicious: suspicious,
    vt_harmless: harmless,
    local_model_score: Number(roundedLocalScore.toFixed(4)),
    combined_risk_level: normalizeRiskLevel(combinedRiskLevel),
    risk_level: normalizeRiskLevel(combinedRiskLevel),
    malicious_count: malicious,
    suspicious_count: suspicious,
    harmless_count: harmless,
    virustotal_risk_level: normalizeRiskLevel(virustotalRiskLevel),
    local_risk_level: normalizeRiskLevel(localRiskLevel),
    sources: {
      virustotal: normalizeRiskLevel(virustotalRiskLevel),
      rei_local_model: normalizeRiskLevel(localRiskLevel),
    },
  };
}

// ── VirusTotal submission ───────────────────────────────────────

function buildVirusTotalSubmitRequest(url, apiKey) {
  return {
    method: "POST",
    headers: {
      "x-apikey": apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `url=${encodeURIComponent(url)}`,
  };
}

function getStatsFromAnalysisPayload(analysisPayload) {
  const attrs = analysisPayload?.data?.attributes || {};
  return attrs.stats || attrs.last_analysis_stats || {};
}

async function pollAnalysisResult(analysisId, apiKey) {
  for (let attempt = 1; attempt <= VT_ANALYSIS_POLL_ATTEMPTS; attempt++) {
    const response = await fetch(`${VT_ANALYSIS_BASE_URL}${encodeURIComponent(analysisId)}`, {
      method: "GET",
      headers: { "x-apikey": apiKey },
    });
    if (!response.ok) {
      throw new Error(`analysis poll failed: ${response.status}`);
    }
    const data = await response.json();
    const status = data?.data?.attributes?.status;
    if (status === "completed" || status === "complete") {
      return data;
    }
    if (attempt < VT_ANALYSIS_POLL_ATTEMPTS) {
      await wait(VT_ANALYSIS_POLL_DELAY_MS);
    }
  }
  throw new Error("analysis not completed in time");
}

// ── Local URL analysis ──────────────────────────────────────────

async function fetchLocalUrlResult(url) {
  try {
    const response = await fetch(URL_ANALYZE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      throw new Error(`local URL analysis failed: ${response.status}`);
    }
    const data = await response.json();
    const score = typeof data?.risk_score === "number" ? Math.max(0, Math.min(1, data.risk_score)) : 0;
    const levelFromApi = normalizeRiskLevel(data?.risk_level);
    return {
      riskLevel: levelFromApi !== "LOW" || score < MEDIUM_WARNING_THRESHOLD ? levelFromApi : mapRiskLevelFromScore(score),
      riskScore: score,
    };
  } catch (_error) {
    console.warn("Local scanner unavailable");
    return { riskLevel: "LOW", riskScore: 0 };
  }
}

// ── Combined URL scan ───────────────────────────────────────────

async function runVirusTotalScanForTab(tabId, url, apiKey) {
  try {
    const submitRequest = buildVirusTotalSubmitRequest(url, apiKey);
    const submitResponse = await fetch(VT_SUBMIT_URL, submitRequest);
    if (!submitResponse.ok) {
      throw new Error(`submit failed: ${submitResponse.status}`);
    }
    const submitData = await submitResponse.json();
    const analysisId = submitData?.data?.id;
    if (!analysisId) {
      throw new Error("missing analysis id");
    }

    const analysis = await pollAnalysisResult(analysisId, apiKey);
    const stats = getStatsFromAnalysisPayload(analysis);
    const localResult = await fetchLocalUrlResult(url);
    const combinedResult = computeCombinedUrlScanResult({
      url,
      vtStats: stats,
      localRiskLevel: localResult.riskLevel,
    });
    const storageEntry = buildLatestUrlScanResult({
      url,
      vtStats: stats,
      localModelScore: localResult.riskScore,
      combinedRiskLevel: combinedResult.risk_level,
      virustotalRiskLevel: combinedResult.virustotal_risk_level,
      localRiskLevel: combinedResult.local_risk_level,
    });

    await chrome.storage.local.set({
      latest_url_scan_result: storageEntry,
    });

    console.log("REI Scan Result:", storageEntry);

    if (combinedResult.risk_level === "HIGH") {
      const { rei_user_override_url: overrideUrl } = await chrome.storage.local.get(["rei_user_override_url"]);
      if (overrideUrl && overrideUrl === url) {
        await chrome.storage.local.remove(["rei_user_override_url"]);
        return true;
      }
      chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(url)}`),
      });
    }
    return true;
  } catch (_error) {
    console.warn("VirusTotal scan failed");
    return false;
  }
}

async function triggerVirusTotalScan(tabId, currentUrl) {
  if (shouldIgnoreUrlForScan(currentUrl)) return;

  try {
    const { vt_api_key: apiKey, vt_last_scanned_url: lastUrl, vt_last_scan_ts: lastTs } =
      await chrome.storage.local.get(["vt_api_key", "vt_last_scanned_url", "vt_last_scan_ts"]);

    if (!apiKey) {
      console.warn("VirusTotal API key not configured");
      return;
    }

    const now = Date.now();
    if (
      shouldSkipDueToCooldown({
        lastUrl,
        lastTs,
        currentUrl,
        now,
        cooldownMs: VT_SCAN_COOLDOWN_MS,
      })
    ) {
      return;
    }

    // Enforce global cooldown from attempted scan time
    await chrome.storage.local.set({ vt_last_scan_ts: now });

    const success = await runVirusTotalScanForTab(tabId, currentUrl, apiKey);
    if (success) {
      await chrome.storage.local.set({ vt_last_scanned_url: currentUrl });
    }
  } catch (_error) {
    console.warn("VirusTotal scan failed");
  }
}

// ── Tab listeners ───────────────────────────────────────────────

if (typeof chrome !== "undefined" && chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    const currentUrl = tab?.url || "";
    triggerVirusTotalScan(tabId, currentUrl).catch(() => {
      console.warn("VirusTotal scan failed");
    });
  });
}

if (typeof chrome !== "undefined" && chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      const currentUrl = tab?.url || "";
      triggerVirusTotalScan(tabId, currentUrl).catch(() => {
        console.warn("VirusTotal scan failed");
      });
    } catch (_error) {
      console.warn("VirusTotal scan failed");
    }
  });
}

// ── Message scanning pipeline ───────────────────────────────────

function normalizeApiResponse(data) {
  const explanations = Array.isArray(data?.explanations)
    ? data.explanations.filter((item) => typeof item === "string")
    : Array.isArray(data?.reasons)
      ? data.reasons.filter((item) => typeof item === "string")
      : [];

  const scoreFromApi = typeof data?.risk_score === "number"
    ? data.risk_score
    : typeof data?.score === "number"
      ? data.score / 100
      : 0;
  const risk_score = Math.max(0, Math.min(1, scoreFromApi));
  const risk_level = mapRiskLevelFromScore(risk_score);

  return {
    risk_score,
    risk_level,
    explanations,
    score: Math.round(risk_score * 100),
    reasons: explanations.length ? explanations : ["No immediate red flags detected"],
  };
}

function logDebugScanEvent({ sender, riskScore, riskLevel, platform }) {
  if (!REI_DEBUG) return;
  console.log("[REI_DEBUG] scan_event", {
    sender: sender || "unknown_sender",
    risk_score: riskScore,
    risk_level: riskLevel,
    platform: platform || "unknown",
  });
}

function storeScanHistory(text, sender, platform, result) {
  chrome.storage.local.get(["history"], (stored) => {
    const history = stored.history || [];
    const newEntry = {
      timestamp: new Date().toISOString(),
      text: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
      sender,
      platform,
      risk_score: result.risk_score,
      risk_level: result.risk_level,
      explanations: result.explanations,
      score: result.score,
      reasons: result.reasons,
    };
    chrome.storage.local.set({ history: [newEntry, ...history].slice(0, 50) });
  });
}

async function analyzeMessage(text, sender, platform) {
  if (!text) {
    throw new Error("Message text is empty");
  }

  const payload = {
    text,
    sender: sender || "unknown_sender",
    platform: platform === "whatsapp" ? "whatsapp" : "email",
  };

  let lastError = new Error("Scanner unavailable");

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const data = await response.json();
      const normalizedResult = normalizeApiResponse(data);
      logDebugScanEvent({
        sender: payload.sender,
        riskScore: normalizedResult.risk_score,
        riskLevel: normalizedResult.risk_level,
        platform: payload.platform,
      });
      console.log("REI Scan Result:", normalizedResult);
      storeScanHistory(text, payload.sender, payload.platform, normalizedResult);
      return normalizedResult;
    } catch (error) {
      console.warn("Local scanner unavailable");
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_REQUEST_ATTEMPTS) {
        await wait(REQUEST_RETRY_DELAY_MS);
      }
    }
  }

  console.warn("Local scanner unavailable");
  throw lastError;
}

// ── Message listener from content scripts ───────────────────────

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "analyzeMessage") {
      const text = typeof request.text === "string" ? request.text.trim() : "";
      const senderId =
        typeof request.sender === "string" && request.sender.trim() ? request.sender.trim() : "unknown_sender";
      const platform = request.platform === "whatsapp" ? "whatsapp" : "email";

      analyzeMessage(text, senderId, platform)
        .then((result) => sendResponse({ status: "success", data: result }))
        .catch((error) => sendResponse({ status: "error", message: error.message }));
      return true; // Keep channel open for async response
    }
  });
}

// ── Module exports for testing ──────────────────────────────────

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    computeUrlRiskLevel,
    combineRiskLevels,
    computeCombinedUrlScanResult,
    buildLatestUrlScanResult,
    shouldIgnoreUrlForScan,
    shouldSkipDueToCooldown,
    buildVirusTotalSubmitRequest,
    normalizeApiResponse,
    mapRiskLevelFromScore,
    VT_SCAN_COOLDOWN_MS,
  };
}
