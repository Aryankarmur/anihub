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

// Minimal pre-grouping permissions fixture. It intentionally has no `groups`
// or `groupNameKeys` match so account cleanup exercises its safe legacy mode
// without depending on a stale snapshot of production rules.
const legacyOwnerOnlyRules = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
      match /watchlist/{animeId} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
      match /completed/{animeId} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
      match /collections/{collectionId} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
        match /items/{animeId} {
          allow read, write: if request.auth != null && request.auth.uid == uid;
        }
      }
    }
  }
}
`;
const currentRules = readFileSync("firestore.rules", "utf8");

let legacyEnv;
let currentEnv;

const userRef = (db, uid) => doc(db, "users", uid);
const animeRef = (db, uid, scope, animeId) => doc(db, "users", uid, scope, animeId);
const scopedAnimeRef = (db, uid, scopeKey, animeId) => (
  scopeKey.startsWith("collection:")
    ? doc(
      db,
      "users",
      uid,
      "collections",
      scopeKey.slice("collection:".length),
      "items",
      animeId,
    )
    : animeRef(db, uid, scopeKey, animeId)
);
const groupRef = (db, uid, groupId) => doc(db, "users", uid, "groups", groupId);
const reservationRef = (db, uid, reservationId) => (
  doc(db, "users", uid, "groupNameKeys", reservationId)
);

async function seedGroup(
  db,
  uid,
  groupId,
  memberIds,
  { groupType = "manual", scopeKey = "watchlist" } = {},
) {
  const normalizedName = `group ${groupId}`;
  const reservationId = await getGroupNameReservationId(scopeKey, normalizedName);
  const collectionId = scopeKey.startsWith("collection:")
    ? scopeKey.slice("collection:".length)
    : null;
  if (collectionId) {
    await setDoc(doc(db, "users", uid, "collections", collectionId), {
      name: `Collection ${collectionId}`,
      groupingState: { groupCount: 1, lastGroupId: groupId },
    });
  }
  await setDoc(groupRef(db, uid, groupId), {
    name: `Group ${groupId}`,
    normalizedName,
    reservationId,
    scopeKey,
    collectionId,
    thumbnailAnimeId: memberIds[0],
    creationMemberIds: memberIds.slice(0, 2),
    groupType,
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
  await setDoc(reservationRef(db, uid, reservationId), {
    scopeKey,
    normalizedName,
    groupId,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  for (const animeId of memberIds) {
    await setDoc(scopedAnimeRef(db, uid, scopeKey, animeId), {
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
  legacyEnv = await initializeTestEnvironment({
    projectId: "demo-anihub-f01-legacy-rules-account-delete",
    firestore: { host: "127.0.0.1", port: 8080, rules: legacyOwnerOnlyRules },
  });
  currentEnv = await initializeTestEnvironment({
    projectId: "demo-anihub-f01-current-rules-account-delete",
    firestore: { host: "127.0.0.1", port: 8080, rules: currentRules },
  });
});

afterAll(async () => {
  await legacyEnv?.cleanup();
  await currentEnv?.cleanup();
});

describe("account deletion compatibility", () => {
  it("deletes a legacy account under owner-only pre-grouping permissions", async () => {
    const uid = "legacy-user";
    await legacyEnv.withSecurityRulesDisabled(async (context) => {
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
      legacyEnv.authenticatedContext(uid).firestore(),
      uid,
    );

    expect(result.data.mode).toBe("legacy");
    expect(result.data.profileDeleted).toBe(true);
    await assertUserDataGone(legacyEnv, uid);
  });

  it("refuses legacy fallback when the profile records grouping data", async () => {
    const uid = "blocked-legacy-fallback";
    await legacyEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(userRef(db, uid), { groupingState: { hasData: true } });
      await setDoc(animeRef(db, uid, "watchlist", "1"), { animeId: "1" });
    });
    const db = legacyEnv.authenticatedContext(uid).firestore();

    await expect(deleteUserDataFromFirestore(db, uid)).rejects.toMatchObject({
      code: "grouping/account-cleanup-unavailable",
    });
    expect((await getDoc(userRef(db, uid))).exists()).toBe(true);
    expect((await getDoc(animeRef(db, uid, "watchlist", "1"))).exists()).toBe(true);
  });

  it("deletes grouped data with each group and reservation handled together", async () => {
    const uid = "grouped-user";
    await currentEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(userRef(db, uid), { groupingState: { hasData: true } });
      await seedGroup(db, uid, "group-a", ["1", "2"], { groupType: "automatic" });
      await seedGroup(db, uid, "group-b", ["3", "4"]);
    });

    const result = await deleteUserDataFromFirestore(
      currentEnv.authenticatedContext(uid).firestore(),
      uid,
    );

    expect(result.data.mode).toBe("group-aware");
    expect(result.data.deletedGroupIds).toHaveLength(2);
    await assertUserDataGone(currentEnv, uid);
  });

  it("deletes grouped custom Collections while decrementing their integrity counter", async () => {
    const uid = "grouped-collection-user";
    await currentEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(userRef(db, uid), { groupingState: { hasData: true } });
      await seedGroup(db, uid, "collection-group", ["1", "2"], {
        scopeKey: "collection:favorites",
      });
    });

    const result = await deleteUserDataFromFirestore(
      currentEnv.authenticatedContext(uid).firestore(),
      uid,
    );

    expect(result.data.deletedGroupIds).toEqual(["collection-group"]);
    expect(result.data.deletedCollectionItems).toBe(2);
    await assertUserDataGone(currentEnv, uid);
  });

  it("crosses bounded document batches without splitting group dependencies", async () => {
    const uid = "large-user";
    await currentEnv.withSecurityRulesDisabled(async (context) => {
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
      currentEnv.authenticatedContext(uid).firestore(),
      uid,
    );

    expect(result.data.deletedGroupIds).toHaveLength(3);
    expect(result.data.deletedWatchlist).toBe(205);
    await assertUserDataGone(currentEnv, uid);
  });

  it("keeps interrupted cleanup retryable and deletes the profile last", async () => {
    const uid = "retry-user";
    await currentEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(userRef(db, uid), { groupingState: { hasData: true } });
      await seedGroup(db, uid, "retry-a", ["1", "2"]);
      await seedGroup(db, uid, "retry-b", ["3", "4"]);
    });
    const db = currentEnv.authenticatedContext(uid).firestore();
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
    await assertUserDataGone(currentEnv, uid);
  });

  it("cannot delete another user's data", async () => {
    await currentEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(userRef(context.firestore(), "target-user"), { displayName: "Target" });
    });
    await assertFails(deleteUserDataFromFirestore(
      currentEnv.authenticatedContext("attacker").firestore(),
      "target-user",
    ));
    await currentEnv.withSecurityRulesDisabled(async (context) => {
      expect((await getDoc(userRef(context.firestore(), "target-user"))).exists()).toBe(true);
    });
  });
});
