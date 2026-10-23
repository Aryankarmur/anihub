import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithEmailAndPassword, deleteUser, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db, isIsolatedFirebasePreview } from "../src/firebase/firebaseConfig";
import {
  addToWatchlist,
  addToCompleted,
  addToCollection,
  removeFromCollection,
  createCollection,
  deleteCollection,
  createGroup,
  updateGroup,
  renameGroup,
  deleteGroupFromFirestore,
  deleteUserDataFromFirestore,
} from "../src/firebase/firestore";
import {
  runAutoGroupingReconciliation,
} from "../src/firebase/autoGroupingService";
import {
  deriveVisibleGroups,
  getGroupNameReservationId,
  partitionAnimeByVisibleGroups,
} from "../src/firebase/groupingUtils";
import {
  setGroupingCapabilityOverrides,
  resetGroupingCapabilityOverrides,
  isGroupingDataCompatibilityEnabled,
  isGroupingPresentationEnabled,
  isAutomaticReconciliationEnabled,
} from "../src/firebase/groupingFeatureGate";

const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const aliceEmail = `alice-rollback-${runId}@anihub.test`;
const bobEmail = `bob-rollback-${runId}@anihub.test`;
const daveEmail = `dave-rollback-${runId}@anihub.test`;
const password = "RollbackSafety123!";

let aliceUid;
let bobUid;
let daveUid;
let aliceCred;
let bobCred;
let daveCred;

const animeDoc = (animeId, title, relations = []) => ({
  animeId: String(animeId),
  title,
  image: `https://example.com/${animeId}.jpg`,
  type: "TV",
  score: 8.5,
  anilistRelations: relations,
});

beforeAll(async () => {
  if (!isIsolatedFirebasePreview) {
    throw new Error("Refusing to run rollback emulator suite outside isolated preview emulators.");
  }

  // Create primary test user (Alice)
  aliceCred = await createUserWithEmailAndPassword(auth, aliceEmail, password);
  aliceUid = aliceCred.user.uid;
});

afterAll(async () => {
  resetGroupingCapabilityOverrides();

  // Cleanup Bob if created
  if (bobCred?.user) {
    try {
      await deleteUserDataFromFirestore(db, bobUid);
      await deleteUser(bobCred.user);
    } catch {
      // Best-effort cleanup
    }
  }

  // Cleanup Alice
  if (aliceCred?.user) {
    try {
      await deleteUserDataFromFirestore(db, aliceUid);
      await deleteUser(aliceCred.user);
    } catch {
      // Best-effort cleanup
    }
  }
});

