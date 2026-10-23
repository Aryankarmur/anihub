export const GROUP_NAME_MAX_LENGTH = 80;
export const GROUP_MIN_MEMBER_COUNT = 2;
export const GROUP_TYPE_MANUAL = "manual";
export const GROUP_TYPE_AUTOMATIC = "automatic";
// Keep transactional membership work comfortably below Firestore's 20
// document-access ceiling for multi-document requests. Group size itself is
// intentionally unlimited; larger operations remain resumable across chunks.
export const GROUP_OPERATION_CHUNK_SIZE = 10;

export const GROUP_SCOPE_WATCHLIST = "watchlist";
export const GROUP_SCOPE_COMPLETED = "completed";
export const GROUP_SCOPE_UP_NEXT = "up-next";
export const GROUP_COLLECTION_SCOPE_PREFIX = "collection:";

const DOCUMENT_ID_PATTERN = /^[^/]+$/u;

const createValidationError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const normalizeWhitespace = (value) => value.trim().replace(/\s+/gu, " ");

export const validateUid = (uid) => {
  if (typeof uid !== "string" || !DOCUMENT_ID_PATTERN.test(uid.trim())) {
    throw createValidationError("grouping/invalid-user", "A valid user ID is required.");
  }
  return uid.trim();
};

export const validateDocumentId = (value, label = "Document ID") => {
  const normalized = String(value ?? "").trim();
  if (!normalized || !DOCUMENT_ID_PATTERN.test(normalized)) {
    throw createValidationError(
      "grouping/invalid-document-id",
      `${label} must be a non-empty Firestore document ID.`
    );
  }
  return normalized;
};

export const validateAnimeId = (animeId) => validateDocumentId(animeId, "Anime ID");

export const normalizeGroupName = (name) => {
  if (typeof name !== "string") {
    throw createValidationError("grouping/invalid-name", "Group name must be a string.");
  }

  const displayName = normalizeWhitespace(name.normalize("NFC"));
  if (!displayName) {
    throw createValidationError("grouping/invalid-name", "Group name is required.");
  }
  if (displayName.length > GROUP_NAME_MAX_LENGTH) {
    throw createValidationError(
      "grouping/invalid-name",
      `Group name must be ${GROUP_NAME_MAX_LENGTH} characters or less.`
    );
  }

  const normalizedName = normalizeWhitespace(name.normalize("NFKC"))
    .toLocaleLowerCase("en-US");

  return { name: displayName, normalizedName };
};

export const parseGroupScopeKey = (scopeKey, { allowUpNext = false } = {}) => {
  if (typeof scopeKey !== "string" || scopeKey !== scopeKey.trim()) {
    throw createValidationError("grouping/invalid-scope", "Group scope is malformed.");
  }

  if (scopeKey === GROUP_SCOPE_WATCHLIST || scopeKey === GROUP_SCOPE_COMPLETED) {
    return { scopeKey, type: scopeKey, collectionId: null };
  }

  if (scopeKey === GROUP_SCOPE_UP_NEXT) {
    if (!allowUpNext) {
      throw createValidationError(
        "grouping/unsupported-scope",
        "The Up Next grouping scope is reserved but is not available yet."
      );
    }
    return { scopeKey, type: GROUP_SCOPE_UP_NEXT, collectionId: null };
  }

  if (scopeKey.startsWith(GROUP_COLLECTION_SCOPE_PREFIX)) {
    const collectionId = scopeKey.slice(GROUP_COLLECTION_SCOPE_PREFIX.length);
    const validCollectionId = validateDocumentId(collectionId, "Collection ID");
    return { scopeKey, type: "collection", collectionId: validCollectionId };
  }

  throw createValidationError("grouping/unsupported-scope", "Unsupported group scope.");
};

export const normalizeAnimeIds = (animeIds) => {
  const values = Array.isArray(animeIds) ? animeIds : [animeIds];
  if (values.length === 0) {
    throw createValidationError("grouping/invalid-anime", "At least one anime ID is required.");
  }
  return [...new Set(values.map(validateAnimeId))];
};

export const normalizeInitialGroupAnimeIds = (animeIds) => {
  const normalizedIds = normalizeAnimeIds(animeIds);
  if (normalizedIds.length < GROUP_MIN_MEMBER_COUNT) {
    throw createValidationError(
      "grouping/not-enough-members",
      `A group requires at least ${GROUP_MIN_MEMBER_COUNT} different anime.`
    );
  }
  return normalizedIds;
};

export const isVisibleGroup = (group, memberCount) => (
  group?.status === "active" && memberCount >= GROUP_MIN_MEMBER_COUNT
);

export const chunkGroupOperation = (values, size = GROUP_OPERATION_CHUNK_SIZE) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

export const buildGroupMetadata = ({
  name,
  normalizedName,
  reservationId,
  scopeKey,
  collectionId = null,
  thumbnailAnimeId,
  groupType = GROUP_TYPE_MANUAL,
  status = "active",
  createdAt,
  updatedAt
}) => ({
  name,
  normalizedName,
  reservationId,
  scopeKey,
  collectionId,
  thumbnailAnimeId,
  groupType,
  status,
  createdAt,
  updatedAt
});

export const deriveVisibleGroups = (groups, animeDocuments) => {
  const memberCounts = new Map();
  animeDocuments.forEach((anime) => {
    if (!anime.groupId) return;
    memberCounts.set(anime.groupId, (memberCounts.get(anime.groupId) || 0) + 1);
  });
  return groups
    .filter((group) => isVisibleGroup(group, memberCounts.get(group.groupId) || 0))
    .map((group) => ({ ...group, memberCount: memberCounts.get(group.groupId) }));
};

export const partitionAnimeByVisibleGroups = (animeDocuments, visibleGroups) => {
  const visibleGroupIds = new Set(visibleGroups.map((group) => group.groupId));
  const grouped = new Map(visibleGroups.map((group) => [group.groupId, []]));
  const standalone = [];

  animeDocuments.forEach((anime) => {
    if (anime.groupId && visibleGroupIds.has(anime.groupId)) {
      grouped.get(anime.groupId).push(anime);
    } else {
      standalone.push(anime);
    }
  });

  return { grouped, standalone };
};

const bytesToHex = (bytes) => (
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()
);

const sha256Hex = async (value) => {
  if (!globalThis.crypto?.subtle) {
    throw createValidationError(
      "grouping/crypto-unavailable",
      "Web Crypto is required for safe group operations."
    );
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return bytesToHex(new Uint8Array(digest));
};

export const getGroupNameReservationId = async (scopeKey, normalizedName) => {
  parseGroupScopeKey(scopeKey);
  if (typeof normalizedName !== "string" || !normalizedName) {
    throw createValidationError("grouping/invalid-name", "A normalized group name is required.");
  }
  return sha256Hex(`${scopeKey.length}:${scopeKey}${normalizedName}`);
};

export const getMembershipOperationKey = async (operation, groupId, animeIds) => {
  const validGroupId = validateDocumentId(groupId, "Group ID");
  const normalizedIds = normalizeAnimeIds(animeIds).sort();
  return sha256Hex(`${operation}\u001f${validGroupId}\u001f${normalizedIds.join("\u001f")}`);
};
