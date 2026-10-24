import { fetchAniList } from "../../api/Fetch.js";
import {
  deriveAutoGroupName,
  deriveDesiredGroups,
  writeCachedRelations,
} from "../../firebase/autoGroupingService.js";
import { selectAutomaticGroupingRelations } from "../../firebase/anilistRelations.js";

export const SYSTEM_COLLECTION_UP_NEXT = "__up_next__";
export const UP_NEXT_SEARCH_SCOPE = "up-next";
export const UP_NEXT_SERIES_NODE_LIMIT = 100;
export const UP_NEXT_REQUEST_BUDGET = 24;
export const UP_NEXT_TRAVERSAL_LIMIT = UP_NEXT_SERIES_NODE_LIMIT;

const MEDIA_CACHE_PREFIX = "anihub:up-next-media:";
const TRAVERSAL_CACHE_PREFIX = "anihub:up-next-chain:";
const MEDIA_CACHE_TTL_MS = 30 * 60 * 1000;
const TRAVERSAL_CACHE_TTL_MS = 30 * 60 * 1000;
const ANILIST_BATCH_SIZE = 50;
const ANILIST_TIMEOUT_MS = 8000;
const pendingTraversals = new Map();
let refreshSequence = 0;

const UP_NEXT_MEDIA_QUERY = `
  query UpNextMedia($ids: [Int], $perPage: Int) {
    Page(perPage: $perPage) {
      media(id_in: $ids, type: ANIME) {
        id
        title { romaji english }
        coverImage { extraLarge }
        format
        averageScore
        seasonYear
        status
        startDate { year month day }
        relations {
          edges {
            relationType
            node { id type }
          }
        }
      }
    }
  }
`;

const animeIdOf = (anime) => String(anime?.animeId ?? anime?.id ?? anime?.mal_id ?? "").trim();

const isCanonicalAniListId = (value) => /^[1-9][0-9]{0,11}$/u.test(String(value ?? ""));

const normalizeSource = (anime, scope) => ({
  animeId: animeIdOf(anime),
  title: String(anime?.title || anime?.title_english || "Unknown source"),
  scope,
});

const compareAnimeIds = (left, right) => Number(left) - Number(right) || left.localeCompare(right);

