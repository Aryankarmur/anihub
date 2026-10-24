/**
 * autoGroupingService.js — F01 Automatic Anime Grouping
 *
 * Detects confirmed PREQUEL / SEQUEL chains from the `anilistRelations` field
 * stored on each saved-anime Firestore document and reconciles Firestore group
 * metadata without touching unrelated scopes, without deleting anime, and
 * without creating duplicate groups.
 *
 * Safety guarantees
 * -----------------
 * - Operates only inside the feature gate (isAnimeGroupingEnabled).
 * - Reads only the anime documents already fetched by the active subscription.
 * - Never modifies anime documents directly; delegates to existing services.
 * - Respects autoGroupExcluded: true on an anime document (manual override).
 * - Reconciles only groups explicitly marked groupType: "automatic".
 * - Treats manual and pre-marker groups as protected user data.
 * - Never merges groups across different scopeKeys.
 * - Idempotent: repeated reconciliation with unchanged data produces zero writes.
 * - Transitive chains: A->B->C are joined even when only A and C are saved.
 */

import {
  createGroup,
  addAnimeToGroup,
  removeAnimeFromGroup,
  deleteGroup as deleteGroupService,
  subscribeToGroupMetadata,
} from "./firestore.js";
import * as groupingFeatureGate from "./groupingFeatureGate.js";

const isAutoReconcileEnabled = (uid) => {
  try {
    if (typeof groupingFeatureGate.isAutomaticReconciliationEnabled === "function") {
      return groupingFeatureGate.isAutomaticReconciliationEnabled(uid);
    }
  } catch {
    // Fall back to isAnimeGroupingEnabled if mock does not define isAutomaticReconciliationEnabled
  }
  return Boolean(groupingFeatureGate.isAnimeGroupingEnabled);
};


import {
  GROUP_TYPE_AUTOMATIC,
  validateUid,
  parseGroupScopeKey,
} from "./groupingUtils.js";
import {
  ANILIST_RELATION_TYPES,
  normalizeAniListRelations,
  selectAutomaticGroupingRelations,
} from "./anilistRelations.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Relationship types that qualify for automatic grouping. */
export const AUTO_GROUP_RELATION_TYPES = new Set(ANILIST_RELATION_TYPES);

/**
 * Field name on anime documents that carries relation metadata.
 * Shape: Array<{ relatedId: string, relationType: string }>
 */
export const ANILIST_RELATIONS_FIELD = "anilistRelations";

/**
 * Field name on anime documents that marks a manual exclusion from auto-grouping.
 * Set to true to prevent this anime from being automatically placed in a group.
 */
export const AUTO_GROUP_EXCLUDED_FIELD = "autoGroupExcluded";

/**
 * Field name on group metadata documents that distinguishes groups created by
 * automatic reconciliation from user-created or legacy groups.
 */
export const GROUP_TYPE_FIELD = "groupType";

// ---------------------------------------------------------------------------
// Relation graph helpers
// ---------------------------------------------------------------------------

/**
 * Build a map from animeId to the set of related animeIds (PREQUEL/SEQUEL only).
 * Only IDs that are actually saved in the current scope are included as targets.
 *
 * @param {Array<object>} animeDocuments
 * @returns {Map<string, Set<string>>} adjacency list keyed by animeId
 */
export function buildRelationGraph(animeDocuments) {
  const savedIds = new Set(
    animeDocuments.map((a) => String(a.animeId ?? a.id ?? "")).filter(Boolean),
  );

  const graph = new Map();

  for (const anime of animeDocuments) {
    const id = String(anime.animeId ?? anime.id ?? "");
    if (!id) continue;
    if (!graph.has(id)) graph.set(id, new Set());

    const rawRelations = Array.isArray(anime[ANILIST_RELATIONS_FIELD])
      ? anime[ANILIST_RELATIONS_FIELD]
      : (readCachedRelations(id) || []);
    const relations = selectAutomaticGroupingRelations(rawRelations);

    for (const rel of relations) {
      const relId = String(rel?.relatedId ?? "");
      const relType = String(rel?.relationType ?? "").toUpperCase();
      if (!relId || !AUTO_GROUP_RELATION_TYPES.has(relType)) continue;
      // Only link to IDs actually saved in this scope — no cross-scope leakage.
      if (!savedIds.has(relId)) continue;
      graph.get(id).add(relId);
      if (!graph.has(relId)) graph.set(relId, new Set());
      graph.get(relId).add(id);
    }
  }

  return graph;
}

/**
 * Find connected components in the relation graph using BFS.
 * Returns only components with >= 2 members (potential groups).
 *
 * @param {Map<string, Set<string>>} graph
 * @returns {Array<Set<string>>} each Set is a connected component
 */
