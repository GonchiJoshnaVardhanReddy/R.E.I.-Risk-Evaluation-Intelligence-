// ─────────────────────────────────────────────────────────────
//  R.E.I. Control Center — i18n Translation Engine
// ─────────────────────────────────────────────────────────────

const SUPPORTED_LANGS = ["en", "hi", "kn", "te", "ml", "ta"];
const DEFAULT_LANG = "en";

let translations = {};
let fallback = {};
let currentLanguage = DEFAULT_LANG;

/**
 * Load a language JSON file from /locales/<lang>.json
 * Falls back to English if the requested language is not found.
 */
async function loadLanguage(lang) {
  const safeLang = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;

  // Always load English as fallback
  if (Object.keys(fallback).length === 0) {
    try {
      const enRes = await fetch("locales/en.json");
      fallback = await enRes.json();
    } catch (e) {
      console.warn("[i18n] Failed to load English fallback:", e);
      fallback = {};
    }
  }

  if (safeLang === "en") {
    translations = fallback;
  } else {
    try {
      const res = await fetch(`locales/${safeLang}.json`);
      translations = await res.json();
    } catch (e) {
      console.warn(`[i18n] Failed to load ${safeLang}, falling back to English`);
      translations = fallback;
    }
  }

  currentLanguage = safeLang;
  updateUI();
  return safeLang;
}

/**
 * Get a translated string by key. Falls back to English, then returns the key itself.
 */
function t(key) {
  return translations[key] || fallback[key] || key;
}

/**
 * Get the currently active language code.
 */
function getActiveLanguage() {
  return currentLanguage;
}

/**
 * Detect the OS / browser language and map to a supported language.
 */
function detectSystemLanguage() {
  const raw = (typeof navigator !== "undefined" && navigator.language) || DEFAULT_LANG;
  const base = raw.toLowerCase().split("-")[0];
  return SUPPORTED_LANGS.includes(base) ? base : DEFAULT_LANG;
}

/**
 * Persist the selected language using electron-store via the preload bridge.
 */
async function saveLanguagePreference(lang) {
  if (typeof window.rei !== "undefined" && window.rei.saveSettings) {
    try {
      const current = await window.rei.getSettings();
      await window.rei.saveSettings({ ...current, language: lang });
    } catch (e) {
      console.warn("[i18n] Could not persist language preference:", e);
    }
  }
}

/**
 * Load saved language preference from electron-store.
 */
async function loadLanguagePreference() {
  if (typeof window.rei !== "undefined" && window.rei.getSettings) {
    try {
      const settings = await window.rei.getSettings();
      if (settings && settings.language && SUPPORTED_LANGS.includes(settings.language)) {
        return settings.language;
      }
    } catch (e) {
      console.warn("[i18n] Could not read language preference:", e);
    }
  }
  return "";
}

/**
 * Update all DOM elements that have a [data-i18n] attribute.
 */
function updateUI() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (key) el.placeholder = t(key);
  });
}

/**
 * Initialize the i18n system:
 * 1. Try saved preference
 * 2. Fall back to OS language detection
 * 3. Fall back to English
 */
async function initI18n() {
  const saved = await loadLanguagePreference();
  const detected = detectSystemLanguage();
  const lang = saved || detected || DEFAULT_LANG;
  await loadLanguage(lang);
  return currentLanguage;
}

// Export for use in renderer.js
window.reiI18n = {
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  initI18n,
  loadLanguage,
  saveLanguagePreference,
  getActiveLanguage,
  updateUI,
  t,
};
