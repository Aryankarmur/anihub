import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/firebase/firebaseConfig", () => ({
  configuredFirebaseProjectId: "anihub-73f72",
  isIsolatedFirebasePreview: false,
}));

import {
  isAutomaticReconciliationEnabled,
  isGroupingDataCompatibilityEnabled,
  isGroupingPresentationEnabled,
} from "../src/firebase/groupingFeatureGate";

describe("localhost grouping feature gate", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("DEV", true);
    vi.stubEnv("PROD", false);
    vi.stubEnv("MODE", "development");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "anihub-73f72");
    vi.stubEnv("VITE_FIREBASE_USE_EMULATOR", "false");
    vi.stubEnv("VITE_ENABLE_LOCALHOST_GROUPING", "true");
    vi.stubEnv("VITE_LOCALHOST_GROUPING_TEST_UID", "approved-test-uid");
    vi.stubEnv("VITE_ENABLE_GROUPING_DATA_COMPATIBILITY", "true");
    vi.stubEnv("VITE_ENABLE_GROUPING_PRESENTATION", "true");
    vi.stubEnv("VITE_ENABLE_AUTOMATIC_GROUPING", "true");
  });

  it("requires explicit presentation and automatic-reconciliation capability flags", () => {
    vi.stubEnv("VITE_ENABLE_GROUPING_PRESENTATION", "false");
    vi.stubEnv("VITE_ENABLE_AUTOMATIC_GROUPING", "false");
    expect(isGroupingDataCompatibilityEnabled("approved-test-uid")).toBe(true);
    expect(isGroupingPresentationEnabled("approved-test-uid")).toBe(false);
    expect(isAutomaticReconciliationEnabled("approved-test-uid")).toBe(false);
  });

  it("enables all grouping capabilities only for the approved localhost UID", () => {
    expect(window.location.hostname).toBe("localhost");
    expect(isGroupingDataCompatibilityEnabled("approved-test-uid")).toBe(true);
    expect(isGroupingPresentationEnabled("approved-test-uid")).toBe(true);
    expect(isAutomaticReconciliationEnabled("approved-test-uid")).toBe(true);
    expect(isGroupingPresentationEnabled("another-user")).toBe(false);
    expect(isAutomaticReconciliationEnabled("another-user")).toBe(false);
  });

  it("keeps production builds disabled even when local flags are present", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("PROD", true);
    vi.stubEnv("MODE", "production");
    expect(isGroupingPresentationEnabled("approved-test-uid")).toBe(false);
    expect(isAutomaticReconciliationEnabled("approved-test-uid")).toBe(false);
  });
});
