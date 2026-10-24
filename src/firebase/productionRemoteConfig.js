import {
  fetchAndActivate,
  getBoolean,
  getNumber,
  getRemoteConfig,
  getString,
  isSupported,
} from "firebase/remote-config";
import app, {
  configuredFirebaseProjectId,
  isIsolatedFirebasePreview,
} from "./firebaseConfig";
import {
  setProductionRemoteConfig,
  setProductionRemoteConfigError,
} from "./productionActivation";

export const PRODUCTION_FIREBASE_PROJECT_ID = "anihub-73f72";

export const GROUPING_REMOTE_CONFIG_KEYS = Object.freeze({
  presentation: "anihub_grouping_presentation_enabled",
  autoReconciliation: "anihub_grouping_auto_reconciliation_enabled",
  emergencyStop: "anihub_grouping_emergency_stop",
  rolloutPercentage: "anihub_grouping_rollout_percentage",
  canaryPercentage: "anihub_grouping_canary_percentage",
  canaryUids: "anihub_grouping_canary_uids",
});

export const GROUPING_REMOTE_CONFIG_DEFAULTS = Object.freeze({
  [GROUPING_REMOTE_CONFIG_KEYS.presentation]: false,
  [GROUPING_REMOTE_CONFIG_KEYS.autoReconciliation]: false,
  [GROUPING_REMOTE_CONFIG_KEYS.emergencyStop]: false,
  [GROUPING_REMOTE_CONFIG_KEYS.rolloutPercentage]: 0,
  [GROUPING_REMOTE_CONFIG_KEYS.canaryPercentage]: 0,
  [GROUPING_REMOTE_CONFIG_KEYS.canaryUids]: "[]",
});

const FETCH_TIMEOUT_MILLIS = 8_000;
const MINIMUM_FETCH_INTERVAL_MILLIS = 5 * 60 * 1_000;
const MAX_CANARY_UIDS = 100;
const MAX_UID_LENGTH = 128;

const defaultSdk = {
  fetchAndActivate,
  getBoolean,
  getNumber,
  getRemoteConfig,
  getString,
  isSupported,
};

export const parseCanaryUids = (rawValue) => {
  if (typeof rawValue !== "string" || rawValue.length > 20_000) return [];

  let values;
  try {
    const parsed = JSON.parse(rawValue);
    values = Array.isArray(parsed) ? parsed : [];
  } catch {
    values = rawValue.split(",");
  }

  return [...new Set(values
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= MAX_UID_LENGTH))]
    .slice(0, MAX_CANARY_UIDS);
};

export const evaluateProductionRemoteConfigEnvironment = ({
  isProduction = false,
  projectId,
  isolatedPreview = false,
  emulatorRequested = false,
} = {}) => {
  if (!isProduction) return { enabled: false, reason: "not_production" };
  if (isolatedPreview || emulatorRequested) {
    return { enabled: false, reason: "emulator_or_preview" };
  }
  if (projectId !== PRODUCTION_FIREBASE_PROJECT_ID) {
    return { enabled: false, reason: "unexpected_firebase_project" };
  }
  return { enabled: true, reason: "approved_production" };
};

export const readGroupingRemoteConfig = (remoteConfig, sdk = defaultSdk) => ({
  presentation: sdk.getBoolean(remoteConfig, GROUPING_REMOTE_CONFIG_KEYS.presentation),
  autoReconciliation: sdk.getBoolean(
    remoteConfig,
    GROUPING_REMOTE_CONFIG_KEYS.autoReconciliation,
  ),
  emergencyStop: sdk.getBoolean(remoteConfig, GROUPING_REMOTE_CONFIG_KEYS.emergencyStop),
  rolloutPercentage: sdk.getNumber(
    remoteConfig,
    GROUPING_REMOTE_CONFIG_KEYS.rolloutPercentage,
  ),
  canaryPercentage: sdk.getNumber(
    remoteConfig,
    GROUPING_REMOTE_CONFIG_KEYS.canaryPercentage,
  ),
  canaryUids: parseCanaryUids(
    sdk.getString(remoteConfig, GROUPING_REMOTE_CONFIG_KEYS.canaryUids),
  ),
});

/**
 * Fetch and apply grouping rollout parameters for the approved production app.
 * Development/preview builds never contact Remote Config through this path.
 * Failures are contained and leave presentation/reconciliation fail-closed.
 */
export const initializeProductionGroupingRemoteConfig = async ({
  env = import.meta.env,
  firebaseApp = app,
  projectId = configuredFirebaseProjectId,
  isolatedPreview = isIsolatedFirebasePreview,
  sdk = defaultSdk,
} = {}) => {
  const environment = evaluateProductionRemoteConfigEnvironment({
    isProduction: env?.PROD === true,
    projectId,
    isolatedPreview,
    emulatorRequested: env?.VITE_FIREBASE_USE_EMULATOR === "true",
  });

  if (!environment.enabled) {
    if (env?.PROD === true) {
      setProductionRemoteConfigError(new Error(
        `Production grouping Remote Config blocked: ${environment.reason}.`,
      ));
    }
    return { status: "skipped", reason: environment.reason };
  }

  try {
    if (!await sdk.isSupported()) {
      throw new Error("Firebase Remote Config is not supported by this browser.");
    }

    const remoteConfig = sdk.getRemoteConfig(firebaseApp);
    remoteConfig.settings.fetchTimeoutMillis = FETCH_TIMEOUT_MILLIS;
    remoteConfig.settings.minimumFetchIntervalMillis = MINIMUM_FETCH_INTERVAL_MILLIS;
    remoteConfig.defaultConfig = { ...GROUPING_REMOTE_CONFIG_DEFAULTS };

    const activated = await sdk.fetchAndActivate(remoteConfig);
    const config = readGroupingRemoteConfig(remoteConfig, sdk);
    setProductionRemoteConfig(config);
    return { status: "ready", activated, config };
  } catch (error) {
    setProductionRemoteConfigError(error);
    console.warn(
      "Production grouping Remote Config was unavailable; grouping remains fail-closed.",
      error,
    );
    return { status: "failed", error };
  }
};

