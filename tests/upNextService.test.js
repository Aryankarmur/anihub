import { afterEach, expect, test, vi } from "vitest";

vi.mock("../src/firebase/firestore.js", () => ({
  createGroup: vi.fn(),
  addAnimeToGroup: vi.fn(),
  removeAnimeFromGroup: vi.fn(),
  deleteGroup: vi.fn(),
  subscribeToGroupMetadata: vi.fn(),
}));
import {
  SYSTEM_COLLECTION_UP_NEXT,
  discoverUpNextSequelChains,
  deriveUpNextCandidates,
  deriveUpNextGroups,
  fetchUpNextMedia,
  resolveUpNextSuggestions,
} from "../src/features/upNext/upNextService.js";
import * as firestore from "../src/firebase/firestore.js";

const source = (animeId, relations, title = `Source ${animeId}`) => ({
  animeId: String(animeId),
  title,
  anilistRelations: relations,
});

const sequel = (relatedId) => ({ relatedId: String(relatedId), relationType: "SEQUEL" });
const prequel = (relatedId) => ({ relatedId: String(relatedId), relationType: "PREQUEL" });

const media = (animeId, relations = [], overrides = {}) => ({
  animeId: String(animeId),
  title: `My Hero Academia Season ${animeId}`,
  image: `${animeId}.jpg`,
  year: 2015 + Number(animeId),
  anilistRelations: relations,
  ...overrides,
});

const resolverFrom = (items, calls = []) => async (animeIds) => {
  calls.push([...animeIds]);
  const byId = new Map(items.map((item) => [item.animeId, item]));
  return animeIds.map((animeId) => byId.get(String(animeId))).filter(Boolean);
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test("Up Next uses an automatic system collection identifier", () => {
  expect(SYSTEM_COLLECTION_UP_NEXT).toBe("__up_next__");
});

test("empty Watchlist and Completed produce no candidates", () => {
  expect(deriveUpNextCandidates()).toEqual([]);
});

test("verified Watchlist sequels produce direct candidates", () => {
  const result = deriveUpNextCandidates({ watchlist: [source(1, [sequel(2)], "Season One")] });
  expect(result).toHaveLength(1);
  expect(result[0].animeId).toBe("2");
  expect(result[0].sources[0].scope).toBe("watchlist");
});

test("verified Completed sequels produce direct candidates", () => {
  const result = deriveUpNextCandidates({ completed: [source(1, [sequel(2)])] });
  expect(result).toHaveLength(1);
  expect(result[0].sources[0].scope).toBe("completed");
});

test("duplicate suggestions from multiple sources are deduplicated with context preserved", () => {
  const result = deriveUpNextCandidates({
    watchlist: [source(1, [sequel(9)])],
    completed: [source(2, [sequel(9)])],
  });
  expect(result).toHaveLength(1);
  expect(result[0].sources).toHaveLength(2);
});

test("anime already in Watchlist are excluded", () => {
  const result = deriveUpNextCandidates({
    watchlist: [source(1, [sequel(2)]), source(2, [])],
  });
  expect(result).toEqual([]);
});

test("anime already in Completed are excluded", () => {
  const result = deriveUpNextCandidates({
    watchlist: [source(1, [sequel(2)])],
    completed: [source(2, [])],
  });
  expect(result).toEqual([]);
});

test("invalid relations and non-SEQUEL relation types are ignored", () => {
  const result = deriveUpNextCandidates({
    watchlist: [source(1, [
      prequel(2),
      { relatedId: "3", relationType: "SIDE_STORY" },
      { relatedId: "4", relationType: "SPIN_OFF" },
      { relatedId: "not-an-id", relationType: "SEQUEL" },
      { relatedId: "5", relationType: "sequel" },
    ])],
  });
  expect(result).toEqual([]);
});

test("missing source relations are resolved in memory without persistence", async () => {
  let relationCalls = 0;
  const result = await resolveUpNextSuggestions({
    watchlist: [{ animeId: "1", title: "First" }],
    relationResolver: async () => {
      relationCalls += 1;
      return new Map([["1", [sequel(2)]]]);
    },
    mediaResolver: async () => [{ animeId: "2", title: "Second", anilistRelations: [] }],
  });
  const { suggestions } = result;
  expect(relationCalls).toBe(1);
  expect(suggestions[0].animeId).toBe("2");
  expect(suggestions[0].upNextSources[0].title).toBe("First");
});

test("AniList display metadata is cached by anime ID", async () => {
  let fetchCalls = 0;
  const fetcher = async () => {
    fetchCalls += 1;
    return {
      Page: {
        media: [{
          id: 2,
          title: { english: "Second", romaji: "Second" },
          coverImage: { extraLarge: "second.jpg" },
          format: "TV",
          averageScore: 80,
          seasonYear: 2025,
          relations: { edges: [] },
        }],
      },
    };
  };
  await fetchUpNextMedia(["2"], { fetcher });
  await fetchUpNextMedia(["2"], { fetcher });
  expect(fetchCalls).toBe(1);
});

test("forced media refresh bypasses both Up Next and request-layer caches", async () => {
  const fetchOptions = [];
  let version = 0;
  const fetcher = async (query, variables, options) => {
    fetchOptions.push(options);
    version += 1;
    return {
      Page: {
        media: [{
          id: variables.ids[0],
          title: { english: `Version ${version}`, romaji: `Version ${version}` },
          coverImage: { extraLarge: "version.jpg" },
          format: "TV",
          averageScore: 80,
          seasonYear: 2025,
          relations: { edges: [] },
        }],
      },
    };
  };
  const first = await fetchUpNextMedia([77], { fetcher });
  const refreshed = await fetchUpNextMedia([77], { fetcher, forceRefresh: true });

  expect(first[0].title).toBe("Version 1");
  expect(refreshed[0].title).toBe("Version 2");
  expect(fetchOptions).toEqual([{ bypassCache: false }, { bypassCache: true }]);
});

test("two verified related suggestions form one derived group", () => {
  const result = deriveUpNextGroups([
    { animeId: "2", title: "Saga Two", anilistRelations: [sequel(3)] },
    { animeId: "3", title: "Saga Three", anilistRelations: [prequel(2)] },
  ]);
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0].name).toBe("Saga");
  expect(result.animeDocuments.filter((anime) => anime.groupId)).toHaveLength(2);
});

