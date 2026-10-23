import {
  doc,
  collection,
  setDoc,
  getDoc,
  addDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  writeBatch,
  getCountFromServer,
  runTransaction,
  query,
  where,
  limit,
  deleteField
} from "firebase/firestore";
import { db } from "./firebaseConfig";
import {
  buildGroupMetadata,
  chunkGroupOperation,
  GROUP_OPERATION_CHUNK_SIZE,
  getGroupNameReservationId,
  getMembershipOperationKey,
  isVisibleGroup,
  normalizeAnimeIds,
  normalizeInitialGroupAnimeIds,
  normalizeGroupName,
  parseGroupScopeKey,
  validateAnimeId,
  validateDocumentId,
  validateUid
} from "./groupingUtils";
import {
  executeCollectionDeletionForMode,
  executeCollectionDeletionPlan,
  executeUngroupedCollectionDeletionPlan,
} from "./collectionDeletionUtils";
import { isAnimeGroupingEnabled } from "./groupingFeatureGate";
import {
  MOVEMENT_RECONCILIATIONS_FIELD,
  collectMovementReconciliations,
  movementTaskKey,
  normalizeMovementReconciliations,
  withoutGroupingInternals,
} from "./movementUtils";

// ==========================================
// SYSTEM CONSTANTS & HELPERS
// ==========================================

export const SYSTEM_COLLECTION_COMPLETED = "__completed__";
export const RESERVED_COLLECTION_NAMES = ["completed", "up next"];

const GROUP_STATUS_ACTIVE = "active";
const GROUP_STATUS_UPDATING = "updating";
const GROUP_STATUS_DELETING = "deleting";
const COLLECTION_DELETION_STATE = "deleting";

const createGroupingError = (code, message, details) => {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
};

const getGroupsRef = (uid) => collection(db, "users", validateUid(uid), "groups");
const getGroupRef = (uid, groupId) => (
  doc(db, "users", validateUid(uid), "groups", validateDocumentId(groupId, "Group ID"))
);
const getGroupNameKeyRef = (uid, reservationId) => (
  doc(db, "users", validateUid(uid), "groupNameKeys", reservationId)
);

export const resolveAnimeCollectionRef = (uid, scopeKey) => {
  const validUid = validateUid(uid);
  const scope = parseGroupScopeKey(scopeKey);
  if (scope.type === "watchlist" || scope.type === "completed") {
    return collection(db, "users", validUid, scope.type);
  }
  return collection(db, "users", validUid, "collections", scope.collectionId, "items");
};

export const resolveAnimeDocumentRef = (uid, scopeKey, animeId) => (
  doc(resolveAnimeCollectionRef(uid, scopeKey), validateAnimeId(animeId))
);

const mapGroupSnapshot = (snapshot) => ({ groupId: snapshot.id, ...snapshot.data() });

const assertActiveGroup = (groupSnapshot) => {
  if (!groupSnapshot.exists()) {
    throw createGroupingError("grouping/group-not-found", "Group not found.");
  }
  const group = groupSnapshot.data();
  if (group.status !== GROUP_STATUS_ACTIVE) {
    throw createGroupingError("grouping/group-not-active", "The group is not active.");
  }
  parseGroupScopeKey(group.scopeKey);
  return group;
};

const assertAvailableAnime = (snapshot, animeId, groupId = null) => {
  if (!snapshot.exists()) {
    throw createGroupingError(
      "grouping/anime-not-found",
      `Anime ${animeId} is not saved in this library location.`
    );
  }
  const existingGroupId = snapshot.data().groupId;
  if (existingGroupId && existingGroupId !== groupId) {
    throw createGroupingError(
      "grouping/already-grouped",
      `Anime ${animeId} already belongs to another group.`
    );
  }
};

const chunkValues = (values, size) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const addOperationProgress = (error, details) => {
  error.details = { ...(error.details || {}), ...details };
  return error;
};

const buildMovementAnimeData = ({ animeId, sourceData, destinationData, anime }) => {
  const supplied = anime && typeof anime === "object" ? anime : {};
  const merged = {
    ...withoutGroupingInternals(destinationData),
    ...withoutGroupingInternals(sourceData),
    ...withoutGroupingInternals(supplied),
  };
  return {
    ...merged,
    animeId: String(animeId),
    title: supplied.title || sourceData?.title || destinationData?.title || "Unknown Title",
    image: supplied.image || sourceData?.image || destinationData?.image || "",
    type: supplied.type || sourceData?.type || destinationData?.type || "TV",
    score: supplied.score !== undefined && supplied.score !== null && !isNaN(supplied.score)
      ? Number(supplied.score)
      : (sourceData?.score ?? destinationData?.score ?? null),
  };
};

export async function retryMovementGroupReconciliation(uid, task) {
  const validUid = validateUid(uid);
  const sourceScope = parseGroupScopeKey(task?.sourceScope).scopeKey;
  const sourceGroupId = validateDocumentId(task?.sourceGroupId, "Group ID");
  const animeId = validateAnimeId(task?.animeId);
  if (sourceScope !== "watchlist" && sourceScope !== "completed") {
    throw createGroupingError(
      "grouping/invalid-reconciliation",
      "Movement cleanup is restricted to Watchlist and Completed.",
      { sourceScope, sourceGroupId, retryable: false }
    );
  }
  const groupRef = getGroupRef(validUid, sourceGroupId);
  const sourceAnimeRef = resolveAnimeDocumentRef(validUid, sourceScope, animeId);
  const operationKey = await getMembershipOperationKey("remove", sourceGroupId, [animeId]);
  let groupStatus = null;
  let superseded = false;

  await runTransaction(db, async (transaction) => {
    const [groupSnapshot, sourceAnimeSnapshot] = await Promise.all([
      transaction.get(groupRef),
      transaction.get(sourceAnimeRef),
    ]);
    if (!groupSnapshot.exists()) return;
    const group = groupSnapshot.data();
    if (group.scopeKey !== sourceScope) {
      throw createGroupingError(
        "grouping/scope-mismatch",
        "Movement cleanup refused to modify a group outside its source location.",
        { sourceScope, sourceGroupId, retryable: false }
      );
    }
    groupStatus = group.status;
    if (sourceAnimeSnapshot.exists() && sourceAnimeSnapshot.data().groupId === sourceGroupId) {
      superseded = true;
      return;
    }
    if (group.status === GROUP_STATUS_ACTIVE) {
      transaction.update(groupRef, {
        status: GROUP_STATUS_UPDATING,
        membershipOperation: { type: "remove", key: operationKey },
        updatedAt: serverTimestamp(),
      });
      groupStatus = GROUP_STATUS_UPDATING;
    } else if (
      group.status === GROUP_STATUS_UPDATING
      && group.membershipOperation?.key !== operationKey
    ) {
      throw createGroupingError("grouping/group-busy", "Another group operation is in progress.");
    }
  });

  if (superseded) {
    return { data: { alreadyComplete: true, superseded: true }, error: null };
  }
  if (groupStatus === null) return { data: { alreadyComplete: true }, error: null };
  try {
    if (groupStatus === GROUP_STATUS_DELETING) {
      return await deleteGroup(validUid, sourceGroupId);
    }
    return await removeAnimeFromGroup(validUid, sourceGroupId, [animeId]);
  } catch (error) {
    if (error?.code === "grouping/group-not-found") {
      return { data: { alreadyComplete: true }, error: null };
    }
    throw addOperationProgress(error, {
      operation: "reconcile-movement-group",
      sourceScope,
      sourceGroupId,
      animeId,
      retryable: error?.details?.retryable !== false,
    });
  }
}

const settleMovementReconciliations = async (uid, destinationRef, requestedTasks) => {
  const tasks = normalizeMovementReconciliations(requestedTasks);
  if (!tasks.length) return { status: "not-needed", pending: [] };
  const completedKeys = new Set();
  const errors = [];
  for (const task of tasks) {
    try {
      await retryMovementGroupReconciliation(uid, task);
      completedKeys.add(movementTaskKey(task));
    } catch (error) {
      errors.push({ task, error });
    }
  }

  try {
    await runTransaction(db, async (transaction) => {
      const destinationSnapshot = await transaction.get(destinationRef);
      if (!destinationSnapshot.exists()) return;
      const currentTasks = normalizeMovementReconciliations(
        destinationSnapshot.data()[MOVEMENT_RECONCILIATIONS_FIELD]
      );
      const remainingTasks = currentTasks.filter(
        (task) => !completedKeys.has(movementTaskKey(task))
      );
      transaction.update(destinationRef, {
        [MOVEMENT_RECONCILIATIONS_FIELD]: remainingTasks.length
          ? remainingTasks
          : deleteField(),
      });
    });
  } catch (error) {
    errors.push({ task: null, error });
  }

  return {
    status: errors.length ? "pending" : "complete",
    pending: errors.map(({ task, error }) => ({
      task,
      code: error?.code || "grouping/unknown",
      message: error?.message || "Movement group cleanup failed.",
    })),
  };
};

