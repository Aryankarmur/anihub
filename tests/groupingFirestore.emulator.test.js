import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import test, { after, before, beforeEach } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";

import {
  chunkGroupOperation,
  getGroupNameReservationId,
  getMembershipOperationKey,
  normalizeGroupName,
  normalizeInitialGroupAnimeIds
} from "../src/firebase/groupingUtils.js";

const PROJECT_ID = "demo-anihub-f01";
const EMULATOR_HOST = "127.0.0.1:8080";
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
let testEnv;

const groupRef = (db, uid, groupId) => doc(db, "users", uid, "groups", groupId);
const reservationRef = (db, uid, reservationId) => (
  doc(db, "users", uid, "groupNameKeys", reservationId)
);
const animeRef = (db, uid, scopeKey, animeId) => {
  if (scopeKey === "watchlist" || scopeKey === "completed") {
    return doc(db, "users", uid, scopeKey, animeId);
  }
  const collectionId = scopeKey.slice("collection:".length);
  return doc(db, "users", uid, "collections", collectionId, "items", animeId);
};
const memberQuery = (db, uid, scopeKey, groupId, maximum = null) => {
  const constraints = [where("groupId", "==", groupId)];
  if (maximum !== null) constraints.push(limit(maximum));
  if (scopeKey === "watchlist" || scopeKey === "completed") {
    return query(collection(db, "users", uid, scopeKey), ...constraints);
  }
  const collectionId = scopeKey.slice("collection:".length);
  return query(
    collection(db, "users", uid, "collections", collectionId, "items"),
    ...constraints
  );
};

const seedAnime = async (uid, scopeKey, ids) => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    if (scopeKey.startsWith("collection:")) {
      const collectionId = scopeKey.slice("collection:".length);
      await setDoc(doc(db, "users", uid, "collections", collectionId), {
        name: `Collection ${collectionId}`,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    await Promise.all(ids.map((animeId) => setDoc(animeRef(db, uid, scopeKey, animeId), {
      animeId,
      title: `Anime ${animeId}`,
      image: `image-${animeId}`,
      type: "TV",
      score: Number(animeId) || null,
      addedAt: new Date("2025-01-01T00:00:00Z")
    })));
  });
};