test("singletons and unrelated suggestions remain standalone", () => {
  const result = deriveUpNextGroups([
    { animeId: "2", title: "Second", anilistRelations: [] },
    { animeId: "8", title: "Other", anilistRelations: [sequel(99)] },
  ]);
  expect(result.groups).toEqual([]);
  expect(result.animeDocuments.every((anime) => !anime.groupId)).toBe(true);
});

test("discovers a complete eight-season forward sequel chain from Season 1", async () => {
  const chain = Array.from({ length: 7 }, (_, index) => {
    const animeId = index + 2;
    return media(animeId, animeId < 8 ? [sequel(animeId + 1)] : []);
  });
  const result = await discoverUpNextSequelChains({
    watchlist: [source(1, [sequel(2)], "My Hero Academia Season 1")],
    mediaResolver: resolverFrom(chain),
  });

  expect(result.incomplete).toBe(false);
  expect(result.suggestions.map((anime) => anime.animeId)).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
  expect(new Set(result.suggestions.map((anime) => anime.upNextSeriesId)).size).toBe(1);
  expect(deriveUpNextGroups(result.suggestions).groups[0].virtualMemberIds).toEqual([
    "2", "3", "4", "5", "6", "7", "8",
  ]);
});

test("many unrelated saved sources use independent series budgets", async () => {
  const watchlist = Array.from({ length: 150 }, (_, index) => source(1000 + index, []));
  const calls = [];
  const refreshedSources = watchlist.map((anime) => media(anime.animeId, [], { title: anime.title }));
  const result = await discoverUpNextSequelChains({
    watchlist,
    forceRefresh: true,
    mediaResolver: resolverFrom(refreshedSources, calls),
  });

  expect(result.incomplete).toBe(false);
  expect(result.visitedCount).toBe(150);
  expect(result.totalSeriesCount).toBe(150);
  expect(result.networkRequestCount).toBe(3);
  expect(calls).toHaveLength(3);
});