const retryPendingMovementReconciliations = (uid, scopeKey, animeDocuments) => {
  if (!isAnimeGroupingEnabled) return;
  animeDocuments.forEach((anime) => {
    const tasks = normalizeMovementReconciliations(anime[MOVEMENT_RECONCILIATIONS_FIELD]);
    if (!tasks.length) return;
    const destinationRef = resolveAnimeDocumentRef(uid, scopeKey, anime.animeId || anime.id);
    void settleMovementReconciliations(uid, destinationRef, tasks).catch((error) => {
      console.error("Movement group reconciliation retry failed:", error);
    });
  });
};

const moveAnimeWithGrouping = async ({
  uid,
  animeId,
  sourceScope,
  destinationScope,
  anime = null,
  requireSource = false,
}) => {
  const validUid = validateUid(uid);
  const normalizedAnimeId = validateAnimeId(animeId);
  const sourceRef = resolveAnimeDocumentRef(validUid, sourceScope, normalizedAnimeId);
  const destinationRef = resolveAnimeDocumentRef(validUid, destinationScope, normalizedAnimeId);
  let reconciliationTasks = [];
  let destinationWritten = false;

  await runTransaction(db, async (transaction) => {
    const [sourceSnapshot, destinationSnapshot] = await Promise.all([
      transaction.get(sourceRef),
      transaction.get(destinationRef),
    ]);
    const sourceData = sourceSnapshot.exists() ? sourceSnapshot.data() : null;
    const destinationData = destinationSnapshot.exists() ? destinationSnapshot.data() : null;
    reconciliationTasks = collectMovementReconciliations({
      animeId: normalizedAnimeId,
      sourceScope,
      sourceData,
      destinationScope,
      destinationData,
    });

    if (requireSource && !sourceData && destinationData) {
      transaction.update(destinationRef, {
        groupId: deleteField(),
        [MOVEMENT_RECONCILIATIONS_FIELD]: reconciliationTasks.length
          ? reconciliationTasks
          : deleteField(),
      });
      destinationWritten = true;
    } else if (!requireSource || sourceData) {
      const movedData = buildMovementAnimeData({
        animeId: normalizedAnimeId,
        sourceData,
        destinationData,
        anime,
      });
      if (destinationScope === "watchlist" || !destinationSnapshot.exists()) {
        movedData.addedAt = serverTimestamp();
      } else if (destinationData?.addedAt !== undefined) {
        movedData.addedAt = destinationData.addedAt;
      }
      movedData.groupId = deleteField();
      movedData[MOVEMENT_RECONCILIATIONS_FIELD] = reconciliationTasks.length
        ? reconciliationTasks
        : deleteField();
      transaction.set(destinationRef, movedData, { merge: true });
      destinationWritten = true;
    }
    transaction.delete(sourceRef);
  });

  const reconciliation = destinationWritten
    ? await settleMovementReconciliations(validUid, destinationRef, reconciliationTasks)
    : { status: "not-persisted", pending: reconciliationTasks };
  return {
    data: {
      movementCommitted: true,
      destinationScope,
      destinationWritten,
      reconciliation,
    },
    error: null,
  };
};

export const isReservedCollectionName = (name) => {
  if (!name || typeof name !== "string") return false;
  const normalized = name.trim().toLowerCase();
  return RESERVED_COLLECTION_NAMES.includes(normalized);
};

export const getFirestoreErrorMessage = (error) => {
  if (!error) return "An unknown error occurred.";
  const code = error.code || "";
  const msg = error.message || "";

  if (code === "permission-denied" || msg.includes("permission-denied") || msg.includes("Missing or insufficient permissions")) {
    return "Permission denied: please check your Firestore security rules for this path in Firebase Console.";
  }
  if (code === "unauthenticated" || msg.includes("unauthenticated")) {
    return "You must be signed in to perform this action.";
  }
  if (code === "unavailable" || msg.includes("unavailable")) {
    return "Database service is temporarily unavailable. Please check your network connection.";
  }
  if (code === "invalid-argument" || msg.includes("invalid-argument")) {
    return "Invalid data provided for database operation.";
  }
  if (code === "not-found" || msg.includes("not-found")) {
    return "Requested item was not found.";
  }
  if (code === "resource-exhausted" || msg.includes("resource-exhausted")) {
    return "Quota exceeded. Please try again later.";
  }
  return error.message || "A database error occurred. Please try again.";
};

// ==========================================
// USER PROFILE
// ==========================================

export const createUserProfile = async (uid, profileData) => {
  try {
    const userRef = doc(db, "users", uid);
    await setDoc(userRef, profileData, { merge: true });
    return { error: null };
  } catch (error) {
    console.error("Error creating user profile:", error);
    throw error;
  }
};

export const getUserProfile = async (uid) => {
  try {
    const userRef = doc(db, "users", uid);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
      return { data: docSnap.data(), error: null };
    } else {
      return { data: null, error: "User profile not found." };
    }
  } catch (error) {
    console.error("Error getting user profile:", error);
    throw error;
  }
};

export const deleteUserData = async (uid) => {
  if (!uid) {
    throw new Error("uid is required to delete user data.");
  }
  
  try {
    const batches = [];
    let currentBatch = writeBatch(db);
    let currentBatchSize = 0;

    const commitBatchIfNeeded = () => {
      // Firestore allows up to 500 writes per batch, 450 is a safe limit
      if (currentBatchSize >= 450) {
        batches.push(currentBatch.commit());
        currentBatch = writeBatch(db);
        currentBatchSize = 0;
      }
    };

    // 1. Delete Watchlist
    const watchlistRef = collection(db, "users", uid, "watchlist");
    const watchlistSnap = await getDocs(watchlistRef);
    watchlistSnap.forEach((docSnap) => {
      currentBatch.delete(docSnap.ref);
      currentBatchSize++;
      commitBatchIfNeeded();
    });

    // 1b. Delete Completed
    const completedRef = collection(db, "users", uid, "completed");
    const completedSnap = await getDocs(completedRef);
    completedSnap.forEach((docSnap) => {
      currentBatch.delete(docSnap.ref);
      currentBatchSize++;
      commitBatchIfNeeded();
    });

    // 1c. Delete grouping metadata and deterministic name reservations
    const groupsSnap = await getDocs(collection(db, "users", uid, "groups"));
    groupsSnap.forEach((docSnap) => {
      currentBatch.delete(docSnap.ref);
      currentBatchSize++;
      commitBatchIfNeeded();
    });

    const groupNameKeysSnap = await getDocs(collection(db, "users", uid, "groupNameKeys"));
    groupNameKeysSnap.forEach((docSnap) => {
      currentBatch.delete(docSnap.ref);
      currentBatchSize++;
      commitBatchIfNeeded();
    });

    // 2. Delete Collections and their Items
    const collectionsRef = collection(db, "users", uid, "collections");
    const collectionsSnap = await getDocs(collectionsRef);
    
    for (const colSnap of collectionsSnap.docs) {
      // Get all items in this collection
      const itemsRef = collection(db, "users", uid, "collections", colSnap.id, "items");
      const itemsSnap = await getDocs(itemsRef);
      
      itemsSnap.forEach((itemSnap) => {
        currentBatch.delete(itemSnap.ref);
        currentBatchSize++;
        commitBatchIfNeeded();
      });

      // Delete the collection document
      currentBatch.delete(colSnap.ref);
      currentBatchSize++;
      commitBatchIfNeeded();
    }

    // 3. Delete user profile document
    const userProfileRef = doc(db, "users", uid);
    currentBatch.delete(userProfileRef);
    currentBatchSize++;
    
    // Commit the remaining batch
    if (currentBatchSize > 0) {
      batches.push(currentBatch.commit());
    }
    
    await Promise.all(batches);
    return { error: null };
  } catch (error) {
    console.error("Error deleting user data:", error);
    throw error; // Re-throw to be handled by caller
  }
};

// ==========================================
// WATCHLIST
// ==========================================

