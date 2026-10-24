import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/firebase/firebaseConfig.js", () => ({
  configuredFirebaseProjectId: "anihub-73f72",
  isIsolatedFirebasePreview: false,
}));

import {
  evaluateProductionGroupingAccess,
  isAutomaticReconciliationEnabled,
  isGroupingDataCompatibilityEnabled,
  isGroupingPresentationEnabled,
  resetGroupingCapabilityOverrides,
  setGroupingCapabilityOverrides,
} from "../src/firebase/groupingFeatureGate.js";

describe("production grouping activation", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetGroupingCapabilityOverrides();
    vi.stubEnv("DEV", false);
    vi.stubEnv("PROD", true);
    vi.stubEnv("MODE", "production");
  });

  it("enables presentation and reconciliation for arbitrary authenticated users", () => {
    for (const uid of ["existing-user", "future-user", "another-valid-user"]) {
      expect(isGroupingPresentationEnabled(uid)).toBe(true);
      expect(isAutomaticReconciliationEnabled(uid)).toBe(true);
      expect(isGroupingDataCompatibilityEnabled(uid)).toBe(true);
    }
  });

  it("does not enable user-specific grouping operations without authentication", () => {
    for (const uid of [undefined, null, "", "   "]) {
      expect(isGroupingPresentationEnabled(uid)).toBe(false);
      expect(isAutomaticReconciliationEnabled(uid)).toBe(false);
      expect(isGroupingDataCompatibilityEnabled(uid)).toBe(true);
    }
  });

  it("fails closed for a production build pointed at an unexpected Firebase project", () => {
    expect(evaluateProductionGroupingAccess({
      isProduction: true,
      projectId: "not-anihub-production",
      activeUid: "authenticated-user",
    })).toEqual({
      dataCompatibility: true,
      presentation: false,
      autoReconciliation: false,
    });
  });

  it("does not honor rollout-style test overrides in production mode", () => {
    setGroupingCapabilityOverrides({
      dataCompatibility: false,
      presentation: false,
      autoReconciliation: false,
    });

    expect(isGroupingDataCompatibilityEnabled("authenticated-user")).toBe(true);
    expect(isGroupingPresentationEnabled("authenticated-user")).toBe(true);
    expect(isAutomaticReconciliationEnabled("authenticated-user")).toBe(true);
  });

  it("resolves production grouping without a Remote Config network request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(isGroupingPresentationEnabled("authenticated-user")).toBe(true);
    expect(isAutomaticReconciliationEnabled("authenticated-user")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