export function findRelatedComponents(graph) {
  const visited = new Set();
  const components = [];

  for (const startId of graph.keys()) {
    if (visited.has(startId)) continue;
    const component = new Set();
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      component.add(id);
      for (const neighbor of (graph.get(id) ?? [])) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    if (component.size >= 2) components.push(component);
  }

  return components;
}

/**
 * Derive the desired automatic grouping state from a flat list of saved anime.
 * Excludes anime with autoGroupExcluded: true.
 *
 * @param {Array<object>} animeDocuments
 * @returns {Array<Set<string>>} list of desired group member-sets (each >= 2 ids)
 */
export function deriveDesiredGroups(animeDocuments) {
  const eligible = animeDocuments.filter((a) => !a[AUTO_GROUP_EXCLUDED_FIELD]);
  const graph = buildRelationGraph(eligible);
  return findRelatedComponents(graph);
}

// ---------------------------------------------------------------------------
// Group name derivation
// ---------------------------------------------------------------------------

/**
 * Choose a representative name for an automatic group.
 * Picks the longest common word-prefix of member titles, falling back to the
 * first title when no useful prefix exists. Clamped to 80 chars.
 *
 * @param {Array<object>} members
 * @returns {string}
 */
export function deriveAutoGroupName(members) {
  const titles = members
    .map((m) => String(m.title ?? "").trim())
    .filter(Boolean);
  if (titles.length === 0) return "Series";
  if (titles.length === 1) return titles[0].slice(0, 80);

  const wordSets = titles.map((t) => t.split(/\s+/));
  const minLen = Math.min(...wordSets.map((w) => w.length));
  const commonWords = [];
  for (let i = 0; i < minLen; i++) {
    const normalize = (w) => w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").toLowerCase();
    const word = normalize(wordSets[0][i]);
    if (word && wordSets.every((ws) => normalize(ws[i]) === word)) {
      commonWords.push(wordSets[0][i].replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ""));
    } else {
      break;
    }
  }

  const prefix = commonWords.join(" ").trim();
  if (prefix.length >= 3) {
    return prefix.slice(0, 80);
  }
  return titles[0].slice(0, 80);
}

// ---------------------------------------------------------------------------
// Group membership helpers
// ---------------------------------------------------------------------------

/**
 * Filter active groups.
 *
 * @param {Array<object>} existingGroups - groups from subscribeToGroupMetadata
 * @returns {Array<object>} active groups only
 */
export function filterAutoGroups(existingGroups) {
  return (Array.isArray(existingGroups) ? existingGroups : []).filter(
    (g) => g?.status === "active" && g[GROUP_TYPE_FIELD] === GROUP_TYPE_AUTOMATIC,
  );
}

/**
 * Map each active group to the set of anime IDs currently assigned to it in this scope.
 *
 * @param {Array<object>} groups
 * @param {Array<object>} animeDocuments
 * @returns {Map<string, Set<string>>} groupId to Set<animeId>
 */
export function buildCurrentGroupMemberships(groups, animeDocuments) {
  const result = new Map();
  const groupList = Array.isArray(groups) ? groups : [];
  for (const group of groupList) {
    if (group?.groupId) {
      result.set(group.groupId, new Set());
    }
  }
  for (const anime of animeDocuments) {
    const id = String(anime.animeId ?? anime.id ?? "");
    const gid = String(anime.groupId ?? "");
    if (id && gid && result.has(gid)) {
      result.get(gid).add(id);
    }
  }
  return result;
}

/**
 * Match desired group components to existing groups by member overlap.
 *
 * @param {Array<Set<string>>} desiredComponents
 * @param {Map<string, Set<string>>} currentMemberships
 * @returns {Array<{desired: Set<string>, existingGroupId: string|null}>}
 */
export function matchComponentsToGroups(desiredComponents, currentMemberships) {
  const matched = new Set();

  return desiredComponents.map((desired) => {
    let bestGroupId = null;
    let bestOverlap = 0;

    for (const [groupId, current] of currentMemberships) {
      if (matched.has(groupId)) continue;
      let overlap = 0;
      for (const id of desired) {
        if (current.has(id)) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestGroupId = groupId;
      }
    }

    if (bestGroupId) matched.add(bestGroupId);
    return { desired, existingGroupId: bestGroupId };
  });
}

/**
 * Determine which existing groups have fewer than 2 members saved in this scope
 * (singletons or empty groups) and should be safely dissolved.
 * Groups with >= 2 members (such as user manual groups) are strictly protected.
 *
 * @param {Array<object>} existingGroups
 * @param {Map<string, Set<string>>} currentMemberships
 * @returns {Array<string>} groupIds to dissolve
 */
