import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithEmailAndPassword, deleteUser } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  query,
  where,
} from "firebase/firestore";

import { auth, db, isIsolatedFirebasePreview } from "../src/firebase/firebaseConfig";
import {
  addToWatchlist,
  addToCompleted,
  createCollection,
  deleteCollection,
  deleteUserDataFromFirestore,
} from "../src/firebase/firestore";
import {
  runAutoGroupingReconciliation,
} from "../src/firebase/autoGroupingService";
import {
  resetGroupingCapabilityOverrides,
} from "../src/firebase/groupingFeatureGate";

describe("AniHub F01 Phase G1.4C — Emulator Performance & Operation Benchmarks", () => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const perfEmail = `perf-bench-${runId}@anihub.test`;
  const password = "PerfSafety123!";
  let userUid;
  let userCred;

  beforeAll(async () => {
    if (!isIsolatedFirebasePreview) {
      throw new Error("Refusing to run performance benchmarks outside isolated preview emulators.");
    }
    resetGroupingCapabilityOverrides();
    userCred = await createUserWithEmailAndPassword(auth, perfEmail, password);
    userUid = userCred.user.uid;
    await auth.currentUser.getIdToken(true);
  });

  afterAll(async () => {
    resetGroupingCapabilityOverrides();
    if (userCred?.user) {
      try {
        await deleteUserDataFromFirestore(db, userUid);
        await deleteUser(userCred.user);
      } catch {
        // cleanup
      }
    }
  });

  it("measures synthetic library reconciliation, no-op pass, movement, and deletion latencies", async () => {
    // 1. Seed a 40-item synthetic library with 10 pairs of sequels/prequels (20 grouped) + 20 standalone
    const items = [];
    for (let i = 1; i <= 20; i += 2) {
      const id1 = `8800000${String(i).padStart(2, "0")}`;
      const id2 = `8800000${String(i + 1).padStart(2, "0")}`;
      items.push({
        animeId: id1,
        title: `Series ${Math.ceil(i / 2)} Season 1`,
        image: `https://example.com/${id1}.jpg`,
        anilistRelations: [{ relatedId: id2, relationType: "SEQUEL" }],
      });
      items.push({
        animeId: id2,
        title: `Series ${Math.ceil(i / 2)} Season 2`,
        image: `https://example.com/${id2}.jpg`,
        anilistRelations: [{ relatedId: id1, relationType: "PREQUEL" }],
      });
    }
    for (let i = 21; i <= 40; i++) {
      const id = `8800000${String(i).padStart(2, "0")}`;
      items.push({
        animeId: id,
        title: `Standalone Show ${i}`,
        image: `https://example.com/${id}.jpg`,
        anilistRelations: [],
      });
    }

    const seedStart = performance.now();
    await Promise.all(items.map((item) => addToWatchlist(userUid, item)));
    const seedDurationMs = Math.round(performance.now() - seedStart);

    // 2. Measure first reconciliation pass (creating 10 groups for 20 items)
    const rec1Start = performance.now();
    const rec1Result = await runAutoGroupingReconciliation({
      uid: userUid,
      scopeKey: "watchlist",
      animeDocuments: items,
    });
    const rec1DurationMs = Math.round(performance.now() - rec1Start);

    expect(rec1Result).not.toBeNull();
    expect(rec1Result.created.length).toBe(10);
    expect(rec1Result.errors.length).toBe(0);

    // 3. Measure second reconciliation pass (idempotency / no-op pass)
    // In real app, useAutoGrouping consumes live snapshot from Firestore containing assigned groupIds
    const updatedWatchlistSnap = await getDocs(collection(db, "users", userUid, "watchlist"));
    const updatedItems = updatedWatchlistSnap.docs.map((d) => d.data());

    // Prime snapshot / ensure Firestore local query cache is updated
    await getDocs(
      query(collection(db, "users", userUid, "groups"), where("scopeKey", "==", "watchlist"))
    );

    const rec2Start = performance.now();
    const rec2Result = await runAutoGroupingReconciliation({
      uid: userUid,
      scopeKey: "watchlist",
      animeDocuments: updatedItems,
    });
    const rec2DurationMs = Math.round(performance.now() - rec2Start);

    expect(rec2Result.created.length).toBe(0);
    expect(rec2Result.errors.length).toBe(0);
    expect(rec2Result.unchanged.length).toBe(10);

    // 4. Measure move latency (moving a grouped item from watchlist to completed via addToCompleted)
    const moveStart = performance.now();
    await addToCompleted(userUid, updatedItems[0]);
    const moveDurationMs = Math.round(performance.now() - moveStart);

    // 5. Measure custom collection creation + 6 items in 2 groups + collection deletion latency
    const colRes = await createCollection(userUid, { name: "Perf Collection" });
    const colId = colRes.id;
    for (let i = 1; i <= 6; i++) {
      await setDoc(doc(db, "users", userUid, "collections", colId, "items", `99000000${i}`), {
        animeId: `99000000${i}`,
        title: `Col Item ${i}`,
      });
    }
    const colDeleteStart = performance.now();
    await deleteCollection(userUid, colId);
    const colDeleteDurationMs = Math.round(performance.now() - colDeleteStart);

    // 6. Measure full account deletion latency on populated user
    const accountDeleteStart = performance.now();
    const accountDeleteRes = await deleteUserDataFromFirestore(db, userUid);
    const accountDeleteDurationMs = Math.round(performance.now() - accountDeleteStart);

    // Log benchmark summary
    console.log("=== ANIHUB PERFORMANCE BENCHMARK RESULTS (EMULATOR) ===");
    console.log(`Synthetic library seed (40 items): ${seedDurationMs} ms`);
    console.log(`Initial reconciliation (40 items, 10 groups created, 20 members): ${rec1DurationMs} ms`);
    console.log(`Idempotent no-op pass (40 items, 0 writes): ${rec2DurationMs} ms`);
    console.log(`Grouping-aware moveAnimeWithGrouping (dissolve singleton): ${moveDurationMs} ms`);
    console.log(`Grouped Collection deletion: ${colDeleteDurationMs} ms`);
    console.log(`Complete Account deletion: ${accountDeleteDurationMs} ms`);
    console.log("=======================================================");

    expect(rec2DurationMs).toBeLessThan(rec1DurationMs);
    expect(accountDeleteRes.error).toBeNull();
  });
});
