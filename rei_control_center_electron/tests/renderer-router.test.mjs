import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createRouter, createStateBus } = require("../renderer.js");

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