const createGroup = async (db, uid, {
  groupId,
  name,
  scopeKey,
  animeIds
}) => {
  const memberIds = normalizeInitialGroupAnimeIds(animeIds);
  const normalized = normalizeGroupName(name);
  const reservationId = await getGroupNameReservationId(scopeKey, normalized.normalizedName);
  const targetGroupRef = groupRef(db, uid, groupId);
  const targetReservationRef = reservationRef(db, uid, reservationId);
  const memberRefs = memberIds.map((animeId) => animeRef(db, uid, scopeKey, animeId));

  await runTransaction(db, async (transaction) => {
    const [reservationSnapshot, ...memberSnapshots] = await Promise.all([
      transaction.get(targetReservationRef),
      ...memberRefs.map((member) => transaction.get(member))
    ]);
    if (reservationSnapshot.exists()) throw new Error("duplicate-name");
    memberSnapshots.forEach((snapshot) => {
      if (!snapshot.exists()) throw new Error("anime-not-found");
      if (snapshot.data().groupId) throw new Error("already-grouped");
    });
    transaction.set(targetGroupRef, {
      name: normalized.name,
      normalizedName: normalized.normalizedName,
      reservationId,
      scopeKey,
      collectionId: scopeKey.startsWith("collection:")
        ? scopeKey.slice("collection:".length)
        : null,
      thumbnailAnimeId: memberIds[0],
      groupType: "manual",
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    transaction.set(targetReservationRef, {
      scopeKey,
      normalizedName: normalized.normalizedName,
      groupId,
      createdAt: serverTimestamp()
    });
    memberRefs.forEach((member) => transaction.update(member, { groupId }));
  });
  return { groupId, reservationId };
};

const addMembersChunked = async (db, uid, scopeKey, groupId, ids) => {
  let processedCount = 0;
  let assignedCount = 0;
  for (const chunk of chunkGroupOperation(ids)) {
    let chunkAssignedCount = 0;
    try {
      await runTransaction(db, async (transaction) => {
        const targetGroupRef = groupRef(db, uid, groupId);
        const targetGroup = await transaction.get(targetGroupRef);
        if (!targetGroup.exists() || targetGroup.data().status !== "active") {
          throw new Error("group-not-active");
        }
        const refs = chunk.map((animeId) => animeRef(db, uid, scopeKey, animeId));
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        snapshots.forEach((snapshot) => {
          if (!snapshot.exists()) throw new Error("anime-not-found");
          if (snapshot.data().groupId && snapshot.data().groupId !== groupId) {
            throw new Error("already-grouped");
          }
        });
        transaction.update(targetGroupRef, { updatedAt: serverTimestamp() });
        snapshots.forEach((snapshot, index) => {
          if (snapshot.data().groupId !== groupId) {
            transaction.update(refs[index], { groupId });
            chunkAssignedCount += 1;
          }
        });
      });
      processedCount += chunk.length;
      assignedCount += chunkAssignedCount;
    } catch (error) {
      error.details = { processedCount, assignedCount, retryable: true };
      throw error;
    }
  }
  return { processedCount, assignedCount };
};

const deleteGroupChunked = async (db, uid, scopeKey, groupId, { stopAfterChunks } = {}) => {
  const targetGroupRef = groupRef(db, uid, groupId);
  let groupData;
  let clearedCount = 0;
  let chunksCompleted = 0;
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(targetGroupRef);
    if (!snapshot.exists()) return;
    groupData = snapshot.data();
    if (groupData.status !== "deleting") {
      transaction.update(targetGroupRef, {
        status: "deleting",
        membershipOperation: deleteField(),
        updatedAt: serverTimestamp()
      });
    }
  });
  if (!groupData) return { clearedCount, complete: true };

  while (true) {
    const members = await getDocs(memberQuery(db, uid, scopeKey, groupId, 10));
    if (members.empty) break;
    await runTransaction(db, async (transaction) => {
      const currentGroup = await transaction.get(targetGroupRef);
      if (currentGroup.data().status !== "deleting") throw new Error("not-deleting");
      const currentMembers = await Promise.all(
        members.docs.map((member) => transaction.get(member.ref))
      );
      currentMembers.forEach((member) => {
        if (member.exists() && member.data().groupId === groupId) {
          transaction.update(member.ref, { groupId: deleteField() });
          clearedCount += 1;
        }
      });
    });
    chunksCompleted += 1;
    if (chunksCompleted === stopAfterChunks) {
      return { clearedCount, complete: false };
    }
  }

  await runTransaction(db, async (transaction) => {
    const targetReservationRef = reservationRef(db, uid, groupData.reservationId);
    await Promise.all([
      transaction.get(targetGroupRef),
      transaction.get(targetReservationRef)
    ]);
    transaction.delete(targetGroupRef);
    transaction.delete(targetReservationRef);
  });
  return { clearedCount, complete: true };
};

before(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== EMULATOR_HOST) {
    throw new Error(
      `Refusing to run: FIRESTORE_EMULATOR_HOST must be ${EMULATOR_HOST}, received ${process.env.FIRESTORE_EMULATOR_HOST || "unset"}.`
    );
  }
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: "127.0.0.1", port: 8080, rules }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv?.cleanup();
});