test("multiple separate sequel chains complete within shared batched request rounds", async () => {
  const watchlist = Array.from({ length: 30 }, (_, index) => {
    const rootId = 2000 + (index * 10);
    return source(rootId, [sequel(rootId + 1)], `Series ${index} One`);
  });
  const graph = watchlist.flatMap((anime) => {
    const rootId = Number(anime.animeId);
    return [
      media(rootId + 1, [sequel(rootId + 2)], { title: `Series ${rootId} Two` }),
      media(rootId + 2, [], { title: `Series ${rootId} Three` }),
    ];
  });
  const result = await discoverUpNextSequelChains({
    watchlist,
    mediaResolver: resolverFrom(graph),
  });

  expect(result.incomplete).toBe(false);
  expect(result.suggestions).toHaveLength(60);
  expect(deriveUpNextGroups(result.suggestions).groups).toHaveLength(30);
  expect(result.networkRequestCount).toBe(2);
});

test("traverses through saved intermediate seasons before filtering saved anime", async () => {
  const result = await discoverUpNextSequelChains({
    watchlist: [
      source(1, [sequel(2)], "Saga Season 1"),
      source(2, [sequel(3)], "Saga Season 2"),
    ],
    completed: [source(3, [sequel(4)], "Saga Season 3")],
    mediaResolver: resolverFrom([
      media(4, [sequel(5)], { title: "Saga Season 4" }),
      media(5, [], { title: "Saga Season 5" }),
    ]),
  });

  expect(result.suggestions.map((anime) => anime.animeId)).toEqual(["4", "5"]);
  const derived = deriveUpNextGroups(result.suggestions);
  expect(derived.groups).toHaveLength(1);
  expect(derived.groups[0].virtualMemberIds).toEqual(["4", "5"]);
});

test("merges same-series sources, removes duplicates, and keeps unrelated series separate", async () => {
  const result = await discoverUpNextSequelChains({
    watchlist: [source(1, [sequel(2)], "Saga One"), source(20, [sequel(21)], "Other One")],
    completed: [source(3, [sequel(4)], "Saga Three")],
    mediaResolver: resolverFrom([
      media(2, [sequel(3)], { title: "Saga Two" }),
      media(4, [], { title: "Saga Four" }),
      media(21, [sequel(22)], { title: "Other Two" }),
      media(22, [], { title: "Other Three" }),
    ]),
  });

  expect(result.suggestions.map((anime) => anime.animeId).sort()).toEqual(["2", "21", "22", "4"]);
  const derived = deriveUpNextGroups(result.suggestions);
  expect(derived.groups).toHaveLength(2);
  expect(derived.animeDocuments.filter((anime) => anime.groupId)).toHaveLength(4);
  expect(result.visitedCount).toBe(7);
});

test("supports verified sequel branches and ignores invalid or non-SEQUEL edges", async () => {
  const result = await discoverUpNextSequelChains({
    watchlist: [source(1, [
      sequel(2),
      sequel(3),
      sequel("invalid"),
      prequel(8),
      { relatedId: "9", relationType: "SIDE_STORY" },
    ], "Branching Saga")],
    mediaResolver: resolverFrom([media(2), media(3), media(8), media(9)]),
  });

  expect(result.suggestions.map((anime) => anime.animeId)).toEqual(["2", "3"]);
  expect(deriveUpNextGroups(result.suggestions).groups).toHaveLength(1);
});

