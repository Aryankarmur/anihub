export const GROUPING_PREVIEW_PROJECT_ID = "demo-anihub-f01";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

const parsePort = (value) => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
};

export const evaluateGroupingPreviewEnvironment = (env = {}) => {
  const requested = env.VITE_GROUPING_PREVIEW === "true";
  const authHost = env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = env.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST;
  const authPort = parsePort(env.VITE_FIREBASE_AUTH_EMULATOR_PORT);
  const firestorePort = parsePort(env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT);
  const errors = [];

  if (requested) {
    if (env.DEV !== true || env.MODE !== "grouping-preview") {
      errors.push("Grouping preview is available only in Vite development mode 'grouping-preview'.");
    }
    if (env.VITE_FIREBASE_PROJECT_ID !== GROUPING_PREVIEW_PROJECT_ID) {
      errors.push(`Grouping preview requires project ${GROUPING_PREVIEW_PROJECT_ID}.`);
    }
    if (env.VITE_FIREBASE_API_KEY !== GROUPING_PREVIEW_PROJECT_ID) {
      errors.push("Grouping preview requires the synthetic demo API key.");
    }
    if (env.VITE_FIREBASE_AUTH_DOMAIN !== `${GROUPING_PREVIEW_PROJECT_ID}.localhost`) {
      errors.push("Grouping preview requires the synthetic localhost auth domain.");
    }
    if (env.VITE_FIREBASE_USE_EMULATOR !== "true") {
      errors.push("Firebase emulator mode must be explicitly enabled.");
    }
    if (env.VITE_ENABLE_WATCHLIST_GROUPING !== "true") {
      errors.push("The grouping feature flag must be explicitly enabled.");
    }
    if (!LOOPBACK_HOSTS.has(authHost) || authPort === null) {
      errors.push("Authentication Emulator must use a loopback host and explicit valid port.");
    }
    if (!LOOPBACK_HOSTS.has(firestoreHost) || firestorePort === null) {
      errors.push("Firestore Emulator must use a loopback host and explicit valid port.");
    }
  }

  return {
    requested,
    enabled: requested && errors.length === 0,
    errors,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    authHost,
    authPort,
    firestoreHost,
    firestorePort,
  };
};

export const getGroupingPreviewHealthUrls = (config) => ({
  auth: `http://${config.authHost}:${config.authPort}/emulator/v1/projects/${config.projectId}/config`,
  firestore: `http://${config.firestoreHost}:${config.firestorePort}/v1/projects/${config.projectId}/databases/(default)/documents?pageSize=1`,
});

const fetchPreviewService = async (name, url, fetchImpl, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      mode: "no-cors",
      signal: controller.signal,
    });
    // Firestore does not expose CORS headers for its REST endpoint. An opaque
    // no-cors response has status 0 and still proves that the loopback service
    // accepted the connection. Network failures and visible 5xx responses block.
    if (!response || response.status >= 500) {
      throw new Error(`${name} Emulator health check returned HTTP ${response.status}.`);
    }
  } catch (error) {
    throw new Error(`${name} Emulator is unavailable; preview startup was blocked.`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const requireGroupingPreviewBackends = async (
  env,
  { fetchImpl = globalThis.fetch, timeoutMs = 2500 } = {},
) => {
  const config = evaluateGroupingPreviewEnvironment(env);
  if (!config.requested) return config;
  if (!config.enabled) {
    throw new Error(`Unsafe grouping preview configuration: ${config.errors.join(" ")}`);
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Grouping preview cannot verify emulator availability.");
  }
  const urls = getGroupingPreviewHealthUrls(config);
  await Promise.all([
    fetchPreviewService("Authentication", urls.auth, fetchImpl, timeoutMs),
    fetchPreviewService("Firestore", urls.firestore, fetchImpl, timeoutMs),
  ]);
  return config;
};
