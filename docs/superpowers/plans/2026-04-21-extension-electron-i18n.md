# Extension + Electron i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multilingual UI localization to the Chrome extension and Electron control panel with runtime language switching, persisted preference, auto-detect on first launch, and English fallback safety.

**Architecture:** Implement two focused i18n layers: Chrome extension localization using `_locales` + a runtime override dictionary, and Electron renderer localization using cached JSON locale bundles with a `t()` helper and data-key binding. Keep all existing backend logic, IPC flow, and detection/scanning behavior unchanged. Make both surfaces extensible by adding keys in one place and adding a new locale file.

**Tech Stack:** Chrome Extensions MV3 (`chrome.i18n`, `chrome.storage.local`), Electron renderer JS, `electron-store` (existing settings pipeline), JSON locale files, Node test runner (`node --test`), Electron test script (`npm test` in `rei_control_center_electron`).

---

## File Structure / Responsibilities

- Create: `extension/extension/_locales/en/messages.json` — canonical extension English message catalog.
- Create: `extension/extension/_locales/es/messages.json` — Spanish extension message catalog.
- Create: `extension/extension/_locales/fr/messages.json` — French extension message catalog.
- Create: `extension/extension/_locales/de/messages.json` — German extension message catalog.
- Create: `extension/extension/_locales/hi/messages.json` — Hindi extension message catalog.
- Modify: `extension/extension/manifest.json` — wire `default_locale` and localized extension name token.
- Create: `extension/extension/scripts/i18n.js` — extension runtime override + fallback helper.
- Modify: `extension/extension/popup.html` — add language selector and `data-i18n` attributes.
- Modify: `extension/extension/scripts/popup.js` — localized rendering and runtime language switching.
- Modify: `extension/extension/blocked.html` — `data-i18n` keys for blocked page UI.
- Modify: `extension/extension/scripts/blocked.js` — apply translations and localized badge labels.
- Modify: `extension/extension/scripts/content.js` — localize warning banner labels.
- Modify: `tests/extension/manifest.vt.test.mjs` — assert manifest locale wiring.
- Create: `rei_control_center_electron/locales/en.json` — canonical panel English catalog.
- Create: `rei_control_center_electron/locales/es.json` — Spanish panel catalog.
- Create: `rei_control_center_electron/locales/fr.json` — French panel catalog.
- Create: `rei_control_center_electron/locales/de.json` — German panel catalog.
- Create: `rei_control_center_electron/locales/hi.json` — Hindi panel catalog.
- Create: `rei_control_center_electron/renderer/i18n.js` — renderer localization runtime (cache, fallback, apply).
- Modify: `rei_control_center_electron/index.html` — sidebar/header `data-i18n` markers.
- Modify: `rei_control_center_electron/renderer.js` — use `t()` in templates, add panel language selector workflow, re-render support.
- Modify: `rei_control_center_electron/main.js` — add `language` to settings defaults only.
- Create: `rei_control_center_electron/tests/i18n.test.mjs` — unit tests for fallback and language mapping behavior.

### Scope note

This work spans two subsystems (extension + Electron). They stay independent at runtime, and each task below is scoped so it can be completed and validated independently.

### Task 1: Extension locale foundation + manifest wiring

**Files:**
- Create: `extension/extension/_locales/en/messages.json`
- Create: `extension/extension/_locales/es/messages.json`
- Create: `extension/extension/_locales/fr/messages.json`
- Create: `extension/extension/_locales/de/messages.json`
- Create: `extension/extension/_locales/hi/messages.json`
- Modify: `extension/extension/manifest.json`
- Modify: `tests/extension/manifest.vt.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/extension/manifest.vt.test.mjs
test("manifest uses chrome i18n extension name and default locale", () => {
  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.name, "__MSG_extension_name__");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/extension/manifest.vt.test.mjs`
Expected: FAIL because `default_locale` and i18n token are not present yet.

- [ ] **Step 3: Write minimal implementation**

```json
// extension/extension/manifest.json
{
  "manifest_version": 3,
  "name": "__MSG_extension_name__",
  "default_locale": "en"
}
```

```json
// extension/extension/_locales/en/messages.json
{
  "extension_name": { "message": "R.E.I. Risk Evaluation Intelligence" }
}
```

```json
// extension/extension/_locales/es/messages.json
{
  "extension_name": { "message": "R.E.I. Inteligencia de Evaluación de Riesgos" }
}
```

