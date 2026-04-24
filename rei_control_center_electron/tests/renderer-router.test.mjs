import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createRouter,
  createStateBus,
  sortDetectionsDescending,
  buildDashboardMetrics,
  buildReputationSummary
} = require("../renderer.js");

test("router unmounts previous page before mounting next page", async () => {
  const calls = [];
  const router = createRouter({
    dashboard: {
      mount: async () => calls.push("mount:dashboard"),
      unmount: () => calls.push("unmount:dashboard")
    },
    status: {
      mount: async () => calls.push("mount:status"),
      unmount: () => calls.push("unmount:status")
    }
  });

  await router.navigate("dashboard");
  await router.navigate("status");
  assert.deepEqual(calls, ["mount:dashboard", "unmount:dashboard", "mount:status"]);
});

test("router destroys page lifecycle on route change", async () => {
  const calls = [];
  const router = createRouter({
    one: {
      mount: ({ lifecycle }) => lifecycle.addCleanup(() => calls.push("cleanup:one")),
      unmount: () => calls.push("unmount:one")
    },
    two: { mount: () => calls.push("mount:two") }
  });
  await router.navigate("one");
  await router.navigate("two");
  assert.deepEqual(calls, ["unmount:one", "cleanup:one", "mount:two"]);
});

test("state bus publishes merged updates to subscribers", () => {
  const bus = createStateBus();
  let snapshot = null;
  const unsubscribe = bus.subscribe((state) => {
    snapshot = state;
  });
  bus.update({ health: { scannerApiReachable: true }, settings: { enableUrlScanning: false } });
  assert.equal(snapshot.health.scannerApiReachable, true);
  assert.equal(snapshot.settings.enableUrlScanning, false);
  assert.ok(snapshot.meta.updatedAt);
  unsubscribe();
});

test("sortDetectionsDescending orders newest events first and keeps invalid timestamps last", () => {
  const sorted = sortDetectionsDescending([
    { timestamp: "2026-04-21T00:01:00Z", sender: "second" },
    { timestamp: "invalid", sender: "invalid" },
    { timestamp: "2026-04-21T00:03:00Z", sender: "latest" }
  ]);

  assert.deepEqual(
    sorted.map((entry) => entry.sender),
    ["latest", "second", "invalid"]
  );
});

test("buildDashboardMetrics computes daily counters, top sender, and platform distribution", () => {
  const metrics = buildDashboardMetrics(
    [
      { timestamp: "2026-04-21T00:01:00Z", sender: "alice@example.com", risk_level: "MEDIUM", platform: "email" },
      { timestamp: "2026-04-21T00:02:00Z", sender: "alice@example.com", risk_level: "HIGH", platform: "whatsapp" },
      { timestamp: "2026-04-21T00:03:00Z", sender: "bob@example.com", risk_level: "LOW", platform: "email" },
      { timestamp: "2026-04-20T23:59:00Z", sender: "legacy@example.com", risk_level: "HIGH", platform: "url" }
    ],
    new Date("2026-04-21T12:00:00Z")
  );

  assert.equal(metrics.detectionsToday, 3);
  assert.equal(metrics.mediumRiskCount, 1);
  assert.equal(metrics.highRiskCount, 1);
  assert.equal(metrics.topSender, "alice@example.com");
  assert.deepEqual(metrics.platformDistribution, {
    email: 2,
    whatsapp: 1
  });
  assert.deepEqual(metrics.riskDistribution, {
    LOW: 1,
    MEDIUM: 1,
    HIGH: 1
  });
});

test("buildReputationSummary returns sorted rows and grouped sender risk counts", () => {
  const summary = buildReputationSummary({
    "medium@example.com": { count: 2, risk_boost: 0.10 },
    "high@example.com": { count: 5, risk_boost: 0.40 },
    "low@example.com": { count: 1, risk_boost: 0.0 }
  });

  assert.deepEqual(
    summary.rows.map((row) => row.id),
    ["high@example.com", "medium@example.com", "low@example.com"]
  );
  assert.deepEqual(summary.senderRiskCounts, {
    LOW: 1,
    MEDIUM: 1,
    HIGH: 1
  });
});
