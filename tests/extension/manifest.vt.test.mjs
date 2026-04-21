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
  assert.equal(manifest.name, "R.E.I. Risk Evaluation Intelligence");
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
