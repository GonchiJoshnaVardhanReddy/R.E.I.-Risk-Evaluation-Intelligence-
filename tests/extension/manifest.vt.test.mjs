import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.resolve(__dirname, "../../extension/extension/manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

test("manifest name/description/version are correct", () => {
  assert.equal(manifest.name, "__MSG_extension_name__");
  assert.equal(
    manifest.description,
    "Offline multi-channel scam detection and website risk intelligence assistant powered by local AI and VirusTotal URL analysis.",
  );
  assert.equal(manifest.version, "1.0.0");
});

test("manifest permissions and hosts include required values", () => {
  for (const permission of ["storage", "tabs", "activeTab", "scripting"]) {
    assert.ok(manifest.permissions.includes(permission));
  }
  for (const hostPermission of ["https://www.virustotal.com/*", "http://127.0.0.1:8000/*", "<all_urls>"]) {
    assert.ok(manifest.host_permissions.includes(hostPermission));
  }
});

test("manifest uses chrome i18n extension default locale", () => {
  // ensure default locale is set to english
  assert.equal(manifest.default_locale, "en");
});

test("locale messages files parse and contain extension_name.message", () => {
  const localesDir = path.resolve(__dirname, "../../extension/extension/_locales");
  const entries = fs.readdirSync(localesDir, { withFileTypes: true });
  const locales = entries.filter((d) => d.isDirectory()).map((d) => d.name);

  // ensure at least english exists
  assert.ok(locales.includes("en"), "default locale 'en' is missing");

  for (const loc of locales) {
    const msgPath = path.join(localesDir, loc, "messages.json");
    assert.ok(fs.existsSync(msgPath), `messages.json missing for locale: ${loc}`);
    const raw = fs.readFileSync(msgPath, "utf8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid JSON in ${msgPath}: ${err.message}`);
    }

    assert.ok(
      data.extension_name && typeof data.extension_name.message === "string",
      `Locale ${loc} missing extension_name.message`
    );
  }
});