test("cycle guards terminate malformed sequel loops without duplicate suggestions", async () => {
  const calls = [];
  const result = await discoverUpNextSequelChains({
    watchlist: [source(1, [sequel(2)], "Cycle One")],
    mediaResolver: resolverFrom([media(2, [sequel(1)], { title: "Cycle Two" })], calls),
  });

  expect(result.incomplete).toBe(false);
  expect(result.suggestions.map((anime) => anime.animeId)).toEqual(["2"]);
  expect(calls).toHaveLength(1);
});

test("preserves verified partial results and reports API failures", async () => {
  let call = 0;
  const result = await discoverUpNextSequelChains({
    watchlist: [source(1, [sequel(2)], "Partial Saga")],
    mediaResolver: async () => {
      call += 1;
      if (call === 1) return [media(2, [sequel(3)], { status: "NOT_YET_RELEASED" })];
      throw new Error("AniList HTTP 429");
    },
  });

  expect(result.incomplete).toBe(true);
  expect(result.incompleteCause).toBe("rate-limit");
  expect(result.warning).toMatch(/HTTP 429/i);
  expect(result.suggestions).toHaveLength(1);
  expect(result.suggestions[0]).toMatchObject({ animeId: "2", status: "NOT_YET_RELEASED" });
});

test("reports a safe incomplete result when the traversal limit is reached", async () => {
  const result = await discoverUpNextSequelChains({
    watchlist: [source(1, [sequel(2)], "Long Saga")],
    mediaResolver: resolverFrom([media(2, [sequel(3)]), media(3)]),
    maxVisited: 2,
  });

  expect(result.incomplete).toBe(true);
  expect(result.incompleteCauses).toContain("series-limit");
  expect(result.warning).toMatch(/per-series safety limit/i);
  expect(result.suggestions.map((anime) => anime.animeId)).toEqual(["2"]);
});

test("one oversized series reaching its limit does not block unrelated series", async () => {
  const largeBranches = Array.from({ length: 8 }, (_, index) => sequel(3101 + index));
  const graph = [
    ...largeBranches.map((relation) => media(relation.relatedId, [sequel(Number(relation.relatedId) + 5000)])),
    media(3201, [sequel(3202)], { title: "Small Series Two" }),
    media(3202, [], { title: "Small Series Three" }),
  ];
  const result = await discoverUpNextSequelChains({
    watchlist: [
      source(3100, largeBranches, "Large Series"),
      source(3200, [sequel(3201)], "Small Series One"),
    ],
    mediaResolver: resolverFrom(graph),
    perSeriesLimit: 4,
    requestBudget: 20,
  });

  expect(result.incompleteCauses).toContain("series-limit");
  expect(result.warning).toMatch(/Other series were still processed/i);
  expect(result.suggestions.map((anime) => anime.animeId)).toEqual(expect.arrayContaining(["3201", "3202"]));
  expect(result.visitedCount).toBeGreaterThanOrEqual(7);
});

test("overall request-budget exhaustion reports partial progress accurately", async () => {
  const graph = [
    media(4101, [sequel(4102)], { title: "Budget A Two" }),
    media(4102, [], { title: "Budget A Three" }),
    media(4201, [sequel(4202)], { title: "Budget B Two" }),
    media(4202, [], { title: "Budget B Three" }),
  ];
  const result = await discoverUpNextSequelChains({
    watchlist: [
      source(4100, [sequel(4101)], "Budget A One"),
      source(4200, [sequel(4201)], "Budget B One"),
    ],
    mediaResolver: resolverFrom(graph),
    requestBudget: 1,
  });

  expect(result.incompleteCause).toBe("request-budget");
  expect(result.networkRequestCount).toBe(1);
  expect(result.warning).toMatch(/overall budget of 1 batched AniList request/i);
  expect(result.suggestions.map((anime) => anime.animeId).sort()).toEqual(["4101", "4201"]);
});

