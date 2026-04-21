// ═══════════════════════════════════════════════════════════════════
// R.E.I. Risk Evaluation Intelligence — Content Script
// Multi-channel message detection: WhatsApp, Gmail, Outlook
// ═══════════════════════════════════════════════════════════════════

console.log("R.E.I.: Content Script Loaded");

const HOSTNAME = window.location.hostname;
const PLATFORM = HOSTNAME.includes("web.whatsapp.com")
  ? "whatsapp"
  : HOSTNAME.includes("mail.google.com") || HOSTNAME.includes("outlook.live.com")
    ? "email"
    : "unknown";

const URL_REGEX = /https?:\/\/[^\s]+/g;
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_REGEX = /\+?\d[\d\s-]{7,}\d/;
const UNKNOWN_SENDER = "unknown_sender";
const SCAN_DEBOUNCE_MS = 250;
const EMAIL_SCAN_DEBOUNCE_MS = 400;
const MEDIUM_WARNING_THRESHOLD = 0.55;
const HIGH_WARNING_THRESHOLD = 0.75;
const MAX_TRACKED_SIGNATURES = 2000;
const MAX_TRACKED_IDS = 4000;

let nextElementId = 1;
const processedElements = new WeakSet();
const processedElementIds = new Set();
const processedSignatures = new Set();

let mutationQueue = new Set();
let mutationTimer = null;
let emailScanTimer = null;
let lastHref = window.location.href;
let observedRoot = null;

// ── Tracking helpers ────────────────────────────────────────────

function addWithLimit(set, value, limit) {
  if (set.has(value)) return;
  set.add(value);
  if (set.size > limit) {
    const oldestValue = set.values().next().value;
    if (oldestValue !== undefined) set.delete(oldestValue);
  }
}

function normalizeWhitespace(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function ensureElementId(element, prefix) {
  if (!element.dataset.reiMessageId) {
    element.dataset.reiMessageId = `rei-${prefix}-${Date.now()}-${nextElementId++}`;
  }
  return element.dataset.reiMessageId;
}

function getUniqueUrls(text) {
  return Array.from(new Set((text.match(URL_REGEX) || []).map((url) => url.trim())));
}

function enrichTextWithUrls(text, urls) {
  if (!urls.length) return text;
  return `${text}\n\nURLs:\n${urls.join("\n")}`;
}

// ── Risk result normalization ───────────────────────────────────

function normalizeRiskResult(rawResult) {
  const explanations = Array.isArray(rawResult?.explanations)
    ? rawResult.explanations.filter((item) => typeof item === "string")
    : Array.isArray(rawResult?.reasons)
      ? rawResult.reasons.filter((item) => typeof item === "string")
      : [];
  const riskScore = typeof rawResult?.risk_score === "number"
    ? rawResult.risk_score
    : typeof rawResult?.score === "number"
      ? rawResult.score / 100
      : 0;
  const normalizedRiskScore = Math.max(0, Math.min(1, riskScore));
  const level = typeof rawResult?.risk_level === "string" ? rawResult.risk_level.toUpperCase() : "LOW";
  return {
    risk_score: normalizedRiskScore,
    risk_level: ["LOW", "MEDIUM", "HIGH"].includes(level) ? level : "LOW",
    explanations,
    score: typeof rawResult?.score === "number" ? rawResult.score : Math.round(normalizedRiskScore * 100),
    reasons: explanations.length ? explanations : ["No immediate red flags detected"],
  };
}

function riskLevelFromScore(score) {
  const normalizedScore = Number.isFinite(Number(score)) ? Number(score) : 0;
  if (normalizedScore >= HIGH_WARNING_THRESHOLD) return "HIGH";
  if (normalizedScore >= MEDIUM_WARNING_THRESHOLD) return "MEDIUM";
  return "LOW";
}

// ── Duplicate prevention ────────────────────────────────────────

function markProcessed(element, signature, idPrefix) {
  const elementId = ensureElementId(element, idPrefix);
  if (processedElements.has(element) || processedElementIds.has(elementId) || processedSignatures.has(signature)) {
    return false;
  }
  processedElements.add(element);
  addWithLimit(processedElementIds, elementId, MAX_TRACKED_IDS);
  addWithLimit(processedSignatures, signature, MAX_TRACKED_SIGNATURES);
  element.dataset.reiScanned = "true";
  return true;
}

// ── Sender extraction ───────────────────────────────────────────

function extractEmail(value) {
  const match = (value || "").match(EMAIL_REGEX);
  return match ? match[0].toLowerCase() : "";
}

function extractWhatsAppSender() {
  const headerSelectors = [
    "header span[title]",
    "header div[title]",
    "header [data-testid='conversation-info-header-chat-title']",
    "#main header span[title]",
  ];
  for (const selector of headerSelectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const candidate = normalizeWhitespace(node.getAttribute("title") || node.textContent);
      if (!candidate) continue;
      const phoneMatch = candidate.match(PHONE_REGEX);
      if (phoneMatch) return phoneMatch[0].replace(/[\s-]/g, "");
    }
  }
  return UNKNOWN_SENDER;
}

