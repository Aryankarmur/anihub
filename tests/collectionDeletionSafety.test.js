import { describe, expect, it, vi } from "vitest";
import {
  executeCollectionDeletionForMode,
  executeCollectionDeletionPlan,
  executeUngroupedCollectionDeletionPlan,
} from "../src/firebase/collectionDeletionUtils";

const makeStore = () => ({
  collections: new Map([
    ["favorites", { name: "Favorites", items: new Set(["1", "2", "3"]) }],
    ["later", { name: "Later", items: new Set(["1", "4"]) }],
  ]),
  groups: new Map([
    ["favorites-group", { scopeKey: "collection:favorites", reservationId: "favorites-key" }],
    ["later-group", { scopeKey: "collection:later", reservationId: "later-key" }],
  ]),
  reservations: new Set(["favorites-key", "later-key"]),
  watchlist: new Set(["1", "5"]),
});

const itemChunks = (store, collectionId, size = 400) => {
  const ids = [...(store.collections.get(collectionId)?.items || [])];
  const chunks = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
};

const deleteItemChunk = (store, collectionId) => async (ids) => {
  ids.forEach((id) => store.collections.get(collectionId)?.items.delete(id));
};

const ungroupedDelete = (store, collectionId, overrides = {}) => (
  executeUngroupedCollectionDeletionPlan({
    loadItemChunks: async () => itemChunks(store, collectionId),
    deleteItemChunk: deleteItemChunk(store, collectionId),
    deleteCollectionDocument: async () => { store.collections.delete(collectionId); },
    ...overrides,
  })
);

const groupedDelete = (store, collectionId, overrides = {}) => (
  executeCollectionDeletionPlan({
    beginCollectionDeletion: async () => {
      const collection = store.collections.get(collectionId);
      if (collection) collection.deletionState = "deleting";
    },
    loadGroupIds: async () => [...store.groups]
      .filter(([, group]) => group.scopeKey === `collection:${collectionId}`)
      .map(([groupId]) => groupId),
    loadItemChunks: async () => itemChunks(store, collectionId),
    deleteGroupById: async (groupId) => {
      const group = store.groups.get(groupId);
      if (!group) return;
      store.reservations.delete(group.reservationId);
      store.groups.delete(groupId);
    },
    deleteItemChunk: deleteItemChunk(store, collectionId),
    deleteCollectionDocument: async () => { store.collections.delete(collectionId); },
    ...overrides,
  })
);

describe("custom Collection deletion safety modes", () => {
  it("deletes an ordinary Collection when grouping is disabled", async () => {
    const store = makeStore();
    const result = await executeCollectionDeletionForMode({
      groupingEnabled: false,
      deleteWithoutGrouping: () => ungroupedDelete(store, "favorites"),
      deleteWithGrouping: vi.fn(),
    });
    expect(result.data).toEqual({ deletedItemCount: 3, collectionDeleted: true });
    expect(store.collections.has("favorites")).toBe(false);
  });

  it("does not read or write grouping metadata when grouping is disabled", async () => {
    const store = makeStore();
    const groupedPath = vi.fn(() => Promise.reject(new Error("groups permission denied")));
    await executeCollectionDeletionForMode({
      groupingEnabled: false,
      deleteWithoutGrouping: () => ungroupedDelete(store, "favorites"),
      deleteWithGrouping: groupedPath,
    });
    expect(groupedPath).not.toHaveBeenCalled();
    expect(store.groups.has("favorites-group")).toBe(true);
    expect(store.reservations.has("favorites-key")).toBe(true);
  });

  it("requires no deletion marker permission in disabled mode", async () => {
    const beginCollectionDeletion = vi.fn(() => Promise.reject(new Error("update denied")));
    const store = makeStore();
    await executeCollectionDeletionForMode({
      groupingEnabled: false,
      deleteWithoutGrouping: () => ungroupedDelete(store, "favorites"),
      deleteWithGrouping: () => groupedDelete(store, "favorites", { beginCollectionDeletion }),
    });
    expect(beginCollectionDeletion).not.toHaveBeenCalled();
  });

  it("uses scoped group and reservation cleanup when grouping is enabled", async () => {
    const store = makeStore();
    await executeCollectionDeletionForMode({
      groupingEnabled: true,
      deleteWithoutGrouping: vi.fn(),
      deleteWithGrouping: () => groupedDelete(store, "favorites"),
    });
    expect(store.collections.has("favorites")).toBe(false);
    expect(store.groups.has("favorites-group")).toBe(false);
    expect(store.reservations.has("favorites-key")).toBe(false);
  });

  it("keeps interrupted grouped cleanup retryable", async () => {
    const store = makeStore();
    const firstDelete = vi.fn()
      .mockImplementationOnce(deleteItemChunk(store, "favorites"))
      .mockRejectedValueOnce(new Error("batch denied"));
    await expect(groupedDelete(store, "favorites", {
      loadItemChunks: async () => itemChunks(store, "favorites", 2),
      deleteItemChunk: firstDelete,
    })).rejects.toMatchObject({
      details: { mode: "grouped", collectionDeleted: false, retryable: true },
    });
    expect(store.collections.has("favorites")).toBe(true);
    await groupedDelete(store, "favorites");
    expect(store.collections.has("favorites")).toBe(false);
  });

  it("deletes only the selected Collection", async () => {
    const store = makeStore();
    await groupedDelete(store, "favorites");
    expect(store.collections.get("later")).toEqual({
      name: "Later",
      items: new Set(["1", "4"]),
    });
    expect(store.groups.has("later-group")).toBe(true);
    expect(store.reservations.has("later-key")).toBe(true);
  });

  it("never changes Watchlist documents", async () => {
    const store = makeStore();
    const originalWatchlist = new Set(store.watchlist);
    await groupedDelete(store, "favorites");
    expect(store.watchlist).toEqual(originalWatchlist);
  });

  it("leaves Collection creation and editing available", async () => {
    const store = makeStore();
    await ungroupedDelete(store, "favorites");
    store.collections.set("new-collection", { name: "New", items: new Set() });
    store.collections.get("new-collection").name = "Renamed";
    expect(store.collections.get("new-collection")).toEqual({
      name: "Renamed",
      items: new Set(),
    });
    expect(store.collections.get("later").name).toBe("Later");
  });

  it("keeps legacy item deletion batches bounded", async () => {
    const store = makeStore();
    store.collections.set("large", {
      name: "Large",
      items: new Set(Array.from({ length: 805 }, (_, index) => String(index))),
    });
    const observedSizes = [];
    await ungroupedDelete(store, "large", {
      loadItemChunks: async () => itemChunks(store, "large", 400),
      deleteItemChunk: async (chunk) => {
        observedSizes.push(chunk.length);
        await deleteItemChunk(store, "large")(chunk);
      },
    });
    expect(observedSizes).toEqual([400, 400, 5]);
  });
});
