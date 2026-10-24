import assert from "node:assert/strict";
import test from "node:test";

import {
  GROUPING_PREVIEW_PROJECT_ID,
  evaluateGroupingPreviewEnvironment,
  getGroupingPreviewHealthUrls,
  requireGroupingPreviewBackends,
} from "../src/firebase/groupingPreviewConfig.js";

const safeEnv = (overrides = {}) => ({
  DEV: true,
  MODE: "grouping-preview",
  VITE_GROUPING_PREVIEW: "true",
  VITE_ENABLE_WATCHLIST_GROUPING: "true",
  VITE_FIREBASE_USE_EMULATOR: "true",
  VITE_FIREBASE_PROJECT_ID: GROUPING_PREVIEW_PROJECT_ID,
  VITE_FIREBASE_API_KEY: GROUPING_PREVIEW_PROJECT_ID,
  VITE_FIREBASE_AUTH_DOMAIN: `${GROUPING_PREVIEW_PROJECT_ID}.localhost`,
  VITE_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1",
  VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
  VITE_FIREBASE_FIRESTORE_EMULATOR_HOST: "127.0.0.1",
  VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: "8080",
  ...overrides,
});

test("preview is inactive and performs no network checks by default", async () => {
  let calls = 0;
  const config = await requireGroupingPreviewBackends(
    { DEV: true, MODE: "development" },
    { fetchImpl: async () => { calls += 1; } },
  );
  assert.equal(config.requested, false);
  assert.equal(config.enabled, false);
  assert.equal(calls, 0);
});

test("safe preview requires the exact demo project and both loopback emulators", () => {
  const config = evaluateGroupingPreviewEnvironment(safeEnv());
  assert.equal(config.enabled, true);
  assert.deepEqual(config.errors, []);
  assert.deepEqual(getGroupingPreviewHealthUrls(config), {
    auth: "http://127.0.0.1:9099/emulator/v1/projects/demo-anihub-f01/config",
    firestore: "http://127.0.0.1:8080/v1/projects/demo-anihub-f01/databases/(default)/documents?pageSize=1",
  });
});

test("preview rejects a real Firebase project ID", async () => {
  await assert.rejects(
    requireGroupingPreviewBackends(safeEnv({ VITE_FIREBASE_PROJECT_ID: "anihub-production" })),
    /requires project demo-anihub-f01/,
  );
});

test("preview rejects production builds and partial emulator configuration", () => {
  const config = evaluateGroupingPreviewEnvironment(safeEnv({
    DEV: false,
    MODE: "production",
    VITE_FIREBASE_AUTH_EMULATOR_HOST: "firebase.google.com",
    VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: "",
  }));
  assert.equal(config.enabled, false);
  assert.equal(config.errors.length, 3);
});

test("preview checks both emulator backends before startup", async () => {
  const calls = [];
  const config = await requireGroupingPreviewBackends(safeEnv(), {
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, status: 200 };
    },
  });
  assert.equal(config.enabled, true);
  assert.equal(calls.length, 2);
});

test("an unavailable emulator blocks startup without fallback", async () => {
  await assert.rejects(
    requireGroupingPreviewBackends(safeEnv(), {
      fetchImpl: async (url) => ({ ok: !url.includes(":9099"), status: 503 }),
    }),
    /Authentication Emulator is unavailable; preview startup was blocked/,
  );
});