test("owner can create a two-member group; missing anime and one-member service input fail", async () => {
  await seedAnime("alice", "watchlist", ["1", "2"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  await assertSucceeds(createGroup(db, "alice", {
    groupId: "g1", name: "Series", scopeKey: "watchlist", animeIds: ["1", "2"]
  }));
  assert.throws(
    () => normalizeInitialGroupAnimeIds(["1"]),
    (error) => error.code === "grouping/not-enough-members"
  );
  await assert.rejects(createGroup(db, "alice", {
    groupId: "missing", name: "Missing", scopeKey: "watchlist", animeIds: ["1", "404"]
  }));
});

test("same-scope names are unique, cross-scope names are allowed, and concurrent creation has one winner", async () => {
  await seedAnime("alice", "watchlist", ["1", "2", "3", "4", "5", "6"]);
  await seedAnime("alice", "completed", ["7", "8"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  const first = await createGroup(db, "alice", {
    groupId: "first", name: "Series", scopeKey: "watchlist", animeIds: ["1", "2"]
  });
  await assert.rejects(createGroup(db, "alice", {
    groupId: "duplicate", name: " series ", scopeKey: "watchlist", animeIds: ["3", "4"]
  }));
  await assertSucceeds(createGroup(db, "alice", {
    groupId: "other-scope", name: "Series", scopeKey: "completed", animeIds: ["7", "8"]
  }));
  await assertFails(updateDoc(reservationRef(db, "alice", first.reservationId), {
    groupId: "stolen"
  }));

  const attempts = await Promise.allSettled([
    createGroup(db, "alice", {
      groupId: "race-a", name: "Concurrent", scopeKey: "watchlist", animeIds: ["3", "4"]
    }),
    createGroup(db, "alice", {
      groupId: "race-b", name: "Concurrent", scopeKey: "watchlist", animeIds: ["5", "6"]
    })
  ]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);

  await assertFails(runTransaction(db, async (transaction) => {
    const fakeReservationId = "0".repeat(64);
    transaction.set(groupRef(db, "alice", "forged"), {
      name: "Concurrent",
      normalizedName: "concurrent",
      reservationId: fakeReservationId,
      scopeKey: "watchlist",
      thumbnailAnimeId: "3",
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    transaction.set(reservationRef(db, "alice", fakeReservationId), {
      scopeKey: "watchlist",
      normalizedName: "concurrent",
      groupId: "forged",
      createdAt: serverTimestamp()
    });
  }));
});

test("unauthenticated and cross-user access is denied", async () => {
  await seedAnime("alice", "watchlist", ["1", "2"]);
  const aliceDb = testEnv.authenticatedContext("alice").firestore();
  await createGroup(aliceDb, "alice", {
    groupId: "g1", name: "Private", scopeKey: "watchlist", animeIds: ["1", "2"]
  });
  const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();
  const bobDb = testEnv.authenticatedContext("bob").firestore();
  await assertFails(getDoc(groupRef(unauthenticatedDb, "alice", "g1")));
  await assertFails(getDoc(groupRef(bobDb, "alice", "g1")));
  await assertFails(updateDoc(animeRef(bobDb, "alice", "watchlist", "1"), { title: "stolen" }));
});

test("rename atomically transfers the deterministic reservation", async () => {
  await seedAnime("alice", "watchlist", ["1", "2"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  const created = await createGroup(db, "alice", {
    groupId: "g1", name: "Before", scopeKey: "watchlist", animeIds: ["1", "2"]
  });
  const renamed = normalizeGroupName("After");
  const nextReservationId = await getGroupNameReservationId(
    "watchlist",
    renamed.normalizedName
  );
  await assertSucceeds(runTransaction(db, async (transaction) => {
    const currentGroup = await transaction.get(groupRef(db, "alice", "g1"));
    assert.equal(currentGroup.exists(), true);
    transaction.set(reservationRef(db, "alice", nextReservationId), {
      scopeKey: "watchlist",
      normalizedName: renamed.normalizedName,
      groupId: "g1",
      createdAt: serverTimestamp()
    });
    transaction.update(groupRef(db, "alice", "g1"), {
      name: renamed.name,
      normalizedName: renamed.normalizedName,
      reservationId: nextReservationId,
      updatedAt: serverTimestamp()
    });
    transaction.delete(reservationRef(db, "alice", created.reservationId));
  }));
  assert.equal((await getDoc(reservationRef(db, "alice", created.reservationId))).exists(), false);
  assert.equal((await getDoc(reservationRef(db, "alice", nextReservationId))).exists(), true);
  assert.equal((await getDoc(groupRef(db, "alice", "g1"))).data().name, "After");
});

test("group provenance is immutable while pre-marker groups remain editable", async () => {
  await seedAnime("alice", "watchlist", ["1", "2"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  await createGroup(db, "alice", {
    groupId: "manual-origin",
    name: "Manual Origin",
    scopeKey: "watchlist",
    animeIds: ["1", "2"]
  });
  await assertFails(updateDoc(groupRef(db, "alice", "manual-origin"), {
    groupType: "automatic",
    updatedAt: serverTimestamp()
  }));

  const normalized = normalizeGroupName("Legacy Group");
  const reservationId = await getGroupNameReservationId(
    "watchlist",
    normalized.normalizedName
  );
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(groupRef(adminDb, "alice", "legacy-origin"), {
      name: normalized.name,
      normalizedName: normalized.normalizedName,
      reservationId,
      scopeKey: "watchlist",
      collectionId: null,
      thumbnailAnimeId: "1",
      status: "active",
      createdAt: new Date("2025-01-01T00:00:00Z"),
      updatedAt: new Date("2025-01-01T00:00:00Z")
    });
    await setDoc(reservationRef(adminDb, "alice", reservationId), {
      scopeKey: "watchlist",
      normalizedName: normalized.normalizedName,
      groupId: "legacy-origin",
      createdAt: new Date("2025-01-01T00:00:00Z")
    });
  });
  await assertSucceeds(updateDoc(groupRef(db, "alice", "legacy-origin"), {
    updatedAt: serverTimestamp()
  }));
});

test("cross-scope, cross-group, and deleting-group assignments are denied", async () => {
  await seedAnime("alice", "watchlist", ["1", "2", "3", "4", "5"]);
  await seedAnime("alice", "completed", ["6"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  await createGroup(db, "alice", {
    groupId: "g1", name: "One", scopeKey: "watchlist", animeIds: ["1", "2"]
  });
  await createGroup(db, "alice", {
    groupId: "g2", name: "Two", scopeKey: "watchlist", animeIds: ["3", "4"]
  });
  await assertFails(updateDoc(groupRef(db, "alice", "g1"), {
    scopeKey: "completed",
    updatedAt: serverTimestamp()
  }));

  await assertFails(runTransaction(db, async (transaction) => {
    transaction.update(groupRef(db, "alice", "g1"), { updatedAt: serverTimestamp() });
    transaction.update(animeRef(db, "alice", "completed", "6"), { groupId: "g1" });
  }));
  await assertFails(runTransaction(db, async (transaction) => {
    transaction.update(groupRef(db, "alice", "g2"), { updatedAt: serverTimestamp() });
    transaction.update(animeRef(db, "alice", "watchlist", "1"), { groupId: "g2" });
  }));
  await updateDoc(groupRef(db, "alice", "g1"), {
    status: "deleting",
    updatedAt: serverTimestamp()
  });
  await assertFails(runTransaction(db, async (transaction) => {
    transaction.update(groupRef(db, "alice", "g1"), { updatedAt: serverTimestamp() });
    transaction.update(animeRef(db, "alice", "watchlist", "5"), { groupId: "g1" });
  }));
});

test("ungrouping preserves metadata, permits orphan repair, and rejects stale assignments", async () => {
  await seedAnime("alice", "watchlist", ["1", "2", "3", "4", "5", "6"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  await createGroup(db, "alice", {
    groupId: "g1", name: "One", scopeKey: "watchlist", animeIds: ["1", "2"]
  });
  await createGroup(db, "alice", {
    groupId: "g2", name: "Two", scopeKey: "watchlist", animeIds: ["3", "4"]
  });
  await updateDoc(animeRef(db, "alice", "watchlist", "1"), { groupId: deleteField() });
  const preserved = await getDoc(animeRef(db, "alice", "watchlist", "1"));
  assert.equal(preserved.data().title, "Anime 1");
  assert.equal(preserved.data().image, "image-1");
  assert.equal("groupId" in preserved.data(), false);

  const attempts = await Promise.allSettled([
    runTransaction(db, async (transaction) => {
      const target = groupRef(db, "alice", "g1");
      await transaction.get(animeRef(db, "alice", "watchlist", "5"));
      transaction.update(target, { updatedAt: serverTimestamp() });
      transaction.update(animeRef(db, "alice", "watchlist", "5"), { groupId: "g1" });
    }),
    runTransaction(db, async (transaction) => {
      const target = groupRef(db, "alice", "g2");
      await transaction.get(animeRef(db, "alice", "watchlist", "5"));
      transaction.update(target, { updatedAt: serverTimestamp() });
      transaction.update(animeRef(db, "alice", "watchlist", "5"), { groupId: "g2" });
    })
  ]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(animeRef(context.firestore(), "alice", "watchlist", "6"), {
      groupId: "missing-group"
    });
  });
  await assertSucceeds(updateDoc(
    animeRef(db, "alice", "watchlist", "6"),
    { groupId: deleteField() }
  ));
  const repaired = await getDoc(animeRef(db, "alice", "watchlist", "6"));
  assert.equal(repaired.data().title, "Anime 6");
  assert.equal("groupId" in repaired.data(), false);
});

test("removing one member from a pair dissolves the group without deleting either anime", async () => {
  await seedAnime("alice", "watchlist", ["1", "2"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  const created = await createGroup(db, "alice", {
    groupId: "pair", name: "Pair", scopeKey: "watchlist", animeIds: ["1", "2"]
  });
  const operationKey = await getMembershipOperationKey("remove", "pair", ["1"]);

  try {
    await assertSucceeds(runTransaction(db, async (transaction) => {
      const group = await transaction.get(groupRef(db, "alice", "pair"));
      assert.equal(group.data().status, "active");
      transaction.update(group.ref, {
        status: "updating",
        membershipOperation: { type: "remove", key: operationKey },
        updatedAt: serverTimestamp()
      });
    }));
  } catch (error) {
    throw new Error(`Failed to start the removal operation: ${error.message}`, { cause: error });
  }
  try {
    await assertSucceeds(runTransaction(db, async (transaction) => {
      const [group, anime] = await Promise.all([
        transaction.get(groupRef(db, "alice", "pair")),
        transaction.get(animeRef(db, "alice", "watchlist", "1"))
      ]);
      assert.equal(group.data().status, "updating");
      assert.equal(group.data().membershipOperation.key, operationKey);
      assert.equal(anime.data().groupId, "pair");
      transaction.update(group.ref, { updatedAt: serverTimestamp() });
      transaction.update(anime.ref, { groupId: deleteField() });
    }));
  } catch (error) {
    throw new Error(`Failed to remove the member chunk: ${error.message}`, { cause: error });
  }

  assert.equal((await getDocs(memberQuery(db, "alice", "watchlist", "pair", 2))).size, 1);
  const dissolved = await deleteGroupChunked(db, "alice", "watchlist", "pair");
  assert.deepEqual(dissolved, { clearedCount: 1, complete: true });
  assert.equal((await getDoc(groupRef(db, "alice", "pair"))).exists(), false);
  assert.equal((await getDoc(reservationRef(db, "alice", created.reservationId))).exists(), false);
  for (const animeId of ["1", "2"]) {
    const anime = await getDoc(animeRef(db, "alice", "watchlist", animeId));
    assert.equal(anime.exists(), true);
    assert.equal(anime.data().title, `Anime ${animeId}`);
    assert.equal("groupId" in anime.data(), false);
  }
});

test("large deletion is interruptible, retryable, preserves anime, and holds its reservation", async () => {
  const ids = Array.from({ length: 105 }, (_, index) => String(index + 1));
  await seedAnime("alice", "watchlist", ids);
  const db = testEnv.authenticatedContext("alice").firestore();
  const created = await createGroup(db, "alice", {
    groupId: "large", name: "Large", scopeKey: "watchlist", animeIds: ids.slice(0, 2)
  });
  const addition = await addMembersChunked(db, "alice", "watchlist", "large", ids.slice(2));
  assert.deepEqual(addition, { processedCount: 103, assignedCount: 103 });
  assert.equal((await getDocs(memberQuery(db, "alice", "watchlist", "large"))).size, 105);

  const interrupted = await deleteGroupChunked(db, "alice", "watchlist", "large", {
    stopAfterChunks: 1
  });
  assert.deepEqual(interrupted, { clearedCount: 10, complete: false });
  assert.equal((await getDoc(groupRef(db, "alice", "large"))).data().status, "deleting");
  assert.equal((await getDoc(reservationRef(db, "alice", created.reservationId))).exists(), true);
  assert.equal((await getDocs(memberQuery(db, "alice", "watchlist", "large"))).size, 95);

  const completed = await deleteGroupChunked(db, "alice", "watchlist", "large");
  assert.deepEqual(completed, { clearedCount: 95, complete: true });
  assert.equal((await getDoc(groupRef(db, "alice", "large"))).exists(), false);
  assert.equal((await getDoc(reservationRef(db, "alice", created.reservationId))).exists(), false);
  const anime = await getDocs(collection(db, "users", "alice", "watchlist"));
  assert.equal(anime.size, 105);
  anime.forEach((snapshot) => assert.equal("groupId" in snapshot.data(), false));
});

test("multi-chunk additions expose committed progress and retry without duplicates", async () => {
  const ids = Array.from({ length: 103 }, (_, index) => String(index + 1));
  await seedAnime("alice", "watchlist", ids.slice(0, 102));
  const db = testEnv.authenticatedContext("alice").firestore();
  await createGroup(db, "alice", {
    groupId: "partial", name: "Partial", scopeKey: "watchlist", animeIds: ids.slice(0, 2)
  });
  await assert.rejects(
    addMembersChunked(db, "alice", "watchlist", "partial", ids.slice(2)),
    (error) => {
      assert.deepEqual(error.details, {
        processedCount: 100,
        assignedCount: 100,
        retryable: true
      });
      return true;
    }
  );
  await seedAnime("alice", "watchlist", ["103"]);
  const retry = await addMembersChunked(db, "alice", "watchlist", "partial", ids.slice(2));
  assert.deepEqual(retry, { processedCount: 101, assignedCount: 1 });
  assert.equal((await getDocs(memberQuery(db, "alice", "watchlist", "partial"))).size, 103);
});

test("watchlist/completed atomic moves, custom collections, and legacy ungrouped anime remain allowed", async () => {
  await seedAnime("alice", "watchlist", ["1"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  const profile = doc(db, "users", "alice");
  await assertSucceeds(setDoc(profile, { displayName: "Alice" }));
  await assertSucceeds(updateDoc(profile, { displayName: "Alice Updated" }));
  assert.equal((await getDoc(profile)).data().displayName, "Alice Updated");
  const batch = writeBatch(db);
  batch.set(animeRef(db, "alice", "completed", "1"), {
    animeId: "1", title: "Anime 1", image: "image-1", type: "TV", score: 8,
    addedAt: serverTimestamp()
  });
  batch.delete(animeRef(db, "alice", "watchlist", "1"));
  await assertSucceeds(batch.commit());
  await assertSucceeds(setDoc(doc(db, "users", "alice", "collections", "favorites"), {
    name: "Favorites", description: "", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(
    animeRef(db, "alice", "collection:favorites", "2"),
    { animeId: "2", title: "Migrated", addedAt: serverTimestamp() }
  ));
  assert.equal((await getDoc(animeRef(db, "alice", "completed", "1"))).exists(), true);
  assert.equal((await getDoc(animeRef(db, "alice", "collection:favorites", "2"))).exists(), true);
});

test("grouped movement commits an ungrouped destination and permits retryable source cleanup", async () => {
  await seedAnime("alice", "watchlist", ["1", "2"]);
  await seedAnime("alice", "collection:favorites", ["1"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  const created = await createGroup(db, "alice", {
    groupId: "moving", name: "Moving", scopeKey: "watchlist", animeIds: ["1", "2"]
  });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(animeRef(context.firestore(), "alice", "watchlist", "1"), {
      _migratedFromLegacy: true
    });
  });

  await assertSucceeds(runTransaction(db, async (transaction) => {
    const sourceRef = animeRef(db, "alice", "watchlist", "1");
    const destinationRef = animeRef(db, "alice", "completed", "1");
    const [source, destination] = await Promise.all([
      transaction.get(sourceRef),
      transaction.get(destinationRef)
    ]);
    assert.equal(source.exists(), true);
    assert.equal(destination.exists(), false);
    transaction.set(destinationRef, {
      ...source.data(),
      groupId: deleteField(),
      addedAt: serverTimestamp()
    }, { merge: true });
    transaction.delete(sourceRef);
  }));

  const moved = await getDoc(animeRef(db, "alice", "completed", "1"));
  assert.equal(moved.exists(), true);
  assert.equal("groupId" in moved.data(), false);
  assert.equal(moved.data()._migratedFromLegacy, true);
  assert.equal((await getDoc(animeRef(db, "alice", "watchlist", "1"))).exists(), false);
  assert.equal((await getDocs(memberQuery(db, "alice", "watchlist", "moving", 2))).size, 1);

  const cleanup = await deleteGroupChunked(db, "alice", "watchlist", "moving");
  assert.deepEqual(cleanup, { clearedCount: 1, complete: true });
  assert.equal((await getDoc(groupRef(db, "alice", "moving"))).exists(), false);
  assert.equal((await getDoc(reservationRef(db, "alice", created.reservationId))).exists(), false);
  assert.equal("groupId" in (await getDoc(animeRef(db, "alice", "watchlist", "2"))).data(), false);
  assert.equal(
    (await getDoc(animeRef(db, "alice", "collection:favorites", "1"))).exists(),
    true
  );
});

test("rules document the unavoidable minimum-member enforcement limitation", async () => {
  await seedAnime("alice", "watchlist", ["1"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  const normalized = normalizeGroupName("Malicious singleton");
  const reservationId = await getGroupNameReservationId("watchlist", normalized.normalizedName);
  await assertSucceeds(runTransaction(db, async (transaction) => {
    transaction.set(groupRef(db, "alice", "singleton"), {
      name: normalized.name,
      normalizedName: normalized.normalizedName,
      reservationId,
      scopeKey: "watchlist",
      collectionId: null,
      thumbnailAnimeId: "1",
      groupType: "manual",
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    transaction.set(reservationRef(db, "alice", reservationId), {
      scopeKey: "watchlist",
      normalizedName: normalized.normalizedName,
      groupId: "singleton",
      createdAt: serverTimestamp()
    });
    transaction.update(animeRef(db, "alice", "watchlist", "1"), { groupId: "singleton" });
  }));
  assert.equal((await getDocs(memberQuery(db, "alice", "watchlist", "singleton", 2))).size, 1);
});

test("movement markers reject malformed, custom-scope, cross-user-shaped, and unprovenanced tasks", async () => {
  await seedAnime("alice", "watchlist", ["1"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  const target = animeRef(db, "alice", "watchlist", "1");
  await assertFails(updateDoc(target, {
    _groupingReconciliations: [{ sourceScope: "collection:favorites", sourceGroupId: "g", animeId: "1" }]
  }));
  await assertFails(updateDoc(target, {
    _groupingReconciliations: [{
      sourceScope: "watchlist", sourceGroupId: "g", animeId: "1", sourceUid: "bob"
    }]
  }));
  await assertFails(updateDoc(target, {
    _groupingReconciliations: [{ sourceScope: "watchlist", sourceGroupId: "users/bob/g", animeId: "1" }]
  }));
  await assertFails(updateDoc(target, {
    _groupingReconciliations: [{ sourceScope: "watchlist", sourceGroupId: "g", animeId: "1" }]
  }));
});

test("movement markers require an atomic transfer and cleanup before a reverse move", async () => {
  await seedAnime("alice", "watchlist", ["1", "2"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  await createGroup(db, "alice", {
    groupId: "source-group", name: "Source group", scopeKey: "watchlist", animeIds: ["1", "2"]
  });
  const task = { sourceScope: "watchlist", sourceGroupId: "source-group", animeId: "1" };

  await assertSucceeds(runTransaction(db, async (transaction) => {
    const source = animeRef(db, "alice", "watchlist", "1");
    const destination = animeRef(db, "alice", "completed", "1");
    const sourceSnapshot = await transaction.get(source);
    transaction.set(destination, {
      ...sourceSnapshot.data(),
      groupId: deleteField(),
      _groupingReconciliations: [task],
      addedAt: serverTimestamp()
    }, { merge: true });
    transaction.delete(source);
  }));
  assert.deepEqual(
    (await getDoc(animeRef(db, "alice", "completed", "1"))).data()._groupingReconciliations,
    [task]
  );

  await assertFails(runTransaction(db, async (transaction) => {
    const source = animeRef(db, "alice", "completed", "1");
    const destination = animeRef(db, "alice", "watchlist", "1");
    const sourceSnapshot = await transaction.get(source);
    transaction.set(destination, {
      ...sourceSnapshot.data(),
      groupId: deleteField(),
      addedAt: serverTimestamp()
    }, { merge: true });
    transaction.delete(source);
  }));
  assert.equal((await getDoc(animeRef(db, "alice", "completed", "1"))).exists(), true);

  await assertSucceeds(updateDoc(animeRef(db, "alice", "completed", "1"), {
    _groupingReconciliations: deleteField()
  }));
  await assertSucceeds(runTransaction(db, async (transaction) => {
    const source = animeRef(db, "alice", "completed", "1");
    const destination = animeRef(db, "alice", "watchlist", "1");
    const sourceSnapshot = await transaction.get(source);
    transaction.set(destination, {
      ...sourceSnapshot.data(),
      addedAt: serverTimestamp()
    }, { merge: true });
    transaction.delete(source);
  }));
  assert.equal(
    "_groupingReconciliations" in (await getDoc(animeRef(db, "alice", "watchlist", "1"))).data(),
    false
  );
});

test("legacy reconciliation lists from one through eight tasks can be cleared safely", async () => {
  const db = testEnv.authenticatedContext("alice").firestore();
  for (let taskCount = 1; taskCount <= 8; taskCount += 1) {
    const animeId = String(taskCount);
    const tasks = Array.from({ length: taskCount }, (_, index) => ({
      sourceScope: index % 2 ? "completed" : "watchlist",
      sourceGroupId: `legacy-${taskCount}-${index}`,
      animeId
    }));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(animeRef(context.firestore(), "alice", "watchlist", animeId), {
        animeId,
        title: `Legacy ${taskCount}`,
        _groupingReconciliations: tasks
      });
    });
    await assertSucceeds(updateDoc(animeRef(db, "alice", "watchlist", animeId), {
      _groupingReconciliations: deleteField()
    }));
  }
});

test("one atomic move may provenance-check both source and destination group tasks", async () => {
  await seedAnime("alice", "watchlist", ["1", "2"]);
  await seedAnime("alice", "completed", ["1", "3"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  await createGroup(db, "alice", {
    groupId: "source-two-task",
    name: "Source Two Task",
    scopeKey: "watchlist",
    animeIds: ["1", "2"]
  });
  await createGroup(db, "alice", {
    groupId: "destination-two-task",
    name: "Destination Two Task",
    scopeKey: "completed",
    animeIds: ["1", "3"]
  });
  const tasks = [
    { sourceScope: "watchlist", sourceGroupId: "source-two-task", animeId: "1" },
    { sourceScope: "completed", sourceGroupId: "destination-two-task", animeId: "1" }
  ];

  await assertSucceeds(runTransaction(db, async (transaction) => {
    const source = animeRef(db, "alice", "watchlist", "1");
    const destination = animeRef(db, "alice", "completed", "1");
    const sourceSnapshot = await transaction.get(source);
    transaction.set(destination, {
      ...sourceSnapshot.data(),
      groupId: deleteField(),
      _groupingReconciliations: tasks,
      addedAt: serverTimestamp()
    }, { merge: true });
    transaction.delete(source);
  }));
  assert.deepEqual(
    (await getDoc(animeRef(db, "alice", "completed", "1"))).data()._groupingReconciliations,
    tasks
  );
});

test("a deleting Collection rejects additions and lock clearing but permits cleanup", async () => {
  await seedAnime("alice", "collection:favorites", ["1", "2"]);
  const db = testEnv.authenticatedContext("alice").firestore();
  await createGroup(db, "alice", {
    groupId: "favorites-group",
    name: "Favorites Group",
    scopeKey: "collection:favorites",
    animeIds: ["1", "2"]
  });
  const collectionRef = doc(db, "users", "alice", "collections", "favorites");
  await assertSucceeds(updateDoc(collectionRef, {
    deletionState: "deleting",
    updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(animeRef(db, "alice", "collection:favorites", "3"), {
    animeId: "3", title: "Blocked", addedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(collectionRef, { deletionState: deleteField() }));
  await assert.rejects(createGroup(db, "alice", {
    groupId: "blocked-group",
    name: "Blocked Group",
    scopeKey: "collection:favorites",
    animeIds: ["1", "2"]
  }));
  await assertSucceeds(updateDoc(
    animeRef(db, "alice", "collection:favorites", "1"),
    { groupId: deleteField() }
  ));
  await assertFails(updateDoc(
    animeRef(db, "alice", "collection:favorites", "2"),
    { title: "Blocked edit" }
  ));
  const otherCollection = doc(db, "users", "alice", "collections", "other");
  await assertSucceeds(setDoc(otherCollection, { name: "Other", createdAt: serverTimestamp() }));
  await assertSucceeds(setDoc(animeRef(db, "alice", "collection:other", "3"), {
    animeId: "3", title: "Allowed elsewhere", addedAt: serverTimestamp()
  }));
});
