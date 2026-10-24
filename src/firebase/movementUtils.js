export const MOVEMENT_RECONCILIATIONS_FIELD = "_groupingReconciliations";
export const MOVEMENT_RECONCILIATION_MAX_TASKS = 8;

const MOVEMENT_SCOPES = new Set(["watchlist", "completed"]);

const asTask = (value) => {
  if (!value || typeof value !== "object") return null;
  const sourceScope = String(value.sourceScope || "");
  const sourceGroupId = String(value.sourceGroupId || "");
  const animeId = String(value.animeId || "");
  if (!MOVEMENT_SCOPES.has(sourceScope) || !sourceGroupId || !animeId) return null;
  if (sourceGroupId.includes("/") || animeId.includes("/")) return null;
  return { sourceScope, sourceGroupId, animeId };
};

export const movementTaskKey = (task) => (
  `${task.sourceScope}\u001f${task.sourceGroupId}\u001f${task.animeId}`
);

export const normalizeMovementReconciliations = (value) => {
  const values = Array.isArray(value) ? value : [];
  const unique = new Map();
  values.forEach((candidate) => {
    const task = asTask(candidate);
    if (task) unique.set(movementTaskKey(task), task);
  });
  return [...unique.values()];
};

export const collectMovementReconciliations = ({
  animeId,
  sourceScope,
  sourceData,
  destinationScope,
  destinationData,
}) => {
  const normalizedAnimeId = String(animeId);
  if (!MOVEMENT_SCOPES.has(sourceScope) || !MOVEMENT_SCOPES.has(destinationScope)) {
    throw new Error("Movement reconciliation is restricted to Watchlist and Completed.");
  }
  const tasks = [
    ...normalizeMovementReconciliations(sourceData?.[MOVEMENT_RECONCILIATIONS_FIELD]),
    ...normalizeMovementReconciliations(destinationData?.[MOVEMENT_RECONCILIATIONS_FIELD]),
  ];
  if (sourceData?.groupId) {
    tasks.push({
      sourceScope,
      sourceGroupId: String(sourceData.groupId),
      animeId: normalizedAnimeId,
    });
  }
  if (destinationData?.groupId) {
    tasks.push({
      sourceScope: destinationScope,
      sourceGroupId: String(destinationData.groupId),
      animeId: normalizedAnimeId,
    });
  }
  const normalizedTasks = normalizeMovementReconciliations(tasks);
  if (normalizedTasks.length > MOVEMENT_RECONCILIATION_MAX_TASKS) {
    throw new Error(
      "Too many pending movement reconciliations; refusing to move without preserving all cleanup work."
    );
  }
  return normalizedTasks;
};

export const withoutGroupingInternals = (data) => {
  if (!data || typeof data !== "object") return {};
  const copy = { ...data };
  delete copy.groupId;
  delete copy[MOVEMENT_RECONCILIATIONS_FIELD];
  return copy;
};