const uniqueSources = (sources) => {
  const seen = new Set();
  return sources.filter((source) => {
    const key = `${source.scope}:${source.animeId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const deriveUpNextCandidates = ({ watchlist = [], completed = [] } = {}) => {
  const sources = [
    ...watchlist.map((anime) => ({ anime, scope: "watchlist" })),
    ...completed.map((anime) => ({ anime, scope: "completed" })),
  ];
  const savedIds = new Set(sources.map(({ anime }) => animeIdOf(anime)).filter(Boolean));
  const candidates = new Map();

  sources.forEach(({ anime, scope }) => {
    const sourceId = animeIdOf(anime);
    if (!sourceId || !Array.isArray(anime?.anilistRelations)) return;

    anime.anilistRelations.forEach((relation) => {
      if (relation?.relationType !== "SEQUEL") return;
      const relatedId = String(relation?.relatedId ?? "").trim();
      if (!isCanonicalAniListId(relatedId) || relatedId === sourceId || savedIds.has(relatedId)) return;

      if (!candidates.has(relatedId)) {
        candidates.set(relatedId, { animeId: relatedId, sources: [] });
      }
      const candidate = candidates.get(relatedId);
      candidate.sources.push(normalizeSource(anime, scope));
      candidate.sources = uniqueSources(candidate.sources);
    });
  });

  return [...candidates.values()].sort((left, right) => compareAnimeIds(left.animeId, right.animeId));
};

const readTimedCache = (key, ttlMs) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.t) || Date.now() - parsed.t > ttlMs) return null;
    return parsed.d ?? null;
  } catch {
    return null;
  }
};

const writeTimedCache = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), d: value }));
  } catch {
    // Best-effort browser cache only.
  }
};

const removeCachedValue = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort browser cache only.
  }
};

const readCachedMediaEntry = (animeId) => {
  try {
    const raw = localStorage.getItem(`${MEDIA_CACHE_PREFIX}${animeId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.t) || Date.now() - parsed.t > MEDIA_CACHE_TTL_MS) return null;
    return parsed.d && typeof parsed.d === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const writeCachedMedia = (anime, refreshToken = null) => {
  try {
    localStorage.setItem(
      `${MEDIA_CACHE_PREFIX}${anime.animeId}`,
      JSON.stringify({ t: Date.now(), d: anime, r: refreshToken }),
    );
  } catch {
    // Best-effort browser cache only.
  }
};

const mapAniListMedia = (media) => {
  const animeId = String(media?.id ?? "");
  if (!isCanonicalAniListId(animeId)) return null;
  const anilistRelations = selectAutomaticGroupingRelations((media.relations?.edges || [])
    .filter((edge) => edge?.node?.type === "ANIME" && edge.node?.id)
    .map((edge) => ({
      relatedId: String(edge.node.id),
      relationType: String(edge.relationType || "").toUpperCase(),
    })));
  const anime = {
    animeId,
    title: media.title?.english || media.title?.romaji || "Untitled anime",
    title_english: media.title?.english || null,
    image: media.coverImage?.extraLarge || "",
    type: media.format || "TV",
    score: Number.isFinite(media.averageScore) ? media.averageScore / 10 : null,
    year: media.seasonYear || media.startDate?.year || null,
    status: media.status || null,
    startDate: media.startDate ? {
      year: media.startDate.year || null,
      month: media.startDate.month || null,
      day: media.startDate.day || null,
    } : null,
    anilistRelations,
  };
  writeCachedRelations(animeId, anilistRelations);
  return anime;
};

const withTimeout = (promise, timeoutMs = ANILIST_TIMEOUT_MS) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("AniList request timed out.")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
};

export const fetchUpNextMedia = async (animeIds, {
  fetcher = fetchAniList,
  timeoutMs = ANILIST_TIMEOUT_MS,
  forceRefresh = false,
  refreshToken = null,
  maxNetworkRequests = Number.POSITIVE_INFINITY,
} = {}) => {
  const ids = [...new Set((animeIds || []).map(String).filter(isCanonicalAniListId))];
  const resolved = new Map();
  const missing = [];
  let networkRequests = 0;
  let budgetExhausted = false;

  ids.forEach((animeId) => {
    const cachedEntry = readCachedMediaEntry(animeId);
    const canReuseForRefresh = forceRefresh
      && refreshToken
      && cachedEntry?.r === refreshToken;
    const cached = !forceRefresh || canReuseForRefresh ? cachedEntry?.d : null;
    if (cached) resolved.set(animeId, cached);
    else missing.push(animeId);
  });

  for (let index = 0; index < missing.length; index += ANILIST_BATCH_SIZE) {
    if (networkRequests >= maxNetworkRequests) {
      budgetExhausted = true;
      break;
    }
    const chunk = missing.slice(index, index + ANILIST_BATCH_SIZE);
    try {
      networkRequests += 1;
      const data = await withTimeout(fetcher(UP_NEXT_MEDIA_QUERY, {
        ids: chunk.map(Number),
        perPage: chunk.length,
      }, { bypassCache: forceRefresh }), timeoutMs);
      (data?.Page?.media || []).forEach((media) => {
        const mapped = mapAniListMedia(media);
        if (mapped && chunk.includes(mapped.animeId)) {
          resolved.set(mapped.animeId, mapped);
          writeCachedMedia(mapped, refreshToken);
        }
      });
    } catch (error) {
      const requestError = error instanceof Error
        ? error
        : new Error("AniList request failed.");
      requestError.partialItems = [...resolved.values()];
      requestError.networkRequests = networkRequests;
      throw requestError;
    }
  }

  const items = ids.map((animeId) => resolved.get(animeId)).filter(Boolean);
  Object.defineProperties(items, {
    networkRequests: { value: networkRequests },
    budgetExhausted: { value: budgetExhausted },
  });
  return items;
};

const addUndirectedEdge = (adjacency, left, right) => {
  if (!adjacency.has(left)) adjacency.set(left, new Set());
  if (!adjacency.has(right)) adjacency.set(right, new Set());
  adjacency.get(left).add(right);
  adjacency.get(right).add(left);
};

const getStartDateValue = (anime) => {
  const year = Number(anime?.startDate?.year || anime?.year || 0);
  if (!year) return Number.POSITIVE_INFINITY;
  const month = Number(anime?.startDate?.month || 1);
  const day = Number(anime?.startDate?.day || 1);
  return (year * 10000) + (month * 100) + day;
};

const compareSuggestions = (left, right) => (
  String(left.upNextSeriesName || "").localeCompare(String(right.upNextSeriesName || ""))
  || getStartDateValue(left) - getStartDateValue(right)
  || (left.upNextDepth ?? Number.POSITIVE_INFINITY) - (right.upNextDepth ?? Number.POSITIVE_INFINITY)
  || compareAnimeIds(animeIdOf(left), animeIdOf(right))
);

const classifyRequestFailure = (error) => {
  const message = String(error?.message || "").toLocaleLowerCase();
  if (message.includes("429") || message.includes("rate limit")) return "rate-limit";
  if (message.includes("403") || message.includes("forbidden")) return "forbidden";
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  return "api-failure";
};

const warningForTraversal = ({ causes, perSeriesLimit, requestBudget, limitedSeriesCount }) => {
  const messages = [];
  if (causes.includes("rate-limit")) {
    messages.push("AniList rate-limited sequel discovery (HTTP 429). Verified results are shown; try again later.");
  } else if (causes.includes("forbidden")) {
    messages.push("AniList rejected sequel discovery (HTTP 403). Verified results are shown; try again later.");
  } else if (causes.includes("timeout")) {
    messages.push("AniList timed out during sequel discovery. Verified results are shown; try again.");
  } else if (causes.includes("api-failure")) {
    messages.push("AniList could not finish every sequel chain. Verified results are shown; try again.");
  }
  if (causes.includes("request-budget")) {
    messages.push(`Up Next used its overall budget of ${requestBudget} batched AniList requests. Completed series are shown; Discover Sequels can continue from cached progress.`);
  }
  if (causes.includes("series-limit")) {
    const seriesLabel = limitedSeriesCount === 1 ? "One sequel series" : `${limitedSeriesCount} sequel series`;
    messages.push(`${seriesLabel} reached the ${perSeriesLimit}-anime per-series safety limit. Other series were still processed.`);
  }
  return messages.join(" ");
};

export const discoverUpNextSequelChains = async ({
  watchlist = [],
  completed = [],
  mediaResolver = fetchUpNextMedia,
  maxVisited = null,
  perSeriesLimit = maxVisited ?? UP_NEXT_SERIES_NODE_LIMIT,
  requestBudget = UP_NEXT_REQUEST_BUDGET,
  forceRefresh = false,
  refreshToken = null,
} = {}) => {
  const normalizedSeriesLimit = Number.isInteger(perSeriesLimit) && perSeriesLimit > 0
    ? perSeriesLimit
    : UP_NEXT_SERIES_NODE_LIMIT;
  const normalizedRequestBudget = Number.isInteger(requestBudget) && requestBudget >= 0
    ? requestBudget
    : UP_NEXT_REQUEST_BUDGET;
  const sourceRecords = [
    ...watchlist.map((anime) => ({ anime, scope: "watchlist" })),
    ...completed.map((anime) => ({ anime, scope: "completed" })),
  ].filter(({ anime }) => isCanonicalAniListId(animeIdOf(anime)));
  const savedIds = new Set(sourceRecords.map(({ anime }) => animeIdOf(anime)));
  const nodes = new Map(sourceRecords.map(({ anime }) => [animeIdOf(anime), { ...anime }]));
  const depths = new Map(sourceRecords.map(({ anime }) => [animeIdOf(anime), 0]));
  const adjacency = new Map(sourceRecords.map(({ anime }) => [animeIdOf(anime), new Set()]));
  const discoveredIds = new Set();
  const globallyProcessed = new Set();
  const ownerByNode = new Map();
  const parentBySeries = new Map();
  const seriesStates = new Map();
  const causes = new Set();
  let networkRequests = 0;
  let rotationOffset = 0;
  let stopAfterFrontier = false;

  const rootSeriesKey = (seriesKey) => {
    let current = seriesKey;
    while (parentBySeries.get(current) && parentBySeries.get(current) !== current) {
      current = parentBySeries.get(current);
    }
    return current;
  };

  const getSeriesState = (seriesKey) => seriesStates.get(rootSeriesKey(seriesKey));

  const createSeriesState = (seriesKey) => {
    const state = {
      key: seriesKey,
      queue: [],
      queued: new Set(),
      processed: new Set(),
      limited: false,
    };
    parentBySeries.set(seriesKey, seriesKey);
    seriesStates.set(seriesKey, state);
    return state;
  };

  const mergeSeriesStates = (leftKey, rightKey) => {
    const left = getSeriesState(leftKey);
    const right = getSeriesState(rightKey);
    if (!left) return right;
    if (!right || left.key === right.key) return left;
    const [target, source] = compareAnimeIds(left.key, right.key) <= 0
      ? [left, right]
      : [right, left];
    parentBySeries.set(source.key, target.key);
    source.processed.forEach((animeId) => target.processed.add(animeId));
    source.queue.forEach((animeId) => {
      if (!globallyProcessed.has(animeId) && !target.queued.has(animeId)) {
        target.queue.push(animeId);
        target.queued.add(animeId);
      }
    });
    target.limited = target.limited || source.limited;
    seriesStates.delete(source.key);
    return target;
  };

  const claimAndQueue = (state, animeId) => {
    const existingOwner = ownerByNode.get(animeId);
    let currentState = existingOwner
      ? mergeSeriesStates(state.key, existingOwner)
      : state;
    currentState = getSeriesState(currentState.key);
    ownerByNode.set(animeId, currentState.key);
    if (!globallyProcessed.has(animeId) && !currentState.queued.has(animeId)) {
      currentState.queue.push(animeId);
      currentState.queued.add(animeId);
    }
    return currentState;
  };

  savedIds.forEach((animeId) => {
    const existingOwner = ownerByNode.get(animeId);
    const state = existingOwner ? getSeriesState(existingOwner) : createSeriesState(animeId);
    claimAndQueue(state, animeId);
  });

  const requeueFront = ({ animeId, seriesKey }) => {
    const state = getSeriesState(seriesKey);
    if (!state || globallyProcessed.has(animeId) || state.queued.has(animeId)) return;
    state.queue.unshift(animeId);
    state.queued.add(animeId);
  };

  while (true) {
    const activeStates = [...seriesStates.values()].filter((state) => {
      while (state.queue.length > 0 && globallyProcessed.has(state.queue[0])) {
        state.queued.delete(state.queue.shift());
      }
      if (state.processed.size >= normalizedSeriesLimit && state.queue.length > 0) {
        state.limited = true;
        return false;
      }
      return state.queue.length > 0;
    });
    if (activeStates.length === 0) break;

    const startIndex = rotationOffset % activeStates.length;
    const orderedStates = [
      ...activeStates.slice(startIndex),
      ...activeStates.slice(0, startIndex),
    ];
    const frontier = [];
    let madeProgress = true;
    while (frontier.length < ANILIST_BATCH_SIZE && madeProgress) {
      madeProgress = false;
      const usedSeriesKeys = new Set();
      for (const stateReference of orderedStates) {
        const state = getSeriesState(stateReference.key);
        if (!state || usedSeriesKeys.has(state.key)) continue;
        usedSeriesKeys.add(state.key);
        while (state.queue.length > 0 && globallyProcessed.has(state.queue[0])) {
          state.queued.delete(state.queue.shift());
        }
        if (state.processed.size >= normalizedSeriesLimit || state.queue.length === 0) {
          if (state.queue.length > 0) state.limited = true;
          continue;
        }
        const animeId = state.queue.shift();
        state.queued.delete(animeId);
        frontier.push({ animeId, seriesKey: state.key });
        madeProgress = true;
        if (frontier.length >= ANILIST_BATCH_SIZE) break;
      }
    }
    rotationOffset += Math.min(frontier.length, activeStates.length);
    if (frontier.length === 0) break;

    const needsMetadataEntries = forceRefresh
      ? frontier
      : frontier.filter(({ animeId }) => !Array.isArray(nodes.get(animeId)?.anilistRelations));
    const needsMetadataIds = needsMetadataEntries.map(({ animeId }) => animeId);
    const blockedByBudget = networkRequests >= normalizedRequestBudget && needsMetadataIds.length > 0;
    let processableEntries = frontier;

    if (blockedByBudget) {
      const blockedIds = new Set(needsMetadataIds);
      needsMetadataEntries.slice().reverse().forEach(requeueFront);
      processableEntries = frontier.filter(({ animeId }) => !blockedIds.has(animeId));
      causes.add("request-budget");
      stopAfterFrontier = true;
    } else if (needsMetadataIds.length > 0) {
      let resolvedMedia;
      let requestFailure = null;
      try {
        resolvedMedia = await mediaResolver(needsMetadataIds, {
          forceRefresh,
          refreshToken,
          maxNetworkRequests: normalizedRequestBudget - networkRequests,
        });
        networkRequests += Number.isInteger(resolvedMedia.networkRequests)
          ? resolvedMedia.networkRequests
          : 1;
        if (resolvedMedia.budgetExhausted) causes.add("request-budget");
      } catch (error) {
        requestFailure = error;
        resolvedMedia = Array.isArray(error?.partialItems) ? error.partialItems : [];
        networkRequests += Number.isInteger(error?.networkRequests) ? error.networkRequests : 1;
        causes.add(classifyRequestFailure(error));
      }
      resolvedMedia.forEach((anime) => {
        const animeId = animeIdOf(anime);
        if (isCanonicalAniListId(animeId)) {
          nodes.set(animeId, { ...nodes.get(animeId), ...anime });
        }
      });
      const resolvedIds = new Set(resolvedMedia.map(animeIdOf));
      const hasMissingMetadata = forceRefresh
        ? needsMetadataIds.some((animeId) => !resolvedIds.has(animeId))
        : needsMetadataIds.some((animeId) => !Array.isArray(nodes.get(animeId)?.anilistRelations));
      if (hasMissingMetadata && !requestFailure && !resolvedMedia.budgetExhausted) {
        causes.add("api-failure");
      }
      if (requestFailure || hasMissingMetadata || resolvedMedia.budgetExhausted) {
        stopAfterFrontier = true;
      }
    }

    processableEntries.forEach(({ animeId, seriesKey }) => {
      let state = getSeriesState(seriesKey);
      if (!state || globallyProcessed.has(animeId)) return;
      if (state.processed.size >= normalizedSeriesLimit) {
        state.limited = true;
        requeueFront({ animeId, seriesKey: state.key });
        return;
      }
      globallyProcessed.add(animeId);
      state.processed.add(animeId);
      const anime = nodes.get(animeId);
      if (!Array.isArray(anime?.anilistRelations)) return;
      anime.anilistRelations.forEach((relation) => {
        const relatedId = String(relation?.relatedId ?? "").trim();
        if (relation?.relationType !== "SEQUEL"
          || !isCanonicalAniListId(relatedId)
          || relatedId === animeId) return;
        discoveredIds.add(relatedId);
        addUndirectedEdge(adjacency, animeId, relatedId);
        const nextDepth = (depths.get(animeId) || 0) + 1;
        depths.set(relatedId, Math.min(depths.get(relatedId) ?? Number.POSITIVE_INFINITY, nextDepth));
        if (!nodes.has(relatedId)) nodes.set(relatedId, { animeId: relatedId });
        state = claimAndQueue(state, relatedId);
      });
      if (state.processed.size >= normalizedSeriesLimit && state.queue.length > 0) {
        state.limited = true;
      }
    });

    if (stopAfterFrontier) break;
  }

  const limitedStates = [...seriesStates.values()].filter((state) => state.limited && state.queue.length > 0);
  if (limitedStates.length > 0) causes.add("series-limit");

  const componentById = new Map();
  const components = new Map();
  [...adjacency.keys()].sort(compareAnimeIds).forEach((startId) => {
    if (componentById.has(startId)) return;
    const componentIds = [];
    const componentQueue = [startId];
    componentById.set(startId, startId);
    while (componentQueue.length > 0) {
      const animeId = componentQueue.shift();
      componentIds.push(animeId);
      (adjacency.get(animeId) || []).forEach((neighborId) => {
        if (!componentById.has(neighborId)) {
          componentById.set(neighborId, startId);
          componentQueue.push(neighborId);
        }
      });
    }
    const seriesId = [...componentIds].sort(compareAnimeIds)[0];
    componentIds.forEach((animeId) => componentById.set(animeId, seriesId));
    components.set(seriesId, componentIds);
  });

  const seriesNames = new Map();
  components.forEach((componentIds, seriesId) => {
    const titledNodes = componentIds.map((animeId) => nodes.get(animeId)).filter((anime) => anime?.title);
    seriesNames.set(seriesId, deriveAutoGroupName(titledNodes));
  });

  const sourcesBySeries = new Map();
  sourceRecords.forEach(({ anime, scope }) => {
    const seriesId = componentById.get(animeIdOf(anime));
    if (!seriesId) return;
    if (!sourcesBySeries.has(seriesId)) sourcesBySeries.set(seriesId, []);
    sourcesBySeries.get(seriesId).push(normalizeSource(anime, scope));
  });

  const suggestions = [...discoveredIds]
    .filter((animeId) => !savedIds.has(animeId))
    .map((animeId) => {
      const anime = nodes.get(animeId);
      const seriesId = componentById.get(animeId);
      if (!anime?.title || !seriesId) return null;
      return {
        ...anime,
        upNextDepth: depths.get(animeId) ?? null,
        upNextSeriesId: seriesId,
        upNextSeriesName: seriesNames.get(seriesId) || anime.title,
        upNextSources: uniqueSources(sourcesBySeries.get(seriesId) || []),
      };
    })
    .filter(Boolean)
    .sort(compareSuggestions);

  return {
    suggestions,
    incomplete: causes.size > 0,
    incompleteCause: causes.values().next().value || "",
    incompleteCauses: [...causes],
    warning: causes.size > 0 ? warningForTraversal({
      causes: [...causes],
      perSeriesLimit: normalizedSeriesLimit,
      requestBudget: normalizedRequestBudget,
      limitedSeriesCount: limitedStates.length,
    }) : "",
    visitedCount: globallyProcessed.size,
    networkRequestCount: networkRequests,
    completedSeriesCount: [...seriesStates.values()].filter((state) => state.queue.length === 0).length,
    totalSeriesCount: seriesStates.size,
  };
};

const sourceFingerprint = (watchlist, completed) => [
  ...watchlist.map((anime) => ({ anime, scope: "w" })),
  ...completed.map((anime) => ({ anime, scope: "c" })),
].map(({ anime, scope }) => {
  const relations = Array.isArray(anime?.anilistRelations)
    ? anime.anilistRelations
      .map((relation) => `${relation?.relatedId}:${relation?.relationType}`)
      .sort()
      .join(",")
    : "missing";
  return `${scope}:${animeIdOf(anime)}:${relations}`;
}).sort().join("|");

const hashText = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const resolveUpNextSuggestions = async ({
  watchlist = [],
  completed = [],
  relationResolver = null,
  mediaResolver = fetchUpNextMedia,
  maxVisited = null,
  perSeriesLimit = maxVisited ?? UP_NEXT_SERIES_NODE_LIMIT,
  requestBudget = UP_NEXT_REQUEST_BUDGET,
  forceRefresh = false,
} = {}) => {
  let hydratedWatchlist = watchlist;
  let hydratedCompleted = completed;
  if (relationResolver) {
    const allSources = [...watchlist, ...completed];
    const missingRelations = allSources.filter((anime) => !Array.isArray(anime?.anilistRelations));
    const relationMap = missingRelations.length > 0 ? await relationResolver(missingRelations) : new Map();
    const hydrate = (anime) => Array.isArray(anime?.anilistRelations)
      ? anime
      : { ...anime, anilistRelations: relationMap.get(animeIdOf(anime)) || [] };
    hydratedWatchlist = watchlist.map(hydrate);
    hydratedCompleted = completed.map(hydrate);
  }

  const fingerprint = sourceFingerprint(hydratedWatchlist, hydratedCompleted);
  const cacheKey = `${TRAVERSAL_CACHE_PREFIX}${hashText(`${perSeriesLimit}:${requestBudget}:${fingerprint}`)}`;
  const progressKey = `${cacheKey}:progress`;
  const cachedEntry = readTimedCache(cacheKey, TRAVERSAL_CACHE_TTL_MS);
  if (!forceRefresh
    && cachedEntry?.fingerprint === fingerprint
    && cachedEntry.result?.suggestions
    && !cachedEntry.result.incomplete) return cachedEntry.result;
  const progressEntry = forceRefresh
    ? readTimedCache(progressKey, TRAVERSAL_CACHE_TTL_MS)
    : null;
  const refreshToken = progressEntry?.fingerprint === fingerprint
    ? progressEntry.refreshToken
    : `${Date.now().toString(36)}-${(refreshSequence += 1).toString(36)}`;
  const requestKey = forceRefresh ? `${cacheKey}:force` : cacheKey;
  if (pendingTraversals.has(requestKey)) return pendingTraversals.get(requestKey);

  const traversal = discoverUpNextSequelChains({
    watchlist: hydratedWatchlist,
    completed: hydratedCompleted,
    mediaResolver,
    perSeriesLimit,
    requestBudget,
    forceRefresh,
    refreshToken: forceRefresh ? refreshToken : null,
  }).then((result) => {
    if (!result.incomplete) {
      writeTimedCache(cacheKey, { fingerprint, result });
      removeCachedValue(progressKey);
    } else if (forceRefresh) {
      writeTimedCache(progressKey, { fingerprint, refreshToken, result });
    }
    return result;
  }).finally(() => pendingTraversals.delete(requestKey));
  pendingTraversals.set(requestKey, traversal);
  return traversal;
};

const hashMemberIds = (memberIds) => hashText(memberIds.join("|"));

export const deriveUpNextGroups = (suggestions = []) => {
  const groupedBySeries = new Map();
  const unassigned = [];
  suggestions.forEach((anime) => {
    if (anime?.upNextSeriesId) {
      if (!groupedBySeries.has(anime.upNextSeriesId)) groupedBySeries.set(anime.upNextSeriesId, []);
      groupedBySeries.get(anime.upNextSeriesId).push(anime);
    } else {
      unassigned.push(anime);
    }
  });

  const legacyComponents = deriveDesiredGroups(unassigned).map((memberIds) => (
    [...memberIds].map((animeId) => unassigned.find((anime) => animeIdOf(anime) === animeId)).filter(Boolean)
  ));
  const components = [
    ...[...groupedBySeries.values()].filter((members) => members.length >= 2),
    ...legacyComponents,
  ];
  const groupByAnimeId = new Map();
  const groups = components.map((members) => {
    const sortedMembers = [...members].sort(compareSuggestions);
    const memberIds = sortedMembers.map(animeIdOf);
    const seriesId = sortedMembers[0]?.upNextSeriesId || memberIds.slice().sort(compareAnimeIds)[0];
    const groupId = `up-next-${hashMemberIds([seriesId])}`;
    memberIds.forEach((animeId) => groupByAnimeId.set(animeId, groupId));
    return {
      groupId,
      name: sortedMembers[0]?.upNextSeriesName || deriveAutoGroupName(sortedMembers),
      scopeKey: UP_NEXT_SEARCH_SCOPE,
      thumbnailAnimeId: memberIds.find((animeId) => sortedMembers.find(
        (anime) => animeIdOf(anime) === animeId && anime.image
      )) || memberIds[0],
      groupType: "automatic",
      status: "active",
      virtualMemberIds: memberIds,
    };
  });

  return {
    groups,
    animeDocuments: suggestions.map((anime) => {
      const groupId = groupByAnimeId.get(animeIdOf(anime));
      return groupId ? { ...anime, groupId } : { ...anime };
    }),
  };
};
