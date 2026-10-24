import { configuredFirebaseProjectId, isIsolatedFirebasePreview } from "./firebaseConfig";
import {
  ANIHUB_FIREBASE_PROJECT_ID,
  evaluateLocalhostGroupingAccess,
} from "./localGroupingDevelopment";

/**
 * Pure capability evaluator.
 *
 * @param {object} params
 * @param {boolean} [params.featureRequested]
 * @param {boolean} [params.isolatedEmulator]
 * @param {boolean} [params.dataCompatibilityRequested]
 * @param {boolean} [params.presentationRequested]
 * @param {boolean} [params.autoReconciliationRequested]
 * @returns {{ dataCompatibility: boolean, presentation: boolean, autoReconciliation: boolean }}
 */
export const evaluateGroupingCapabilities = ({
  featureRequested = false,
  isolatedEmulator = false,
  dataCompatibilityRequested,
  presentationRequested,
  autoReconciliationRequested,
} = {}) => {
  const baseEnabled = featureRequested === true && isolatedEmulator === true;

  // DATA COMPATIBILITY must remain active whenever existing grouped data may exist in the database.
  const dataCompatibility = typeof dataCompatibilityRequested === "boolean"
    ? dataCompatibilityRequested
    : (isolatedEmulator ? true : (baseEnabled || true));

  // GROUPING PRESENTATION controls UI group cards, group detail views, and manual group editing.
  const presentation = typeof presentationRequested === "boolean"
    ? presentationRequested
    : baseEnabled;

  // AUTOMATIC RECONCILIATION controls background reconciliation, auto-group creation and expansion.
  const autoReconciliation = typeof autoReconciliationRequested === "boolean"
    ? autoReconciliationRequested
    : baseEnabled;

  return {
    dataCompatibility,
    presentation,
    autoReconciliation,
  };
};

/** Legacy single-gate evaluator for backward compatibility. */
export const evaluateAnimeGroupingGate = ({ featureRequested, isolatedEmulator }) => (
  featureRequested === true && isolatedEmulator === true
);

let runtimeOverrides = null;

const getEnvironment = () => (
  (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {}
);

/**
 * Production grouping is an authenticated AniHub capability, not a rollout cohort.
 * Keeping this evaluator pure makes it straightforward to verify that arbitrary
 * existing and future UIDs receive identical capabilities without network state.
 */
export const evaluateProductionGroupingAccess = ({
  isProduction = false,
  projectId = "",
  activeUid = "",
} = {}) => {
  const authenticated = typeof activeUid === "string" && activeUid.trim().length > 0;
  const enabled = isProduction === true
    && projectId === ANIHUB_FIREBASE_PROJECT_ID
    && authenticated;

  return {
    dataCompatibility: true,
    presentation: enabled,
    autoReconciliation: enabled,
  };
};

const getProductionGroupingAccess = (activeUid) => {
  const env = getEnvironment();
  return evaluateProductionGroupingAccess({
    isProduction: env.PROD === true,
    projectId: configuredFirebaseProjectId,
    activeUid,
  });
};

const getTestOverride = (capability) => {
  const env = getEnvironment();
  if (env.MODE !== "test" && env.MODE !== "grouping-preview") return undefined;
  const value = runtimeOverrides?.[capability];
  return typeof value === "boolean" ? value : undefined;
};

export const isLocalhostGroupingDevelopmentEnabled = (activeUid) => {
  const env = getEnvironment();
  const hostname = typeof globalThis.location?.hostname === "string"
    ? globalThis.location.hostname
    : "";

  return evaluateLocalhostGroupingAccess({
    isDevelopment: env.DEV === true && env.MODE === "development",
    isProduction: env.PROD === true,
    hostname,
    projectId: configuredFirebaseProjectId,
    explicitlyEnabled: env.VITE_ENABLE_LOCALHOST_GROUPING === "true",
    allowedUid: env.VITE_LOCALHOST_GROUPING_TEST_UID,
    activeUid,
    emulatorRequested: env.VITE_FIREBASE_USE_EMULATOR === "true",
  });
};

export const setGroupingCapabilityOverrides = (overrides) => {
  runtimeOverrides = overrides ? { ...overrides } : null;
};

export const resetGroupingCapabilityOverrides = () => {
  runtimeOverrides = null;
};

export const isAnimeGroupingEnabled = evaluateAnimeGroupingGate({
  featureRequested: (typeof import.meta !== "undefined" && import.meta.env?.VITE_ENABLE_WATCHLIST_GROUPING === "true"),
  isolatedEmulator: isIsolatedFirebasePreview,
});

export const isGroupingDataCompatibilityEnabled = (activeUid) => {
  void activeUid;
  // Existing grouped data must always remain safe to move or delete, even when
  // presentation/reconciliation are unavailable in an unsupported environment.
  return true;
};

export const isGroupingPresentationEnabled = (activeUid) => {
  const override = getTestOverride("presentation");
  if (override !== undefined) return override;

  const env = getEnvironment();
  if (env.PROD === true) {
    return getProductionGroupingAccess(activeUid).presentation;
  }
  if (env.VITE_ENABLE_GROUPING_PRESENTATION === "false") {
    return false;
  }
  if (isIsolatedFirebasePreview || Boolean(isAnimeGroupingEnabled)) {
    return Boolean(isAnimeGroupingEnabled);
  }
  if (
    isLocalhostGroupingDevelopmentEnabled(activeUid)
    && env.VITE_ENABLE_GROUPING_PRESENTATION === "true"
  ) return true;
  return false;
};

export const isAutomaticReconciliationEnabled = (activeUid) => {
  const override = getTestOverride("autoReconciliation");
  if (override !== undefined) return override;

  const env = getEnvironment();
  if (env.PROD === true) {
    return getProductionGroupingAccess(activeUid).autoReconciliation;
  }
  if (env.VITE_ENABLE_AUTOMATIC_GROUPING === "false") {
    return false;
  }
  if (isIsolatedFirebasePreview || Boolean(isAnimeGroupingEnabled)) {
    return Boolean(isAnimeGroupingEnabled);
  }
  if (
    isLocalhostGroupingDevelopmentEnabled(activeUid)
    && env.VITE_ENABLE_AUTOMATIC_GROUPING === "true"
  ) return true;
  return false;
};

// Compatibility aliases for the approved Phase D Watchlist integration.
export const evaluateWatchlistGroupingGate = evaluateAnimeGroupingGate;
export const isWatchlistGroupingEnabled = isAnimeGroupingEnabled;
