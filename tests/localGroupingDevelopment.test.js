import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCALHOST_GROUPING_PROJECT_ID,
  evaluateLocalhostGroupingAccess,
} from "../src/firebase/localGroupingDevelopment.js";

const enabledContext = (overrides = {}) => ({
  isDevelopment: true,
  isProduction: false,
  hostname: "localhost",
  projectId: LOCALHOST_GROUPING_PROJECT_ID,
  explicitlyEnabled: true,
  allowedUid: "approved-test-uid",
  activeUid: "approved-test-uid",
  emulatorRequested: false,
  ...overrides,
});

test("approved localhost development enables the designated test UID", () => {
  assert.equal(evaluateLocalhostGroupingAccess(enabledContext()), true);
  assert.equal(evaluateLocalhostGroupingAccess(enabledContext({ hostname: "127.0.0.1" })), true);
});

test("production and non-development builds cannot use the localhost override", () => {
  assert.equal(evaluateLocalhostGroupingAccess(enabledContext({ isProduction: true })), false);
  assert.equal(evaluateLocalhostGroupingAccess(enabledContext({ isDevelopment: false })), false);
});

test("non-loopback hosts cannot use the localhost override", () => {
  assert.equal(evaluateLocalhostGroupingAccess(enabledContext({ hostname: "anihub.netlify.app" })), false);
  assert.equal(evaluateLocalhostGroupingAccess(enabledContext({ hostname: "192.168.1.20" })), false);
});

test("only the exact approved Firebase project can use the override", () => {
  assert.equal(evaluateLocalhostGroupingAccess(enabledContext({ projectId: "anihub-copy" })), false);
  assert.equal(evaluateLocalhostGroupingAccess(enabledContext({ emulatorRequested: true })), false);
});

test("explicit opt-in and the exact active UID are mandatory", () => {
  assert.equal(evaluateLocalhostGroupingAccess(enabledContext({ explicitlyEnabled: false })), false);
  assert.equal(evaluateLocalhostGroupingAccess(enabledContext({ allowedUid: "" })), false);
  assert.equal(evaluateLocalhostGroupingAccess(enabledContext({ activeUid: "another-user" })), false);
});
