import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  computeUrlRiskLevel,
  combineRiskLevels,
  computeCombinedUrlScanResult,
  shouldIgnoreUrlForScan,
  shouldSkipDueToCooldown,
  buildVirusTotalSubmitRequest,
  normalizeApiResponse,
  buildLatestUrlScanResult,
} = require("../../extension/extension/scripts/background.js");

test("computeUrlRiskLevel returns HIGH when malicious > 0", () => {
  assert.equal(computeUrlRiskLevel({ malicious: 2, suspicious: 0, harmless: 0 }), "HIGH");
});

test("computeUrlRiskLevel returns MEDIUM when suspicious > 0 and malicious == 0", () => {
  assert.equal(computeUrlRiskLevel({ malicious: 0, suspicious: 3, harmless: 7 }), "MEDIUM");
});

test("computeUrlRiskLevel returns LOW when malicious and suspicious are 0", () => {
  assert.equal(computeUrlRiskLevel({ malicious: 0, suspicious: 0, harmless: 10 }), "LOW");
});

test("shouldIgnoreUrlForScan ignores non-http protocols", () => {
  assert.equal(shouldIgnoreUrlForScan("chrome://extensions"), true);
  assert.equal(shouldIgnoreUrlForScan("file://C:/x.txt"), true);
  assert.equal(shouldIgnoreUrlForScan("https://example.com"), false);
});

test("shouldSkipDueToCooldown skips same URL or global cooldown hits", () => {
  const now = 100_000;
  assert.equal(
    shouldSkipDueToCooldown({
      lastUrl: "https://a.com",
      lastTs: now - 1000,
      currentUrl: "https://a.com",
      now,
      cooldownMs: 20000,
    }),
    true,
  );
  assert.equal(
    shouldSkipDueToCooldown({
      lastUrl: "https://a.com",
      lastTs: now - 1000,
      currentUrl: "https://b.com",
      now,
      cooldownMs: 20000,
    }),
    true,
  );
  assert.equal(
    shouldSkipDueToCooldown({
      lastUrl: "https://a.com",
      lastTs: now - 21000,
      currentUrl: "https://b.com",
      now,
      cooldownMs: 20000,
    }),
    false,
  );
});

test("buildVirusTotalSubmitRequest uses form-encoded body with original URL", () => {
  const req = buildVirusTotalSubmitRequest("https://example.com/path?a=1", "k");
  assert.equal(req.method, "POST");
  assert.equal(req.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.match(req.body, /^url=/);
  assert.equal(decodeURIComponent(req.body.slice(4)), "https://example.com/path?a=1");
});

test("combineRiskLevels returns HIGH if either source is HIGH", () => {
  assert.equal(combineRiskLevels("LOW", "HIGH"), "HIGH");
  assert.equal(combineRiskLevels("HIGH", "LOW"), "HIGH");
  assert.equal(combineRiskLevels("MEDIUM", "HIGH"), "HIGH");
});

test("combineRiskLevels returns MEDIUM if either source is MEDIUM and none HIGH", () => {
  assert.equal(combineRiskLevels("LOW", "MEDIUM"), "MEDIUM");
  assert.equal(combineRiskLevels("MEDIUM", "LOW"), "MEDIUM");
});

test("computeCombinedUrlScanResult merges VT stats with local scanner risk", () => {
  const result = computeCombinedUrlScanResult({
    url: "https://x.test",
    vtStats: { malicious: 0, suspicious: 1, harmless: 12 },
    localRiskLevel: "HIGH",
  });

  assert.equal(result.url, "https://x.test");
  assert.equal(result.virustotal_risk_level, "MEDIUM");
  assert.equal(result.local_risk_level, "HIGH");
  assert.equal(result.risk_level, "HIGH");
  assert.equal(result.malicious_count, 0);
  assert.equal(result.suspicious_count, 1);
  assert.equal(result.harmless_count, 12);
});

test("normalizeApiResponse maps score below 0.55 to LOW", () => {
  const result = normalizeApiResponse({ risk_score: 0.54, risk_level: "HIGH", explanations: [] });
  assert.equal(result.risk_level, "LOW");
});

test("normalizeApiResponse maps score >= 0.55 and < 0.75 to MEDIUM", () => {
  const result = normalizeApiResponse({ risk_score: 0.60, risk_level: "LOW", explanations: [] });
  assert.equal(result.risk_level, "MEDIUM");
});

test("normalizeApiResponse maps score >= 0.75 to HIGH", () => {
  const result = normalizeApiResponse({ risk_score: 0.80, risk_level: "LOW", explanations: [] });
  assert.equal(result.risk_level, "HIGH");
});

test("buildLatestUrlScanResult stores VT and local model score fields", () => {
  const entry = buildLatestUrlScanResult({
    url: "https://x.test",
    vtStats: { malicious: 2, suspicious: 1, harmless: 5 },
    localModelScore: 0.78,
    combinedRiskLevel: "HIGH",
    virustotalRiskLevel: "HIGH",
    localRiskLevel: "HIGH",
  });
  assert.equal(entry.url, "https://x.test");
  assert.equal(entry.vt_malicious, 2);
  assert.equal(entry.vt_suspicious, 1);
  assert.equal(entry.vt_harmless, 5);
  assert.equal(entry.local_model_score, 0.78);
  assert.equal(entry.combined_risk_level, "HIGH");
});
