(function bootstrapSystemMetrics(globalScope) {
  let mockNetworkMbps = 18;
  let reportedBridgeError = false;

  function nextMockNetwork() {
    const drift = (Math.random() * 8) - 4;
    mockNetworkMbps = Math.max(0, Math.min(100, mockNetworkMbps + drift));
    return Number(mockNetworkMbps.toFixed(1));
  }

  async function getSnapshot() {
    if (globalScope.rei && typeof globalScope.rei.getSystemMetrics === "function") {
      try {
        const metrics = globalScope.rei.getSystemMetrics();
        const cpuPercent = Number(metrics?.cpuPercent || 0);
        const ramPercent = Number(metrics?.ramPercent || 0);
        const networkThroughputMbps = Number.isFinite(Number(metrics?.networkThroughputMbps))
          ? Number(metrics.networkThroughputMbps)
          : nextMockNetwork();
        return {
          cpuPercent: Math.max(0, Math.min(cpuPercent, 100)),
          ramPercent: Math.max(0, Math.min(ramPercent, 100)),
          networkThroughputMbps,
        };
      } catch (error) {
        if (!reportedBridgeError) {
          reportedBridgeError = true;
          console.warn("[Metrics] Falling back to mock values:", error?.message || error);
        }
      }
    }

    return {
      cpuPercent: Number((Math.random() * 60).toFixed(1)),
      ramPercent: Number((35 + Math.random() * 55).toFixed(1)),
      networkThroughputMbps: nextMockNetwork(),
    };
  }

  globalScope.reiSystemMetrics = { getSnapshot };
})(window);