function extractGmailSender(container) {
  const senderSelectors = [".gD[email]", "span[email]", "[email]", "a[href^='mailto:']"];
  for (const selector of senderSelectors) {
    const candidate = container.querySelector(selector) || document.querySelector(selector);
    if (!candidate) continue;
    const fromAttribute = candidate.getAttribute("email")
      || candidate.getAttribute("title")
      || candidate.getAttribute("href")
      || candidate.textContent;
    const email = extractEmail(fromAttribute);
    if (email) return email;
  }
  return UNKNOWN_SENDER;
}

function extractOutlookSender() {
  const senderSelectors = [
    "[data-testid='message-header-from'] span[title]",
    "[data-testid='message-header-from']",
    "a[href^='mailto:']",
    "span[title*='@']",
  ];
  for (const selector of senderSelectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const candidate = node.getAttribute("title")
        || node.getAttribute("href")
        || node.textContent;
      const email = extractEmail(candidate);
      if (email) return email;
    }
  }
  return UNKNOWN_SENDER;
}

// ── Message text extraction ─────────────────────────────────────

function extractWhatsAppText(messageNode) {
  const textParts = [];
  const textNodes = messageNode.querySelectorAll("span.selectable-text");
  textNodes.forEach((node) => {
    const value = normalizeWhitespace(node.innerText);
    if (value) textParts.push(value);
  });
  if (textParts.length) return normalizeWhitespace(textParts.join(" "));
  return normalizeWhitespace(messageNode.innerText);
}

// ── Analysis + Warning injection ────────────────────────────────

function analyzeDetectedContent(text, sender, platform, container) {
  const safeSender = sender && sender.trim() ? sender.trim() : UNKNOWN_SENDER;
  chrome.runtime.sendMessage(
    { action: "analyzeMessage", text, sender: safeSender, platform },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn("REI API request failed");
        return;
      }
      if (!response || response.status !== "success" || !response.data) {
        console.warn("REI API request failed");
        return;
      }
      const result = normalizeRiskResult(response.data);
      console.log("REI Scan Result:", {
        sender: safeSender,
        risk_score: result.risk_score,
        risk_level: result.risk_level,
        explanations: result.explanations,
      });
      if (result.risk_score < MEDIUM_WARNING_THRESHOLD) return;
      result.risk_level = riskLevelFromScore(result.risk_score);
      result.score = Math.round(result.risk_score * 100);
      if (container) {
        injectWarning(container, result);
      }
    }
  );
}

function injectWarning(container, result) {
  const messageId = ensureElementId(container, "warning");
  const existingWarning = container.parentElement?.querySelector(`.rei-warning[data-rei-for='${messageId}']`);
  if (existingWarning) return;

  const warning = document.createElement("div");
  warning.dataset.reiFor = messageId;
  warning.className = `rei-warning ${result.risk_level.toLowerCase()}`;

  const reasons = (Array.isArray(result.explanations) && result.explanations.length
    ? result.explanations
    : result.reasons).slice(0, 3);

  const riskIcon = result.risk_level === "HIGH" ? "🔴" : "🟠";

  warning.innerHTML = `
    <div class="rei-header">
      <span class="rei-icon">${riskIcon}</span>
      <span class="rei-title">R.E.I. ALERT — ${result.risk_level} RISK</span>
      <span class="rei-score">${result.score}%</span>
    </div>
    <div class="rei-body">
      <ul>
        ${reasons.map((reason) => `<li>${reason}</li>`).join("")}
      </ul>
    </div>
  `;

  if (container.parentElement) {
    container.style.position = "relative";
    container.parentElement.insertBefore(warning, container);
    container.classList.add(`rei-glow-${result.risk_level.toLowerCase()}`);
  }
}

// ── WhatsApp scanning ───────────────────────────────────────────

function processWhatsAppMessage(messageNode) {
  const text = extractWhatsAppText(messageNode);
  if (!text || text.length < 2) return;
  const sender = extractWhatsAppSender();
  const urls = getUniqueUrls(text);
  const enrichedText = enrichTextWithUrls(text, urls);
  const signature = `whatsapp|${sender}|${enrichedText}`;
  if (!markProcessed(messageNode, signature, "wa")) return;
  analyzeDetectedContent(enrichedText, sender, "whatsapp", messageNode);
}

