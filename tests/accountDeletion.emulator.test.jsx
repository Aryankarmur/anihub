import { readFileSync } from "node:fs";
import {
  assertFails,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteGroupFromFirestore,
  deleteUserDataFromFirestore,
} from "../src/firebase/firestore";
import { getGroupNameReservationId } from "../src/firebase/groupingUtils";

const productionRules = readFileSync(
  new URL("../src/production-firestore-rules.txt", import.meta.url),
  "utf8",
);
const proposedRules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

let productionEnv;
let proposedEnv;

const userRef = (db, uid) => doc(db, "users", uid);
const animeRef = (db, uid, scope, animeId) => doc(db, "users", uid, scope, animeId);
const groupRef = (db, uid, groupId) => doc(db, "users", uid, "groups", groupId);
const reservationRef = (db, uid, reservationId) => (
  doc(db, "users", uid, "groupNameKeys", reservationId)
);

async function seedGroup(db, uid, groupId, memberIds, { groupType = "manual" } = {}) {
  const normalizedName = `group ${groupId}`;
  const reservationId = await getGroupNameReservationId("watchlist", normalizedName);
  await setDoc(groupRef(db, uid, groupId), {
    name: `Group ${groupId}`,
    normalizedName,
    reservationId,
    scopeKey: "watchlist",
    collectionId: null,
    thumbnailAnimeId: memberIds[0],
    groupType,
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
  await setDoc(reservationRef(db, uid, reservationId), {
    scopeKey: "watchlist",
    normalizedName,
    groupId,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  for (const animeId of memberIds) {
    await setDoc(animeRef(db, uid, "watchlist", animeId), {
      animeId,
      title: `Anime ${animeId}`,
      groupId,
      addedAt: new Date("2026-01-01T00:00:00Z"),
    });
  }
}

async function assertUserDataGone(environment, uid) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    expect((await getDoc(userRef(db, uid))).exists()).toBe(false);
    for (const subcollection of ["watchlist", "completed", "collections", "groups", "groupNameKeys"]) {
      expect((await getDocs(collection(db, "users", uid, subcollection))).empty).toBe(true);
    }
  });
}

beforeAll(async () => {
  productionEnv = await initializeTestEnvironment({
    projectId: "demo-anihub-f01-production-rules-account-delete",
    firestore: { host: "127.0.0.1", port: 8080, rules: productionRules },
  });
  proposedEnv = await initializeTestEnvironment({
    projectId: "demo-anihub-f01-proposed-rules-account-delete",
    firestore: { host: "127.0.0.1", port: 8080, rules: proposedRules },
  });
});

afterAll(async () => {
  await productionEnv?.cleanup();
  await proposedEnv?.cleanup();
});

describe("account deletion compatibility", () => {
  it("deletes a legacy account under production-equivalent permissions", async () => {
    const uid = "legacy-user";
    await productionEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(userRef(db, uid), { displayName: "Legacy" });
      await setDoc(animeRef(db, uid, "watchlist", "1"), { animeId: "1" });
      await setDoc(animeRef(db, uid, "completed", "2"), { animeId: "2" });
      await setDoc(doc(db, "users", uid, "collections", "favorites"), { name: "Favorites" });
      await setDoc(doc(db, "users", uid, "collections", "favorites", "items", "3"), {
        animeId: "3",
      });
    });

    const result = await deleteUserDataFromFirestore(
      productionEnv.authenticatedContext(uid).firestore(),
      uid,
    );

    expect(result.data.mode).toBe("legacy");
    expect(result.data.profileDeleted).toBe(true);
    await assertUserDataGone(productionEnv, uid);
  });

  it("refuses legacy fallback when the profile records grouping data", async () => {
    const uid = "blocked-legacy-fallback";
    await productionEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(userRef(db, uid), { groupingState: { hasData: true } });
      await setDoc(animeRef(db, uid, "watchlist", "1"), { animeId: "1" });
    });
    const db = productionEnv.authenticatedContext(uid).firestore();

    await expect(deleteUserDataFromFirestore(db, uid)).rejects.toMatchObject({
      code: "grouping/account-cleanup-unavailable",
    });
    expect((await getDoc(userRef(db, uid))).exists()).toBe(true);
    expect((await getDoc(animeRef(db, uid, "watchlist", "1"))).exists()).toBe(true);
  });

  it("deletes grouped data with each group and reservation handled together", async () => {
    const uid = "grouped-user";
    await proposedEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(userRef(db, uid), { groupingState: { hasData: true } });
      await seedGroup(db, uid, "group-a", ["1", "2"], { groupType: "automatic" });
      await seedGroup(db, uid, "group-b", ["3", "4"]);
    });

    const result = await deleteUserDataFromFirestore(
      proposedEnv.authenticatedContext(uid).firestore(),
      uid,
    );

    expect(result.data.mode).toBe("group-aware");
    expect(result.data.deletedGroupIds).toHaveLength(2);
    await assertUserDataGone(proposedEnv, uid);
  });

  it("crosses bounded document batches without splitting group dependencies", async () => {
    const uid = "large-user";
    await proposedEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(userRef(db, uid), { groupingState: { hasData: true } });
      const batch = writeBatch(db);
      for (let index = 0; index < 205; index += 1) {
        const animeId = String(index);
        batch.set(animeRef(db, uid, "watchlist", animeId), {
          animeId,
          title: `Anime ${animeId}`,
        });
      }
      await batch.commit();
      await seedGroup(db, uid, "large-a", ["0", "1"]);
      await seedGroup(db, uid, "large-b", ["2", "3"]);
      await seedGroup(db, uid, "large-c", ["4", "5"]);
    });

    const result = await deleteUserDataFromFirestore(
      proposedEnv.authenticatedContext(uid).firestore(),
      uid,
    );

    expect(result.data.deletedGroupIds).toHaveLength(3);
    expect(result.data.deletedWatchlist).toBe(205);
    await assertUserDataGone(proposedEnv, uid);
  });

  it("keeps interrupted cleanup retryable and deletes the profile last", async () => {
    const uid = "retry-user";
    await proposedEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(userRef(db, uid), { groupingState: { hasData: true } });
      await seedGroup(db, uid, "retry-a", ["1", "2"]);
      await seedGroup(db, uid, "retry-b", ["3", "4"]);
    });
    const db = proposedEnv.authenticatedContext(uid).firestore();
    let groupCalls = 0;

    await expect(deleteUserDataFromFirestore(db, uid, {
      deleteGroupById: async (groupId) => {
        groupCalls += 1;
        if (groupCalls === 2) throw new Error("simulated interruption");
        return deleteGroupFromFirestore(db, uid, groupId);
      },
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        operation: "delete-user-data",
        profileDeleted: false,
        retryable: true,
      }),
    });
    expect((await getDoc(userRef(db, uid))).exists()).toBe(true);

    await deleteUserDataFromFirestore(db, uid);
    await assertUserDataGone(proposedEnv, uid);
  });

  it("cannot delete another user's data", async () => {
    await proposedEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(userRef(context.firestore(), "target-user"), { displayName: "Target" });
    });
    await assertFails(deleteUserDataFromFirestore(
      proposedEnv.authenticatedContext("attacker").firestore(),
      "target-user",
    ));
    await proposedEnv.withSecurityRulesDisabled(async (context) => {
      expect((await getDoc(userRef(context.firestore(), "target-user"))).exists()).toBe(true);
    });
  });
});