export const addToWatchlist = async (uid, anime) => {
  try {
    const { animeId, title, image, type, score } = anime;
    
    if (!animeId) {
      throw new Error("animeId is required to add to watchlist.");
    }

    const strId = String(animeId);
    const animeRef = doc(db, "users", uid, "watchlist", strId);
    const completedRef = doc(db, "users", uid, "completed", strId);
    
    const animeData = {
      animeId: strId,
      title: title || "Unknown Title",
      image: image || "",
      type: type || "TV",
      score: score !== undefined ? score : null,
      addedAt: serverTimestamp(),
      ...(Array.isArray(anime.anilistRelations) && anime.anilistRelations.length > 0
        ? { anilistRelations: anime.anilistRelations }
        : {})
    };

    if (isAnimeGroupingEnabled) {
      return await moveAnimeWithGrouping({
        uid,
        animeId: strId,
        sourceScope: "completed",
        destinationScope: "watchlist",
        anime,
      });
    }

    // Atomic batch: Add to Watchlist AND Remove from Completed (mutual exclusivity rule)
    const batch = writeBatch(db);
    batch.set(animeRef, animeData, { merge: true });
    batch.delete(completedRef);
    await batch.commit();

    return { error: null };
  } catch (error) {
    console.error("Error adding to watchlist:", error);
    throw error;
  }
};

export const removeFromWatchlist = async (uid, animeId) => {
  try {
    const animeRef = doc(db, "users", uid, "watchlist", String(animeId));
    await deleteDoc(animeRef);
    return { error: null };
  } catch (error) {
    console.error("Error removing from watchlist:", error);
    throw error;
  }
};

export const getWatchlist = async (uid) => {
  try {
    const watchlistRef = collection(db, "users", uid, "watchlist");
    const querySnapshot = await getDocs(watchlistRef);
    const watchlist = [];
    querySnapshot.forEach((doc) => {
      watchlist.push({ id: doc.id, ...doc.data() });
    });
    return { data: watchlist, error: null };
  } catch (error) {
    console.error("Error getting watchlist:", error);
    throw error;
  }
};

export const subscribeToWatchlist = (uid, callback, onError) => {
  const watchlistRef = collection(db, "users", uid, "watchlist");
  return onSnapshot(
    watchlistRef,
    (snapshot) => {
      const watchlist = [];
      snapshot.forEach((doc) => {
        watchlist.push({ id: doc.id, ...doc.data() });
      });
      callback(watchlist);
      retryPendingMovementReconciliations(uid, "watchlist", watchlist);
    },
    (error) => {
      console.error("Watchlist subscription error:", error);
      if (onError) onError(error);
    }
  );
};

export const checkInWatchlist = async (uid, animeId) => {
  try {
    const animeRef = doc(db, "users", uid, "watchlist", String(animeId));
    const docSnap = await getDoc(animeRef);
    return { data: docSnap.exists(), error: null };
  } catch (error) {
    console.error("Error checking watchlist:", error);
    throw error;
  }
};

export const getWatchlistCount = async (uid) => {
  try {
    const watchlistRef = collection(db, "users", uid, "watchlist");
    const snapshot = await getCountFromServer(watchlistRef);
    return { data: snapshot.data().count, error: null };
  } catch (error) {
    console.error("Error getting watchlist count:", error);
    return { data: 0, error };
  }
};

// ==========================================
// COLLECTIONS
// ==========================================

export const createCollection = async (uid, collectionData) => {
  try {
    const trimmedName = (collectionData.name || "Untitled Collection").trim();
    if (isReservedCollectionName(trimmedName)) {
      throw new Error(`"${trimmedName}" is a reserved system collection name.`);
    }

    const collectionsRef = collection(db, "users", uid, "collections");
    const newCollection = {
      name: trimmedName,
      description: collectionData.description || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    const docRef = await addDoc(collectionsRef, newCollection);
    return { id: docRef.id, error: null };
  } catch (error) {
    console.error("Error creating collection:", error);
    throw error;
  }
};

export const updateCollection = async (uid, collectionId, collectionData) => {
  try {
    const trimmedName = (collectionData.name || "").trim();
    if (isReservedCollectionName(trimmedName)) {
      throw new Error(`"${trimmedName}" is a reserved system collection name.`);
    }

    const collectionRef = doc(db, "users", uid, "collections", collectionId);
    const updateData = {
      name: trimmedName,
      description: collectionData.description,
      updatedAt: serverTimestamp()
    };
    await updateDoc(collectionRef, updateData);
    return { error: null };
  } catch (error) {
    console.error("Error updating collection:", error);
    throw error;
  }
};

export const getCollections = async (uid) => {
  try {
    const collectionsRef = collection(db, "users", uid, "collections");
    const querySnapshot = await getDocs(collectionsRef);
    const collections = [];
    querySnapshot.forEach((doc) => {
      collections.push({ id: doc.id, ...doc.data() });
    });
    return { data: collections, error: null };
  } catch (error) {
    console.error("Error getting collections:", error);
    throw error;
  }
};

export const subscribeToCollections = (uid, callback, onError) => {
  const collectionsRef = collection(db, "users", uid, "collections");
  return onSnapshot(
    collectionsRef,
    (snapshot) => {
      const collections = [];
      snapshot.forEach((doc) => {
        collections.push({ id: doc.id, ...doc.data() });
      });
      callback(collections);
    },
    (error) => {
      console.error("Collections subscription error:", error);
      if (onError) onError(error);
    }
  );
};

export const deleteCollection = async (uid, collectionId) => {
  try {
    const validUid = validateUid(uid);
    const validCollectionId = validateDocumentId(collectionId, "Collection ID");
    const collectionRef = doc(db, "users", validUid, "collections", validCollectionId);
    const scopeKey = `collection:${validCollectionId}`;

    const loadItemChunks = async () => {
      const itemsSnapshot = await getDocs(
        collection(db, "users", validUid, "collections", validCollectionId, "items")
      );
      return chunkValues(itemsSnapshot.docs, 400);
    };
    const deleteItemChunk = async (itemChunk) => {
      const batch = writeBatch(db);
      itemChunk.forEach((itemDoc) => batch.delete(itemDoc.ref));
      await batch.commit();
    };
    const deleteCollectionDocument = () => deleteDoc(collectionRef);

    return await executeCollectionDeletionForMode({
      groupingEnabled: isAnimeGroupingEnabled,
      deleteWithoutGrouping: () => executeUngroupedCollectionDeletionPlan({
        loadItemChunks,
        deleteItemChunk,
        deleteCollectionDocument,
      }),
      // Groups are top-level user metadata, so the emulator-only grouped path
      // seals the Collection before reading and deleting its exact scope.
      deleteWithGrouping: () => executeCollectionDeletionPlan({
        beginCollectionDeletion: async () => {
          await runTransaction(db, async (transaction) => {
            const collectionSnapshot = await transaction.get(collectionRef);
            if (!collectionSnapshot.exists()) return;
            if (collectionSnapshot.data().deletionState !== COLLECTION_DELETION_STATE) {
              transaction.update(collectionRef, {
                deletionState: COLLECTION_DELETION_STATE,
                updatedAt: serverTimestamp(),
              });
            }
          });
        },
        loadGroupIds: async () => {
          const scopedGroups = await getDocs(
            query(getGroupsRef(validUid), where("scopeKey", "==", scopeKey))
          );
          return scopedGroups.docs.map((groupDoc) => groupDoc.id);
        },
        loadItemChunks,
        deleteGroupById: (groupId) => deleteGroup(validUid, groupId),
        deleteItemChunk,
        deleteCollectionDocument,
      }),
    });
  } catch (error) {
    console.error("Error deleting collection:", error);
    throw error;
  }
};

export const getCollectionCount = async (uid) => {
  try {
    const collectionsRef = collection(db, "users", uid, "collections");
    const snapshot = await getCountFromServer(collectionsRef);
    return { data: snapshot.data().count, error: null };
  } catch (error) {
    console.error("Error getting collections count:", error);
    return { data: 0, error };
  }
};

// ==========================================
// COLLECTION ITEMS
// ==========================================

export const addToCollection = async (uid, collectionId, anime) => {
  try {
    const validUid = validateUid(uid);
    const validCollectionId = validateDocumentId(collectionId, "Collection ID");
    const { animeId, title, image, type, score } = anime;
    
    if (!animeId) {
      throw new Error("animeId is required to add to a collection.");
    }

    const collectionRef = doc(db, "users", validUid, "collections", validCollectionId);
    const itemRef = doc(collectionRef, "items", String(animeId));
    
    const animeData = {
      animeId: String(animeId),
      title: title || "Unknown Title",
      image: image || "",
      type: type || "TV",
      score: score || null,
      addedAt: serverTimestamp(),
      ...(Array.isArray(anime.anilistRelations) && anime.anilistRelations.length > 0
        ? { anilistRelations: anime.anilistRelations }
        : {})
    };

    await runTransaction(db, async (transaction) => {
      const collectionSnapshot = await transaction.get(collectionRef);
      if (!collectionSnapshot.exists()) {
        throw createGroupingError(
          "collection/not-found",
          "The selected custom collection no longer exists."
        );
      }
      if (collectionSnapshot.data().deletionState === COLLECTION_DELETION_STATE) {
        throw createGroupingError(
          "collection/deleting",
          "The selected custom collection is being deleted."
        );
      }
      transaction.set(itemRef, animeData, { merge: true });
      transaction.update(collectionRef, { updatedAt: serverTimestamp() });
    });

    return { error: null };
  } catch (error) {
    console.error("Error adding to collection:", error);
    throw error;
  }
};

export const removeFromCollection = async (uid, collectionId, animeId) => {
  try {
    const validUid = validateUid(uid);
    const validCollectionId = validateDocumentId(collectionId, "Collection ID");
    const collectionRef = doc(db, "users", validUid, "collections", validCollectionId);
    const itemRef = doc(collectionRef, "items", validateAnimeId(animeId));
    await runTransaction(db, async (transaction) => {
      const collectionSnapshot = await transaction.get(collectionRef);
      transaction.delete(itemRef);
      if (
        collectionSnapshot.exists()
        && collectionSnapshot.data().deletionState !== COLLECTION_DELETION_STATE
      ) {
        transaction.update(collectionRef, { updatedAt: serverTimestamp() });
      }
    });

    return { error: null };
  } catch (error) {
    console.error("Error removing from collection:", error);
    throw error;
  }
};

export const getCollectionItems = async (uid, collectionId) => {
  try {
    const itemsRef = collection(db, "users", uid, "collections", collectionId, "items");
    const querySnapshot = await getDocs(itemsRef);
    const items = [];
    querySnapshot.forEach((doc) => {
      items.push({ id: doc.id, ...doc.data() });
    });
    return { data: items, error: null };
  } catch (error) {
    console.error("Error getting collection items:", error);
    throw error;
  }
};

export const checkInCollection = async (uid, collectionId, animeId) => {
  try {
    const itemRef = doc(db, "users", uid, "collections", collectionId, "items", String(animeId));
    const docSnap = await getDoc(itemRef);
    return { data: docSnap.exists(), error: null };
  } catch (error) {
    console.error("Error checking collection item:", error);
    throw error;
  }
};

export const subscribeToCollectionItems = (uid, collectionId, callback, onError) => {
  const itemsRef = collection(db, "users", uid, "collections", collectionId, "items");
  return onSnapshot(
    itemsRef,
    (snapshot) => {
      const items = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() });
      });
      callback(items);
    },
    (error) => {
      console.error("Collection items subscription error:", error);
      if (onError) onError(error);
    }
  );
};