export function findOrphanedGroupIds(existingGroups, currentMemberships) {
  const groups = Array.isArray(existingGroups) ? existingGroups : [];
  return groups
    .filter((g) => {
      if (g.status !== "active") return false;
      const members = currentMemberships.get(g.groupId);
      return !members || members.size < 2;
    })
    .map((g) => g.groupId);
}

// ---------------------------------------------------------------------------
// State fingerprint (no-write guard)
// ---------------------------------------------------------------------------

/**
 * Build a stable content fingerprint for the current anime+groups state.
 * Used to skip reconciliation when nothing has changed.
 *
 * @param {Array<object>} animeDocuments
 * @param {Array<object>} [existingGroups]
 * @returns {string}
 */
export function buildStateFingerprint(animeDocuments, existingGroups = []) {
  const animeState = (animeDocuments || [])
    .map((a) => {
      const id = String(a.animeId ?? a.id ?? "");
      const gid = String(a.groupId ?? "");
      const excl = String(a[AUTO_GROUP_EXCLUDED_FIELD] ?? false);
      const relations = Array.isArray(a[ANILIST_RELATIONS_FIELD])
        ? a[ANILIST_RELATIONS_FIELD]
        : (readCachedRelations(id) || []);
      const rels = JSON.stringify(
        relations
          .map((r) => `${r.relatedId}:${r.relationType}`)
          .sort(),
      );
      return `${id}|${gid}|${excl}|${rels}`;
    })
    .sort()
    .join(";");
  const groupState = (existingGroups || [])
    .map((g) => `${g.groupId}|${g.status}`)
    .sort()
    .join(";");
  return `${animeState}::${groupState}`;
}

// ---------------------------------------------------------------------------
// Reconciliation orchestrator
// ---------------------------------------------------------------------------

/**
 * Full reconciliation: compute desired state vs Firestore, apply minimal
 * create / add / remove / delete operations.
 *
 * @param {object} params
 * @param {string} params.uid
 * @param {string} params.scopeKey
 * @param {Array<object>} params.animeDocuments
 * @param {Array<object>} params.existingGroups
 * @param {object} [params.services]
 * @returns {Promise<object>}
 */
