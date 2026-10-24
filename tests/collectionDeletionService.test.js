import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
  updateDoc: vi.fn(),
  batchDeletes: [],
  batchCommits: [],
}));

vi.mock("../src/firebase/firebaseConfig", () => ({ db: { kind: "mock-db" } }));
vi.mock("../src/firebase/groupingFeatureGate", () => ({ isAnimeGroupingEnabled: false }));
vi.mock("firebase/firestore", () => ({
  addDoc: mocks.addDoc,
  collection: (...segments) => ({ path: segments.slice(1).join("/") }),
  deleteDoc: mocks.deleteDoc,
  doc: (...segments) => ({ path: segments.slice(1).join("/") }),
  getCountFromServer: vi.fn(),
  getDoc: vi.fn(),
  getDocs: mocks.getDocs,
  limit: vi.fn((value) => ({ type: "limit", value })),
  onSnapshot: vi.fn(),
  query: vi.fn((reference, ...constraints) => ({ reference, constraints })),
  runTransaction: mocks.runTransaction,
  serverTimestamp: vi.fn(() => "server-timestamp"),
  setDoc: vi.fn(),
  updateDoc: mocks.updateDoc,
  where: vi.fn((...values) => ({ type: "where", values })),
  writeBatch: vi.fn(() => {
    const deleted = [];
    const commit = vi.fn().mockResolvedValue(undefined);
    mocks.batchDeletes.push(deleted);
    mocks.batchCommits.push(commit);
    return {
      delete: (reference) => deleted.push(reference),
      set: vi.fn(),
      update: vi.fn(),
      commit,
    };
  }),
  deleteField: vi.fn(),
}));

import {
  createCollection,
  deleteCollection,
  updateCollection,
} from "../src/firebase/firestore";

describe("deleteCollection service with production-safe grouping gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.batchDeletes.length = 0;
    mocks.batchCommits.length = 0;
    mocks.getDocs.mockResolvedValue({
      docs: [
        { ref: { path: "users/user-1/collections/favorites/items/1" } },
        { ref: { path: "users/user-1/collections/favorites/items/2" } },
      ],
    });
  });

  it("uses only legacy Collection permissions while grouping is disabled", async () => {
    const result = await deleteCollection("user-1", "favorites");
    expect(result.data).toEqual({ deletedItemCount: 2, collectionDeleted: true });
    expect(mocks.getDocs).toHaveBeenCalledTimes(1);
    expect(mocks.getDocs.mock.calls[0][0]).toEqual({
      path: "users/user-1/collections/favorites/items",
    });
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.batchDeletes[0]).toHaveLength(2);
    expect(mocks.deleteDoc).toHaveBeenCalledWith({
      path: "users/user-1/collections/favorites",
    });
  });

  it("preserves ordinary Collection creation and editing", async () => {
    mocks.addDoc.mockResolvedValue({ id: "new-collection" });
    await expect(createCollection("user-1", {
      name: "Favorites",
      description: "Keepers",
    })).resolves.toEqual({ id: "new-collection", error: null });
    await expect(updateCollection("user-1", "new-collection", {
      name: "Best",
      description: "Edited",
    })).resolves.toEqual({ error: null });
    expect(mocks.addDoc).toHaveBeenCalledTimes(1);
    expect(mocks.updateDoc).toHaveBeenCalledWith(
      { path: "users/user-1/collections/new-collection" },
      expect.objectContaining({ name: "Best", description: "Edited" }),
    );
  });
});