```json
// extension/extension/_locales/fr/messages.json
{
  "extension_name": { "message": "R.E.I. Intelligence d'Évaluation des Risques" }
}
```

```json
// extension/extension/_locales/de/messages.json
{
  "extension_name": { "message": "R.E.I. Risiko-Bewertungs-Intelligenz" }
}
```

```json
// extension/extension/_locales/hi/messages.json
{
  "extension_name": { "message": "R.E.I. जोखिम मूल्यांकन इंटेलिजेंस" }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/extension/manifest.vt.test.mjs`
Expected: PASS with both manifest locale assertions passing.

- [ ] **Step 5: Commit**

```bash
git add extension/extension/manifest.json extension/extension/_locales tests/extension/manifest.vt.test.mjs
git commit -m "feat(extension): add chrome locale bundles and manifest locale wiring"
```

### Task 2: Extension UI localization + runtime language switch

**Files:**
- Create: `extension/extension/scripts/i18n.js`
- Modify: `extension/extension/popup.html`
- Modify: `extension/extension/scripts/popup.js`
- Modify: `extension/extension/blocked.html`
- Modify: `extension/extension/scripts/blocked.js`
- Modify: `extension/extension/scripts/content.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/extension/popup.vt.test.mjs
test("formatLatestUrlScanResult localizes labels through translator", () => {
  const fakeT = (k) => ({ url_label: "URL", malicious_label: "Malicioso" }[k] || k);
  const text = formatLatestUrlScanResult({ url: "https://x.test", vt_malicious: 3 }, fakeT);
  assert.match(text, /Malicioso:\s*3/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/extension/popup.vt.test.mjs`
Expected: FAIL because `formatLatestUrlScanResult` does not accept translator yet.

- [ ] **Step 3: Write minimal implementation**

```js
// extension/extension/scripts/i18n.js
const SUPPORTED_LANGS = ["en", "es", "fr", "de", "hi"];
const DEFAULT_LANG = "en";
let activeLang = DEFAULT_LANG;
let activeDict = {};
let englishDict = null;

async function loadLocaleMessages(lang) {
  const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
  if (!res.ok) throw new Error(`locale load failed: ${lang}`);
  return res.json();
}

function fromLocaleDict(dict, key) {
  return dict?.[key]?.message || "";
}

async function initI18n() {
  const stored = await chrome.storage.local.get(["rei_language"]);
  const selected = SUPPORTED_LANGS.includes(stored.rei_language) ? stored.rei_language : DEFAULT_LANG;
  if (!englishDict) englishDict = await loadLocaleMessages(DEFAULT_LANG);
  activeLang = selected;
  activeDict = selected === DEFAULT_LANG ? englishDict : await loadLocaleMessages(selected);
}

function t(key) {
  const override = fromLocaleDict(activeDict, key);
  if (override) return override;
  const chromeMsg = chrome.i18n?.getMessage?.(key);
  if (chromeMsg) return chromeMsg;
  const en = fromLocaleDict(englishDict, key);
  return en || key;
}

async function setLanguage(lang) {
  const next = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
  activeLang = next;
  activeDict = next === DEFAULT_LANG ? englishDict : await loadLocaleMessages(next);
  await chrome.storage.local.set({ rei_language: next });
}

window.reiExtI18n = { initI18n, setLanguage, t };
```

```html
<!-- extension/extension/popup.html -->
<label for="languageSelector" data-i18n="popup_language_label"></label>
<select id="languageSelector">
  <option value="en">English</option>
  <option value="es">Español</option>
  <option value="fr">Français</option>
  <option value="de">Deutsch</option>
  <option value="hi">हिन्दी</option>
</select>
```

```js
// extension/extension/scripts/popup.js (key integration points)
const { initI18n, setLanguage, t } = window.reiExtI18n;

function applyDataI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}

function formatLatestUrlScanResult(result, translator = t) {
  if (!result || !result.url) return translator("popup_no_url_scan_result");
  return [
    `${translator("url_label")}: ${result.url}`,
    `${translator("risk_label")}: ${result.combined_risk_level || result.risk_level || "LOW"}`,
    `${translator("malicious_label")}: ${Number(result.vt_malicious ?? result.malicious_count ?? 0)}`
  ].join("\n");
}
```

