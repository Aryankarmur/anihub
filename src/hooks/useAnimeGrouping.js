import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { defaultAnimeGroupingServices } from "../firebase/groupingServiceAdapter";
import {
  deriveVisibleGroups,
  normalizeAnimeIds,
  normalizeGroupName,
  parseGroupScopeKey,
  partitionAnimeByVisibleGroups,
  validateUid,
} from "../firebase/groupingUtils";

const EMPTY = Object.freeze([]);

const animeIdOf = (animeOrId) => String(
  typeof animeOrId === "object" && animeOrId !== null
    ? (animeOrId.animeId ?? animeOrId.id ?? animeOrId.mal_id ?? "")
    : (animeOrId ?? ""),
);

const initialState = (contextKey, subscribing = false) => ({
  contextKey,
  groups: EMPTY,
  isSubscribing: subscribing,
  subscriptionError: null,
  openGroupId: null,
  openGroupSnapshot: null,
  managementMode: null,
  editingGroup: null,
  initialAnimeIds: EMPTY,
  deleteTarget: null,
  isSaving: false,
  isRemovingMember: false,
  isDeleting: false,
  operationError: null,
  retryableOperation: null,
});

function reducer(state, action) {
  if (action.type !== "patch") return state;
  const base = state.contextKey === action.contextKey
    ? state
    : initialState(action.contextKey, action.subscribing);
  return { ...base, ...action.patch };
}

function codeOf(error) {
  return String(error?.code || error?.details?.code || "grouping/unknown");
}

function messageForError(error) {
  const code = codeOf(error);
  const messages = {
    "auth/required": "Sign in again before managing anime groups.",
    "permission-denied": "You do not have permission to change this group. Sign in again or check your access.",
    "firestore/permission-denied": "You do not have permission to change this group. Sign in again or check your access.",
    unavailable: "The grouping service is temporarily unavailable. Try again.",
    "firestore/unavailable": "The grouping service is temporarily unavailable. Try again.",
    "grouping/duplicate-name": "A group with that name already exists in this library location.",
    "grouping/reservation-conflict": "That group name is temporarily unavailable. Refresh and try again.",
    "grouping/invalid-name": "Enter a valid group name.",
    "grouping/invalid-scope": "This library location cannot contain groups.",
    "grouping/unsupported-scope": "This library location cannot contain groups.",
    "grouping/anime-not-found": "One or more selected anime are no longer in this library location.",
    "grouping/collection-not-found": "This collection no longer exists.",
    "grouping/group-not-found": "This group no longer exists.",
    "grouping/group-not-active": "This group is currently unavailable.",
    "grouping/group-deleting": "This group is being deleted.",
    "grouping/anime-already-grouped": "One or more selected anime now belong to another group.",
    "grouping/already-grouped": "One or more selected anime now belong to another group.",
    "grouping/invalid-thumbnail": "Choose a thumbnail from the anime that will remain in this group.",
    "grouping/group-busy": "This group changed while it was being edited. Refresh and try again.",
    "grouping/membership-changed": "Group membership changed. Reopen the editor and try again.",
    "grouping/operation-in-progress": "Another group change is still in progress.",
    "grouping/minimum-members": "Select at least two saved anime for a group.",
    "grouping/stale-operation": "The library location changed before this operation finished.",
  };
  if (messages[code]) return messages[code];
  if (error?.details?.retryable) return "The change was only partly completed. Retry to finish it safely.";
  return "The group change could not be completed. Try again.";
}

function toControllerError(error, operation) {
  const source = error instanceof Error ? error : new Error(String(error || "Unknown grouping error"));
  return {
    code: codeOf(source),
    message: messageForError(source),
    operation,
    details: source.details || null,
    technicalMessage: source.message,
  };
}

