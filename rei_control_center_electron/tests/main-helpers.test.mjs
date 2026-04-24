import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const {
  inferExtensionConnectivity,
  inferMonitorRunning,
  inferScannerOnline,
  detectionLogRecentlyUpdated,
  buildStatusPayload,
  getPythonCandidates,
  mergeSettings,
  isSupportedPlatformEvent,
  canStopExternalProcess,
  resolveProjectRoot,
  startService,
  stopService,
  analyzeFile
} = require("../main.js");

test("isSupportedPlatformEvent only accepts whatsapp/email", () => {
  assert.equal(isSupportedPlatformEvent("whatsapp"), true);
  assert.equal(isSupportedPlatformEvent("email"), true);
  assert.equal(isSupportedPlatformEvent("url"), false);
  assert.equal(isSupportedPlatformEvent(""), false);
});

test("inferExtensionConnectivity marks connected for recent whatsapp/email activity", () => {
  const now = new Date("2026-04-21T00:00:00Z").getTime();
  const entries = [
    { platform: "url", timestamp: "2026-04-20T23:58:00Z" },
    { platform: "whatsapp", timestamp: "2026-04-20T23:55:00Z" }
  ];
  const result = inferExtensionConnectivity(entries, now, 10);
  assert.equal(result.connected, true);
  assert.equal(result.lastExtensionEventAt, "2026-04-20T23:55:00.000Z");
});

test("inferExtensionConnectivity marks disconnected when latest event is stale", () => {
  const now = new Date("2026-04-21T00:00:00Z").getTime();
  const entries = [{ platform: "email", timestamp: "2026-04-20T23:40:00Z" }];
  const result = inferExtensionConnectivity(entries, now, 10);
  assert.equal(result.connected, false);
});

test("inferExtensionConnectivity supports metadata.last_extension_activity timestamps", () => {
  const now = new Date("2026-04-21T00:00:00Z").getTime();
  const entries = [
    {
      platform: "url",
      timestamp: "2026-04-20T23:40:00Z",
      metadata: { last_extension_activity: "2026-04-20T23:59:30Z" },
    }
  ];
  const result = inferExtensionConnectivity(entries, now, 2);
  assert.equal(result.connected, true);
  assert.equal(result.lastExtensionEventAt, "2026-04-20T23:59:30.000Z");
});

test("inferMonitorRunning treats recent file detections as an active monitor fallback", () => {
  const now = new Date("2026-04-21T00:00:10Z").getTime();
  const entries = [
    { platform: "email", timestamp: "2026-04-21T00:00:05Z" },
    { platform: "file:pdf", timestamp: "2026-04-21T00:00:04Z" }
  ];
  assert.equal(
    inferMonitorRunning({
      processRunning: false,
      entries,
      nowMs: now,
      thresholdSeconds: 10
    }),
    true
  );
});

test("inferMonitorRunning ignores stale and non-file activity when process is absent", () => {
  const now = new Date("2026-04-21T00:00:20Z").getTime();
  const entries = [
    { platform: "whatsapp", timestamp: "2026-04-21T00:00:15Z" },
    { platform: "file:pdf", timestamp: "2026-04-21T00:00:00Z" }
  ];
  assert.equal(
    inferMonitorRunning({
      processRunning: false,
      entries,
      nowMs: now,
      thresholdSeconds: 10
    }),
    false
  );
});

test("inferScannerOnline falls back to recent detection activity for demo continuity", () => {
  const now = new Date("2026-04-21T00:10:00Z").getTime();
  const entries = [
    { platform: "email", timestamp: "2026-04-21T00:07:30Z" }
  ];
  assert.equal(
    inferScannerOnline({
      portReachable: false,
      entries,
      nowMs: now,
      thresholdMinutes: 5
    }),
    true
  );
});

test("inferScannerOnline stays offline when endpoint is down and detections are stale", () => {
  const now = new Date("2026-04-21T00:10:00Z").getTime();
  const entries = [
    { platform: "email", timestamp: "2026-04-21T00:01:00Z" }
  ];
  assert.equal(
    inferScannerOnline({
      portReachable: false,
      entries,
      nowMs: now,
      thresholdMinutes: 5
    }),
    false
  );
});

test("buildStatusPayload publishes required runtime keys and backward-compatible aliases", () => {
  const payload = buildStatusPayload({
    scannerOnline: true,
    monitorRunning: false,
    extensionActive: true,
    detLogExists: true,
    repDbExists: false,
    lastExtensionEventAt: "2026-04-21T00:00:00.000Z"
  });

  assert.equal(payload.scannerOnline, true);
  assert.equal(payload.monitorRunning, false);
  assert.equal(payload.extensionActive, true);
  assert.equal(payload.scannerUp, true);
  assert.equal(payload.monitorUp, false);
  assert.equal(payload.extensionConnected, true);
  assert.equal(payload.detLogExists, true);
  assert.equal(payload.repDbExists, false);
  assert.equal(payload.lastExtensionEventAt, "2026-04-21T00:00:00.000Z");
});

