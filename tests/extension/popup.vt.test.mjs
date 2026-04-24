import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { formatLatestUrlScanResult } = require("../../extension/extension/scripts/popup.js");

test("formatLatestUrlScanResult renders core fields", () => {
  const text = formatLatestUrlScanResult({
    url: "https://x.test",
    combined_risk_level: "HIGH",
    vt_malicious: 3,
    vt_suspicious: 1,
    vt_harmless: 9,
    local_model_score: 0.82,
  });
  assert.match(text, /https:\/\/x\.test/);
  assert.match(text, /HIGH/);
  assert.match(text, /Malicious:\s*3/i);
  assert.match(text, /Suspicious:\s*1/i);
  assert.match(text, /Local Model Score:\s*0\.82/i);
});