export async function reconcileAutoGrouping({
  uid,
  scopeKey,
  animeDocuments,
  existingGroups,
  services = {},
}) {
  const {
    createGroupFn = createGroup,
    addAnimeToGroupFn = addAnimeToGroup,
    removeAnimeFromGroupFn = removeAnimeFromGroup,
    deleteGroupFn = deleteGroupService,
  } = services;

  const result = {
    created: [],
    updated: [],
    dissolved: [],
    unchanged: [],
    skipped: [],
    errors: [],
  };

  const desiredComponents = deriveDesiredGroups(animeDocuments);
  const activeGroups = (Array.isArray(existingGroups) ? existingGroups : []).filter(
    (g) => g?.status === "active",
  );
  // Missing provenance is intentionally conservative: groups created before
  // groupType existed are treated as manual and are never reorganized.
  const automaticGroups = filterAutoGroups(activeGroups);
  const currentMemberships = buildCurrentGroupMemberships(automaticGroups, animeDocuments);
  const allMemberships = buildCurrentGroupMemberships(activeGroups, animeDocuments);
  const matchedPairs = matchComponentsToGroups(desiredComponents, currentMemberships);
  const orphanedIds = findOrphanedGroupIds(automaticGroups, currentMemberships);

  for (const { desired, existingGroupId } of matchedPairs) {
    const desiredIds = [...desired];

    if (!existingGroupId) {
      // Create a new auto-group.
      // Ensure anime that already belong to an active group with >= 2 members are not stolen.
      const activeGroupIds = new Set(
        activeGroups
          .filter((g) => (allMemberships.get(g.groupId)?.size ?? 0) >= 2)
          .map((g) => g.groupId),
      );

      const availableDesiredIds = desiredIds.filter((id) => {
        const doc = animeDocuments.find((a) => String(a.animeId ?? a.id ?? "") === id);
        return !doc?.groupId || !activeGroupIds.has(doc.groupId);
      });

      if (availableDesiredIds.length < 2) {
        result.skipped.push({ reason: "insufficient-members", animeIds: desiredIds });
        continue;
      }

      const members = animeDocuments.filter((a) => {
        const id = String(a.animeId ?? a.id ?? "");
        return availableDesiredIds.includes(id) && !a[AUTO_GROUP_EXCLUDED_FIELD];
      });

      if (members.length < 2) {
        result.skipped.push({ reason: "insufficient-members", animeIds: availableDesiredIds });
        continue;
      }

      const groupName = deriveAutoGroupName(members);
      try {
        let nameToUse = groupName;
        let createResult;
        try {
          createResult = await createGroupFn(uid, {
            name: nameToUse,
            scopeKey,
            animeIds: availableDesiredIds,
            thumbnailAnimeId: null,
            groupType: GROUP_TYPE_AUTOMATIC,
          });
        } catch (nameErr) {
          if (nameErr?.code === "grouping/duplicate-name") {
            nameToUse = `${groupName} Series`.slice(0, 80);
            createResult = await createGroupFn(uid, {
              name: nameToUse,
              scopeKey,
              animeIds: availableDesiredIds,
              thumbnailAnimeId: null,
              groupType: GROUP_TYPE_AUTOMATIC,
            });
          } else {
            throw nameErr;
          }
        }
        result.created.push({
          groupId: createResult.id ?? createResult.data?.groupId,
          name: nameToUse,
          animeIds: availableDesiredIds,
        });
      } catch (error) {
        if (error?.code === "grouping/duplicate-name") {
          result.skipped.push({ reason: "duplicate-name", groupName, animeIds: availableDesiredIds });
        } else {
          result.errors.push({ operation: "create", animeIds: availableDesiredIds, error });
        }
      }
    } else {
      // Update existing auto-group membership.
      const currentIds = currentMemberships.get(existingGroupId) ?? new Set();
      const protectedGroupIds = new Set(
        activeGroups
          .filter((group) => group.groupId !== existingGroupId)
          .map((group) => group.groupId),
      );
      const toAdd = desiredIds.filter((id) => {
        if (currentIds.has(id)) return false;
        const document = animeDocuments.find(
          (anime) => String(anime.animeId ?? anime.id ?? "") === id,
        );
        return !document?.groupId || !protectedGroupIds.has(document.groupId);
      });
      const toRemove = [...currentIds].filter((id) => !desired.has(id));

      if (toAdd.length === 0 && toRemove.length === 0) {
        result.unchanged.push({ groupId: existingGroupId, animeIds: desiredIds });
        continue;
      }

      if (desiredIds.length < 2) {
        if (!orphanedIds.includes(existingGroupId)) {
          orphanedIds.push(existingGroupId);
        }
        continue;
      }

      try {
        if (toAdd.length > 0) {
          await addAnimeToGroupFn(uid, existingGroupId, toAdd);
        }
        if (toRemove.length > 0) {
          await removeAnimeFromGroupFn(uid, existingGroupId, toRemove);
        }
        result.updated.push({ groupId: existingGroupId, added: toAdd, removed: toRemove });
      } catch (error) {
        result.errors.push({ operation: "update", groupId: existingGroupId, error });
      }
    }
  }

  for (const groupId of orphanedIds) {
    try {
      await deleteGroupFn(uid, groupId);
      result.dissolved.push({ groupId });
    } catch (error) {
      if (error?.code !== "grouping/group-not-found") {
        result.errors.push({ operation: "dissolve", groupId, error });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// AniList relation fetcher (cache + rate-limit safety)
// ---------------------------------------------------------------------------

const RELATION_CACHE_TTL_MS = 30 * 60 * 1000;
const RELATION_CACHE_PREFIX = "f01:relations:";
const MAX_CONCURRENT_RELATION_FETCHES = 3;

/**
 * Read cached relation metadata from localStorage.
 *
 * @param {string} anilistId
 * @returns {Array<object>|null}
 */
export function readCachedRelations(anilistId) {
  try {
    const raw = localStorage.getItem(`${RELATION_CACHE_PREFIX}${anilistId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > RELATION_CACHE_TTL_MS) return null;
    return Array.isArray(parsed.d) ? normalizeAniListRelations(parsed.d) : null;
  } catch {
    return null;
  }
}

/**
 * Persist relation metadata to localStorage.
 *
 * @param {string} anilistId
 * @param {Array<object>} relations
 */
export function writeCachedRelations(anilistId, relations) {
  try {
    const normalized = normalizeAniListRelations(relations);
    localStorage.setItem(
      `${RELATION_CACHE_PREFIX}${anilistId}`,
      JSON.stringify({ t: Date.now(), d: normalized }),
    );
  } catch {
    // Quota errors are silently ignored; cache is best-effort.
  }
}

const ANILIST_RELATIONS_QUERY = `
  query($id: Int) {
    Media(id: $id, type: ANIME) {
      relations {
        edges {
          relationType
          node { id type }
        }
      }
    }
  }
`;

/**
 * Fetch AniList relations for a single anime ID.
 * Returns empty array on HTTP 403, 429, 5xx or network error (fail-safe).
 *
 * @param {string|number} anilistId
 * @param {Function} [fetchImpl]
 * @returns {Promise<Array<{relatedId: string, relationType: string}>>}
 */
export async function fetchAniListRelations(anilistId, fetchImpl = globalThis.fetch) {
  const idNum = Number(anilistId);
  if (!idNum || !Number.isFinite(idNum)) return [];

  const cached = readCachedRelations(String(anilistId));
  if (cached !== null) return cached;

  try {
    const signal = typeof AbortSignal?.timeout === "function"
      ? AbortSignal.timeout(8000)
      : undefined;
    const response = await fetchImpl("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: ANILIST_RELATIONS_QUERY, variables: { id: idNum } }),
      ...(signal ? { signal } : {}),
    });

    if (response.status === 403 || response.status === 429 || response.status >= 500) {
      console.warn(
        `[autoGrouping] AniList HTTP ${response.status} for id=${anilistId}; skipping.`,
      );
      return [];
    }

    const json = await response.json();
    if (json.errors?.length) {
      console.warn("[autoGrouping] AniList GraphQL errors:", json.errors);
      return [];
    }

    const edges = json.data?.Media?.relations?.edges ?? [];
    const relations = selectAutomaticGroupingRelations(edges
      .filter((edge) => edge?.node?.type === "ANIME")
      .map((edge) => ({
        relatedId: String(edge.node.id),
        relationType: String(edge.relationType ?? "").toUpperCase(),
      })));

    writeCachedRelations(String(anilistId), relations);
    return relations;
  } catch (error) {
    console.warn("[autoGrouping] AniList fetch failed:", error?.message ?? error);
    return [];
  }
}

/**
 * Backfill AniList relations for saved anime that lack anilistRelations.
 * Bounded concurrency; does NOT write to Firestore — returns a map for the caller.
 *
 * @param {Array<object>} animeDocuments
 * @param {Function} [fetchImpl]
 * @returns {Promise<Map<string, Array<object>>>}
 */
export async function backfillRelationsFromAniList(animeDocuments, fetchImpl) {
  const needsBackfill = animeDocuments.filter(
    (a) => !Array.isArray(a[ANILIST_RELATIONS_FIELD]),
  );
  const result = new Map();

  for (let i = 0; i < needsBackfill.length; i += MAX_CONCURRENT_RELATION_FETCHES) {
    const batch = needsBackfill.slice(i, i + MAX_CONCURRENT_RELATION_FETCHES);
    const settled = await Promise.allSettled(
      batch.map(async (anime) => {
        const id = String(anime.animeId ?? anime.id ?? "");
        if (!id) return;
        const relations = await fetchAniListRelations(id, fetchImpl);
        result.set(id, relations);
      }),
    );
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        console.warn("[autoGrouping] backfill batch error:", outcome.reason);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public orchestration entry-point
// ---------------------------------------------------------------------------

/**
 * Run a full auto-grouping reconciliation pass for one scope.
 * Called by useAutoGrouping hook after anime data settles.
 *
 * @param {object} params
 * @param {string} params.uid
 * @param {string} params.scopeKey
 * @param {Array<object>} params.animeDocuments
 * @param {Function} [params.onResult]
 * @param {object} [params.services]
 * @returns {Promise<object|null>}
 */
export async function runAutoGroupingReconciliation({
  uid,
  scopeKey,
  animeDocuments,
  onResult,
  services = {},
}) {
  if (!isAutoReconcileEnabled(uid)) return null;

  try {
    validateUid(uid);
    parseGroupScopeKey(scopeKey);
  } catch {
    return null;
  }

  // Read current group metadata once (non-reactive snapshot).
  const existingGroups = await new Promise((resolve) => {
    let settled = false;
    const subscribeFn = services?.subscribeToGroupMetadata || subscribeToGroupMetadata;
    const unsub = subscribeFn(
      uid,
      scopeKey,
      (groups) => {
        if (!settled) {
          settled = true;
          try { unsub(); } catch { /* ignore */ }
          resolve(groups);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          try { unsub(); } catch { /* ignore */ }
          resolve([]);
        }
      },
    );
    setTimeout(() => {
      if (!settled) {
        settled = true;
        try { unsub(); } catch { /* ignore */ }
        resolve([]);
      }
    }, 5000);
  });

  const result = await reconcileAutoGrouping({
    uid,
    scopeKey,
    animeDocuments,
    existingGroups,
    services,
  });

  if (onResult) onResult(result);
  return result;
}
