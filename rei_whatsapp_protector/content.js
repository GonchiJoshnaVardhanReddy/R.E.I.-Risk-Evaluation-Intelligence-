(function reiWhatsappProtector() {
  const API_URL = "http://127.0.0.1:8000/analyze-text";
  const INCOMING_MESSAGE_SELECTOR = ".message-in";
  const BADGE_CLASS = "rei-risk-badge";
  const SCAN_STATE_ATTR = "data-rei-scan-state";

  const URL_REGEX =
    /((?:https?:\/\/|www\.)[^\s<>()]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>()]*)?)/gi;
  const PHONE_REGEX = /\+?\d[\d\s-]{6,}\d/;

  function normalizePhone(value) {
    return value.replace(/[^\d+]/g, "");
  }

  function detectUrls(text) {
    const matches = text.match(URL_REGEX) || [];
    return [...new Set(matches.map((value) => value.trim()))];
  }

  function extractSenderPhone() {
    const header = document.querySelector("header");
    if (!header) {
      return "unknown";
    }

    const candidates = new Set();
    const titleNode = header.querySelector('[data-testid="conversation-info-header-chat-title"]');
    if (titleNode && titleNode.textContent) {
      candidates.add(titleNode.textContent);
    }

    header.querySelectorAll("[title]").forEach((node) => {
      const title = node.getAttribute("title");
      if (title) {
        candidates.add(title);
      }
    });

    if (header.textContent) {
      candidates.add(header.textContent);
    }

    for (const candidate of candidates) {
      const match = candidate.match(PHONE_REGEX);
      if (match) {
        return normalizePhone(match[0]);
      }
    }

    return "unknown";
  }

  function extractMessageText(messageNode) {
    const textNodes = messageNode.querySelectorAll("span.selectable-text");
    const parts = Array.from(textNodes)
      .map((node) => node.innerText.trim())
      .filter(Boolean);

    if (parts.length > 0) {
      return parts.join(" ");
    }

    const copyable = messageNode.querySelector(".copyable-text");
    if (copyable) {
      return (copyable.innerText || "").trim();
    }

    return (messageNode.innerText || "").trim();
  }

  async function analyzeMessage(text, sender) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        sender: sender || "unknown",
        platform: "whatsapp"
      })
    });

    if (!response.ok) {
      throw new Error(`R.E.I. API request failed with status ${response.status}`);
    }

    return response.json();
  }

  function injectRiskBadge(messageNode, riskLevel) {
    const existing = messageNode.querySelector(`.${BADGE_CLASS}`);
    if (riskLevel !== "HIGH" && riskLevel !== "MEDIUM") {
      return;
    }

    const badge = existing || document.createElement("div");
    badge.className = BADGE_CLASS;
    badge.textContent =
      riskLevel === "HIGH" ? "⚠ HIGH SCAM RISK" : "⚠ Suspicious message detected";
    badge.style.backgroundColor = riskLevel === "HIGH" ? "red" : "orange";
    badge.style.color = "white";
    badge.style.fontSize = "12px";
    badge.style.padding = "6px";
    badge.style.borderRadius = "6px";
    badge.style.marginTop = "4px";
    badge.style.maxWidth = "fit-content";
    badge.style.display = "block";

    if (!existing) {
      const bubbleContent =
        messageNode.querySelector(".copyable-text")?.parentElement || messageNode;
      bubbleContent.appendChild(badge);
    }
  }

  async function processIncomingMessage(messageNode) {
    const state = messageNode.getAttribute(SCAN_STATE_ATTR);
    if (state === "processing" || state === "done") {
      return;
    }

    messageNode.setAttribute(SCAN_STATE_ATTR, "processing");

    const messageText = extractMessageText(messageNode);
    if (!messageText) {
      messageNode.setAttribute(SCAN_STATE_ATTR, "done");
      return;
    }

    const senderPhone = extractSenderPhone();
    const urls = detectUrls(messageText);

    try {
      const result = await analyzeMessage(messageText, senderPhone);
      injectRiskBadge(messageNode, result.risk_level);
      messageNode.setAttribute(SCAN_STATE_ATTR, "done");

      console.log("[REI] Message scanned", {
        text: messageText,
        sender: senderPhone,
        urls,
        risk_score: result.risk_score,
        risk_level: result.risk_level,
        explanations: result.explanations
      });
    } catch (error) {
      messageNode.removeAttribute(SCAN_STATE_ATTR);
      console.error("[REI] Failed to scan message", error);
    }
  }

  function collectIncomingMessages(rootNode) {
    const results = [];
    if (!(rootNode instanceof Element)) {
      return results;
    }

    if (rootNode.matches(INCOMING_MESSAGE_SELECTOR)) {
      results.push(rootNode);
    }

    rootNode.querySelectorAll(INCOMING_MESSAGE_SELECTOR).forEach((node) => {
      results.push(node);
    });

    return results;
  }

  function startObserver() {
    const observer = new MutationObserver((mutations) => {
      const toProcess = new Set();
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          collectIncomingMessages(node).forEach((messageNode) => toProcess.add(messageNode));
        });
      }

      toProcess.forEach((messageNode) => {
        processIncomingMessage(messageNode);
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.body) {
    startObserver();
  } else {
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        startObserver();
      },
      { once: true }
    );
  }
})();
