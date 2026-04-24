(function reiEmailProtector() {
  const API_URL = "http://127.0.0.1:8000/analyze-text";
  const BANNER_CLASS = "rei-email-risk-banner";
  const URL_REGEX =
    /((?:https?:\/\/|www\.)[^\s<>()]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>()]*)?)/gi;
  const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

  let scanTimer = null;
  let lastHref = location.href;

  function detectUrls(text) {
    const matches = text.match(URL_REGEX) || [];
    return [...new Set(matches.map((value) => value.trim()))];
  }

  function hashText(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function extractEmailFromText(text) {
    if (!text) {
      return null;
    }
    const match = text.match(EMAIL_REGEX);
    return match ? match[0] : null;
  }

  function extractGmailView() {
    const openMessages = Array.from(document.querySelectorAll("div.adn.ads")).filter(isVisible);
    if (openMessages.length === 0) {
      return null;
    }

    const root = openMessages[openMessages.length - 1];
    const bodyContainer = root.querySelector("div.a3s.aiL, div.a3s");
    if (!bodyContainer) {
      return null;
    }

    const bodyText = (bodyContainer.innerText || "").trim();
    if (!bodyText) {
      return null;
    }

    let senderEmail = "unknown";
    const senderNode = root.querySelector(
      ".gD[email], .gD[data-hovercard-id], span[email], span[data-hovercard-id]"
    );
    if (senderNode) {
      senderEmail =
        senderNode.getAttribute("email") ||
        senderNode.getAttribute("data-hovercard-id") ||
        extractEmailFromText(senderNode.textContent || "") ||
        "unknown";
    }

    if (senderEmail === "unknown") {
      senderEmail = extractEmailFromText(root.innerText || "") || "unknown";
    }

    return {
      root,
      bodyContainer,
      bodyText,
      senderEmail
    };
  }

  function extractOutlookView() {
    const bodyCandidates = Array.from(
      document.querySelectorAll(
        'div[role="document"], div[data-testid="MessageBody"], div[aria-label*="Message body"]'
      )
    ).filter(isVisible);

    if (bodyCandidates.length === 0) {
      return null;
    }

    const bodyContainer = bodyCandidates.sort(
      (a, b) => (b.innerText || "").length - (a.innerText || "").length
    )[0];
    const bodyText = (bodyContainer.innerText || "").trim();
    if (!bodyText) {
      return null;
    }

    const panelRoot =
      bodyContainer.closest('[data-app-section="MailReadCompose"]') ||
      bodyContainer.closest('[role="main"]') ||
      document.body;

    let senderEmail = "unknown";
    const senderSelectors = [
      '[data-testid="message-header-from"] [title*="@"]',
      '[aria-label*="From"] [title*="@"]',
      'span[title*="@"]'
    ];

    for (const selector of senderSelectors) {
      const node = panelRoot.querySelector(selector);
      if (!node) {
        continue;
      }
      senderEmail =
        node.getAttribute("title") ||
        extractEmailFromText(node.textContent || "") ||
        "unknown";
      if (senderEmail !== "unknown") {
        break;
      }
    }

    if (senderEmail === "unknown") {
      senderEmail = extractEmailFromText(panelRoot.innerText || "") || "unknown";
    }

    return {
      root: panelRoot,
      bodyContainer,
      bodyText,
      senderEmail
    };
  }

  function getCurrentEmailView() {
    if (location.host.includes("mail.google.com")) {
      return extractGmailView();
    }
    if (location.host.includes("outlook.live.com")) {
      return extractOutlookView();
    }
    return null;
  }

  async function analyzeEmail(text, sender) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        sender: sender || "unknown",
        platform: "email"
      })
    });

    if (!response.ok) {
      throw new Error(`R.E.I. API request failed with status ${response.status}`);
    }

    return response.json();
  }

  function ensureBanner(bodyContainer, riskLevel) {
    const existing = bodyContainer.querySelector(`.${BANNER_CLASS}`);

    if (riskLevel !== "HIGH" && riskLevel !== "MEDIUM") {
      if (existing) {
        existing.remove();
      }
      return;
    }

    const banner = existing || document.createElement("div");
    banner.className = BANNER_CLASS;
    banner.textContent =
      riskLevel === "HIGH"
        ? "⚠ HIGH RISK PHISHING EMAIL DETECTED"
        : "⚠ Suspicious email detected";
    banner.style.position = "sticky";
    banner.style.top = "0";
    banner.style.width = "100%";
    banner.style.backgroundColor = riskLevel === "HIGH" ? "red" : "orange";
    banner.style.color = "white";
    banner.style.fontSize = "14px";
    banner.style.padding = "10px";
    banner.style.zIndex = "9999";
    banner.style.textAlign = "center";
    banner.style.borderRadius = "6px";
    banner.style.marginBottom = "8px";
    banner.style.boxSizing = "border-box";

    if (!existing) {
      bodyContainer.prepend(banner);
    }
  }

  async function scanCurrentEmail() {
    const view = getCurrentEmailView();
    if (!view) {
      return;
    }

    const fingerprint = hashText(
      `${view.senderEmail}|${view.bodyText.slice(0, 2500)}|${location.href}`
    );
    if (view.root.getAttribute("data-rei-email-fingerprint") === fingerprint) {
      return;
    }

    view.root.setAttribute("data-rei-email-fingerprint", fingerprint);

    const urls = detectUrls(view.bodyText);
    const result = await analyzeEmail(view.bodyText, view.senderEmail);
    ensureBanner(view.bodyContainer, result.risk_level);

    console.log("[REI Email Protector]", {
      sender: view.senderEmail,
      risk_score: result.risk_score,
      risk_level: result.risk_level,
      urls_detected: urls.length
    });
  }

  function scheduleScan() {
    if (scanTimer) {
      clearTimeout(scanTimer);
    }
    scanTimer = setTimeout(() => {
      scanCurrentEmail().catch((error) => {
        console.error("[REI Email Protector] Scan failed", error);
      });
    }, 700);
  }

  function startObservers() {
    const observer = new MutationObserver(() => {
      scheduleScan();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true
    });

    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        scheduleScan();
      }
    }, 800);

    scheduleScan();
  }

  if (document.body) {
    startObservers();
  } else {
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        startObservers();
      },
      { once: true }
    );
  }
})();