test("getPythonCandidates prefers explicit env overrides and common local runtimes", () => {
  const candidates = getPythonCandidates(
    {
      REI_PYTHON_EXE: "D:\\custom\\python.exe",
      LOCALAPPDATA: "C:\\Users\\gonch\\AppData\\Local",
    },
    "C:\\Users\\gonch",
  );

  assert.equal(candidates[0].command, "D:\\custom\\python.exe");
  assert.deepEqual(candidates[0].args, []);
  assert.ok(candidates.some((candidate) => candidate.command === "C:\\Users\\gonch\\miniconda3\\envs\\scamshield\\python.exe"));
  assert.ok(candidates.some((candidate) => candidate.command === "C:\\Users\\gonch\\AppData\\Local\\Programs\\Python\\Python314\\python.exe"));
});

test("detectionLogRecentlyUpdated returns true for recent mtime", () => {
  const nowMs = new Date("2026-04-21T00:00:10Z").getTime();
  const recentMtime = new Date("2026-04-21T00:00:04Z").getTime();
  assert.equal(detectionLogRecentlyUpdated(recentMtime, nowMs, 10), true);
});

test("detectionLogRecentlyUpdated returns false for stale mtime", () => {
  const nowMs = new Date("2026-04-21T00:00:10Z").getTime();
  const staleMtime = new Date("2026-04-20T23:59:40Z").getTime();
  assert.equal(detectionLogRecentlyUpdated(staleMtime, nowMs, 10), false);
});

test("mergeSettings applies defaults and keeps explicit false values", () => {
  const result = mergeSettings({
    virustotalApiKey: "abc123",
    enableUrlScanning: false
  });
  assert.equal(result.virustotalApiKey, "abc123");
  assert.equal(result.enableUrlScanning, false);
  assert.equal(result.enableFileScanning, true);
  assert.equal(result.enableReputationTracking, true);
});

test("canStopExternalProcess allows shutdown only for app-owned pids", () => {
  assert.equal(
    canStopExternalProcess({ externalPid: 1234, startedByApp: true }),
    true
  );
  assert.equal(
    canStopExternalProcess({ externalPid: 1234, startedByApp: false }),
    false
  );
});

test("canStopExternalProcess rejects missing or invalid pids", () => {
  assert.equal(canStopExternalProcess({ externalPid: null, startedByApp: true }), false);
  assert.equal(canStopExternalProcess({ externalPid: -1, startedByApp: true }), false);
  assert.equal(canStopExternalProcess({ startedByApp: true }), false);
});

test("resolveProjectRoot falls back to development root when package resources unavailable", () => {
  const devRoot = path.resolve(path.dirname(testDir), "..");
  assert.equal(resolveProjectRoot(false, ""), devRoot);
  assert.equal(resolveProjectRoot(true, "C:\\missing-resources-root"), devRoot);
});

test("startService returns false when child spawn errors", async () => {
  const service = {
    key: "file_monitor",
    marker: `missing-binary-${Date.now()}`,
    command: [`missing-binary-${Date.now()}`],
    process: null,
    externalPid: null,
    startedByApp: false
  };
  const started = await startService(service);
  assert.equal(started, false);
  assert.equal(service.process, null);
  assert.equal(service.startedByApp, false);
});

test("stopService stops app-owned managed services via pid tree", () => {
  let treeStopPid = null;
  let killCalled = false;
  const service = {
    process: { pid: 4242, exitCode: null, kill: () => { killCalled = true; } },
    externalPid: 4242,
    startedByApp: true
  };

  stopService(service, {
    stopProcessTreeByPid(pid) {
      treeStopPid = pid;
    }
  });

  assert.equal(treeStopPid, 4242);
  assert.equal(killCalled, false);
  assert.equal(service.process, null);
  assert.equal(service.externalPid, null);
  assert.equal(service.startedByApp, false);
});

test("analyzeFile reads file through async fs.promises.readFile", async () => {
  const fixturePath = path.join(
    testDir,
    `analyze-file-fixture-${Date.now()}.txt`
  );
  const originalFetch = globalThis.fetch;
  const originalReadFileSync = fs.readFileSync;
  const originalReadFile = fs.promises.readFile;
  let asyncReadCalled = false;

  await writeFile(fixturePath, "fixture");

  fs.readFileSync = () => {
    throw new Error("sync read should not be used");
  };
  fs.promises.readFile = async (...args) => {
    asyncReadCalled = true;
    return originalReadFile(...args);
  };
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { ok: true };
    }
  });

  try {
    const result = await analyzeFile(fixturePath);
    assert.equal(asyncReadCalled, true);
    assert.deepEqual(result, { ok: true });
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.promises.readFile = originalReadFile;
    globalThis.fetch = originalFetch;
    await rm(fixturePath, { force: true });
  }
});
