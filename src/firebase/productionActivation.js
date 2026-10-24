/**
 * productionActivation.js — AniHub F01 Production Capability & Rollout Management
 *
 * Implements safe, deliberate production capability resolution for AniHub F01.
 *
 * Core architectural principles:
 * 1. Safe Defaults: By default in production, Grouping Presentation and Automatic
 *    Reconciliation are DISABLED (fail-closed).
 * 2. Data Compatibility Invariant: Data Compatibility remains ENABLED by default in
 *    production so that any existing grouped data can be moved or deleted without
 *    data corruption.
 * 3. Fail-Closed Remote Config: If remote configuration is unavailable, times out,
 *    or errors, the system falls back safely to disabled presentation/reconciliation
 *    while preserving data compatibility.
 * 4. Deterministic Canary Cohorts: Rollout percentage is evaluated using a stable
 *    hash of the user's UID (no arbitrary localStorage flags).
 * 5. Authorization Boundary: Firestore Security Rules remain the ultimate security
 *    boundary. Client capability flags never grant unauthorized access.
 */

export const DEFAULT_PRODUCTION_CAPABILITIES = Object.freeze({
  dataCompatibility: true,
  presentation: false,
  autoReconciliation: false,
});

/**
 * Deterministically hash a string (UID) to an integer in [0, 99].
 * Uses a 32-bit FNV-1a variant for uniform distribution.
 *
 * @param {string} uid
 * @returns {number} integer 0 to 99
 */
export const hashUidToPercent = (uid) => {
  if (!uid || typeof uid !== "string") return 0;
  let hash = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    hash ^= uid.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
};

/**
 * Determine if a user qualifies for the canary cohort.
 *
 * @param {object} params
 * @param {string} [params.uid]
 * @param {object} [params.claims]
 * @param {Array<string>} [params.canaryUids]
 * @param {number} [params.canaryPercentage]
 * @returns {boolean}
 */
export const isUserEligibleForCanary = ({
  uid,
  claims = {},
  canaryUids = [],
  canaryPercentage = 0,
} = {}) => {
  if (!uid || typeof uid !== "string") return false;

  // 1. Explicit Custom Auth Claims (e.g. set by Firebase Admin SDK)
  if (claims?.groupingCanary === true || claims?.admin === true) {
    return true;
  }

  // 2. Explicit Canary Allowlist
  if (Array.isArray(canaryUids) && canaryUids.includes(uid)) {
    return true;
  }

  // 3. Deterministic Percentage Rollout
  const pct = Number(canaryPercentage);
  if (Number.isFinite(pct) && pct > 0) {
    if (pct >= 100) return true;
    return hashUidToPercent(uid) < pct;
  }

  return false;
};

/**
 * Pure evaluator for production capability state.
 *
 * @param {object} params
 * @param {object|null} [params.remoteConfig]
 * @param {object|null} [params.user]
 * @param {Error|string|null} [params.fetchError]
 * @returns {{ dataCompatibility: boolean, presentation: boolean, autoReconciliation: boolean, reason: string }}
 */
export const resolveProductionCapabilities = ({
  remoteConfig = null,
  user = null,
  fetchError = null,
} = {}) => {
  // If remote configuration failed to fetch or is unavailable, fail closed safely.
  if (fetchError || !remoteConfig) {
    return {
      ...DEFAULT_PRODUCTION_CAPABILITIES,
      reason: fetchError ? "remote_config_error_fallback" : "default_production_baseline",
    };
  }

  // Emergency stop trigger
  if (remoteConfig.emergencyStop === true) {
    return {
      // This is deliberately not remotely switchable. Existing grouped data
      // must remain movable/deletable even while all visible grouping and
      // background reconciliation are stopped.
      dataCompatibility: true,
      presentation: false,
      autoReconciliation: false,
      reason: "emergency_stop_active",
    };
  }

  const isEligible = isUserEligibleForCanary({
    uid: user?.uid,
    claims: user?.claims,
    canaryUids: remoteConfig.canaryUids,
    canaryPercentage: remoteConfig.canaryPercentage,
  });

  const isGeneralAvailability = remoteConfig.rolloutPercentage === 100;
  const isTargeted = isEligible || isGeneralAvailability;

  return {
    // Data compatibility is a cleanup/safety invariant, not a rollout flag.
    dataCompatibility: true,
    presentation: isTargeted && remoteConfig.presentation === true,
    autoReconciliation: isTargeted && remoteConfig.autoReconciliation === true,
    reason: isGeneralAvailability
      ? "general_availability_active"
      : (isTargeted ? "canary_cohort_active" : "production_default_inactive"),
  };
};

// ---------------------------------------------------------------------------
// In-Memory Production State Management
// ---------------------------------------------------------------------------

let activeRemoteConfig = null;
let activeRemoteError = null;
let activeUser = null;

export const setProductionRemoteConfig = (config) => {
  activeRemoteConfig = config ? { ...config } : null;
  activeRemoteError = null;
};

export const setProductionRemoteConfigError = (error) => {
  activeRemoteError = error ?? new Error("Remote configuration fetch failed.");
};

export const setProductionActiveUser = (user) => {
  activeUser = user ? { uid: user.uid, claims: user.claims || {} } : null;
};

export const resetProductionActivation = () => {
  activeRemoteConfig = null;
  activeRemoteError = null;
  activeUser = null;
};

export const getProductionCapabilities = () => resolveProductionCapabilities({
  remoteConfig: activeRemoteConfig,
  user: activeUser,
  fetchError: activeRemoteError,
});