test("caches complete traversal results and avoids repeated resolver requests", async () => {
  const calls = [];
  const watchlist = [source(101, [sequel(102)], "Cached Saga")];
  const mediaResolver = resolverFrom([media(102, [], { title: "Cached Sequel" })], calls);
  const first = await resolveUpNextSuggestions({ watchlist, mediaResolver });
  const second = await resolveUpNextSuggestions({ watchlist, mediaResolver });

  expect(first.suggestions).toHaveLength(1);
  expect(second.suggestions).toEqual(first.suggestions);
  expect(calls).toHaveLength(1);
});

test("forced discovery bypasses a complete chain cache and replaces it only after success", async () => {
  const watchlist = [source(601, [sequel(602)], "Refresh Saga One")];
  let graphVersion = 1;
  const calls = [];
  const mediaResolver = async (animeIds, options = {}) => {
    calls.push({ animeIds: [...animeIds], forceRefresh: options.forceRefresh });
    const graph = graphVersion === 1
      ? [media(602, [], { title: "Refresh Saga Two" })]
      : [
          media(601, [sequel(602)], { title: "Refresh Saga One" }),
          media(602, [sequel(603)], { title: "Refresh Saga Two" }),
          media(603, [], { title: "Refresh Saga Three" }),
        ];
    const byId = new Map(graph.map((anime) => [anime.animeId, anime]));
    return animeIds.map((animeId) => byId.get(String(animeId))).filter(Boolean);
  };

  const initial = await resolveUpNextSuggestions({ watchlist, mediaResolver });
  graphVersion = 2;
  const refreshed = await resolveUpNextSuggestions({ watchlist, mediaResolver, forceRefresh: true });
  const callCountAfterRefresh = calls.length;
  const cachedReplacement = await resolveUpNextSuggestions({ watchlist, mediaResolver });

  expect(initial.suggestions.map((anime) => anime.animeId)).toEqual(["602"]);
  expect(refreshed.suggestions.map((anime) => anime.animeId)).toEqual(["602", "603"]);
  expect(calls.slice(1).every((call) => call.forceRefresh === true)).toBe(true);
  expect(cachedReplacement.suggestions).toEqual(refreshed.suggestions);
  expect(calls).toHaveLength(callCountAfterRefresh);
});

test("manual refresh continues a budget-limited traversal from refreshed metadata", async () => {
  const graph = new Map([
    [5100, { id: 5100, next: 5101 }],
    [5101, { id: 5101, next: 5102 }],
    [5102, { id: 5102, next: 5103 }],
    [5103, { id: 5103, next: null }],
  ]);
  let networkCalls = 0;
  const fetcher = async (query, variables) => {
    networkCalls += 1;
    return {
      Page: {
        media: variables.ids.map((id) => {
          const item = graph.get(id);
          return {
            id,
            title: { english: `Continuation ${id}`, romaji: `Continuation ${id}` },
            coverImage: { extraLarge: `${id}.jpg` },
            format: "TV",
            averageScore: 80,
            seasonYear: 2025,
            relations: {
              edges: item.next ? [{ relationType: "SEQUEL", node: { id: item.next, type: "ANIME" } }] : [],
            },
          };
        }),
      },
    };
  };
  const mediaResolver = (animeIds, options) => fetchUpNextMedia(animeIds, { ...options, fetcher });
  const watchlist = [source(5100, [sequel(5101)], "Continuation 5100")];

  const first = await resolveUpNextSuggestions({
    watchlist,
    mediaResolver,
    requestBudget: 2,
    forceRefresh: true,
  });
  const callsAfterFirst = networkCalls;
  const continued = await resolveUpNextSuggestions({
    watchlist,
    mediaResolver,
    requestBudget: 2,
    forceRefresh: true,
  });

  expect(first.incompleteCause).toBe("request-budget");
  expect(first.suggestions.map((anime) => anime.animeId)).toEqual(["5101"]);
  expect(continued.incomplete).toBe(false);
  expect(continued.suggestions.map((anime) => anime.animeId)).toEqual(["5101", "5102", "5103"]);
  expect(networkCalls - callsAfterFirst).toBe(2);
});

