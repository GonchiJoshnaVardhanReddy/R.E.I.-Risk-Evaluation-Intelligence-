import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(testDir, "..");
const packagePath = path.join(appDir, "package.json");
const mainPath = path.join(appDir, "main.js");

test("package.json defines start script and windows build target", async () => {
  const raw = await readFile(packagePath, "utf8");
  const pkg = JSON.parse(raw);

  assert.equal(pkg.main, "main.js");
  assert.equal(pkg.scripts.start, "electron .");
  assert.equal(pkg.scripts.build, "electron-builder --win");
  assert.equal(pkg.build.productName, "REI_Control_Center");
  assert.ok(pkg.build.win.target.includes("nsis"));
  assert.equal(pkg.build.win.artifactName, "REI_Control_Center.exe");
  assert.ok(Array.isArray(pkg.build.extraResources));
  const destinations = pkg.build.extraResources.map((entry) => entry.to);
  assert.ok(destinations.includes("backend/rei_scanner_api.py"));
  assert.ok(destinations.includes("backend/file_monitor.py"));
  assert.ok(destinations.includes("backend/rei_model"));
  assert.ok(destinations.includes("backend/detection_log.json"));
  assert.ok(destinations.includes("backend/reputation_db.json"));
});

test("main.js includes secure BrowserWindow options", async () => {
  const raw = await readFile(mainPath, "utf8");
  assert.match(raw, /width:\s*1200/u);
  assert.match(raw, /height:\s*800/u);
  assert.match(raw, /nodeIntegration:\s*false/u);
  assert.match(raw, /contextIsolation:\s*true/u);
  assert.match(raw, /title:\s*"R\.E\.I\. Control Center"/u);
});
