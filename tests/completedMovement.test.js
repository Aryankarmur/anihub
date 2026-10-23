import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  state: new Map(),
  transactionCalls: 0,
  failTransactionCall: null,
  deleteSentinel: Symbol("delete-field"),
  transactionReads: [],
}));

vi.mock("../src/firebase/firebaseConfig", () => ({ db: { kind: "mock-db" } }));
vi.mock("../src/firebase/groupingFeatureGate", () => ({ isAnimeGroupingEnabled: true }));
vi.mock("firebase/firestore", () => {
  const pathFor = (segments) => {
    const first = segments[0];
    return first?.path
      ? [first.path, ...segments.slice(1)].join("/")
      : segments.slice(1).join("/");
  };
  const reference = (segments) => {
    const path = pathFor(segments);
    return { path, id: path.split("/").at(-1) };
  };
  const snapshot = (ref) => ({
    id: ref.id,
    ref,
    exists: () => harness.state.has(ref.path),
    data: () => harness.state.get(ref.path),
  });
  const applyData = (current, incoming, merge) => {
    const next = merge ? { ...(current || {}) } : {};
    Object.entries(incoming).forEach(([key, value]) => {
      if (value === harness.deleteSentinel) delete next[key];
      else next[key] = value;
    });
    return next;
  };
  const queryDocs = (input) => {
    const ref = input.reference || input;
    const constraints = input.constraints || [];
    const prefix = `${ref.path}/`;
    let docs = [...harness.state.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path]) => snapshot({ path, id: path.split("/").at(-1) }));
    constraints.forEach((constraint) => {
      if (constraint.type === "where") {
        docs = docs.filter((docSnap) => docSnap.data()?.[constraint.field] === constraint.value);
      }
      if (constraint.type === "limit") docs = docs.slice(0, constraint.value);
    });
    return {
      docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: (callback) => docs.forEach(callback),
    };
  };
  const runTransaction = vi.fn(async (_db, callback) => {
    harness.transactionCalls += 1;
    const callNumber = harness.transactionCalls;
    const writes = [];
    const transaction = {
      get: async (ref) => {
        harness.transactionReads.push(ref.path);
        return snapshot(ref);
      },
      set: (ref, data, options = {}) => writes.push({ type: "set", ref, data, options }),
      update: (ref, data) => writes.push({ type: "update", ref, data }),
      delete: (ref) => writes.push({ type: "delete", ref }),
    };
    const result = await callback(transaction);
    if (harness.failTransactionCall === callNumber) throw new Error("atomic commit failed");
    writes.forEach((write) => {
      if (write.type === "delete") harness.state.delete(write.ref.path);
      else harness.state.set(
        write.ref.path,
        applyData(harness.state.get(write.ref.path), write.data, write.type === "update" || write.options.merge),
      );
    });
    return result;
  });
  return {
    addDoc: vi.fn(),
    collection: (...segments) => reference(segments),
    deleteDoc: vi.fn(async (ref) => { harness.state.delete(ref.path); }),
    deleteField: vi.fn(() => harness.deleteSentinel),
    doc: (...segments) => reference(segments),
    getCountFromServer: vi.fn(),
    getDoc: vi.fn(async (ref) => snapshot(ref)),
    getDocs: vi.fn(async (input) => queryDocs(input)),
    limit: vi.fn((value) => ({ type: "limit", value })),
    onSnapshot: vi.fn(),
    query: vi.fn((ref, ...constraints) => ({ reference: ref, constraints })),
    runTransaction,
    serverTimestamp: vi.fn(() => "server-timestamp"),
    setDoc: vi.fn(),
    updateDoc: vi.fn(async (ref, data) => {
      harness.state.set(ref.path, applyData(harness.state.get(ref.path), data, true));
    }),
    where: vi.fn((field, operator, value) => ({ type: "where", field, operator, value })),
    writeBatch: vi.fn(() => ({
      set: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

import {
  addToCompleted,
  removeFromCompleted,
  retryMovementGroupReconciliation,
} from "../src/firebase/firestore";
import {
  collectMovementReconciliations,
  normalizeMovementReconciliations,
} from "../src/firebase/movementUtils";

const path = (scope, animeId) => `users/user-1/${scope}/${animeId}`;
const setAnime = (scope, animeId, data = {}) => {
  harness.state.set(path(scope, animeId), {
    animeId,
    title: `Anime ${animeId}`,
    image: `${animeId}.jpg`,
    type: "TV",
    score: 8,
    addedAt: `added-${animeId}`,
    ...data,
  });
};
const setGroup = (scope, groupId, memberIds) => {
  const reservationId = `${groupId}-reservation`;
  harness.state.set(`users/user-1/groups/${groupId}`, {
    name: groupId,
    normalizedName: groupId,
    reservationId,
    scopeKey: scope,
    collectionId: null,
    thumbnailAnimeId: memberIds[0],
    status: "active",
    createdAt: "created",
    updatedAt: "updated",
  });
  harness.state.set(`users/user-1/groupNameKeys/${reservationId}`, {
    groupId,
    scopeKey: scope,
  });
  memberIds.forEach((animeId) => {
    const collectionName = scope === "completed" ? "completed" : "watchlist";
    setAnime(collectionName, animeId, { groupId });
  });
};
const destinationData = (scope, animeId) => harness.state.get(path(scope, animeId));

describe("F02 movement with grouping enabled", () => {
  beforeEach(() => {
    harness.state.clear();
    harness.transactionCalls = 0;
    harness.failTransactionCall = null;
    harness.transactionReads.length = 0;
  });

  it("moves an ungrouped Watchlist anime to Completed ungrouped", async () => {
    setAnime("watchlist", "1");
    const result = await addToCompleted("user-1", { animeId: "1", title: "Anime 1" });
    expect(result.data.movementCommitted).toBe(true);
    expect(harness.state.has(path("watchlist", "1"))).toBe(false);
    expect(destinationData("completed", "1").groupId).toBeUndefined();
  });

  it("keeps a three-member source group when movement leaves two members", async () => {
    setGroup("watchlist", "watch-group", ["1", "2", "3"]);
    await addToCompleted("user-1", { animeId: "1", title: "Anime 1" });
    expect(harness.state.get("users/user-1/groups/watch-group").status).toBe("active");
    expect(destinationData("watchlist", "2").groupId).toBe("watch-group");
    expect(destinationData("watchlist", "3").groupId).toBe("watch-group");
  });

  it("dissolves a two-member Watchlist group after movement", async () => {
    setGroup("watchlist", "watch-group", ["1", "2"]);
    await addToCompleted("user-1", { animeId: "1", title: "Anime 1" });
    expect(harness.state.has("users/user-1/groups/watch-group")).toBe(false);
    expect(destinationData("watchlist", "2").groupId).toBeUndefined();
    expect(destinationData("completed", "1").groupId).toBeUndefined();
  });

  it("moves an ungrouped Completed anime back to Watchlist", async () => {
    setAnime("completed", "1");
    await removeFromCompleted("user-1", "1", true);
    expect(harness.state.has(path("completed", "1"))).toBe(false);
    expect(destinationData("watchlist", "1").groupId).toBeUndefined();
  });

  it("dissolves a two-member Completed group after restoration", async () => {
    setGroup("completed", "completed-group", ["1", "2"]);
    await removeFromCompleted("user-1", "1", true);
    expect(harness.state.has("users/user-1/groups/completed-group")).toBe(false);
    expect(destinationData("completed", "2").groupId).toBeUndefined();
    expect(destinationData("watchlist", "1").groupId).toBeUndefined();
  });

  it("clears and reconciles a stale destination groupId", async () => {
    setAnime("watchlist", "1");
    setGroup("completed", "stale-destination", ["1", "2"]);
    await addToCompleted("user-1", { animeId: "1", title: "Moved" });
    expect(destinationData("completed", "1").groupId).toBeUndefined();
    expect(harness.state.has("users/user-1/groups/stale-destination")).toBe(false);
    expect(destinationData("completed", "2").groupId).toBeUndefined();
  });

  it("does not modify matching anime in a custom Collection", async () => {
    setGroup("watchlist", "watch-group", ["1", "2"]);
    harness.state.set("users/user-1/collections/favorites/items/1", {
      animeId: "1",
      title: "Favorite",
      groupId: "favorite-group",
    });
    await addToCompleted("user-1", { animeId: "1", title: "Moved" });
    expect(harness.state.get("users/user-1/collections/favorites/items/1")).toEqual({
      animeId: "1",
      title: "Favorite",
      groupId: "favorite-group",
    });
  });

  it("preserves arbitrary saved metadata and migration flags", async () => {
    setAnime("completed", "1", {
      _migratedFromLegacy: true,
      customMetadata: { note: "preserve me" },
    });
    await removeFromCompleted("user-1", "1", true);
    expect(destinationData("watchlist", "1")).toEqual(expect.objectContaining({
      _migratedFromLegacy: true,
      customMetadata: { note: "preserve me" },
      title: "Anime 1",
      image: "1.jpg",
      type: "TV",
      score: 8,
    }));
  });

  it("leaves the source intact when the atomic movement commit fails", async () => {
    setAnime("watchlist", "1", { groupId: "group-1" });
    harness.failTransactionCall = 1;
    await expect(addToCompleted("user-1", { animeId: "1", title: "Moved" }))
      .rejects.toThrow("atomic commit failed");
    expect(harness.state.has(path("watchlist", "1"))).toBe(true);
    expect(harness.state.has(path("completed", "1"))).toBe(false);
  });

  it("persists interrupted cleanup and finishes it on a repeated movement", async () => {
    setGroup("watchlist", "watch-group", ["1", "2"]);
    harness.failTransactionCall = 2;
    const first = await addToCompleted("user-1", { animeId: "1", title: "Moved" });
    expect(first.data.reconciliation.status).toBe("pending");
    expect(destinationData("completed", "1")._groupingReconciliations).toHaveLength(1);
    harness.failTransactionCall = null;
    await addToCompleted("user-1", { animeId: "1", title: "Moved" });
    expect(destinationData("completed", "1")._groupingReconciliations).toBeUndefined();
    expect(destinationData("watchlist", "2").groupId).toBeUndefined();
  });

  it("captures source and destination documents in the atomic transaction", async () => {
    setAnime("watchlist", "1", { groupId: "concurrent-group" });
    await addToCompleted("user-1", { animeId: "1", title: "Moved" });
    expect(harness.transactionReads.slice(0, 2)).toEqual([
      path("watchlist", "1"),
      path("completed", "1"),
    ]);
  });

  it("refuses reconciliation against a group in another scope", async () => {
    setGroup("completed", "completed-group", ["1", "2"]);
    await expect(retryMovementGroupReconciliation("user-1", {
      sourceScope: "watchlist",
      sourceGroupId: "completed-group",
      animeId: "1",
    })).rejects.toMatchObject({ code: "grouping/scope-mismatch" });
    expect(harness.state.has("users/user-1/groups/completed-group")).toBe(true);
  });

  it("does not remove a membership created after the movement", async () => {
    setGroup("watchlist", "watch-group", ["1", "2"]);
    harness.failTransactionCall = 2;
    const moved = await addToCompleted("user-1", { animeId: "1", title: "Moved" });
    const [task] = moved.data.reconciliation.pending.map((entry) => entry.task);
    harness.failTransactionCall = null;
    setAnime("watchlist", "1", { groupId: "watch-group", title: "New membership" });

    const result = await retryMovementGroupReconciliation("user-1", task);

    expect(result.data.superseded).toBe(true);
    expect(destinationData("watchlist", "1").groupId).toBe("watch-group");
    expect(harness.state.has("users/user-1/groups/watch-group")).toBe(true);
  });

  it("never applies a movement reconciliation to a custom Collection", async () => {
    await expect(retryMovementGroupReconciliation("user-1", {
      sourceScope: "collection:favorites",
      sourceGroupId: "favorite-group",
      animeId: "1",
    })).rejects.toMatchObject({ code: "grouping/invalid-reconciliation" });
  });

  it("drops malformed, cross-user-shaped, and custom-scope marker tasks", () => {
    expect(normalizeMovementReconciliations([
      { sourceScope: "collection:favorites", sourceGroupId: "g", animeId: "1" },
      { sourceScope: "watchlist", sourceGroupId: "users/other/groups/g", animeId: "1" },
      { sourceScope: "completed", sourceGroupId: "good", animeId: "1" },
    ])).toEqual([
      { sourceScope: "completed", sourceGroupId: "good", animeId: "1" },
    ]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "recovers %i older pending reconciliation task(s) before moving",
    async (taskCount) => {
      const pending = Array.from({ length: taskCount }, (_, index) => ({
        sourceScope: index % 2 ? "completed" : "watchlist",
        sourceGroupId: `already-clean-${index}`,
        animeId: "1",
      }));
      setAnime("watchlist", "1", { _groupingReconciliations: pending });

      await addToCompleted("user-1", { animeId: "1", title: "Moved" });

      expect(harness.state.has(path("watchlist", "1"))).toBe(false);
      expect(destinationData("completed", "1")._groupingReconciliations).toBeUndefined();
    },
  );

  it("retains every older marker when pre-move cleanup is interrupted", async () => {
    const pending = Array.from({ length: 3 }, (_, index) => ({
      sourceScope: index % 2 ? "completed" : "watchlist",
      sourceGroupId: `pending-${index}`,
      animeId: "1",
    }));
    setAnime("watchlist", "1", { _groupingReconciliations: pending });
    harness.failTransactionCall = 2;

    await expect(addToCompleted("user-1", { animeId: "1", title: "Moved" }))
      .rejects.toMatchObject({ code: "grouping/reconciliation-pending" });
    expect(destinationData("watchlist", "1")._groupingReconciliations).toEqual(pending);
    expect(harness.state.has(path("completed", "1"))).toBe(false);

    harness.failTransactionCall = null;
    await addToCompleted("user-1", { animeId: "1", title: "Moved" });
    expect(destinationData("completed", "1")._groupingReconciliations).toBeUndefined();
  });

  it("refuses a movement rather than dropping excess pending cleanup", () => {
    const pending = Array.from({ length: 9 }, (_, index) => ({
      sourceScope: index % 2 ? "completed" : "watchlist",
      sourceGroupId: `group-${index}`,
      animeId: "1",
    }));
    expect(() => collectMovementReconciliations({
      animeId: "1",
      sourceScope: "watchlist",
      destinationScope: "completed",
      sourceData: { _groupingReconciliations: pending },
      destinationData: null,
    })).toThrow("refusing to move");
  });
});
