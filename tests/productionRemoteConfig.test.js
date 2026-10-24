import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/firebase/firebaseConfig.js", () => ({
  default: { name: "test-app" },
  configuredFirebaseProjectId: "anihub-73f72",
  isIsolatedFirebasePreview: false,
}));

import {
  getProductionCapabilities,
  resetProductionActivation,
  resolveProductionCapabilities,
  setProductionActiveUser,
} from "../src/firebase/productionActivation.js";
import {
  GROUPING_REMOTE_CONFIG_DEFAULTS,
  GROUPING_REMOTE_CONFIG_KEYS,
  evaluateProductionRemoteConfigEnvironment,
  initializeProductionGroupingRemoteConfig,
  parseCanaryUids,
} from "../src/firebase/productionRemoteConfig.js";

const createSdk = (values = {}) => {
  const remoteConfig = { settings: {}, defaultConfig: {} };
  return {
    remoteConfig,
    isSupported: vi.fn().mockResolvedValue(true),
    getRemoteConfig: vi.fn(() => remoteConfig),
    fetchAndActivate: vi.fn().mockResolvedValue(true),
    getBoolean: vi.fn((_instance, key) => Boolean(values[key])),
    getNumber: vi.fn((_instance, key) => Number(values[key] ?? 0)),
    getString: vi.fn((_instance, key) => String(values[key] ?? "")),
  };
};

describe("production grouping Remote Config", () => {
  beforeEach(() => {
    resetProductionActivation();
  });

  it("initializes only for anihub-73f72 production without emulators", () => {
    expect(evaluateProductionRemoteConfigEnvironment({
      isProduction: true,
      projectId: "anihub-73f72",
    })).toEqual({ enabled: true, reason: "approved_production" });

    expect(evaluateProductionRemoteConfigEnvironment({
      isProduction: false,
      projectId: "anihub-73f72",
    }).enabled).toBe(false);
    expect(evaluateProductionRemoteConfigEnvironment({
      isProduction: true,
      projectId: "other-project",
    }).enabled).toBe(false);
    expect(evaluateProductionRemoteConfigEnvironment({
      isProduction: true,
      projectId: "anihub-73f72",
      emulatorRequested: true,
    }).enabled).toBe(false);
  });

  it("fetches, activates, and applies general availability parameters", async () => {
    const sdk = createSdk({
      [GROUPING_REMOTE_CONFIG_KEYS.presentation]: true,
      [GROUPING_REMOTE_CONFIG_KEYS.autoReconciliation]: true,
      [GROUPING_REMOTE_CONFIG_KEYS.emergencyStop]: false,
      [GROUPING_REMOTE_CONFIG_KEYS.rolloutPercentage]: 100,
      [GROUPING_REMOTE_CONFIG_KEYS.canaryPercentage]: 0,
      [GROUPING_REMOTE_CONFIG_KEYS.canaryUids]: "[]",
    });

    const result = await initializeProductionGroupingRemoteConfig({
      env: { PROD: true, VITE_FIREBASE_USE_EMULATOR: "false" },
      projectId: "anihub-73f72",
      firebaseApp: { name: "production-app" },
      sdk,
    });

    expect(result.status).toBe("ready");
    expect(sdk.isSupported).toHaveBeenCalledOnce();
    expect(sdk.getRemoteConfig).toHaveBeenCalledOnce();
    expect(sdk.fetchAndActivate).toHaveBeenCalledWith(sdk.remoteConfig);
    expect(sdk.remoteConfig.defaultConfig).toEqual(GROUPING_REMOTE_CONFIG_DEFAULTS);
    expect(sdk.remoteConfig.settings.fetchTimeoutMillis).toBe(8_000);
    expect(sdk.remoteConfig.settings.minimumFetchIntervalMillis).toBe(300_000);

    // 100% is general availability and does not depend on an allowlist or on
    // when the account was registered.
    setProductionActiveUser({ uid: "existing-user" });
    expect(getProductionCapabilities().presentation).toBe(true);
    expect(getProductionCapabilities().autoReconciliation).toBe(true);
    setProductionActiveUser({ uid: "future-user" });
    expect(getProductionCapabilities().presentation).toBe(true);
    expect(getProductionCapabilities().autoReconciliation).toBe(true);
    expect(getProductionCapabilities().reason).toBe("general_availability_active");
  });

  it("fails closed when the fetch fails", async () => {
    const sdk = createSdk();
    sdk.fetchAndActivate.mockRejectedValue(new Error("offline"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await initializeProductionGroupingRemoteConfig({
      env: { PROD: true },
      projectId: "anihub-73f72",
      sdk,
    });

    expect(result.status).toBe("failed");
    expect(getProductionCapabilities()).toMatchObject({
      dataCompatibility: true,
      presentation: false,
      autoReconciliation: false,
      reason: "remote_config_error_fallback",
    });
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("keeps cleanup compatibility enabled under every emergency-stop configuration", () => {
    expect(resolveProductionCapabilities({
      remoteConfig: {
        dataCompatibility: false,
        presentation: true,
        autoReconciliation: true,
        rolloutPercentage: 100,
        emergencyStop: true,
      },
    })).toMatchObject({
      dataCompatibility: true,
      presentation: false,
      autoReconciliation: false,
      reason: "emergency_stop_active",
    });
  });

  it("parses a bounded, deduplicated canary UID list", () => {
    expect(parseCanaryUids('["alpha", "beta", "alpha", 42]')).toEqual(["alpha", "beta"]);
    expect(parseCanaryUids(" alpha, beta, alpha ")).toEqual(["alpha", "beta"]);
    expect(parseCanaryUids("x".repeat(20_001))).toEqual([]);
  });
});
