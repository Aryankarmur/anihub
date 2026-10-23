import { isIsolatedFirebasePreview } from "./firebaseConfig";
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

export const isGroupingDataCompatibilityEnabled = () => {
  if (runtimeOverrides && typeof runtimeOverrides.dataCompatibility === "boolean") {
    return runtimeOverrides.dataCompatibility;
  }
  const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};
  if (env.VITE_ENABLE_GROUPING_DATA_COMPATIBILITY === "false") {
    return false;
  }
  if (isIsolatedFirebasePreview || Boolean(isAnimeGroupingEnabled)) {
    return true;
  }
  return getProductionCapabilities().dataCompatibility;
};

export const isGroupingPresentationEnabled = () => {
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
  return getProductionCapabilities().presentation;
};

export const isAutomaticReconciliationEnabled = () => {
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