// ==========================================
// COMPLETED (BUILT-IN SYSTEM COLLECTION)
// ==========================================

export const addToCompleted = async (uid, anime) => {
  if (!uid) {
    throw new Error("User ID is required to mark anime completed.");
  }
  if (!anime || !anime.animeId) {
    throw new Error("animeId is required to mark anime completed.");
  }

  try {
    const { animeId, title, image, type, score } = anime;
    const strId = String(animeId);

    if (isAnimeGroupingEnabled) {
      return await moveAnimeWithGrouping({
        uid,
        animeId: strId,
        sourceScope: "watchlist",
        destinationScope: "completed",
        anime,
      });
    }

    const completedRef = doc(db, "users", uid, "completed", strId);
    const watchlistRef = doc(db, "users", uid, "watchlist", strId);

    // Check if completed doc already exists to preserve original addedAt timestamp
    let existingData = null;
    let docExists = false;
    try {
      const existingSnap = await getDoc(completedRef);
      if (existingSnap.exists()) {
        docExists = true;
        existingData = existingSnap.data();
      }
    } catch (readErr) {
      console.error("Error checking existing completed doc:", readErr);
      throw readErr;
    }

    const animeData = {
      animeId: strId,
      title: title || existingData?.title || "Unknown Title",
      image: image || existingData?.image || "",
      type: type || existingData?.type || "TV",
      score: (score !== undefined && score !== null && !isNaN(score)) ? Number(score) : (existingData?.score ?? null),
      ...(Array.isArray(anime.anilistRelations) && anime.anilistRelations.length > 0
        ? { anilistRelations: anime.anilistRelations }
        : (Array.isArray(existingData?.anilistRelations) ? { anilistRelations: existingData.anilistRelations } : {}))
    };

    if (!docExists) {
      animeData.addedAt = serverTimestamp();
    }

    // Atomic batch: write to completed and remove from watchlist (mutual exclusivity rule)
    const batch = writeBatch(db);
    batch.set(completedRef, animeData, { merge: true });
    batch.delete(watchlistRef);
    await batch.commit();

    return { error: null };
  } catch (error) {
    console.error("Error marking anime completed:", error);
    throw error;
  }
};

export const removeFromCompleted = async (uid, animeId, restoreToWatchlist = true) => {
  if (!uid) {
    throw new Error("User ID is required to remove from completed.");
  }
  if (!animeId) {
    throw new Error("animeId is required to remove from completed.");
  }

  try {
    const strId = String(animeId);

    if (isAnimeGroupingEnabled && restoreToWatchlist) {
      return await moveAnimeWithGrouping({
        uid,
        animeId: strId,
        sourceScope: "completed",
        destinationScope: "watchlist",
        requireSource: true,
      });
    }

    const completedRef = doc(db, "users", uid, "completed", strId);
    const watchlistRef = doc(db, "users", uid, "watchlist", strId);

    const batch = writeBatch(db);

    if (restoreToWatchlist) {
      // Read completed document to preserve metadata when returning to watchlist
      try {
        const compSnap = await getDoc(completedRef);
        if (compSnap.exists()) {
          const data = compSnap.data();
          const restoredData = {
            animeId: strId,
            title: data.title || "Unknown Title",
            image: data.image || "",
            type: data.type || "TV",
            score: (data.score !== undefined && data.score !== null) ? data.score : null,
            addedAt: serverTimestamp()
          };
          batch.set(watchlistRef, restoredData, { merge: true });
        }
      } catch (readErr) {
        console.error("Error reading completed document for metadata restoration:", readErr);
        throw readErr;
      }
    }

    batch.delete(completedRef);
    await batch.commit();

    return { error: null };
  } catch (error) {
    console.error("Error removing from completed:", error);
    throw error;
  }
};

export const getCompleted = async (uid) => {
  try {
    const completedRef = collection(db, "users", uid, "completed");
    const querySnapshot = await getDocs(completedRef);
    const completedList = [];
    querySnapshot.forEach((docSnap) => {
      completedList.push({ id: docSnap.id, ...docSnap.data() });
    });
    return { data: completedList, error: null };
  } catch (error) {
    console.error("Error getting completed anime:", error);
    throw error;
  }
};

export const subscribeToCompleted = (uid, callback, onError) => {
  const completedRef = collection(db, "users", uid, "completed");
  return onSnapshot(
    completedRef,
    (snapshot) => {
      const completedList = [];
      snapshot.forEach((docSnap) => {
        completedList.push({ id: docSnap.id, ...docSnap.data() });
      });
      callback(completedList);
      retryPendingMovementReconciliations(uid, "completed", completedList);
    },
    (error) => {
      console.error("Completed subscription error:", error);
      if (onError) onError(error);
    }
  );
};

export const checkInCompleted = async (uid, animeId) => {
  try {
    const animeRef = doc(db, "users", uid, "completed", String(animeId));
    const docSnap = await getDoc(animeRef);
    return { data: docSnap.exists(), error: null };
  } catch (error) {
    console.error("Error checking completed:", error);
    throw error;
  }
};

export const getCompletedCount = async (uid) => {
  try {
    const completedRef = collection(db, "users", uid, "completed");
    const snapshot = await getCountFromServer(completedRef);
    return { data: snapshot.data().count, error: null };
  } catch (error) {
    console.error("Error getting completed count:", error);
    return { data: 0, error };
  }
};

// ==========================================
// ANIME GROUPS
// ==========================================

const getGroupMembersQuery = (uid, scopeKey, groupId, maximum = null) => {
  const constraints = [where("groupId", "==", validateDocumentId(groupId, "Group ID"))];
  if (maximum !== null) constraints.push(limit(maximum));
  return query(resolveAnimeCollectionRef(uid, scopeKey), ...constraints);
};

export const getGroupMemberCount = async (uid, scopeKey, groupId) => {
  const scope = parseGroupScopeKey(scopeKey);
  const snapshot = await getCountFromServer(
    getGroupMembersQuery(uid, scope.scopeKey, groupId)
  );
  return snapshot.data().count;
};

