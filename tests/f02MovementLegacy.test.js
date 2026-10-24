import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  state: new Map(),
  failCommit: false,
  readPaths: [],
  transactionCalls: 0,
}));

vi.mock("../src/firebase/firebaseConfig", () => ({ db: { kind: "mock-db" } }));
vi.mock("../src/firebase/groupingFeatureGate", () => ({ isAnimeGroupingEnabled: false }));
vi.mock("firebase/firestore", () => {
  const pathFor = (segments) => segments[0]?.path
    ? [segments[0].path, ...segments.slice(1)].join("/")
    : segments.slice(1).join("/");
  const refFor = (segments) => {
    const path = pathFor(segments);
    return { path, id: path.split("/").at(-1) };
  };
  const snapshot = (ref) => ({
    id: ref.id,
    ref,
    exists: () => harness.state.has(ref.path),
    data: () => harness.state.get(ref.path),
  });
  return {
    addDoc: vi.fn(),
    collection: (...segments) => refFor(segments),
    deleteDoc: vi.fn(),
    deleteField: vi.fn(() => ({ deleteField: true })),
    doc: (...segments) => refFor(segments),
    getCountFromServer: vi.fn(),
    getDoc: vi.fn(async (ref) => {
      harness.readPaths.push(ref.path);
      return snapshot(ref);
    }),
    getDocs: vi.fn(),
    limit: vi.fn(),
    onSnapshot: vi.fn(),
    query: vi.fn(),
    runTransaction: vi.fn(async () => { harness.transactionCalls += 1; }),
    serverTimestamp: vi.fn(() => "server-timestamp"),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    where: vi.fn(),
    writeBatch: vi.fn(() => {
      const writes = [];
      return {
        set: (ref, data, options) => writes.push({ type: "set", ref, data, options }),
        delete: (ref) => writes.push({ type: "delete", ref }),
        update: (ref, data) => writes.push({ type: "update", ref, data }),
        commit: async () => {
          if (harness.failCommit) throw new Error("batch commit failed");
          writes.forEach((write) => {
            if (write.type === "delete") harness.state.delete(write.ref.path);
            else harness.state.set(write.ref.path, {
              ...(write.options?.merge ? harness.state.get(write.ref.path) : {}),
              ...write.data,
            });
          });
        },
      };
    }),
  };
});

import {
  addToCompleted,
  addToWatchlist,
  removeFromCompleted,
} from "../src/firebase/firestore";

const path = (scope, animeId) => `users/user-1/${scope}/${animeId}`;
const anime = {
  animeId: "1",
  title: "One",
  image: "one.jpg",
  type: "TV",
  score: 8,
};

describe("legacy F02 movement while grouping is disabled", () => {
  beforeEach(() => {
    harness.state.clear();
    harness.failCommit = false;
    harness.readPaths.length = 0;
    harness.transactionCalls = 0;
  });

  it("moves Watchlist to Completed without group or reservation access", async () => {
    harness.state.set(path("watchlist", "1"), anime);
    await addToCompleted("user-1", anime);
    expect(harness.state.has(path("watchlist", "1"))).toBe(false);
    expect(harness.state.has(path("completed", "1"))).toBe(true);
    expect(harness.readPaths.every((value) => !value.includes("/groups/") && !value.includes("groupNameKeys"))).toBe(true);
    expect(harness.transactionCalls).toBe(0);
  });

  it("restores Completed to Watchlist without grouping permissions", async () => {
    harness.state.set(path("completed", "1"), { ...anime, addedAt: "old" });
    await removeFromCompleted("user-1", "1", true);
    expect(harness.state.has(path("completed", "1"))).toBe(false);
    expect(harness.state.has(path("watchlist", "1"))).toBe(true);
    expect(harness.readPaths).toEqual([path("completed", "1")]);
    expect(harness.transactionCalls).toBe(0);
  });

  it("keeps addToWatchlist on its existing atomic batch path", async () => {
    harness.state.set(path("completed", "1"), anime);
    await addToWatchlist("user-1", anime);
    expect(harness.state.has(path("completed", "1"))).toBe(false);
    expect(harness.state.has(path("watchlist", "1"))).toBe(true);
    expect(harness.readPaths).toEqual([]);
    expect(harness.transactionCalls).toBe(0);
  });

  it("leaves the source intact when the legacy batch commit fails", async () => {
    harness.state.set(path("watchlist", "1"), anime);
    harness.failCommit = true;
    await expect(addToCompleted("user-1", anime)).rejects.toThrow("batch commit failed");
    expect(harness.state.has(path("watchlist", "1"))).toBe(true);
    expect(harness.state.has(path("completed", "1"))).toBe(false);
  });
});
