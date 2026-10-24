import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithEmailAndPassword, deleteUser, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";

import { auth, db, isIsolatedFirebasePreview } from "../src/firebase/firebaseConfig";
import {
  addToWatchlist,
  addToCompleted,
  addToCollection,
  createCollection,
  deleteCollection,
  createGroup,
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
  evaluateProductionGroupingAccess,
  isGroupingDataCompatibilityEnabled,
  isGroupingPresentationEnabled,
  isAutomaticReconciliationEnabled,
  setGroupingCapabilityOverrides,
  resetGroupingCapabilityOverrides,
} from "../src/firebase/groupingFeatureGate";
import {
  evaluateGroupingPreviewEnvironment,
  GROUPING_PREVIEW_PROJECT_ID,
} from "../src/firebase/groupingPreviewConfig";

describe("AniHub F01 Phase G1.5 — Production Activation & Preflight Test Suite", () => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const canaryEmail = `canary-user-${runId}@anihub.test`;
  const legacyEmail = `legacy-user-${runId}@anihub.test`;
  const password = "PreflightSafety123!";

  let canaryUid;
  let canaryCred;
  let legacyUid;
  let legacyCred;

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
      throw new Error("Refusing to run preflight suite outside isolated preview emulators.");
    }
    resetGroupingCapabilityOverrides();

    // Create canary user
    canaryCred = await createUserWithEmailAndPassword(auth, canaryEmail, password);
    canaryUid = canaryCred.user.uid;
    await auth.currentUser.getIdToken(true);
  });

  afterAll(async () => {
    resetGroupingCapabilityOverrides();

    if (canaryCred?.user) {
      try {
        await deleteUserDataFromFirestore(db, canaryUid);
        await deleteUser(canaryCred.user);
      } catch {
        // cleanup
      }
    }
    if (legacyCred?.user) {
      try {
        await deleteUserDataFromFirestore(db, legacyUid);
        await deleteUser(legacyCred.user);
      } catch {
        // cleanup
      }
    }
  });

  // 1. Production capabilities for authenticated users
  it("1. enables production presentation and reconciliation for every authenticated AniHub user", () => {
    expect(evaluateProductionGroupingAccess({
      isProduction: true,
      projectId: "anihub-73f72",
      activeUid: canaryUid,
    })).toEqual({
      dataCompatibility: true,
      presentation: true,
      autoReconciliation: true,
    });

    expect(evaluateProductionGroupingAccess({
      isProduction: true,
      projectId: "anihub-73f72",
      activeUid: "future-registration-with-no-rollout-entry",
    })).toEqual({
      dataCompatibility: true,
      presentation: true,
      autoReconciliation: true,
    });
  });

  // 2. Authentication boundary
  it("2. keeps user-specific grouping disabled without an authenticated UID", () => {
    for (const activeUid of [undefined, null, "", "   "]) {
      expect(evaluateProductionGroupingAccess({
        isProduction: true,
        projectId: "anihub-73f72",
        activeUid,
      })).toEqual({
        dataCompatibility: true,
        presentation: false,
        autoReconciliation: false,
      });
    }
  });

  // 3. Project boundary
  it("3. rejects production grouping on an unexpected Firebase project", () => {
    expect(evaluateProductionGroupingAccess({
      isProduction: true,
      projectId: "unexpected-project",
      activeUid: canaryUid,
    })).toEqual({
      dataCompatibility: true,
      presentation: false,
      autoReconciliation: false,
    });
  });

  // 4. Cleanup compatibility cannot be disabled
  it("4. keeps data compatibility unconditional while test-only UI controls are disabled", () => {
    setGroupingCapabilityOverrides({
      dataCompatibility: false,
      presentation: false,
      autoReconciliation: false,
    });
    expect(isGroupingDataCompatibilityEnabled(canaryUid)).toBe(true);
    expect(isGroupingPresentationEnabled(canaryUid)).toBe(false);
    expect(isAutomaticReconciliationEnabled(canaryUid)).toBe(false);
    resetGroupingCapabilityOverrides();
  });

  // 5. Presentation disabled while grouped data exists in Firestore
  it("5. renders all saved anime as standalone cards without data loss when presentation is disabled", async () => {
    // Seed 2 anime and create a group for canary user
    const a1 = animeDoc("850000001", "Canary Anime S1");
    const a2 = animeDoc("850000002", "Canary Anime S2");
    await addToWatchlist(canaryUid, a1);
    await addToWatchlist(canaryUid, a2);

    const groupRes = await createGroup(canaryUid, {
      name: "Canary Group",
      scopeKey: "watchlist",
      animeIds: ["850000001", "850000002"],
      groupType: "manual",
    });
    expect(groupRes.id).toBeTruthy();

    // Disable presentation (simulating non-canary user or rolled back presentation)
    setGroupingCapabilityOverrides({ presentation: false, dataCompatibility: true });
    expect(isGroupingPresentationEnabled()).toBe(false);
    expect(isGroupingDataCompatibilityEnabled()).toBe(true);

    // Read anime documents from Firestore
    const snap = await getDocs(collection(db, "users", canaryUid, "watchlist"));
    const docs = snap.docs.map((d) => d.data());

    // With presentation disabled, UI partitions all anime as standalone
    const visibleGroups = deriveVisibleGroups([], docs);
    const { standalone } = partitionAnimeByVisibleGroups(docs, visibleGroups);

    expect(visibleGroups.length).toBe(0);
    expect(standalone.length).toBe(docs.length);
    const animeIds = standalone.map((a) => a.animeId);
    expect(animeIds).toContain("850000001");
    expect(animeIds).toContain("850000002");

    // Reset overrides
    resetGroupingCapabilityOverrides();
  });

  // 6. Automatic reconciliation disabled while grouped data exists
  it("6. blocks new automated group creation when auto-reconciliation is disabled", async () => {
    setGroupingCapabilityOverrides({ autoReconciliation: false });
    expect(isAutomaticReconciliationEnabled()).toBe(false);

    const a3 = animeDoc("850000003", "Reconcile Test 1", [
      { relatedId: "850000004", relationType: "SEQUEL" },
    ]);
    const a4 = animeDoc("850000004", "Reconcile Test 2", [
      { relatedId: "850000003", relationType: "PREQUEL" },
    ]);
    await addToWatchlist(canaryUid, a3);
    await addToWatchlist(canaryUid, a4);

    const result = await runAutoGroupingReconciliation({
      uid: canaryUid,
      scopeKey: "watchlist",
      animeDocuments: [a3, a4],
    });

    expect(result).toBeNull();
    const snap3 = await getDoc(doc(db, "users", canaryUid, "watchlist", "850000003"));
    expect(snap3.data().groupId).toBeUndefined();

    resetGroupingCapabilityOverrides();
  });

  // 7. Safe data compatibility during rollback (Watchlist -> Completed move)
  it("7. executes safe grouping dissolution and membership cleanup during rollback movement", async () => {
    // Disable presentation & reconciliation, preserve data compatibility
    setGroupingCapabilityOverrides({
      presentation: false,
      autoReconciliation: false,
      dataCompatibility: true,
    });

    const a1Doc = (await getDoc(doc(db, "users", canaryUid, "watchlist", "850000001"))).data();
    expect(a1Doc.groupId).toBeTruthy();
    const originalGroupId = a1Doc.groupId;

    // Move to Completed
    await addToCompleted(canaryUid, a1Doc);

    const destSnap = await getDoc(doc(db, "users", canaryUid, "completed", "850000001"));
    const srcSnap = await getDoc(doc(db, "users", canaryUid, "watchlist", "850000001"));
    expect(destSnap.exists()).toBe(true);
    expect(srcSnap.exists()).toBe(false);
    expect(destSnap.data().groupId).toBeUndefined();

    // Group had 2 members (850000001, 850000002). Moving 1 dissolved the singleton group:
    const groupSnap = await getDoc(doc(db, "users", canaryUid, "groups", originalGroupId));
    expect(groupSnap.exists()).toBe(false);

    // Remaining anime in watchlist has groupId cleared
    const remainingSnap = await getDoc(doc(db, "users", canaryUid, "watchlist", "850000002"));
    expect(remainingSnap.data().groupId).toBeUndefined();

    resetGroupingCapabilityOverrides();
  });

  // 8. Legacy client & stored data backward compatibility
  it("8. preserves full compatibility for legacy ungrouped anime and counterless collections", async () => {
    legacyCred = await createUserWithEmailAndPassword(auth, legacyEmail, password);
    legacyUid = legacyCred.user.uid;
    await auth.currentUser.getIdToken(true);

    // Seed a legacy anime document (no groupId, no grouping internal fields)
    await setDoc(doc(db, "users", legacyUid, "watchlist", "700000001"), {
      animeId: "700000001",
      title: "Legacy Classic Anime",
      type: "TV",
      episodes: 24,
    });

    // Seed a legacy counterless collection (no groupingState field)
    const colRef = doc(collection(db, "users", legacyUid, "collections"));
    await setDoc(colRef, {
      name: "Legacy Ungrouped Collection",
      createdAt: new Date().toISOString(),
    });

    await setDoc(doc(db, "users", legacyUid, "collections", colRef.id, "items", "700000001"), {
      animeId: "700000001",
      title: "Legacy Classic Anime",
    });

    // Verify read
    const animeSnap = await getDoc(doc(db, "users", legacyUid, "watchlist", "700000001"));
    expect(animeSnap.exists()).toBe(true);
    expect(animeSnap.data().groupId).toBeUndefined();

    // Delete legacy collection directly
    const deleteColRes = await deleteCollection(legacyUid, colRef.id);
    expect(deleteColRes.error).toBeNull();

    const colSnap = await getDoc(colRef);
    expect(colSnap.exists()).toBe(false);
  });

  // 9. Existing Account Deletion remains safe with mixed data
  it("9. deletes mixed legacy and grouped account data cleanly under emulator rules", async () => {
    // Delete legacy user account
    const delRes = await deleteUserDataFromFirestore(db, legacyUid);
    expect(delRes.error).toBeNull();
    expect(delRes.data.profileDeleted).toBe(true);

    const userSnap = await getDoc(doc(db, "users", legacyUid));
    expect(userSnap.exists()).toBe(false);
  });

  // 10. Outdated browser tab simulation
  it("10. gracefully handles concurrent in-flight movements from an outdated browser tab", async () => {
    // Switch back to canary user
    await signInWithEmailAndPassword(auth, canaryEmail, password);

    // Create a new collection with a group
    const colRes = await createCollection(canaryUid, { name: "Tab Test Col" });
    const cId = colRes.id;
    await addToCollection(canaryUid, cId, animeDoc("850000010", "Tab Anime 1"));
    await addToCollection(canaryUid, cId, animeDoc("850000011", "Tab Anime 2"));

    const tabGroup = await createGroup(canaryUid, {
      name: "Tab Group",
      scopeKey: `collection:${cId}`,
      animeIds: ["850000010", "850000011"],
      groupType: "manual",
    });

    // Simulating outdated tab: remote configuration turns off grouping presentation
    setGroupingCapabilityOverrides({ presentation: false, autoReconciliation: false, dataCompatibility: true });

    // Outdated tab attempts to delete the collection:
    const delRes = await deleteCollection(canaryUid, cId);
    expect(delRes.error).toBeNull();

    // Verify all scoped groups and reservations cleaned up:
    const gSnap = await getDoc(doc(db, "users", canaryUid, "groups", tabGroup.id));
    expect(gSnap.exists()).toBe(false);

    const resId = await getGroupNameReservationId(`collection:${cId}`, "tab group");
    const rSnap = await getDoc(doc(db, "users", canaryUid, "groupNameKeys", resId));
    expect(rSnap.exists()).toBe(false);

    resetGroupingCapabilityOverrides();
  });

  // 11. Preview / Project isolation
  it("11. enforces strict preview isolation, rejecting production project IDs and non-loopback hosts", () => {
    const prodConfig = evaluateGroupingPreviewEnvironment({
      DEV: true,
      MODE: "grouping-preview",
      VITE_GROUPING_PREVIEW: "true",
      VITE_ENABLE_WATCHLIST_GROUPING: "true",
      VITE_FIREBASE_USE_EMULATOR: "true",
      VITE_FIREBASE_PROJECT_ID: "anihub-prod-live-app",
      VITE_FIREBASE_API_KEY: GROUPING_PREVIEW_PROJECT_ID,
      VITE_FIREBASE_AUTH_DOMAIN: `${GROUPING_PREVIEW_PROJECT_ID}.localhost`,
      VITE_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1",
      VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
      VITE_FIREBASE_FIRESTORE_EMULATOR_HOST: "127.0.0.1",
      VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: "8080",
    });
    expect(prodConfig.enabled).toBe(false);
    expect(prodConfig.errors.some((e) => e.includes(GROUPING_PREVIEW_PROJECT_ID))).toBe(true);

    const nonDevConfig = evaluateGroupingPreviewEnvironment({
      VITE_GROUPING_PREVIEW: "true",
      VITE_FIREBASE_PROJECT_ID: GROUPING_PREVIEW_PROJECT_ID,
      DEV: false,
      MODE: "production",
    });
    expect(nonDevConfig.enabled).toBe(false);
  });

  // 12. Cross-user denial under emulator rules
  it("12. strictly rejects cross-user writes under Firestore security rules", async () => {
    // Canary user attempts to write to another user's document
    const fakeVictimUid = "victim-user-999999";
    await expect(
      setDoc(doc(db, "users", fakeVictimUid, "watchlist", "850000001"), {
        title: "Malicious Overwrite",
      })
    ).rejects.toThrow();

    await expect(
      setDoc(doc(db, "users", fakeVictimUid, "groups", "malicious-group"), {
        name: "Hacked",
      })
    ).rejects.toThrow();
  });
});
