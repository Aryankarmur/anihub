/**
 * Client-side schema shared by every AniList relationship write path.
 *
 * Firestore Rules cannot iterate over arbitrary lists, so the server rules
 * mirror this fixed bound and validate each possible slot explicitly.
 * Relationship metadata remains untrusted: it is only a grouping hint and
 * never grants access to another user, scope, anime, or group.
 */
export const ANILIST_RELATIONS_MAX_COUNT = 8;
export const ANILIST_ID_MAX_LENGTH = 10;
export const ANILIST_RELATION_TYPES = Object.freeze(["PREQUEL", "SEQUEL"]);

const ANILIST_ID_PATTERN = /^[1-9]\d{0,9}$/u;
const ALLOWED_RELATION_TYPES = new Set(ANILIST_RELATION_TYPES);

const validationError = (message) => {
  const error = new Error(message);
  error.code = "anime/invalid-anilist-relations";
  return error;
};

export const normalizeAniListId = (value) => {
  const normalized = String(value ?? "").trim();
  if (!ANILIST_ID_PATTERN.test(normalized)) {
    throw validationError(
      `AniList IDs must be canonical positive decimal strings up to ${ANILIST_ID_MAX_LENGTH} digits.`
    );
  }
  return normalized;
};

export const normalizeAniListRelations = (relations) => {
  if (!Array.isArray(relations)) {
    throw validationError("anilistRelations must be a list.");
  }
  if (relations.length > ANILIST_RELATIONS_MAX_COUNT) {
    throw validationError(
      `anilistRelations may contain at most ${ANILIST_RELATIONS_MAX_COUNT} entries.`
    );
  }

  const seenIds = new Set();
  return relations.map((relation) => {
    if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
      throw validationError("Every AniList relationship must be an object.");
    }
    const keys = Object.keys(relation).sort();
    if (keys.length !== 2 || keys[0] !== "relatedId" || keys[1] !== "relationType") {
      throw validationError("AniList relationships may only contain relatedId and relationType.");
    }

    const relatedId = normalizeAniListId(relation.relatedId);
    const relationType = String(relation.relationType ?? "").trim().toUpperCase();
    if (!ALLOWED_RELATION_TYPES.has(relationType)) {
      throw validationError("Only PREQUEL and SEQUEL relationships are supported.");
    }
    if (seenIds.has(relatedId)) {
      throw validationError("Duplicate AniList related IDs are not allowed.");
    }
    seenIds.add(relatedId);
    return { relatedId, relationType };
  });
};

export const relationFieldForWrite = (anime) => {
  if (!anime || typeof anime !== "object" || anime.anilistRelations == null) return {};
  const normalized = normalizeAniListRelations(anime.anilistRelations);
  return normalized.length > 0 ? { anilistRelations: normalized } : {};
};

// AniList API responses are external input. Ignore unsupported/malformed edges,
// de-duplicate by related ID, and cap before anything reaches cache or Firestore.
export const selectAutomaticGroupingRelations = (relations) => {
  if (!Array.isArray(relations)) return [];
  const selected = [];
  const seenIds = new Set();
  for (const relation of relations) {
    try {
      const [normalized] = normalizeAniListRelations([relation]);
      if (seenIds.has(normalized.relatedId)) continue;
      seenIds.add(normalized.relatedId);
      selected.push(normalized);
      if (selected.length === ANILIST_RELATIONS_MAX_COUNT) break;
    } catch {
      // Unsupported AniList relation types are irrelevant to auto-grouping.
    }
  }
  return selected;
};
