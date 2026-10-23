import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useState } from "react";
import {
  buildRelationGraph,
  deriveDesiredGroups,
  reconcileAutoGrouping,
  fetchAniListRelations,
  readCachedRelations,
  writeCachedRelations,
  buildStateFingerprint,
  AUTO_GROUP_EXCLUDED_FIELD,
  ANILIST_RELATIONS_FIELD,
} from "../src/firebase/autoGroupingService.js";
import { useAutoGrouping } from "../src/hooks/useAutoGrouping.js";
vi.mock("../src/firebase/groupingFeatureGate.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isAnimeGroupingEnabled: true,
  };
});

import {
  evaluateAnimeGroupingGate,
} from "../src/firebase/groupingFeatureGate.js";
import {
  collectMovementReconciliations,
  withoutGroupingInternals,
} from "../src/firebase/movementUtils.js";

describe("Automatic Anime Grouping — Complete 18-Requirement Suite", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // 1. One anime remains standalone
  it("1. One anime remains standalone", async () => {
    const singleAnime = [
      {
        animeId: "101",
        title: "Demon Slayer Season 1",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "SEQUEL" }],
      },
    ];

    const desired = deriveDesiredGroups(singleAnime);
    expect(desired).toEqual([]); // Minimum 2 saved anime required to form a group

    const createGroupFn = vi.fn();
    const result = await reconcileAutoGrouping({
      uid: "user-1",
      scopeKey: "watchlist",
      animeDocuments: singleAnime,
      existingGroups: [],
      services: { createGroupFn },
    });

    expect(createGroupFn).not.toHaveBeenCalled();
    expect(result.created).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });

  // 2. Two related anime automatically group
  it("2. Two related anime automatically group", async () => {
    const twoRelated = [
      {
        animeId: "101",
        title: "Demon Slayer",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "SEQUEL" }],
      },
      {
        animeId: "102",
        title: "Demon Slayer: Kimetsu no Yaiba Season 2",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "101", relationType: "PREQUEL" }],
      },
    ];

    const desired = deriveDesiredGroups(twoRelated);
    expect(desired).toHaveLength(1);
    expect([...desired[0]].sort()).toEqual(["101", "102"]);

    const createGroupFn = vi.fn().mockResolvedValue({ id: "group-ds" });
    const result = await reconcileAutoGrouping({
      uid: "user-1",
      scopeKey: "watchlist",
      animeDocuments: twoRelated,
      existingGroups: [],
      services: { createGroupFn },
    });

    expect(createGroupFn).toHaveBeenCalledWith("user-1", expect.objectContaining({
      name: "Demon Slayer",
      scopeKey: "watchlist",
      animeIds: ["101", "102"],
      thumbnailAnimeId: null,
    }));
    expect(result.created).toHaveLength(1);
    expect(result.created[0].groupId).toBe("group-ds");
  });

  // 3. A third sequel joins the existing group
  it("3. A third sequel joins the existing group", async () => {
    const threeAnime = [
      {
        animeId: "101",
        title: "Demon Slayer Season 1",
        groupId: "group-ds",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "SEQUEL" }],
      },
      {
        animeId: "102",
        title: "Demon Slayer Season 2",
        groupId: "group-ds",
        [ANILIST_RELATIONS_FIELD]: [
          { relatedId: "101", relationType: "PREQUEL" },
          { relatedId: "103", relationType: "SEQUEL" },
        ],
      },
      {
        animeId: "103",
        title: "Demon Slayer Season 3",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "PREQUEL" }],
      },
    ];

    const existingGroups = [
      {
        groupId: "group-ds",
        name: "Demon Slayer",
        scopeKey: "watchlist",
        status: "active",
      },
    ];

    const createGroupFn = vi.fn();
    const addAnimeToGroupFn = vi.fn().mockResolvedValue({ data: { assignedCount: 1 } });

    const result = await reconcileAutoGrouping({
      uid: "user-1",
      scopeKey: "watchlist",
      animeDocuments: threeAnime,
      existingGroups,
      services: { createGroupFn, addAnimeToGroupFn },
    });

    expect(createGroupFn).not.toHaveBeenCalled();
    expect(addAnimeToGroupFn).toHaveBeenCalledWith("user-1", "group-ds", ["103"]);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].added).toEqual(["103"]);
  });

  // 4. Unrelated anime stay standalone
  it("4. Unrelated anime stay standalone", async () => {
    const mixed = [
      {
        animeId: "101",
        title: "Demon Slayer Season 1",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "SEQUEL" }],
      },
      {
        animeId: "102",
        title: "Demon Slayer Season 2",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "101", relationType: "PREQUEL" }],
      },
      {
        animeId: "999",
        title: "Death Note",
        [ANILIST_RELATIONS_FIELD]: [],
      },
    ];

    const desired = deriveDesiredGroups(mixed);
    expect(desired).toHaveLength(1);
    expect(desired[0].has("999")).toBe(false);
    expect([...desired[0]].sort()).toEqual(["101", "102"]);

    const createGroupFn = vi.fn().mockResolvedValue({ id: "ds-group" });
    const result = await reconcileAutoGrouping({
      uid: "user-1",
      scopeKey: "watchlist",
      animeDocuments: mixed,
      existingGroups: [],
      services: { createGroupFn },
    });

    expect(createGroupFn).toHaveBeenCalledWith("user-1", expect.objectContaining({
      animeIds: ["101", "102"],
    }));
    expect(result.created[0].animeIds).not.toContain("999");
  });

  // 5. Different Collections stay independent
  it("5. Different Collections stay independent", async () => {
    // S1 is in Collection A, S2 is in Collection B
    const colAAnime = [
      {
        animeId: "101",
        title: "Demon Slayer Season 1",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "SEQUEL" }],
      },
    ];

    const colBAnime = [
      {
        animeId: "102",
        title: "Demon Slayer Season 2",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "101", relationType: "PREQUEL" }],
      },
    ];

    // Reconciling Collection A does not see 102
    const graphA = buildRelationGraph(colAAnime);
    expect(graphA.get("101")?.size ?? 0).toBe(0); // 102 is not in colA

    const graphB = buildRelationGraph(colBAnime);
    expect(graphB.get("102")?.size ?? 0).toBe(0); // 101 is not in colB

    expect(deriveDesiredGroups(colAAnime)).toEqual([]);
    expect(deriveDesiredGroups(colBAnime)).toEqual([]);
  });

  // 6. Existing manual groups are preserved
  it("6. Existing manual groups are preserved", async () => {
    const manualGroupAnime = [
      {
        animeId: "501",
        title: "Steins;Gate",
        groupId: "manual-favs",
      },
      {
        animeId: "502",
        title: "Attack on Titan",
        groupId: "manual-favs",
      },
    ];

    const existingGroups = [
      {
        groupId: "manual-favs",
        name: "My Personal Favorites",
        scopeKey: "watchlist",
        status: "active",
      },
    ];

    const deleteGroupFn = vi.fn();
    const result = await reconcileAutoGrouping({
      uid: "user-1",
      scopeKey: "watchlist",
      animeDocuments: manualGroupAnime,
      existingGroups,
      services: { deleteGroupFn },
    });

    // Group has >= 2 members, so it must NEVER be dissolved
    expect(deleteGroupFn).not.toHaveBeenCalled();
    expect(result.dissolved).toEqual([]);
  });

  // 7. Excluded anime are not regrouped
  it("7. Excluded anime are not regrouped", async () => {
    const anime = [
      {
        animeId: "101",
        title: "Demon Slayer Season 1",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "SEQUEL" }],
      },
      {
        animeId: "102",
        title: "Demon Slayer Season 2",
        [AUTO_GROUP_EXCLUDED_FIELD]: true, // explicitly excluded
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "101", relationType: "PREQUEL" }],
      },
    ];

    const desired = deriveDesiredGroups(anime);
    expect(desired).toEqual([]); // 102 is excluded, leaving 101 alone

    const createGroupFn = vi.fn();
    await reconcileAutoGrouping({
      uid: "user-1",
      scopeKey: "watchlist",
      animeDocuments: anime,
      existingGroups: [],
      services: { createGroupFn },
    });

    expect(createGroupFn).not.toHaveBeenCalled();
  });

  // 8. Duplicate groups are prevented
  it("8. Duplicate groups are prevented", async () => {
    const anime = [
      {
        animeId: "101",
        title: "Demon Slayer Season 1",
        groupId: "existing-g1",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "SEQUEL" }],
      },
      {
        animeId: "102",
        title: "Demon Slayer Season 2",
        groupId: "existing-g1",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "101", relationType: "PREQUEL" }],
      },
    ];

    const existingGroups = [
      {
        groupId: "existing-g1",
        name: "Demon Slayer",
        scopeKey: "watchlist",
        status: "active",
      },
    ];

    const createGroupFn = vi.fn();
    const addAnimeToGroupFn = vi.fn();
    const result = await reconcileAutoGrouping({
      uid: "user-1",
      scopeKey: "watchlist",
      animeDocuments: anime,
      existingGroups,
      services: { createGroupFn, addAnimeToGroupFn },
    });

    expect(createGroupFn).not.toHaveBeenCalled();
    expect(addAnimeToGroupFn).not.toHaveBeenCalled();
    expect(result.created).toEqual([]);
    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0].groupId).toBe("existing-g1");
  });

  // 9. React rerenders do not trigger redundant Firestore writes
  it("9. React rerenders do not trigger redundant Firestore writes", async () => {
    vi.useFakeTimers();

    const animeDocuments = [
      {
        animeId: "101",
        title: "Demon Slayer Season 1",
        groupId: "g1",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "SEQUEL" }],
      },
      {
        animeId: "102",
        title: "Demon Slayer Season 2",
        groupId: "g1",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "101", relationType: "PREQUEL" }],
      },
    ];

    const reconcileMock = vi.fn().mockResolvedValue({
      created: [],
      updated: [],
      dissolved: [],
      unchanged: [{ groupId: "g1" }],
    });

    function TestComponent() {
      const [, setRenderCount] = useState(0);
      useAutoGrouping({
        uid: "user-1",
        scopeKey: "watchlist",
        animeDocuments,
        isLoading: false,
        services: { runAutoGroupingReconciliation: reconcileMock },
      });

      return (
        <button onClick={() => setRenderCount((c) => c + 1)}>
          Rerender
        </button>
      );
    }

    const { getByText } = render(<TestComponent />);

    // Fast-forward initial debounce
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(reconcileMock).toHaveBeenCalledTimes(1);

    // Trigger 5 re-renders with unchanged data
    for (let i = 0; i < 5; i++) {
      act(() => {
        getByText("Rerender").click();
      });
    }

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Reconcile was NOT called again because fingerprint remained unchanged
    expect(reconcileMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  // 10. Firestore subscription changes do not create infinite reconciliation loops
  it("10. Firestore subscription changes do not create infinite reconciliation loops", async () => {
    const docs = [
      {
        animeId: "101",
        title: "Demon Slayer Season 1",
        groupId: "g1",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "SEQUEL" }],
      },
      {
        animeId: "102",
        title: "Demon Slayer Season 2",
        groupId: "g1",
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "101", relationType: "PREQUEL" }],
      },
    ];
    const existing = [{ groupId: "g1", status: "active" }];

    // Stable fingerprint test
    const fp1 = buildStateFingerprint(docs, existing);
    const fp2 = buildStateFingerprint([...docs], [...existing]);
    expect(fp1).toBe(fp2);

    const result = await reconcileAutoGrouping({
      uid: "u1",
      scopeKey: "watchlist",
      animeDocuments: docs,
      existingGroups: existing,
      services: {
        createGroupFn: vi.fn(),
        addAnimeToGroupFn: vi.fn(),
        deleteGroupFn: vi.fn(),
      },
    });

    // 0 creations, 0 updates, 0 deletions
    expect(result.created).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.dissolved).toHaveLength(0);
    expect(result.unchanged).toHaveLength(1);
  });

  // 11. Singleton groups dissolve safely
  it("11. Singleton groups dissolve safely", async () => {
    const singleInGroup = [
      {
        animeId: "101",
        title: "Demon Slayer Season 1",
        groupId: "g1",
        [ANILIST_RELATIONS_FIELD]: [],
      },
    ];

    const existingGroups = [
      {
        groupId: "g1",
        name: "Demon Slayer",
        scopeKey: "watchlist",
        status: "active",
      },
    ];

    const deleteGroupFn = vi.fn().mockResolvedValue({ data: { clearedCount: 1 } });
    const result = await reconcileAutoGrouping({
      uid: "user-1",
      scopeKey: "watchlist",
      animeDocuments: singleInGroup,
      existingGroups,
      services: { deleteGroupFn },
    });

    expect(deleteGroupFn).toHaveBeenCalledWith("user-1", "g1");
    expect(result.dissolved).toHaveLength(1);
    expect(result.dissolved[0].groupId).toBe("g1");
  });

  // 12. AniList HTTP 403 does not break existing saved library rendering
  it("12. AniList HTTP 403 does not break existing saved library rendering", async () => {
    const mockFetch403 = vi.fn().mockResolvedValue({
      status: 403,
      json: async () => ({ message: "Forbidden" }),
    });

    const relations = await fetchAniListRelations("12345", mockFetch403);
    expect(relations).toEqual([]); // Safe fallback; never throws or crashes UI
  });

  // 13. Cached relationship metadata works without AniList
  it("13. Cached relationship metadata works without AniList", async () => {
    writeCachedRelations("201", [
      { relatedId: "202", relationType: "SEQUEL" },
    ]);

    const cached = readCachedRelations("201");
    expect(cached).toEqual([{ relatedId: "202", relationType: "SEQUEL" }]);

    const fetchImpl = vi.fn(); // Should NOT be called
    const relations = await fetchAniListRelations("201", fetchImpl);
    expect(relations).toEqual([{ relatedId: "202", relationType: "SEQUEL" }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // 14. Missing relationship metadata remains safe
  it("14. Missing relationship metadata remains safe", async () => {
    const animeWithoutMeta = [
      { animeId: "801", title: "Classic Anime A" },
      { animeId: "802", title: "Classic Anime B" },
    ];

    expect(() => deriveDesiredGroups(animeWithoutMeta)).not.toThrow();
    expect(deriveDesiredGroups(animeWithoutMeta)).toEqual([]);

    const result = await reconcileAutoGrouping({
      uid: "u1",
      scopeKey: "watchlist",
      animeDocuments: animeWithoutMeta,
      existingGroups: [],
    });

    expect(result.created).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // 15. Watchlist ↔ Completed movement preserves relationship metadata and correct grouping behavior
  it("15. Watchlist ↔ Completed movement preserves relationship metadata and correct grouping behavior", () => {
    const sourceData = {
      animeId: "101",
      title: "Demon Slayer S1",
      groupId: "watchlist-group-1",
      [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "SEQUEL" }],
    };

    const cleaned = withoutGroupingInternals(sourceData);
    expect(cleaned.groupId).toBeUndefined(); // Strips scope-specific groupId
    expect(cleaned[ANILIST_RELATIONS_FIELD]).toEqual([
      { relatedId: "102", relationType: "SEQUEL" },
    ]); // Preserves relation metadata

    const tasks = collectMovementReconciliations({
      animeId: "101",
      sourceScope: "watchlist",
      sourceData,
      destinationScope: "completed",
      destinationData: null,
    });

    expect(tasks).toEqual([
      {
        sourceScope: "watchlist",
        sourceGroupId: "watchlist-group-1",
        animeId: "101",
      },
    ]);
  });

  // 16. No anime metadata or library membership is lost
  it("16. No anime metadata or library membership is lost", async () => {
    const anime = [
      {
        animeId: "101",
        title: "Fullmetal Alchemist",
        image: "fma.jpg",
        type: "TV",
        score: 9.1,
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "102", relationType: "SEQUEL" }],
      },
      {
        animeId: "102",
        title: "Fullmetal Alchemist: Brotherhood",
        image: "fmab.jpg",
        type: "TV",
        score: 9.2,
        [ANILIST_RELATIONS_FIELD]: [{ relatedId: "101", relationType: "PREQUEL" }],
      },
    ];

    const createGroupFn = vi.fn().mockResolvedValue({ id: "fma-group" });
    await reconcileAutoGrouping({
      uid: "u1",
      scopeKey: "watchlist",
      animeDocuments: anime,
      existingGroups: [],
      services: { createGroupFn },
    });

    expect(createGroupFn).toHaveBeenCalledWith("u1", {
      name: "Fullmetal Alchemist",
      scopeKey: "watchlist",
      animeIds: ["101", "102"],
      thumbnailAnimeId: null,
    });
    // Original anime documents are untouched; only groupId is assigned by service
    expect(anime[0].title).toBe("Fullmetal Alchemist");
    expect(anime[0].score).toBe(9.1);
    expect(anime[1].score).toBe(9.2);
  });

  // 17. Production grouping remains disabled
  it("17. Production grouping remains disabled", () => {
    // When isolatedEmulator is false, grouping is disabled regardless of feature flag
    expect(evaluateAnimeGroupingGate({ featureRequested: false, isolatedEmulator: false })).toBe(false);
    expect(evaluateAnimeGroupingGate({ featureRequested: true, isolatedEmulator: false })).toBe(false);
  });

  // 18. Automatic grouping works in the isolated preview
  it("18. Automatic grouping works in the isolated preview", () => {
    // When both feature is requested and isolated preview is active
    expect(evaluateAnimeGroupingGate({ featureRequested: true, isolatedEmulator: true })).toBe(true);
    // When feature is not requested even in preview
    expect(evaluateAnimeGroupingGate({ featureRequested: false, isolatedEmulator: true })).toBe(false);
  });
});
