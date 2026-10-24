import { configuredFirebaseProjectId, isIsolatedFirebasePreview } from "./firebaseConfig";
import { evaluateLocalhostGroupingAccess } from "./localGroupingDevelopment";
import {
  DEFAULT_PRODUCTION_CAPABILITIES,
  getProductionCapabilities,
  hashUidToPercent,
  isUserEligibleForCanary,
  resolveProductionCapabilities,
  setProductionRemoteConfig,
  setProductionRemoteConfigError,
  setProductionActiveUser,
  resetProductionActivation,
} from "./productionActivation";

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
  if (runtimeOverrides && typeof runtimeOverrides.dataCompatibility === "boolean") {
    return runtimeOverrides.dataCompatibility;
  }
  const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};
  // Production cleanup compatibility is deliberately not remotely or
  // environmentally disableable. It is required to safely move/delete data
  // created while presentation or reconciliation was enabled.
  if (env.PROD === true) {
    return getProductionCapabilities().dataCompatibility;
  }
  if (env.VITE_ENABLE_GROUPING_DATA_COMPATIBILITY === "false") {
    return false;
  }
  if (isIsolatedFirebasePreview || Boolean(isAnimeGroupingEnabled)) {
    return true;
  }
  if (
    isLocalhostGroupingDevelopmentEnabled(activeUid)
    && env.VITE_ENABLE_GROUPING_DATA_COMPATIBILITY === "true"
  ) return true;
  return getProductionCapabilities().dataCompatibility;
};

export const isGroupingPresentationEnabled = (activeUid) => {
  if (runtimeOverrides && typeof runtimeOverrides.presentation === "boolean") {
    return runtimeOverrides.presentation;
  }
  const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};
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
  return getProductionCapabilities().presentation;
};

export const isAutomaticReconciliationEnabled = (activeUid) => {
  if (runtimeOverrides && typeof runtimeOverrides.autoReconciliation === "boolean") {
    return runtimeOverrides.autoReconciliation;
  }
  const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};
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
  return getProductionCapabilities().autoReconciliation;
};

// Re-export production activation helpers
export {
  DEFAULT_PRODUCTION_CAPABILITIES,
  hashUidToPercent,
  isUserEligibleForCanary,
  resolveProductionCapabilities,
  setProductionRemoteConfig,
  setProductionRemoteConfigError,
  setProductionActiveUser,
  resetProductionActivation,
  getProductionCapabilities,
};

// Compatibility aliases for the approved Phase D Watchlist integration.
export const evaluateWatchlistGroupingGate = evaluateAnimeGroupingGate;
export const isWatchlistGroupingEnabled = isAnimeGroupingEnabled;