describe("AniHub F01 Phase G1.4C — Complete Rollback & Capability Control Test Suite", () => {
  let autoGroupId;
  let manualGroupId;
  let col1Id;
  let col2Id;

  // 1. Create an automatic group
  it("1. creates an automatic group when auto-reconciliation is active", async () => {
    const a1 = animeDoc("910000001", "Titan Saga Season 1", [
      { relatedId: "910000002", relationType: "SEQUEL" },
    ]);
    const a2 = animeDoc("910000002", "Titan Saga Season 2", [
      { relatedId: "910000001", relationType: "PREQUEL" },
    ]);

    await addToWatchlist(aliceUid, a1);
    await addToWatchlist(aliceUid, a2);

    const reconcileResult = await runAutoGroupingReconciliation({
      uid: aliceUid,
      scopeKey: "watchlist",
      animeDocuments: [a1, a2],
    });

    expect(reconcileResult).toBeTruthy();
    expect(reconcileResult.created.length).toBe(1);
    autoGroupId = reconcileResult.created[0].groupId;

    const groupSnap = await getDoc(doc(db, "users", aliceUid, "groups", autoGroupId));
    expect(groupSnap.exists()).toBe(true);
    expect(groupSnap.data().groupType).toBe("automatic");

    const w1Snap = await getDoc(doc(db, "users", aliceUid, "watchlist", "910000001"));
    const w2Snap = await getDoc(doc(db, "users", aliceUid, "watchlist", "910000002"));
    expect(w1Snap.data().groupId).toBe(autoGroupId);
    expect(w2Snap.data().groupId).toBe(autoGroupId);
  });

  // 2. Create a manual group
  it("2. creates a manual group in a custom collection", async () => {
    const colRes = await createCollection(aliceUid, { name: "Action Favorites" });
    col1Id = colRes.id;

    const a3 = animeDoc("910000003", "Action Hero 1");
    const a4 = animeDoc("910000004", "Action Hero 2");
    await addToCollection(aliceUid, col1Id, a3);
    await addToCollection(aliceUid, col1Id, a4);

    const manualRes = await createGroup(aliceUid, {
      name: "Manual Heroes",
      scopeKey: `collection:${col1Id}`,
      animeIds: ["910000003", "910000004"],
      groupType: "manual",
    });

    expect(manualRes.id).toBeTruthy();
    manualGroupId = manualRes.id;

    const groupSnap = await getDoc(doc(db, "users", aliceUid, "groups", manualGroupId));
    expect(groupSnap.exists()).toBe(true);
    expect(groupSnap.data().groupType).toBe("manual");
    expect(groupSnap.data().scopeKey).toBe(`collection:${col1Id}`);

    const colSnap = await getDoc(doc(db, "users", aliceUid, "collections", col1Id));
    expect(colSnap.data().groupingState?.groupCount).toBe(1);
  });

  // 3. Rename a group and change its thumbnail
  it("3. renames a group atomically and changes its thumbnail", async () => {
    const oldReservationId = await getGroupNameReservationId(
      `collection:${col1Id}`,
      "manual heroes"
    );
    const newReservationId = await getGroupNameReservationId(
      `collection:${col1Id}`,
      "renamed heroes"
    );

    const renameRes = await renameGroup(aliceUid, manualGroupId, "Renamed Heroes");
    expect(renameRes.error).toBeNull();

    const oldResSnap = await getDoc(
      doc(db, "users", aliceUid, "groupNameKeys", oldReservationId)
    );
    const newResSnap = await getDoc(
      doc(db, "users", aliceUid, "groupNameKeys", newReservationId)
    );
    expect(oldResSnap.exists()).toBe(false);
    expect(newResSnap.exists()).toBe(true);

    const updateRes = await updateGroup(aliceUid, manualGroupId, {
      thumbnailAnimeId: "910000004",
    });
    expect(updateRes.error).toBeNull();

    const groupSnap = await getDoc(doc(db, "users", aliceUid, "groups", manualGroupId));
    expect(groupSnap.data().name).toBe("Renamed Heroes");
    expect(groupSnap.data().thumbnailAnimeId).toBe("910000004");
  });

  // 4. Disable automatic reconciliation
  it("4. disables automatic reconciliation capability independently", () => {
    setGroupingCapabilityOverrides({ autoReconciliation: false });
    expect(isAutomaticReconciliationEnabled()).toBe(false);
    expect(isGroupingPresentationEnabled()).toBe(true);
    expect(isGroupingDataCompatibilityEnabled()).toBe(true);
  });

  // 5. Confirm no new automatic groups are created
  it("5. confirms no new automatic groups are created when auto-reconciliation is disabled", async () => {
    const a5 = animeDoc("910000005", "Unorganized Sequel Part 1", [
      { relatedId: "910000006", relationType: "SEQUEL" },
    ]);
    const a6 = animeDoc("910000006", "Unorganized Sequel Part 2", [
      { relatedId: "910000005", relationType: "PREQUEL" },
    ]);

    await addToWatchlist(aliceUid, a5);
    await addToWatchlist(aliceUid, a6);

    const result = await runAutoGroupingReconciliation({
      uid: aliceUid,
      scopeKey: "watchlist",
      animeDocuments: [a5, a6],
    });

    expect(result).toBeNull();

    const a5Snap = await getDoc(doc(db, "users", aliceUid, "watchlist", "910000005"));
    const a6Snap = await getDoc(doc(db, "users", aliceUid, "watchlist", "910000006"));
    expect(a5Snap.data().groupId).toBeUndefined();
    expect(a6Snap.data().groupId).toBeUndefined();
  });

  // 6. Disable grouping presentation
  it("6. disables grouping presentation independently while preserving data compatibility", () => {
    setGroupingCapabilityOverrides({
      autoReconciliation: false,
      presentation: false,
      dataCompatibility: true,
    });
    expect(isGroupingPresentationEnabled()).toBe(false);
    expect(isAutomaticReconciliationEnabled()).toBe(false);
    expect(isGroupingDataCompatibilityEnabled()).toBe(true);
  });

  // 7. Confirm all saved anime remain visible
  it("7. confirms all saved anime remain visible when grouping presentation is disabled", async () => {
    const watchlistSnap = await getDocs(collection(db, "users", aliceUid, "watchlist"));
    const docs = watchlistSnap.docs.map((d) => d.data());
    expect(docs.length).toBeGreaterThanOrEqual(4);

    // When presentation is disabled, UI components derive zero visible groups
    const visibleGroups = deriveVisibleGroups([], docs);
    const { standalone } = partitionAnimeByVisibleGroups(docs, visibleGroups);

    expect(visibleGroups.length).toBe(0);
    expect(standalone.length).toBe(docs.length);
    // Anime with existing groupId (e.g. 910000001, 910000002) are NOT hidden
    const ids = standalone.map((a) => a.animeId);
    expect(ids).toContain("910000001");
    expect(ids).toContain("910000002");
    expect(ids).toContain("910000005");
    expect(ids).toContain("910000006");
  });

  // 8. Move grouped anime between Watchlist and Completed
  it("8. moves grouped anime between Watchlist and Completed safely during rollback", async () => {
    const a1Snap = await getDoc(doc(db, "users", aliceUid, "watchlist", "910000001"));
    expect(a1Snap.exists()).toBe(true);
    expect(a1Snap.data().groupId).toBe(autoGroupId);

    // Movement must use data-compatibility layer to avoid corrupting Firestore group data
    await addToCompleted(aliceUid, a1Snap.data());

    const destSnap = await getDoc(doc(db, "users", aliceUid, "completed", "910000001"));
    const srcSnap = await getDoc(doc(db, "users", aliceUid, "watchlist", "910000001"));
    expect(destSnap.exists()).toBe(true);
    expect(srcSnap.exists()).toBe(false);
    expect(destSnap.data().groupId).toBeUndefined();
  });

  // 9. Confirm membership references remain consistent
  it("9. confirms membership references remain consistent after movement dissolution", async () => {
    // The auto group originally had 910000001 and 910000002.
    // When 910000001 moved to Completed, the remaining group was a singleton.
    // Data compatibility dissolved the singleton:
    const remainingGroupSnap = await getDoc(doc(db, "users", aliceUid, "groups", autoGroupId));
    expect(remainingGroupSnap.exists()).toBe(false);

    // Remaining anime in Watchlist (910000002) had its stale groupId cleared
    const a2Snap = await getDoc(doc(db, "users", aliceUid, "watchlist", "910000002"));
    expect(a2Snap.exists()).toBe(true);
    expect(a2Snap.data().groupId).toBeUndefined();
  });

  // 10. Remove a grouped anime from a custom Collection
  it("10. removes a grouped anime from a custom Collection during rollback", async () => {
    const itemSnap = await getDoc(doc(db, "users", aliceUid, "collections", col1Id, "items", "910000003"));
    expect(itemSnap.exists()).toBe(true);
    expect(itemSnap.data().groupId).toBe(manualGroupId);

    await removeFromCollection(aliceUid, col1Id, "910000003");

    const deletedItemSnap = await getDoc(doc(db, "users", aliceUid, "collections", col1Id, "items", "910000003"));
    expect(deletedItemSnap.exists()).toBe(false);
  });

  // 11. Confirm cleanup works without automatic grouping
  it("11. confirms cleanup works without automatic grouping and dissolves the remaining singleton", async () => {
    // Group had 910000003 and 910000004. Removing 910000003 dissolved the singleton group:
    const groupSnap = await getDoc(doc(db, "users", aliceUid, "groups", manualGroupId));
    expect(groupSnap.exists()).toBe(false);

    // Collection counter decremented to 0
    const colSnap = await getDoc(doc(db, "users", aliceUid, "collections", col1Id));
    expect(colSnap.data().groupingState?.groupCount).toBe(0);

    // Remaining anime has groupId cleared
    const a4Snap = await getDoc(doc(db, "users", aliceUid, "collections", col1Id, "items", "910000004"));
    expect(a4Snap.exists()).toBe(true);
    expect(a4Snap.data().groupId).toBeUndefined();
  });

  // 12. Delete a grouped Collection
  it("12. deletes a grouped Collection during rollback", async () => {
    const col2Res = await createCollection(aliceUid, { name: "Temporary To Delete" });
    col2Id = col2Res.id;

    await addToCollection(aliceUid, col2Id, animeDoc("910000007", "Temp 1"));
    await addToCollection(aliceUid, col2Id, animeDoc("910000008", "Temp 2"));

    const tempGroupRes = await createGroup(aliceUid, {
      name: "Temp Group",
      scopeKey: `collection:${col2Id}`,
      animeIds: ["910000007", "910000008"],
      groupType: "manual",
    });
    expect(tempGroupRes.id).toBeTruthy();

    const colBefore = await getDoc(doc(db, "users", aliceUid, "collections", col2Id));
    expect(colBefore.data().groupingState?.groupCount).toBe(1);

    // Delete collection during rollback
    const delRes = await deleteCollection(aliceUid, col2Id);
    expect(delRes.error).toBeNull();
  });

  // 13. Confirm groups, name reservations, and counters are cleaned up
  it("13. confirms scoped groups, name reservations, and items are completely cleaned up", async () => {
    const colSnap = await getDoc(doc(db, "users", aliceUid, "collections", col2Id));
    expect(colSnap.exists()).toBe(false);

    const scopedGroups = await getDocs(
      query(collection(db, "users", aliceUid, "groups"), where("scopeKey", "==", `collection:${col2Id}`))
    );
    expect(scopedGroups.size).toBe(0);

    const tempResId = await getGroupNameReservationId(`collection:${col2Id}`, "temp group");
    const resSnap = await getDoc(doc(db, "users", aliceUid, "groupNameKeys", tempResId));
    expect(resSnap.exists()).toBe(false);
  });

  // 14. Delete an account containing grouped data
  it("14. deletes an account containing grouped data cleanly", async () => {
    daveCred = await createUserWithEmailAndPassword(auth, daveEmail, password);
    daveUid = daveCred.user.uid;

    // Seed Dave with Watchlist, Completed, Collection, and Groups
    await addToWatchlist(daveUid, animeDoc("920000001", "Dave Watch 1"));
    await addToWatchlist(daveUid, animeDoc("920000002", "Dave Watch 2"));
    await createGroup(daveUid, {
      name: "Dave Watch Group",
      scopeKey: "watchlist",
      animeIds: ["920000001", "920000002"],
      groupType: "manual",
    });

    const daveCol = await createCollection(daveUid, { name: "Dave Col" });
    await addToCollection(daveUid, daveCol.id, animeDoc("920000003", "Dave Col 1"));
    await addToCollection(daveUid, daveCol.id, animeDoc("920000004", "Dave Col 2"));
    await createGroup(daveUid, {
      name: "Dave Col Group",
      scopeKey: `collection:${daveCol.id}`,
      animeIds: ["920000003", "920000004"],
      groupType: "manual",
    });

    await setDoc(doc(db, "users", daveUid), {
      displayName: "Dave",
      email: daveEmail,
      groupingState: { hasData: true },
    }, { merge: true });

    // Execute account deletion
    const delResult = await deleteUserDataFromFirestore(db, daveUid);
    expect(delResult.error).toBeNull();
    expect(delResult.data.deletedGroupIds.length).toBe(2);
    expect(delResult.data.profileDeleted).toBe(true);
  });

  // 15. Confirm all owned data is removed
  it("15. confirms all owned data is removed after account deletion", async () => {
    const userSnap = await getDoc(doc(db, "users", daveUid));
    expect(userSnap.exists()).toBe(false);

    const groupsSnap = await getDocs(collection(db, "users", daveUid, "groups"));
    expect(groupsSnap.size).toBe(0);

    const reservationsSnap = await getDocs(collection(db, "users", daveUid, "groupNameKeys"));
    expect(reservationsSnap.size).toBe(0);

    const watchlistSnap = await getDocs(collection(db, "users", daveUid, "watchlist"));
    expect(watchlistSnap.size).toBe(0);

    const collectionsSnap = await getDocs(collection(db, "users", daveUid, "collections"));
    expect(collectionsSnap.size).toBe(0);
  });

  // 16. Reload and retry interrupted operations
  it("16. recovers and retries interrupted group deletion without orphan data", async () => {
    // Re-authenticate as Alice (since test 14 authenticated as Dave)
    await signInWithEmailAndPassword(auth, aliceEmail, password);

    // Create a group for Alice to interrupt
    const a7 = animeDoc("910000007", "Interrupted 1");
    const a8 = animeDoc("910000008", "Interrupted 2");
    await addToWatchlist(aliceUid, a7);
    await addToWatchlist(aliceUid, a8);

    const interGroup = await createGroup(aliceUid, {
      name: "Interrupted Group",
      scopeKey: "watchlist",
      animeIds: ["910000007", "910000008"],
      groupType: "manual",
    });

    // Simulate interrupted deletion by setting status = 'deleting' in Firestore
    await setDoc(
      doc(db, "users", aliceUid, "groups", interGroup.id),
      { status: "deleting", updatedAt: serverTimestamp() },
      { merge: true }
    );

    // Call deleteGroupFromFirestore to retry and finish deletion
    const retryResult = await deleteGroupFromFirestore(db, aliceUid, interGroup.id);
    expect(retryResult.error).toBeNull();

    const groupSnap = await getDoc(doc(db, "users", aliceUid, "groups", interGroup.id));
    expect(groupSnap.exists()).toBe(false);

    const a7Snap = await getDoc(doc(db, "users", aliceUid, "watchlist", "910000007"));
    expect(a7Snap.data().groupId).toBeUndefined();
  });

  // 17. Confirm cross-user and cross-scope protections
  it("17. enforces cross-user and cross-scope protections under emulator rules", async () => {
    bobCred = await createUserWithEmailAndPassword(auth, bobEmail, password);
    bobUid = bobCred.user.uid;

    await addToWatchlist(bobUid, animeDoc("930000001", "Bob 1"));
    await addToWatchlist(bobUid, animeDoc("930000002", "Bob 2"));
    const bobGroup = await createGroup(bobUid, {
      name: "Bob Saga",
      scopeKey: "watchlist",
      animeIds: ["930000001", "930000002"],
      groupType: "manual",
    });

    // Sign back in as Alice to test unauthorized access to Bob's data
    await signInWithEmailAndPassword(auth, aliceEmail, password);

    // Alice attempts to write to Bob's group -> Rejected by Firestore Rules
    await expect(
      setDoc(doc(db, "users", bobUid, "groups", bobGroup.id), { name: "Hacked" }, { merge: true })
    ).rejects.toThrow();

    // Alice attempts to assign Bob's groupId to her own anime -> Rejected by Firestore Rules
    await expect(
      setDoc(doc(db, "users", aliceUid, "watchlist", "910000007"), { groupId: bobGroup.id }, { merge: true })
    ).rejects.toThrow();

    // Alice attempts to assign a Watchlist group to a Completed anime -> Rejected by Rules
    await expect(
      setDoc(doc(db, "users", aliceUid, "completed", "910000001"), { groupId: bobGroup.id }, { merge: true })
    ).rejects.toThrow();
  });

  // 18. Verify that restoring UI presentation displays retained groups correctly
  it("18. restores UI presentation of retained groups when presentation is re-enabled", async () => {
    // Create a fresh group in Watchlist for Alice
    const r1 = animeDoc("910000011", "Retained Part 1");
    const r2 = animeDoc("910000012", "Retained Part 2");
    await addToWatchlist(aliceUid, r1);
    await addToWatchlist(aliceUid, r2);

    const retainedRes = await createGroup(aliceUid, {
      name: "Retained Chronicle",
      scopeKey: "watchlist",
      animeIds: ["910000011", "910000012"],
      groupType: "manual",
    });

    const groupSnap = await getDoc(doc(db, "users", aliceUid, "groups", retainedRes.id));
    const retainedGroup = { ...groupSnap.data(), groupId: retainedRes.id };

    // With presentation disabled:
    setGroupingCapabilityOverrides({ presentation: false });
    expect(isGroupingPresentationEnabled()).toBe(false);

    // Restoring presentation:
    resetGroupingCapabilityOverrides();
    expect(isGroupingPresentationEnabled()).toBe(true);

    const animeList = [
      { ...r1, groupId: retainedRes.id },
      { ...r2, groupId: retainedRes.id },
    ];
    const visibleGroups = deriveVisibleGroups([retainedGroup], animeList);
    const { grouped, standalone } = partitionAnimeByVisibleGroups(animeList, visibleGroups);

    expect(visibleGroups.length).toBe(1);
    expect(visibleGroups[0].name).toBe("Retained Chronicle");
    expect(grouped.get(retainedRes.id).length).toBe(2);
    expect(standalone.length).toBe(0);
  });
});