function processWhatsAppNode(node) {
  if (!(node instanceof Element) || node.classList.contains("rei-warning")) return;
  const candidates = new Set();
  if (node.matches("div.message-in")) candidates.add(node);
  if (node.matches("div.message-in div.copyable-text")) {
    const parentMessage = node.closest("div.message-in");
    if (parentMessage) candidates.add(parentMessage);
  }
  node.querySelectorAll("div.message-in").forEach((messageNode) => candidates.add(messageNode));
  candidates.forEach((messageNode) => processWhatsAppMessage(messageNode));
}

// ── Gmail scanning ──────────────────────────────────────────────

function scanGmail() {
  const mainRegion = document.querySelector("[role='main']");
  if (!mainRegion) return;
  const emailBody = document.querySelector("div.a3s") || mainRegion.querySelector("div.a3s");
  const scanContainer = emailBody || mainRegion;
  const text = normalizeWhitespace(scanContainer.innerText);
  if (!text || text.length < 10) return;

  const senderNode = document.querySelector("span[email]");
  const senderCandidate = senderNode?.getAttribute("email") || senderNode?.textContent || extractGmailSender(mainRegion);
  const sender = extractEmail(senderCandidate) || UNKNOWN_SENDER;
  const urls = getUniqueUrls(text);
  const enrichedText = enrichTextWithUrls(text, urls);
  const signature = `email|${sender}|${enrichedText}`;
  if (!markProcessed(scanContainer, signature, "gmail")) return;
  analyzeDetectedContent(enrichedText, sender, "email", scanContainer);
}

// ── Outlook scanning ────────────────────────────────────────────

function scanOutlook() {
  const selectors = [
    "div[role='document']:not([contenteditable='true'])",
    "div[data-app-section='MailReadCompose'] div[dir='ltr']",
  ];
  const bodyNodes = document.querySelectorAll(selectors.join(","));
  const sender = extractOutlookSender();
  bodyNodes.forEach((bodyNode) => {
    const text = normalizeWhitespace(bodyNode.innerText);
    if (!text || text.length < 10) return;
    const urls = getUniqueUrls(text);
    const enrichedText = enrichTextWithUrls(text, urls);
    const signature = `email|${sender}|${enrichedText}`;
    if (!markProcessed(bodyNode, signature, "outlook")) return;
    analyzeDetectedContent(enrichedText, sender, "email", bodyNode);
  });
}

// ── Scheduling + MutationObserver ───────────────────────────────

function scheduleEmailScan() {
  if (emailScanTimer) return;
  emailScanTimer = window.setTimeout(() => {
    emailScanTimer = null;
    if (HOSTNAME.includes("mail.google.com")) {
      scanGmail();
      return;
    }
    if (HOSTNAME.includes("outlook.live.com")) {
      scanOutlook();
    }
  }, EMAIL_SCAN_DEBOUNCE_MS);
}

function processMutationQueue() {
  mutationTimer = null;
  const queuedNodes = Array.from(mutationQueue);
  mutationQueue = new Set();

  if (PLATFORM === "whatsapp") {
    queuedNodes.forEach((node) => processWhatsAppNode(node));
    return;
  }
  if (PLATFORM === "email") {
    scheduleEmailScan();
  }
}

function queueMutationNode(node) {
  if (!(node instanceof Element)) return;
  if (node.classList.contains("rei-warning") || node.closest(".rei-warning")) return;
  mutationQueue.add(node);
  if (!mutationTimer) {
    mutationTimer = window.setTimeout(processMutationQueue, SCAN_DEBOUNCE_MS);
  }
}

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => queueMutationNode(node));
  });
});

function startObserver() {
  const root = PLATFORM === "email"
    ? (document.querySelector("[role='main']") || document.body)
    : document.body;
  if (!root || root === observedRoot) return;
  observer.disconnect();
  observedRoot = root;
  observer.observe(root, { childList: true, subtree: true });
}

function runInitialScan() {
  if (PLATFORM === "whatsapp") {
    processWhatsAppNode(document.body);
  } else if (PLATFORM === "email") {
    scheduleEmailScan();
  }
}

// ── Boot ────────────────────────────────────────────────────────

if (PLATFORM !== "unknown") {
  startObserver();
  runInitialScan();

  if (PLATFORM === "email") {
    window.setInterval(() => {
      startObserver();
      if (window.location.href !== lastHref) {
        lastHref = window.location.href;
        scheduleEmailScan();
      }
    }, 1000);
  }
}