export const createGroup = async (
  uid,
  { name, scopeKey, animeIds, thumbnailAnimeId = null } = {}
) => {
  const validUid = validateUid(uid);
  const scope = parseGroupScopeKey(scopeKey);
  const normalized = normalizeGroupName(name);
  const requestedIds = normalizeInitialGroupAnimeIds(animeIds);
  const requestedThumbnailId = thumbnailAnimeId === null
    ? requestedIds[0]
    : validateAnimeId(thumbnailAnimeId);
  if (!requestedIds.includes(requestedThumbnailId)) {
    throw createGroupingError(
      "grouping/invalid-thumbnail",
      "The thumbnail must be one of the group's anime."
    );
  }

  const initialIds = requestedIds.slice(0, 2);
  const initialThumbnailId = initialIds.includes(requestedThumbnailId)
    ? requestedThumbnailId
    : initialIds[0];
  const groupRef = doc(getGroupsRef(validUid));
  const reservationId = await getGroupNameReservationId(scope.scopeKey, normalized.normalizedName);
  const reservationRef = getGroupNameKeyRef(validUid, reservationId);
  const initialAnimeRefs = initialIds.map((animeId) => (
    resolveAnimeDocumentRef(validUid, scope.scopeKey, animeId)
  ));

  await runTransaction(db, async (transaction) => {
    const reads = [
      transaction.get(reservationRef),
      ...initialAnimeRefs.map((animeRef) => transaction.get(animeRef))
    ];
    let collectionRef = null;
    if (scope.type === "collection") {
      collectionRef = doc(db, "users", validUid, "collections", scope.collectionId);
      reads.push(transaction.get(collectionRef));
    }

    const snapshots = await Promise.all(reads);
    const reservationSnapshot = snapshots[0];
    const animeSnapshots = snapshots.slice(1, 1 + initialAnimeRefs.length);
    const collectionSnapshot = collectionRef ? snapshots.at(-1) : null;
    if (reservationSnapshot.exists()) {
      throw createGroupingError(
        "grouping/duplicate-name",
        "A group with this name already exists in this library location."
      );
    }
    if (collectionRef && !collectionSnapshot.exists()) {
      throw createGroupingError(
        "grouping/collection-not-found",
        "The selected custom collection no longer exists."
      );
    }
    if (
      collectionSnapshot
      && collectionSnapshot.data().deletionState === COLLECTION_DELETION_STATE
    ) {
      throw createGroupingError(
        "grouping/collection-deleting",
        "The selected custom collection is being deleted."
      );
    }
    animeSnapshots.forEach((snapshot, index) => {
      assertAvailableAnime(snapshot, initialIds[index]);
    });

    transaction.set(groupRef, buildGroupMetadata({
      name: normalized.name,
      normalizedName: normalized.normalizedName,
      reservationId,
      scopeKey: scope.scopeKey,
      collectionId: scope.collectionId,
      thumbnailAnimeId: initialThumbnailId,
      status: GROUP_STATUS_ACTIVE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    transaction.set(reservationRef, {
      scopeKey: scope.scopeKey,
      normalizedName: normalized.normalizedName,
      groupId: groupRef.id,
      createdAt: serverTimestamp()
    });
    initialAnimeRefs.forEach((animeRef) => {
      transaction.update(animeRef, { groupId: groupRef.id });
    });
  });

  let assignedCount = initialIds.length;
  try {
    if (requestedIds.length > initialIds.length) {
      const addition = await addAnimeToGroup(validUid, groupRef.id, requestedIds.slice(2));
      assignedCount += addition.data.assignedCount;
    }
    if (requestedThumbnailId !== initialThumbnailId) {
      await updateGroup(validUid, groupRef.id, { thumbnailAnimeId: requestedThumbnailId });
    }
  } catch (error) {
    assignedCount += error.details?.assignedCount || 0;
    throw addOperationProgress(error, {
      operation: "create-group",
      groupId: groupRef.id,
      requestedCount: requestedIds.length,
      assignedCount,
      retryableWith: "addAnimeToGroup"
    });
  }

  return {
    id: groupRef.id,
    data: {
      groupId: groupRef.id,
      name: normalized.name,
      scopeKey: scope.scopeKey,
      thumbnailAnimeId: requestedThumbnailId,
      status: GROUP_STATUS_ACTIVE
    },
    operation: { requestedCount: requestedIds.length, assignedCount },
    error: null
  };
};

export const getGroup = async (uid, groupId) => {
  try {
    const snapshot = await getDoc(getGroupRef(uid, groupId));
    if (!snapshot.exists()) return { data: null, error: null };
    const group = mapGroupSnapshot(snapshot);
    if (group.status !== GROUP_STATUS_ACTIVE) return { data: null, error: null };
    const memberCount = await getGroupMemberCount(uid, group.scopeKey, groupId);
    return {
      data: isVisibleGroup(group, memberCount) ? { ...group, memberCount } : null,
      error: null
    };
  } catch (error) {
    console.error("Error getting group:", error);
    throw error;
  }
};

export const renameGroup = async (uid, groupId, newName) => {
  const validUid = validateUid(uid);
  const validGroupId = validateDocumentId(groupId, "Group ID");
  const normalizedNewName = normalizeGroupName(newName);
  const groupRef = getGroupRef(validUid, validGroupId);

  await runTransaction(db, async (transaction) => {
    const groupSnapshot = await transaction.get(groupRef);
    const group = assertActiveGroup(groupSnapshot);

    const normalizedOldName = normalizeGroupName(group.name);
    const [oldReservationId, newReservationId] = await Promise.all([
      getGroupNameReservationId(group.scopeKey, normalizedOldName.normalizedName),
      getGroupNameReservationId(group.scopeKey, normalizedNewName.normalizedName)
    ]);
    const oldReservationRef = getGroupNameKeyRef(validUid, oldReservationId);
    const newReservationRef = getGroupNameKeyRef(validUid, newReservationId);

    const oldReservationSnapshot = await transaction.get(oldReservationRef);
    const newReservationSnapshot = oldReservationId === newReservationId
      ? oldReservationSnapshot
      : await transaction.get(newReservationRef);

    if (
      oldReservationSnapshot.exists()
      && oldReservationSnapshot.data().groupId !== validGroupId
    ) {
      throw createGroupingError(
        "grouping/reservation-conflict",
        "The group's current name reservation belongs to another group."
      );
    }
    if (
      newReservationSnapshot.exists()
      && newReservationSnapshot.data().groupId !== validGroupId
    ) {
      throw createGroupingError(
        "grouping/duplicate-name",
        "A group with this name already exists in this library location."
      );
    }

    transaction.update(groupRef, {
      name: normalizedNewName.name,
      normalizedName: normalizedNewName.normalizedName,
      reservationId: newReservationId,
      updatedAt: serverTimestamp()
    });

    const reservationData = {
      scopeKey: group.scopeKey,
      normalizedName: normalizedNewName.normalizedName,
      groupId: validGroupId
    };
    if (!newReservationSnapshot.exists()) {
      reservationData.createdAt = serverTimestamp();
    }
    transaction.set(newReservationRef, reservationData, { merge: true });

    if (oldReservationId !== newReservationId && oldReservationSnapshot.exists()) {
      transaction.delete(oldReservationRef);
    }
  });

  return { error: null };
};

export const updateGroup = async (uid, groupId, updates = {}) => {
  const validUid = validateUid(uid);
  const validGroupId = validateDocumentId(groupId, "Group ID");
  const allowedKeys = ["thumbnailAnimeId"];
  const updateKeys = Object.keys(updates);
  if (updateKeys.length === 0 || updateKeys.some((key) => !allowedKeys.includes(key))) {
    throw createGroupingError(
      "grouping/invalid-update",
      "Only thumbnailAnimeId can be changed with updateGroup; use renameGroup for names."
    );
  }

  const thumbnailAnimeId = updates.thumbnailAnimeId === null
    ? null
    : validateAnimeId(updates.thumbnailAnimeId);
  const groupRef = getGroupRef(validUid, validGroupId);

  await runTransaction(db, async (transaction) => {
    const groupSnapshot = await transaction.get(groupRef);
    const group = assertActiveGroup(groupSnapshot);

    if (thumbnailAnimeId !== null) {
      const thumbnailRef = resolveAnimeDocumentRef(validUid, group.scopeKey, thumbnailAnimeId);
      const thumbnailSnapshot = await transaction.get(thumbnailRef);
      if (!thumbnailSnapshot.exists() || thumbnailSnapshot.data().groupId !== validGroupId) {
        throw createGroupingError(
          "grouping/invalid-thumbnail",
          "The thumbnail must reference an anime currently assigned to this group."
        );
      }
    }

    transaction.update(groupRef, {
      thumbnailAnimeId,
      updatedAt: serverTimestamp()
    });
  });

  return { error: null };
};

export const addAnimeToGroup = async (uid, groupId, animeIds) => {
  const validUid = validateUid(uid);
  const validGroupId = validateDocumentId(groupId, "Group ID");
  const requestedIds = normalizeAnimeIds(animeIds);
  const groupRef = getGroupRef(validUid, validGroupId);
  let processedCount = 0;
  let assignedCount = 0;

  for (const memberChunk of chunkGroupOperation(requestedIds)) {
    try {
      let chunkAssignedCount = 0;
      await runTransaction(db, async (transaction) => {
        const groupSnapshot = await transaction.get(groupRef);
        const group = assertActiveGroup(groupSnapshot);
        const animeRefs = memberChunk.map((animeId) => (
          resolveAnimeDocumentRef(validUid, group.scopeKey, animeId)
        ));
        const animeSnapshots = await Promise.all(
          animeRefs.map((animeRef) => transaction.get(animeRef))
        );
        animeSnapshots.forEach((snapshot, index) => {
          assertAvailableAnime(snapshot, memberChunk[index], validGroupId);
        });

        chunkAssignedCount = 0;
        animeSnapshots.forEach((snapshot, index) => {
          if (snapshot.data().groupId !== validGroupId) {
            transaction.update(animeRefs[index], { groupId: validGroupId });
            chunkAssignedCount += 1;
          }
        });
        if (chunkAssignedCount > 0) {
          transaction.update(groupRef, { updatedAt: serverTimestamp() });
        }
      });
      processedCount += memberChunk.length;
      assignedCount += chunkAssignedCount;
    } catch (error) {
      throw addOperationProgress(error, {
        operation: "add-members",
        groupId: validGroupId,
        requestedCount: requestedIds.length,
        processedCount,
        assignedCount,
        retryable: true
      });
    }
  }

  return {
    data: { requestedCount: requestedIds.length, processedCount, assignedCount },
    error: null
  };
};

export const removeAnimeFromGroup = async (uid, groupId, animeIds) => {
  const validUid = validateUid(uid);
  const validGroupId = validateDocumentId(groupId, "Group ID");
  const requestedIds = normalizeAnimeIds(animeIds);
  const groupRef = getGroupRef(validUid, validGroupId);
  const operationKey = await getMembershipOperationKey("remove", validGroupId, requestedIds);
  let scopeKey;
  let processedCount = 0;
  let removedCount = 0;

  try {
    await runTransaction(db, async (transaction) => {
      const groupSnapshot = await transaction.get(groupRef);
      if (!groupSnapshot.exists()) {
        throw createGroupingError("grouping/group-not-found", "Group not found.");
      }
      const group = groupSnapshot.data();
      scopeKey = parseGroupScopeKey(group.scopeKey).scopeKey;
      if (group.status === GROUP_STATUS_UPDATING) {
        if (group.membershipOperation?.key !== operationKey) {
          throw createGroupingError(
            "grouping/group-busy",
            "Another membership operation is already in progress."
          );
        }
        return;
      }
      if (group.status !== GROUP_STATUS_ACTIVE) {
        throw createGroupingError("grouping/group-not-active", "The group is not active.");
      }
      transaction.update(groupRef, {
        status: GROUP_STATUS_UPDATING,
        membershipOperation: { type: "remove", key: operationKey },
        updatedAt: serverTimestamp()
      });
    });

    for (const memberChunk of chunkGroupOperation(requestedIds)) {
      let chunkRemovedCount = 0;
      await runTransaction(db, async (transaction) => {
        const groupSnapshot = await transaction.get(groupRef);
        if (!groupSnapshot.exists()) {
          throw createGroupingError("grouping/group-not-found", "Group not found.");
        }
        const group = groupSnapshot.data();
        if (
          group.status !== GROUP_STATUS_UPDATING
          || group.membershipOperation?.key !== operationKey
        ) {
          throw createGroupingError("grouping/group-busy", "The membership operation changed.");
        }
        const animeRefs = memberChunk.map((animeId) => (
          resolveAnimeDocumentRef(validUid, group.scopeKey, animeId)
        ));
        const animeSnapshots = await Promise.all(
          animeRefs.map((animeRef) => transaction.get(animeRef))
        );
        chunkRemovedCount = 0;
        animeSnapshots.forEach((snapshot, index) => {
          if (snapshot.exists() && snapshot.data().groupId === validGroupId) {
            transaction.update(animeRefs[index], { groupId: deleteField() });
            chunkRemovedCount += 1;
          }
        });
        transaction.update(groupRef, { updatedAt: serverTimestamp() });
      });
      processedCount += memberChunk.length;
      removedCount += chunkRemovedCount;
    }

    const remainingSnapshot = await getDocs(
      getGroupMembersQuery(validUid, scopeKey, validGroupId, 2)
    );
    if (remainingSnapshot.size < 2) {
      await deleteGroup(validUid, validGroupId);
      return {
        data: { dissolved: true, processedCount, removedCount, remainingCount: 0 },
        error: null
      };
    }

    await runTransaction(db, async (transaction) => {
      const groupSnapshot = await transaction.get(groupRef);
      if (!groupSnapshot.exists()) {
        throw createGroupingError("grouping/group-not-found", "Group not found.");
      }
      const group = groupSnapshot.data();
      if (
        group.status !== GROUP_STATUS_UPDATING
        || group.membershipOperation?.key !== operationKey
      ) {
        throw createGroupingError("grouping/group-busy", "The membership operation changed.");
      }

      const candidateRefs = remainingSnapshot.docs.map((memberDoc) => memberDoc.ref);
      const thumbnailRef = group.thumbnailAnimeId === null
        ? null
        : resolveAnimeDocumentRef(validUid, group.scopeKey, group.thumbnailAnimeId);
      const refsToRead = thumbnailRef
        && !candidateRefs.some((candidateRef) => candidateRef.path === thumbnailRef.path)
        ? [...candidateRefs, thumbnailRef]
        : candidateRefs;
      const memberSnapshots = await Promise.all(
        refsToRead.map((memberRef) => transaction.get(memberRef))
      );
      const validMembers = memberSnapshots.filter((memberSnapshot) => (
        memberSnapshot.exists() && memberSnapshot.data().groupId === validGroupId
      ));
      if (validMembers.length < 2) {
        throw createGroupingError(
          "grouping/membership-changed",
          "Group membership changed while the removal was finishing."
        );
      }
      const thumbnailStillValid = memberSnapshots.some((memberSnapshot) => (
        thumbnailRef
        && memberSnapshot.ref.path === thumbnailRef.path
        && memberSnapshot.exists()
        && memberSnapshot.data().groupId === validGroupId
      ));
      transaction.update(groupRef, {
        status: GROUP_STATUS_ACTIVE,
        membershipOperation: deleteField(),
        thumbnailAnimeId: thumbnailStillValid ? group.thumbnailAnimeId : validMembers[0].id,
        updatedAt: serverTimestamp()
      });
    });

    return {
      data: { dissolved: false, processedCount, removedCount, remainingCount: null },
      error: null
    };
  } catch (error) {
    throw addOperationProgress(error, {
      operation: "remove-members",
      groupId: validGroupId,
      requestedCount: requestedIds.length,
      processedCount,
      removedCount,
      retryable: true
    });
  }
};

export const deleteGroup = async (uid, groupId) => {
  const validUid = validateUid(uid);
  const validGroupId = validateDocumentId(groupId, "Group ID");
  const groupRef = getGroupRef(validUid, validGroupId);
  let groupData = null;
  let clearedCount = 0;

  try {
    await runTransaction(db, async (transaction) => {
      const groupSnapshot = await transaction.get(groupRef);
      if (!groupSnapshot.exists()) return;
      groupData = groupSnapshot.data();
      parseGroupScopeKey(groupData.scopeKey);
      if (groupData.status !== GROUP_STATUS_DELETING) {
        transaction.update(groupRef, {
          status: GROUP_STATUS_DELETING,
          membershipOperation: deleteField(),
          updatedAt: serverTimestamp()
        });
      }
    });
    if (!groupData) return { data: { clearedCount: 0, alreadyDeleted: true }, error: null };

    while (true) {
      const memberSnapshot = await getDocs(
        getGroupMembersQuery(validUid, groupData.scopeKey, validGroupId, GROUP_OPERATION_CHUNK_SIZE)
      );
      if (memberSnapshot.empty) break;

      let chunkClearedCount = 0;
      await runTransaction(db, async (transaction) => {
        const groupSnapshot = await transaction.get(groupRef);
        if (!groupSnapshot.exists()) return;
        if (groupSnapshot.data().status !== GROUP_STATUS_DELETING) {
          throw createGroupingError("grouping/group-not-deleting", "The group is not being deleted.");
        }
        const memberSnapshots = await Promise.all(
          memberSnapshot.docs.map((memberDoc) => transaction.get(memberDoc.ref))
        );
        chunkClearedCount = 0;
        memberSnapshots.forEach((animeSnapshot) => {
          if (animeSnapshot.exists() && animeSnapshot.data().groupId === validGroupId) {
            transaction.update(animeSnapshot.ref, { groupId: deleteField() });
            chunkClearedCount += 1;
          }
        });
      });
      clearedCount += chunkClearedCount;
    }

    const reservationId = groupData.reservationId || await getGroupNameReservationId(
      groupData.scopeKey,
      normalizeGroupName(groupData.name).normalizedName
    );
    const reservationRef = getGroupNameKeyRef(validUid, reservationId);
    await runTransaction(db, async (transaction) => {
      const [groupSnapshot, reservationSnapshot] = await Promise.all([
        transaction.get(groupRef),
        transaction.get(reservationRef)
      ]);
      if (!groupSnapshot.exists()) return;
      if (groupSnapshot.data().status !== GROUP_STATUS_DELETING) {
        throw createGroupingError("grouping/group-not-deleting", "The group is not being deleted.");
      }
      transaction.delete(groupRef);
      if (reservationSnapshot.exists() && reservationSnapshot.data().groupId === validGroupId) {
        transaction.delete(reservationRef);
      }
    });

    return { data: { clearedCount, alreadyDeleted: false }, error: null };
  } catch (error) {
    throw addOperationProgress(error, {
      operation: "delete-group",
      groupId: validGroupId,
      clearedCount,
      retryable: true
    });
  }
};

export const inspectInvalidGroups = async (uid, scopeKey) => {
  const validUid = validateUid(uid);
  const scope = parseGroupScopeKey(scopeKey);
  const snapshot = await getDocs(
    query(getGroupsRef(validUid), where("scopeKey", "==", scope.scopeKey))
  );
  const inspectedGroups = await Promise.all(snapshot.docs.map(async (groupDoc) => {
    const memberSnapshot = await getDocs(
      getGroupMembersQuery(validUid, scope.scopeKey, groupDoc.id, 2)
    );
    const group = mapGroupSnapshot(groupDoc);
    const invalid = !isVisibleGroup(group, memberSnapshot.size);
    return {
      groupId: groupDoc.id,
      status: group.status,
      observedMemberCount: memberSnapshot.size,
      memberCountIsExact: memberSnapshot.size < 2,
      invalid,
      reason: group.status !== GROUP_STATUS_ACTIVE
        ? `status:${group.status || "missing"}`
        : memberSnapshot.size === 0
          ? "empty"
          : memberSnapshot.size === 1
            ? "singleton"
            : null
    };
  }));
  return { data: inspectedGroups, error: null };
};

export const cleanupInvalidGroups = async (uid, scopeKey) => {
  const validUid = validateUid(uid);
  const inspection = await inspectInvalidGroups(validUid, scopeKey);
  const invalidGroups = inspection.data.filter((group) => group.invalid);
  const deletedGroupIds = [];
  try {
    for (const group of invalidGroups) {
      await deleteGroup(validUid, group.groupId);
      deletedGroupIds.push(group.groupId);
    }
  } catch (error) {
    throw addOperationProgress(error, {
      operation: "cleanup-invalid-groups",
      deletedGroupIds,
      remainingGroupIds: invalidGroups
        .map((group) => group.groupId)
        .filter((groupId) => !deletedGroupIds.includes(groupId)),
      retryable: true
    });
  }
  return { data: { deletedGroupIds }, error: null };
};

// Preferred Phase B contract: combine this single metadata listener with the
// existing scope-level anime listener and derive visible groups/counts locally.
export const subscribeToGroupMetadata = (uid, scopeKey, callback, onError) => {
  const validUid = validateUid(uid);
  const scope = parseGroupScopeKey(scopeKey);
  return onSnapshot(
    query(getGroupsRef(validUid), where("scopeKey", "==", scope.scopeKey)),
    (snapshot) => callback(
      snapshot.docs.map(mapGroupSnapshot).filter((group) => group.status === GROUP_STATUS_ACTIVE)
    ),
    (error) => {
      console.error("Group metadata subscription error:", error);
      if (onError) onError(error);
    }
  );
};

// Phase F integration note: Watchlist/Completed moves should eventually invoke
// the grouping removal workflow in the same product operation. Until then,
// consumers must regard groupId as valid only when this subscription returns
// the referenced group; missing, non-active, empty, and singleton groups leave
// their anime visible as standalone entries.
export const subscribeToGroups = (uid, scopeKey, callback, onError) => {
  const validUid = validateUid(uid);
  const scope = parseGroupScopeKey(scopeKey);
  const groupsQuery = query(getGroupsRef(validUid), where("scopeKey", "==", scope.scopeKey));
  const groups = new Map();
  const memberCounts = new Map();
  const memberUnsubscribers = new Map();

  const emitVisibleGroups = () => {
    callback([...groups.values()].filter((group) => (
      isVisibleGroup(group, memberCounts.get(group.groupId) || 0)
    )));
  };

  const unsubscribeGroups = onSnapshot(
    groupsQuery,
    (snapshot) => {
      const nextGroupIds = new Set(snapshot.docs.map((groupDoc) => groupDoc.id));
      memberUnsubscribers.forEach((unsubscribe, groupId) => {
        const group = snapshot.docs.find((groupDoc) => groupDoc.id === groupId)?.data();
        if (!nextGroupIds.has(groupId) || group?.status !== GROUP_STATUS_ACTIVE) {
          unsubscribe();
          memberUnsubscribers.delete(groupId);
          memberCounts.delete(groupId);
        }
      });

      groups.clear();
      snapshot.docs.forEach((groupDoc) => {
        const group = mapGroupSnapshot(groupDoc);
        groups.set(group.groupId, group);
        if (group.status !== GROUP_STATUS_ACTIVE || memberUnsubscribers.has(group.groupId)) return;
        const unsubscribeMembers = onSnapshot(
          getGroupMembersQuery(validUid, scope.scopeKey, group.groupId, 2),
          (memberSnapshot) => {
            memberCounts.set(group.groupId, memberSnapshot.size);
            emitVisibleGroups();
          },
          (error) => {
            memberCounts.delete(group.groupId);
            emitVisibleGroups();
            if (onError) onError(error);
          }
        );
        memberUnsubscribers.set(group.groupId, unsubscribeMembers);
      });
      emitVisibleGroups();
    },
    (error) => {
      console.error("Groups subscription error:", error);
      if (onError) onError(error);
    }
  );

  return () => {
    unsubscribeGroups();
    memberUnsubscribers.forEach((unsubscribe) => unsubscribe());
    memberUnsubscribers.clear();
  };
};

// ==========================================
// MIGRATION: LEGACY COMPLETED COLLECTION
// ==========================================

/**
 * Inspect the legacy Completed migration state without performing any writes.
 * Returns a summary of source items, destination items, and what would be copied.
 * Safe to call at any time — performs only reads.
 */
export const inspectLegacyMigration = async (uid) => {
  if (!uid) throw new Error("uid is required.");

  try {
    // 1. Check user profile flag
    const userDocRef = doc(db, "users", uid);
    const userSnap = await getDoc(userDocRef);
    const userData = userSnap.exists() ? userSnap.data() : {};
    const profileFlagSet = Boolean(userData.system_meta?.legacyCompletedMigrated);

    // 2. Find legacy "Completed" custom collections
    const collectionsRef = collection(db, "users", uid, "collections");
    const collectionsSnap = await getDocs(collectionsRef);

    const legacyMatches = [];
    collectionsSnap.forEach((colDoc) => {
      const data = colDoc.data();
      const normalizedName = (data.name || "").trim().toLowerCase();
      if (normalizedName === "completed") {
        legacyMatches.push({ id: colDoc.id, ref: colDoc.ref, data });
      }
    });

    if (legacyMatches.length === 0) {
      return {
        found: false,
        profileFlagSet,
        message: "No custom collection named 'Completed' was found.",
      };
    }

    if (legacyMatches.length > 1) {
      return {
        found: false,
        ambiguous: true,
        profileFlagSet,
        collectionIds: legacyMatches.map((m) => m.id),
        message: `Multiple collections named 'Completed' found (${legacyMatches.map((m) => m.id).join(", ")}). Manual review required.`,
      };
    }

    const legacyCol = legacyMatches[0];
    const collectionFlagSet = Boolean(legacyCol.data._isMigratedLegacy);

    // 3. Fetch source items
    const legacyItemsRef = collection(db, "users", uid, "collections", legacyCol.id, "items");
    const legacyItemsSnap = await getDocs(legacyItemsRef);
    const sourceItems = legacyItemsSnap.docs.map((d) => ({
      docId: d.id,
      animeId: String(d.data().animeId || d.id),
      title: d.data().title || "Unknown Title",
      image: d.data().image || "",
      type: d.data().type || "TV",
      score: d.data().score ?? null,
      hasAnimeId: Boolean(d.data().animeId),
    }));

    // 4. Fetch destination items
    const destRef = collection(db, "users", uid, "completed");
    const destSnap = await getDocs(destRef);
    const destinationIds = new Set(destSnap.docs.map((d) => d.id));

    // 5. Compute missing items
    const missingItems = sourceItems.filter((item) => !destinationIds.has(item.animeId));
    const alreadyInDest = sourceItems.filter((item) => destinationIds.has(item.animeId));
    const itemsWithNoAnimeId = sourceItems.filter((item) => !item.hasAnimeId);

    return {
      found: true,
      collectionId: legacyCol.id,
      collectionName: legacyCol.data.name,
      profileFlagSet,
      collectionFlagSet,
      sourceCount: sourceItems.length,
      destinationCount: destSnap.size,
      missingCount: missingItems.length,
      alreadyMigratedCount: alreadyInDest.length,
      itemsWithNoAnimeId: itemsWithNoAnimeId.length,
      missingItems: missingItems.map((i) => ({ animeId: i.animeId, title: i.title })),
      message: missingItems.length === 0
        ? "All source items are already present in the destination. Migration is complete."
        : `${missingItems.length} item(s) need to be copied to the System Completed collection.`,
    };
  } catch (error) {
    console.error("inspectLegacyMigration error:", error);
    throw error;
  }
};

/**
 * Safely migrate the legacy custom "Completed" collection to the built-in
 * users/{uid}/completed subcollection.
 *
 * Safety guarantees:
 * - Never overwrites existing destination documents.
 * - Never deletes source documents.
 * - Never deletes watchlist items (watchlist reconciliation is a separate step).
 * - Idempotent: safe to re-run if partially completed.
 * - Verifies destination after writing before setting migration flags.
 * - Returns a detailed result object.
 *
 * @param {string} uid - The authenticated user's UID.
 * @param {object} [options]
 * @param {boolean} [options.skipFlagCheck=false] - If true, ignores migration-complete flags and re-inspects destination.
 */
export const migrateLegacyCompletedCollection = async (uid, { skipFlagCheck = false } = {}) => {
  if (!uid) {
    throw new Error("uid is required for migration.");
  }

  try {
    // 1. Fetch user profile to see if migration was already performed and recorded
    const userDocRef = doc(db, "users", uid);
    const userSnap = await getDoc(userDocRef);
    const userData = userSnap.exists() ? userSnap.data() : {};

    // Early exit on profile flag — but ONLY if destination is also non-empty
    if (!skipFlagCheck && userData.system_meta?.legacyCompletedMigrated) {
      // Verify destination actually has records before trusting the flag
      const destRef = collection(db, "users", uid, "completed");
      const destSnap = await getDocs(destRef);
      if (destSnap.size > 0) {
        return { success: true, migrated: false, alreadyMigrated: true, destinationCount: destSnap.size };
      }
      // Flag is set but destination is empty → flag was incorrect, continue migration
      console.warn("migrateLegacyCompletedCollection: profile flag was set but destination is empty. Proceeding.");
    }

    // 2. Find legacy "Completed" custom collection
    const collectionsRef = collection(db, "users", uid, "collections");
    const collectionsSnap = await getDocs(collectionsRef);

    const legacyMatches = [];
    collectionsSnap.forEach((colDoc) => {
      const data = colDoc.data();
      const normalizedName = (data.name || "").trim().toLowerCase();
      if (normalizedName === "completed") {
        legacyMatches.push({ id: colDoc.id, ref: colDoc.ref, data });
      }
    });

    if (legacyMatches.length === 0) {
      return { success: true, migrated: false, count: 0, message: "No legacy Completed collection found." };
    }

    if (legacyMatches.length > 1) {
      console.warn("Multiple collections named 'Completed' found for user. Migration paused for safety.");
      return {
        success: false,
        ambiguous: true,
        error: "Multiple collections named 'Completed' were found. Manual review is required before migration.",
        matches: legacyMatches.map((m) => m.id)
      };
    }

    const legacyCol = legacyMatches[0];

    // Check if this specific collection document was already marked migrated
    // But verify destination before trusting the flag
    if (!skipFlagCheck && legacyCol.data._isMigratedLegacy) {
      const destRef = collection(db, "users", uid, "completed");
      const destSnap = await getDocs(destRef);
      if (destSnap.size > 0) {
        return { success: true, migrated: false, alreadyMigrated: true, collectionId: legacyCol.id, destinationCount: destSnap.size };
      }
      console.warn("migrateLegacyCompletedCollection: collection flag was set but destination is empty. Proceeding.");
    }

    // 3. Fetch items in the legacy collection
    const legacyItemsRef = collection(db, "users", uid, "collections", legacyCol.id, "items");
    const legacyItemsSnap = await getDocs(legacyItemsRef);

    if (legacyItemsSnap.empty) {
      // Source is genuinely empty — mark as migrated
      await updateDoc(legacyCol.ref, {
        _isMigratedLegacy: true,
        _migratedAt: serverTimestamp()
      });
      await setDoc(
        userDocRef,
        {
          system_meta: {
            legacyCompletedMigrated: true,
            legacyCompletedCollectionId: legacyCol.id,
            migratedCount: 0,
            migratedAt: serverTimestamp()
          }
        },
        { merge: true }
      );
      return { success: true, migrated: true, count: 0, collectionId: legacyCol.id, message: "Source collection was empty." };
    }

    // 4. Pre-read the existing destination IDs to skip already-migrated items
    const destRef = collection(db, "users", uid, "completed");
    const destSnap = await getDocs(destRef);
    const existingDestIds = new Set(destSnap.docs.map((d) => d.id));

    // 5. Copy items into users/{uid}/completed/{animeId}
    // IMPORTANT: Does NOT delete watchlist items — watchlist reconciliation is a separate deliberate step.
    const batches = [];
    let currentBatch = writeBatch(db);
    let currentBatchSize = 0;

    const commitBatchIfNeeded = () => {
      if (currentBatchSize >= 400) {
        batches.push(currentBatch.commit());
        currentBatch = writeBatch(db);
        currentBatchSize = 0;
      }
    };

    const migratedAnimeIds = [];
    const skippedAnimeIds = [];

    for (const itemDoc of legacyItemsSnap.docs) {
      const itemData = itemDoc.data();
      const animeId = String(itemData.animeId || itemDoc.id);

      const targetCompletedRef = doc(db, "users", uid, "completed", animeId);

      // Skip if already in destination (idempotent — never overwrite existing records)
      if (existingDestIds.has(animeId)) {
        skippedAnimeIds.push(animeId);
        continue;
      }

      const completedData = {
        animeId,
        title: itemData.title || "Unknown Title",
        image: itemData.image || "",
        type: itemData.type || "TV",
        score: itemData.score ?? null,
        addedAt: itemData.addedAt || serverTimestamp(),
        _migratedFromLegacy: true
      };

      currentBatch.set(targetCompletedRef, completedData, { merge: true });
      currentBatchSize++;
      commitBatchIfNeeded();

      migratedAnimeIds.push(animeId);
    }

    if (currentBatchSize > 0) {
      batches.push(currentBatch.commit());
    }

    if (batches.length > 0) {
      await Promise.all(batches);
    }

    // 6. Verification: verify that newly written items exist in destination
    let verifySuccess = true;
    const verifyIds = migratedAnimeIds.slice(0, 10);
    for (const animeId of verifyIds) {
      const checkDoc = await getDoc(doc(db, "users", uid, "completed", animeId));
      if (!checkDoc.exists()) {
        verifySuccess = false;
        break;
      }
    }

    if (!verifySuccess) {
      throw new Error("Verification of migrated Completed items failed. Migration flags will NOT be set. Re-run when Firestore permissions are confirmed.");
    }

    // 7. Mark legacy collection as migrated and record in user profile
    //    Only set flags AFTER successful write + verification
    await updateDoc(legacyCol.ref, {
      _isMigratedLegacy: true,
      _migratedAt: serverTimestamp()
    });

    await setDoc(
      userDocRef,
      {
        system_meta: {
          legacyCompletedMigrated: true,
          legacyCompletedCollectionId: legacyCol.id,
          migratedCount: migratedAnimeIds.length,
          migratedAt: serverTimestamp()
        }
      },
      { merge: true }
    );

    return {
      success: true,
      migrated: true,
      count: migratedAnimeIds.length,
      skippedCount: skippedAnimeIds.length,
      collectionId: legacyCol.id,
      message: `Successfully copied ${migratedAnimeIds.length} anime to System Completed. ${skippedAnimeIds.length} were already present and preserved.`
    };
  } catch (error) {
    console.error("Migration of legacy Completed collection encountered an error:", error);
    throw error;
  }
};