function controllerFailure(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function unwrap(result) {
  if (result?.error) throw result.error;
  return result;
}

function sameIds(left, right) {
  if (left.length !== right.length) return false;
  const other = new Set(right);
  return left.every((id) => other.has(id));
}

function selectedDocuments(animeDocuments, ids, scopeKey, allowedGroupId = null) {
  const byId = new Map(animeDocuments.map((anime) => [
    animeIdOf(anime),
    anime,
  ]));
  return ids.map((id) => {
    const anime = byId.get(id);
    if (!anime) {
      throw controllerFailure("grouping/anime-not-found", `Saved anime ${id} was not found.`);
    }
    if (anime.scopeKey && anime.scopeKey !== scopeKey) {
      throw controllerFailure("grouping/anime-not-found", `Saved anime ${id} is outside this scope.`);
    }
    if (anime.groupId && anime.groupId !== allowedGroupId) {
      throw controllerFailure("grouping/anime-already-grouped", `Saved anime ${id} belongs to another group.`);
    }
    return anime;
  });
}

function normalizeSelection(values) {
  const requestedIds = Array.isArray(values?.animeIds) ? values.animeIds : [];
  const animeIds = requestedIds.length ? normalizeAnimeIds(requestedIds) : [];
  if (animeIds.length < 2) {
    throw controllerFailure("grouping/minimum-members", "A group requires at least two anime.");
  }
  const { name } = normalizeGroupName(values?.name);
  const thumbnailAnimeId = values?.thumbnailAnimeId == null
    ? null
    : String(values.thumbnailAnimeId);
  if (thumbnailAnimeId && !animeIds.includes(thumbnailAnimeId)) {
    throw controllerFailure("grouping/anime-not-found", "The thumbnail must be a selected anime.");
  }
  return { name, animeIds, thumbnailAnimeId };
}

function makeRetry(type, payload, error, progress = null) {
  const details = progress || error?.details || null;
  if (!details) return { type, payload, progress: null };
  const requestedCount = Number.isFinite(details.requestedCount) ? details.requestedCount : null;
  const completedCount = [
    details.assignedCount,
    details.removedCount,
    details.processedCount,
    details.clearedCount,
  ].find(Number.isFinite) ?? null;
  const remainingCount = Number.isFinite(details.remainingCount)
    ? details.remainingCount
    : requestedCount !== null && completedCount !== null
      ? Math.max(0, requestedCount - completedCount)
      : null;
  return {
    type,
    payload,
    progress: { ...details, requestedCount, completedCount, remainingCount },
  };
}

export function useAnimeGrouping({
  uid,
  scopeKey,
  animeDocuments = EMPTY,
  services = defaultAnimeGroupingServices,
} = {}) {
  const contextKey = `${uid || "signed-out"}\u001f${scopeKey || "no-scope"}`;
  const validContext = useMemo(() => {
    if (!uid || !scopeKey) return { ready: false, error: null };
    try {
      return {
        ready: true,
        uid: validateUid(uid),
        scopeKey: parseGroupScopeKey(scopeKey).scopeKey,
        error: null,
      };
    } catch (error) {
      return { ready: false, error: toControllerError(error, "subscribe") };
    }
  }, [scopeKey, uid]);
  const [storedState, dispatch] = useReducer(
    reducer,
    null,
    () => initialState(contextKey, validContext.ready),
  );
  const state = storedState.contextKey === contextKey
    ? storedState
    : initialState(contextKey, validContext.ready);
  const contextRef = useRef(contextKey);
  const operationRef = useRef({ sequence: 0, busy: false });

  const patch = useCallback((value) => {
    dispatch({
      type: "patch",
      contextKey,
      subscribing: validContext.ready,
      patch: value,
    });
  }, [contextKey, validContext.ready]);

  useEffect(() => {
    contextRef.current = contextKey;
    operationRef.current.sequence += 1;
    operationRef.current.busy = false;
    if (!validContext.ready) return undefined;

    let active = true;
    let unsubscribe = () => {};
    const onGroups = (groups) => {
      if (!active || contextRef.current !== contextKey) return;
      patch({ groups: Array.isArray(groups) ? groups : EMPTY, isSubscribing: false, subscriptionError: null });
    };
    const onError = (error) => {
      if (!active || contextRef.current !== contextKey) return;
      patch({
        groups: EMPTY,
        isSubscribing: false,
        subscriptionError: toControllerError(error, "subscribe"),
      });
    };
    try {
      unsubscribe = services.subscribeToGroupMetadata(
        validContext.uid,
        validContext.scopeKey,
        onGroups,
        onError,
      ) || unsubscribe;
    } catch (error) {
      queueMicrotask(() => onError(error));
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, [contextKey, patch, services, validContext]);

  const anime = Array.isArray(animeDocuments) ? animeDocuments : EMPTY;
  const visibleGroups = useMemo(
    () => deriveVisibleGroups(state.groups, anime),
    [anime, state.groups],
  );
  const partition = useMemo(
    () => partitionAnimeByVisibleGroups(anime, visibleGroups),
    [anime, visibleGroups],
  );
  const openMetadata = state.openGroupId
    ? state.groups.find((group) => group.groupId === state.openGroupId)
    : null;
  const selectedGroup = state.openGroupId
    ? (openMetadata || { ...state.openGroupSnapshot, groupId: state.openGroupId, status: "missing" })
    : null;
  const selectedMembers = state.openGroupId
    ? anime.filter((entry) => entry.groupId === state.openGroupId)
    : EMPTY;

  const beginOperation = useCallback((operation) => {
    if (!validContext.ready) {
      throw controllerFailure("auth/required", "Authentication and a valid scope are required.");
    }
    if (operationRef.current.busy) {
      throw controllerFailure("grouping/operation-in-progress", "Another operation is in progress.");
    }
    operationRef.current.busy = true;
    operationRef.current.sequence += 1;
    return {
      operation,
      sequence: operationRef.current.sequence,
      contextKey,
      uid: validContext.uid,
      scopeKey: validContext.scopeKey,
    };
  }, [contextKey, validContext]);

  const assertCurrent = useCallback((operation) => {
    if (
      contextRef.current !== operation.contextKey
      || operationRef.current.sequence !== operation.sequence
    ) {
      throw controllerFailure("grouping/stale-operation", "The grouping context changed.");
    }
  }, []);

  const finishOperation = useCallback((operation) => {
    if (
      contextRef.current === operation.contextKey
      && operationRef.current.sequence === operation.sequence
    ) operationRef.current.busy = false;
  }, []);

  const performCreate = useCallback(async (values, resumeGroupId = null) => {
    let operation;
    try {
      operation = beginOperation("create");
      const selection = normalizeSelection(values);
      selectedDocuments(anime, selection.animeIds, operation.scopeKey, resumeGroupId);
      patch({ isSaving: true, operationError: null });
      let groupId = resumeGroupId;
      if (groupId) {
        unwrap(await services.addAnimeToGroup(operation.uid, groupId, selection.animeIds));
      } else {
        const result = unwrap(await services.createGroup(operation.uid, {
          name: selection.name,
          scopeKey: operation.scopeKey,
          animeIds: selection.animeIds,
          thumbnailAnimeId: selection.thumbnailAnimeId,
        }));
        groupId = result?.id || result?.data?.groupId;
      }
      assertCurrent(operation);
      if (resumeGroupId && selection.thumbnailAnimeId) {
        unwrap(await services.updateGroup(operation.uid, groupId, {
          thumbnailAnimeId: selection.thumbnailAnimeId,
        }));
        assertCurrent(operation);
      }
      patch({
        isSaving: false,
        managementMode: null,
        editingGroup: null,
        initialAnimeIds: EMPTY,
        operationError: null,
        retryableOperation: null,
      });
      return { ok: true, groupId };
    } catch (error) {
      const mapped = toControllerError(error, "create");
      const groupId = resumeGroupId || error?.details?.groupId || null;
      const retryable = groupId
        ? makeRetry("create", { values, groupId }, error)
        : null;
      if (!operation || contextRef.current === operation.contextKey) {
        patch({
          ...(mapped.code === "grouping/operation-in-progress" ? {} : { isSaving: false }),
          operationError: mapped,
          retryableOperation: retryable,
        });
      }
      return { ok: false, error: mapped };
    } finally {
      if (operation) finishOperation(operation);
    }
  }, [anime, assertCurrent, beginOperation, finishOperation, patch, services]);

  const performEdit = useCallback(async (groupId, values, baselineIds, isRetry = false) => {
    let operation;
    let stage = "validate";
    try {
      operation = beginOperation("edit");
      const selection = normalizeSelection(values);
      const group = state.groups.find((entry) => entry.groupId === groupId);
      if (!group || group.scopeKey !== operation.scopeKey || group.status !== "active") {
        throw controllerFailure("grouping/group-not-active", "The group is not active in this scope.");
      }
      selectedDocuments(anime, selection.animeIds, operation.scopeKey, groupId);
      const currentIds = anime
        .filter((entry) => entry.groupId === groupId)
        .map(animeIdOf);
      if (!isRetry && baselineIds && !sameIds(normalizeAnimeIds(baselineIds), currentIds)) {
        throw controllerFailure("grouping/membership-changed", "Membership changed after the editor opened.");
      }
      const additions = selection.animeIds.filter((id) => !currentIds.includes(id));
      const removals = currentIds.filter((id) => !selection.animeIds.includes(id));
      patch({ isSaving: true, operationError: null });

      if (additions.length) {
        stage = "add-members";
        unwrap(await services.addAnimeToGroup(operation.uid, groupId, additions));
        assertCurrent(operation);
      }
      if (selection.name !== group.name) {
        stage = "rename";
        unwrap(await services.renameGroup(operation.uid, groupId, selection.name));
        assertCurrent(operation);
      }
      if ((selection.thumbnailAnimeId || null) !== (group.thumbnailAnimeId || null)) {
        stage = "thumbnail";
        unwrap(await services.updateGroup(operation.uid, groupId, {
          thumbnailAnimeId: selection.thumbnailAnimeId,
        }));
        assertCurrent(operation);
      }
      if (removals.length) {
        stage = "remove-members";
        unwrap(await services.removeAnimeFromGroup(operation.uid, groupId, removals));
        assertCurrent(operation);
      }
      patch({
        isSaving: false,
        managementMode: null,
        editingGroup: null,
        initialAnimeIds: EMPTY,
        operationError: null,
        retryableOperation: null,
      });
      return { ok: true, groupId };
    } catch (error) {
      const mapped = toControllerError(error, "edit");
      const retryable = operation && stage !== "validate"
        ? makeRetry("edit", { groupId, values, baselineIds }, error, { stage, ...error?.details })
        : null;
      if (!operation || contextRef.current === operation.contextKey) {
        patch({
          ...(mapped.code === "grouping/operation-in-progress" ? {} : { isSaving: false }),
          operationError: mapped,
          retryableOperation: retryable,
        });
      }
      return { ok: false, error: mapped };
    } finally {
      if (operation) finishOperation(operation);
    }
  }, [anime, assertCurrent, beginOperation, finishOperation, patch, services, state.groups]);

  const openGroup = useCallback((group) => {
    const groupId = typeof group === "string" ? group : group?.groupId;
    const metadata = state.groups.find((entry) => entry.groupId === groupId) || group;
    patch({ openGroupId: groupId || null, openGroupSnapshot: metadata || null, operationError: null });
  }, [patch, state.groups]);

  const closeGroup = useCallback(() => {
    patch({ openGroupId: null, openGroupSnapshot: null, operationError: null });
  }, [patch]);

  const openCreateGroup = useCallback(() => {
    patch({
      managementMode: "create",
      editingGroup: null,
      initialAnimeIds: EMPTY,
      operationError: null,
      retryableOperation: null,
    });
  }, [patch]);

  const openEditGroup = useCallback((group) => {
    const groupId = typeof group === "string" ? group : group?.groupId;
    const metadata = state.groups.find((entry) => entry.groupId === groupId) || group;
    const memberIds = anime
      .filter((entry) => entry.groupId === groupId)
      .map(animeIdOf);
    patch({
      managementMode: "edit",
      editingGroup: metadata || null,
      initialAnimeIds: memberIds,
      operationError: null,
      retryableOperation: null,
    });
  }, [anime, patch, state.groups]);

  const closeManagement = useCallback(() => {
    if (state.isSaving) return;
    patch({ managementMode: null, editingGroup: null, initialAnimeIds: EMPTY, operationError: null });
  }, [patch, state.isSaving]);

  const saveManagement = useCallback((values) => {
    if (state.managementMode === "edit" && state.editingGroup?.groupId) {
      return performEdit(state.editingGroup.groupId, values, state.initialAnimeIds);
    }
    return performCreate(values);
  }, [performCreate, performEdit, state.editingGroup, state.initialAnimeIds, state.managementMode]);

  const performRemoveMember = useCallback(async (groupId, animeId) => {
    let operation;
    try {
      operation = beginOperation("remove-member");
      if (!groupId) throw controllerFailure("grouping/group-not-found", "No group is open.");
      patch({ isRemovingMember: true, operationError: null });
      const result = unwrap(await services.removeAnimeFromGroup(
        operation.uid,
        groupId,
        [animeIdOf(animeId)],
      ));
      assertCurrent(operation);
      const dissolved = Boolean(result?.data?.dissolved);
      patch({
        isRemovingMember: false,
        operationError: null,
        retryableOperation: null,
        ...(dissolved && state.openGroupId === groupId
          ? { openGroupSnapshot: { ...state.openGroupSnapshot, status: "missing" } }
          : {}),
      });
      return { ok: true, dissolved };
    } catch (error) {
      const mapped = toControllerError(error, "remove-member");
      const retryable = groupId
        ? makeRetry("remove-member", { groupId, animeId }, error)
        : null;
      if (!operation || contextRef.current === operation.contextKey) {
        patch({
          ...(mapped.code === "grouping/operation-in-progress" ? {} : { isRemovingMember: false }),
          operationError: mapped,
          retryableOperation: retryable,
        });
      }
      return { ok: false, error: mapped };
    } finally {
      if (operation) finishOperation(operation);
    }
  }, [assertCurrent, beginOperation, finishOperation, patch, services, state.openGroupId, state.openGroupSnapshot]);

  const removeMember = useCallback(
    (animeId) => performRemoveMember(state.openGroupId, animeId),
    [performRemoveMember, state.openGroupId],
  );

  const requestDeleteGroup = useCallback((group) => {
    const groupId = typeof group === "string" ? group : group?.groupId;
    const metadata = state.groups.find((entry) => entry.groupId === groupId) || group;
    patch({ deleteTarget: metadata || null, operationError: null, retryableOperation: null });
  }, [patch, state.groups]);

  const cancelDeleteGroup = useCallback(() => {
    if (state.isDeleting) return;
    patch({ deleteTarget: null, operationError: null });
  }, [patch, state.isDeleting]);

  const performDelete = useCallback(async (groupId) => {
    let operation;
    try {
      operation = beginOperation("delete");
      patch({ isDeleting: true, operationError: null });
      const result = unwrap(await services.deleteGroup(operation.uid, groupId));
      assertCurrent(operation);
      patch({
        isDeleting: false,
        deleteTarget: null,
        operationError: null,
        retryableOperation: null,
        ...(state.openGroupId === groupId
          ? { openGroupSnapshot: { ...state.openGroupSnapshot, status: "missing" } }
          : {}),
      });
      return { ok: true, data: result?.data || null };
    } catch (error) {
      const mapped = toControllerError(error, "delete");
      const retryable = makeRetry("delete", { groupId }, error);
      if (!operation || contextRef.current === operation.contextKey) {
        patch({
          ...(mapped.code === "grouping/operation-in-progress" ? {} : { isDeleting: false }),
          operationError: mapped,
          retryableOperation: retryable,
        });
      }
      return { ok: false, error: mapped };
    } finally {
      if (operation) finishOperation(operation);
    }
  }, [assertCurrent, beginOperation, finishOperation, patch, services, state.openGroupId, state.openGroupSnapshot]);

  const confirmDeleteGroup = useCallback(() => {
    if (!state.deleteTarget?.groupId) {
      const error = toControllerError(
        controllerFailure("grouping/group-not-found", "No group is selected for deletion."),
        "delete",
      );
      patch({ operationError: error });
      return Promise.resolve({ ok: false, error });
    }
    return performDelete(state.deleteTarget.groupId);
  }, [patch, performDelete, state.deleteTarget]);

  const retryLastOperation = useCallback(() => {
    const retry = state.retryableOperation;
    if (!retry) return Promise.resolve({ ok: false, error: null });
    if (retry.type === "create") return performCreate(retry.payload.values, retry.payload.groupId);
    if (retry.type === "edit") {
      return performEdit(
        retry.payload.groupId,
        retry.payload.values,
        retry.payload.baselineIds,
        true,
      );
    }
    if (retry.type === "delete") return performDelete(retry.payload.groupId);
    if (retry.type === "remove-member") {
      return performRemoveMember(retry.payload.groupId, retry.payload.animeId);
    }
    return Promise.resolve({ ok: false, error: null });
  }, [performCreate, performDelete, performEdit, performRemoveMember, state.retryableOperation]);

  const error = state.operationError || state.subscriptionError || validContext.error;
  const isManagementOpen = Boolean(state.managementMode);
  const isDeleteOpen = Boolean(state.deleteTarget);

  return {
    groups: state.groups,
    visibleGroups,
    groupedAnime: partition.grouped,
    standaloneAnime: partition.standalone,
    selectedGroup,
    selectedMembers,
    isSubscribing: state.isSubscribing,
    isSaving: state.isSaving,
    isRemovingMember: state.isRemovingMember,
    isDeleting: state.isDeleting,
    error,
    debugError: error?.technicalMessage || null,
    retryableOperation: state.retryableOperation,
    management: {
      isOpen: isManagementOpen,
      mode: state.managementMode || "create",
      group: state.editingGroup,
      initialAnimeIds: state.initialAnimeIds,
    },
    deletion: { isOpen: isDeleteOpen, group: state.deleteTarget },
    actions: {
      openGroup,
      closeGroup,
      openCreateGroup,
      openEditGroup,
      closeManagement,
      saveManagement,
      createGroup: performCreate,
      editGroup: performEdit,
      removeMember,
      requestDeleteGroup,
      cancelDeleteGroup,
      confirmDeleteGroup,
      retryLastOperation,
      clearError: () => patch({ operationError: null, subscriptionError: null }),
    },
    libraryGridProps: {
      groups: state.groups,
      animeDocuments: anime,
      onOpenGroup: openGroup,
      onEditGroup: openEditGroup,
      onDeleteGroup: requestDeleteGroup,
    },
    groupDetailProps: {
      group: selectedGroup,
      members: selectedMembers,
      onBack: closeGroup,
      onEditGroup: openEditGroup,
      onDeleteGroup: requestDeleteGroup,
      onRemoveMember: removeMember,
      isLoading: state.isRemovingMember,
      error: state.operationError?.message || null,
      retryableOperation: state.retryableOperation?.type === "remove-member"
        ? state.retryableOperation
        : null,
      onRetry: retryLastOperation,
    },
    managementModalProps: {
      isOpen: isManagementOpen,
      mode: state.managementMode || "create",
      group: state.editingGroup,
      availableAnime: anime,
      initialAnimeIds: state.initialAnimeIds,
      onClose: closeManagement,
      onSaveGroup: saveManagement,
      isLoading: state.isSaving,
      error: state.operationError?.message || null,
      retryableOperation: ["create", "edit"].includes(state.retryableOperation?.type)
        ? state.retryableOperation
        : null,
      onRetry: retryLastOperation,
    },
    deleteDialogProps: {
      isOpen: isDeleteOpen,
      groupName: state.deleteTarget?.name || "",
      onClose: cancelDeleteGroup,
      onConfirm: confirmDeleteGroup,
      isLoading: state.isDeleting,
      error: state.operationError?.message || null,
      retryableOperation: state.retryableOperation?.type === "delete"
        ? state.retryableOperation
        : null,
      onRetry: retryLastOperation,
    },
  };
}

export default useAnimeGrouping;