test("simultaneous forced discoveries share one traversal", async () => {
  const watchlist = [source(701, [sequel(702)], "Dedupe Saga")];
  const calls = [];
  const mediaResolver = async (animeIds, options) => {
    calls.push({ animeIds: [...animeIds], options });
    await Promise.resolve();
    const graph = [
      media(701, [sequel(702)], { title: "Dedupe Saga One" }),
      media(702, [], { title: "Dedupe Saga Two" }),
    ];
    const byId = new Map(graph.map((anime) => [anime.animeId, anime]));
    return animeIds.map((animeId) => byId.get(String(animeId))).filter(Boolean);
  };

  const [first, second] = await Promise.all([
    resolveUpNextSuggestions({ watchlist, mediaResolver, forceRefresh: true }),
    resolveUpNextSuggestions({ watchlist, mediaResolver, forceRefresh: true }),
  ]);

  expect(second).toEqual(first);
  expect(calls).toHaveLength(2);
  expect(calls.every((call) => call.options.forceRefresh)).toBe(true);
});

test("maps official upcoming release status and start date from AniList metadata", async () => {
  const result = await fetchUpNextMedia([202], {
    fetcher: async () => ({
      Page: {
        media: [{
          id: 202,
          title: { english: "Upcoming Sequel", romaji: "Upcoming Sequel" },
          coverImage: { extraLarge: "upcoming.jpg" },
          format: "TV",
          averageScore: null,
          seasonYear: 2028,
          status: "NOT_YET_RELEASED",
          startDate: { year: 2028, month: 4, day: 1 },
          relations: { edges: [] },
        }],
      },
    }),
  });

  expect(result[0]).toMatchObject({
    animeId: "202",
    status: "NOT_YET_RELEASED",
    startDate: { year: 2028, month: 4, day: 1 },
  });
});

test.each(["AniList HTTP 403", "AniList HTTP 429", "AniList request timed out."])(
  "handles %s without discarding the saved library",
  async (message) => {
    const result = await discoverUpNextSequelChains({
      watchlist: [source(301, [sequel(302)], "Unavailable Saga")],
      mediaResolver: async () => { throw new Error(message); },
    });
    expect(result).toMatchObject({ suggestions: [], incomplete: true });
    expect(result.warning).toMatch(/HTTP 403|HTTP 429|timed out/i);
  },
);

test("saving one suggested member preserves the remaining derived group identity", async () => {
  const resolver = resolverFrom([
    media(402, [sequel(403)], { title: "Stable Saga Two" }),
    media(403, [sequel(404)], { title: "Stable Saga Three" }),
    media(404, [], { title: "Stable Saga Four" }),
  ]);
  const initial = await discoverUpNextSequelChains({
    watchlist: [source(401, [sequel(402)], "Stable Saga One")],
    mediaResolver: resolver,
  });
  const initialGroup = deriveUpNextGroups(initial.suggestions).groups[0];
  const afterSave = await discoverUpNextSequelChains({
    watchlist: [
      source(401, [sequel(402)], "Stable Saga One"),
      media(402, [sequel(403)], { title: "Stable Saga Two" }),
    ],
    mediaResolver: resolver,
  });
  const remainingGroup = deriveUpNextGroups(afterSave.suggestions).groups[0];

  expect(afterSave.suggestions.map((anime) => anime.animeId)).toEqual(["403", "404"]);
  expect(remainingGroup.groupId).toBe(initialGroup.groupId);
});

test("discovery and derived grouping perform no Firestore mutations", async () => {
  const result = await discoverUpNextSequelChains({
    watchlist: [source(501, [sequel(502)], "Read Only Saga")],
    mediaResolver: resolverFrom([media(502, [], { title: "Read Only Sequel" })]),
  });
  deriveUpNextGroups(result.suggestions);

  expect(firestore.createGroup).not.toHaveBeenCalled();
  expect(firestore.addAnimeToGroup).not.toHaveBeenCalled();
  expect(firestore.removeAnimeFromGroup).not.toHaveBeenCalled();
  expect(firestore.deleteGroup).not.toHaveBeenCalled();
});
