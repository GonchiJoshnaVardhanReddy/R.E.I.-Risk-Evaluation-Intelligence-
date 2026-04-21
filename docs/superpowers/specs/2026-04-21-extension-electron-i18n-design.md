# Extension + Electron i18n Design

## Goal

Add multilingual UI localization for:

1. Chrome extension (`extension/extension`)
2. Electron control panel (`rei_control_center_electron`)

Supported initial languages:

- English (`en`, default)
- Spanish (`es`)
- French (`fr`)
- German (`de`)
- Hindi (`hi`)

This design only localizes UI strings and does not change backend logic, IPC architecture, or detection pipeline behavior.

## Scope

### In scope

- Chrome extension manifest localization wiring and `_locales` bundles
- Extension UI text localization across popup, content warning UI, and blocked page
- Runtime language override in extension via `rei_language` setting (with browser-locale default behavior)
- Electron locale files and renderer-side i18n runtime
- Electron runtime language switch in Settings and persisted preference
- First-run auto-detect from system/browser locale with safe fallback to English
- Fallback mechanism for missing keys

### Out of scope

- Translating backend-provided detection explanations or model-generated text
- Any changes to scan logic, thresholds, request flow, storage schema beyond adding language preference
- Any backend API/IPC channel redesign

## High-level Architecture

## Chrome extension i18n

### Files

- Create: `extension/extension/_locales/en/messages.json`
- Create: `extension/extension/_locales/es/messages.json`
- Create: `extension/extension/_locales/fr/messages.json`
- Create: `extension/extension/_locales/de/messages.json`
- Create: `extension/extension/_locales/hi/messages.json`
- Modify: `extension/extension/manifest.json`
- Modify: `extension/extension/popup.html`
- Modify: `extension/extension/blocked.html`
- Modify: `extension/extension/scripts/popup.js`
- Modify: `extension/extension/scripts/content.js`
- Modify: `extension/extension/scripts/blocked.js`

### Design

1. **Chrome-native baseline**
   - `manifest.name` becomes `"__MSG_extension_name__"`.
   - `default_locale` is set to `"en"`.
   - UI uses `chrome.i18n.getMessage(key)` where available.

2. **Runtime override layer**
   - User-selected language stored in `chrome.storage.local` as `rei_language`.
   - If selected language differs from browser locale, load corresponding `_locales/<lang>/messages.json` into memory and use it as top-priority lookup.
   - Lookup order:
     1. selected-language dictionary
     2. `chrome.i18n.getMessage(key)`
     3. English dictionary
     4. key name

3. **Popup + blocked page localization**
   - Static nodes use `[data-i18n]` attributes.
   - Dynamic template strings use lookup helper at render time.
   - Add popup language selector with supported languages and persist selection.

4. **Content warning localization**
   - Warning title labels and risk caption UI become localized through helper.
   - Existing risk level tokens (`LOW/MEDIUM/HIGH`) remain logic tokens and are mapped to localized display labels.

## Electron panel i18n

### Files

- Create: `rei_control_center_electron/locales/en.json`
- Create: `rei_control_center_electron/locales/es.json`
- Create: `rei_control_center_electron/locales/fr.json`
- Create: `rei_control_center_electron/locales/de.json`
- Create: `rei_control_center_electron/locales/hi.json`
- Create: `rei_control_center_electron/renderer/i18n.js`
- Modify: `rei_control_center_electron/index.html`
- Modify: `rei_control_center_electron/renderer.js`
- Modify: `rei_control_center_electron/main.js` (settings defaults only, no IPC redesign)

### Design

1. **Renderer i18n module**
   - `loadLanguage(lang)` loads locale JSON once and caches it.
   - `setLanguage(lang)` switches active language and reapplies localized nodes.
   - `t(key)` returns localized string using fallback chain:
     1. active language key
     2. English key
     3. key

2. **Startup language resolution**
   - Read persisted `settings.language` via existing settings flow.
   - If absent, map `navigator.language` to supported language and default to `en`.
   - Persist resolved language to settings to make behavior stable across launches.

3. **UI integration**
   - Sidebar labels, header status text, dashboard labels/cards/charts/alerts, settings labels, scan/report labels use translation keys.
   - For HTML generated via template literals in `renderer.js`, apply `t()` directly while generating markup and/or include `data-i18n` for reusable static parts.

4. **Settings language selector**
   - Add `panelLanguageSelector` in settings section.
   - On change, save via existing `saveSettings` payload with `language` key.
   - Re-render visible UI immediately without reload.

## Key Strategy

Use stable semantic keys (not English text as key), grouped by domain:

- `common.*` (buttons/status words)
- `sidebar.*`
- `header.*`
- `dashboard.*`
- `alerts.*`
- `settings.*`
- `scan.*`
- `reports.*`
- `extension.popup.*`
- `extension.blocked.*`
- `extension.warning.*`

This keeps adding new languages as “drop in new locale file with same keys.”

## Data Flow and Performance

1. Load locale bundle once per language and cache in memory.
2. UI update is text replacement only, no blocking network dependencies during status/IPC updates.
3. Existing timers/refresh loops remain intact; localization should not register competing intervals.
4. Missing translation never throws; always resolves through fallback chain.

## Error Handling

- If locale file load fails:
  - log warning
  - keep current language if possible, else fallback to English
- If a key is missing in selected locale:
  - use English translation
- If missing in English:
  - display key as last resort (debug-visible fallback)

## Testing Plan

1. **Extension**
   - Update manifest tests for `default_locale` and localized name token.
   - Keep existing background/popup logic tests passing.
   - Add targeted tests for localization helper fallback behavior where feasible.

2. **Electron**
   - Add renderer-level unit tests (or pure-function tests) for i18n lookup/fallback.
   - Keep existing renderer-router and main helper tests passing.

3. **Command-level validation**
   - Run repository tests already present for extension and electron modules after integration.

## Rollout Notes

- Existing stored settings remain valid; language defaults gracefully when absent.
- No migration required for detection log, reputation DB, or scan payloads.