```js
// extension/extension/scripts/content.js (risk title only)
const title = `${t("extension_warning_prefix")} ${t(`risk_${result.risk_level.toLowerCase()}`)} ${t("extension_warning_suffix")}`;
```

```js
// extension/extension/scripts/blocked.js (DOM translation hook)
document.querySelectorAll("[data-i18n]").forEach((el) => {
  el.textContent = t(el.dataset.i18n);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/extension/popup.vt.test.mjs tests/extension/background.vt.test.mjs tests/extension/manifest.vt.test.mjs`
Expected: PASS with localization-aware popup formatter and no background regression.

- [ ] **Step 5: Commit**

```bash
git add extension/extension/scripts/i18n.js extension/extension/popup.html extension/extension/scripts/popup.js extension/extension/blocked.html extension/extension/scripts/blocked.js extension/extension/scripts/content.js extension/extension/_locales tests/extension/popup.vt.test.mjs
git commit -m "feat(extension): localize popup blocked page and content warnings with runtime language override"
```

### Task 3: Electron i18n runtime + locale bundles

**Files:**
- Create: `rei_control_center_electron/locales/en.json`
- Create: `rei_control_center_electron/locales/es.json`
- Create: `rei_control_center_electron/locales/fr.json`
- Create: `rei_control_center_electron/locales/de.json`
- Create: `rei_control_center_electron/locales/hi.json`
- Create: `rei_control_center_electron/renderer/i18n.js`
- Modify: `rei_control_center_electron/main.js`
- Create: `rei_control_center_electron/tests/i18n.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// rei_control_center_electron/tests/i18n.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveLanguage, createTranslator } = require("../renderer/i18n.js");

test("resolveLanguage maps navigator language and falls back to en", () => {
  assert.equal(resolveLanguage("es-ES"), "es");
  assert.equal(resolveLanguage("hi-IN"), "hi");
  assert.equal(resolveLanguage("pt-BR"), "en");
});

test("translator falls back to english key when active locale key missing", () => {
  const t = createTranslator({ dashboard: "Tablero" }, { dashboard: "Dashboard", settings: "Settings" });
  assert.equal(t("dashboard"), "Tablero");
  assert.equal(t("settings"), "Settings");
  assert.equal(t("missing_key"), "missing_key");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `Set-Location rei_control_center_electron; npm test`
Expected: FAIL because `renderer/i18n.js` and exports do not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// rei_control_center_electron/renderer/i18n.js
const SUPPORTED = ["en", "es", "fr", "de", "hi"];
const cache = new Map();

function resolveLanguage(raw) {
  const base = String(raw || "").toLowerCase().split("-")[0];
  return SUPPORTED.includes(base) ? base : "en";
}

function createTranslator(active, fallbackEn) {
  return (key) => active?.[key] || fallbackEn?.[key] || key;
}

async function loadLocale(lang) {
  const key = resolveLanguage(lang);
  if (cache.has(key)) return cache.get(key);
  const data = await fetch(`locales/${key}.json`).then((r) => r.json());
  cache.set(key, data);
  return data;
}

window.reiI18n = { resolveLanguage, createTranslator, loadLocale };
if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveLanguage, createTranslator, loadLocale };
}
```

```js
// rei_control_center_electron/main.js
const SETTINGS_DEFAULTS = {
  virustotalApiKey: "",
  enableUrlScanning: true,
  enableFileScanning: true,
  enableReputationTracking: true,
  language: ""
};
```

