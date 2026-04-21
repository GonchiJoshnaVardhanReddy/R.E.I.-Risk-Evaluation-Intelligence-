import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { formatLatestUrlScanResult } = require("../../extension/extension/scripts/popup.js");

test("formatLatestUrlScanResult renders core fields", () => {
  const text = formatLatestUrlScanResult({
    url: "https://x.test",
    risk_level: "MEDIUM",
    malicious_count: 0,
    suspicious_count: 2,
  });
  assert.match(text, /https:\/\/x\.test/);
  assert.match(text, /MEDIUM/);
  assert.match(text, /suspicious/i);
});