```json
// rei_control_center_electron/locales/en.json
{
  "sidebar_overview": "Overview",
  "sidebar_live_protection": "Live Protection",
  "sidebar_threat_timeline": "Threat Timeline",
  "sidebar_reputation_intelligence": "Reputation Intelligence",
  "sidebar_scan_center": "Scan Center",
  "sidebar_reports": "Reports",
  "sidebar_settings": "Settings"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `Set-Location rei_control_center_electron; npm test`
Expected: PASS including new i18n tests and existing test suite.

- [ ] **Step 5: Commit**

```bash
git add rei_control_center_electron/locales rei_control_center_electron/renderer/i18n.js rei_control_center_electron/main.js rei_control_center_electron/tests/i18n.test.mjs
git commit -m "feat(electron): add renderer i18n engine with locale bundles and language defaults"
```

### Task 4: Electron UI integration + runtime language selector

**Files:**
- Modify: `rei_control_center_electron/index.html`
- Modify: `rei_control_center_electron/renderer.js`

- [ ] **Step 1: Write the failing test**

```js
// rei_control_center_electron/tests/renderer-router.test.mjs
test("state bus can store language setting without breaking merge semantics", () => {
  const bus = createStateBus();
  bus.update({ settings: { language: "fr" } });
  assert.equal(bus.getState().settings.language, "fr");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `Set-Location rei_control_center_electron; npm test`
Expected: FAIL after adding assertions for language-aware initialization paths not yet wired in renderer.

- [ ] **Step 3: Write minimal implementation**

```html
<!-- rei_control_center_electron/index.html -->
<span data-i18n="sidebar_overview">Overview</span>
<span data-i18n="sidebar_live_protection">Live Protection</span>
```

```js
// rei_control_center_electron/renderer.js (integration points)
const { resolveLanguage, loadLocale, createTranslator } = window.reiI18n;

let currentLanguage = "en";
let t = (key) => key;

async function initI18n() {
  const settings = await window.rei.getSettings();
  const initial = settings?.language ? resolveLanguage(settings.language) : resolveLanguage(navigator.language);
  const en = await loadLocale("en");
  const active = await loadLocale(initial);
  t = createTranslator(active, en);
  currentLanguage = initial;
  applyI18n();
  if (!settings?.language) {
    await window.rei.saveSettings({ ...settings, language: initial });
  }
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}

async function onPanelLanguageChange(lang) {
  const target = resolveLanguage(lang);
  const en = await loadLocale("en");
  const active = await loadLocale(target);
  t = createTranslator(active, en);
  currentLanguage = target;
  await window.rei.saveSettings({ language: target });
  initPage(activePage);
  applyI18n();
}
```

```html
<!-- renderer settings template in renderer.js -->
<label for="panelLanguageSelector">${t("settings_language_label")}</label>
<select id="panelLanguageSelector">
  <option value="en">English</option>
  <option value="es">Español</option>
  <option value="fr">Français</option>
  <option value="de">Deutsch</option>
  <option value="hi">हिन्दी</option>
</select>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `Set-Location rei_control_center_electron; npm test`
Expected: PASS with language selector and localization wiring in renderer while preserving existing route/timer behavior.

- [ ] **Step 5: Commit**

```bash
git add rei_control_center_electron/index.html rei_control_center_electron/renderer.js rei_control_center_electron/tests/renderer-router.test.mjs
git commit -m "feat(electron): localize panel UI and add runtime language selector"
```

### Task 5: End-to-end verification and fallback checks

**Files:**
- Modify: `extension/extension/_locales/en/messages.json` (if any missing fallback keys discovered)
- Modify: `rei_control_center_electron/locales/en.json` (if any missing fallback keys discovered)

- [ ] **Step 1: Write failing checks as targeted assertions**

```js
// extension/extension/scripts/popup.js
// Ensure every used key resolves by checking t("key") !== "key" for required list in a lightweight dev assertion helper.
```

```js
// rei_control_center_electron/tests/i18n.test.mjs
test("critical UI keys exist in english fallback", async () => {
  const en = await loadLocale("en");
  for (const key of ["sidebar_overview", "dashboard_cpu_usage", "settings_language_label"]) {
    assert.ok(en[key], `missing english key: ${key}`);
  }
});
```

- [ ] **Step 2: Run tests to observe any missing-key failures**

Run: `node --test tests/extension/*.mjs`
Expected: FAIL only if required fallback keys are missing.

Run: `Set-Location rei_control_center_electron; npm test`
Expected: FAIL only if critical English keys are missing.

- [ ] **Step 3: Implement missing fallback keys**

```json
// Ensure en catalogs include every key used by code.
{
  "settings_language_label": "Language",
  "dashboard_cpu_usage": "CPU Usage"
}
```

- [ ] **Step 4: Run full verification**

Run: `node --test tests/extension/*.mjs`
Expected: PASS (extension tests green).

Run: `Set-Location rei_control_center_electron; npm test`
Expected: PASS (electron tests green).

- [ ] **Step 5: Commit**

```bash
git add extension/extension/_locales/en/messages.json rei_control_center_electron/locales/en.json tests/extension rei_control_center_electron/tests
git commit -m "test: verify i18n fallback coverage across extension and electron panel"
```

