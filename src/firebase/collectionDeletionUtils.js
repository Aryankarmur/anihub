const addDeletionProgress = (error, progress) => {
  error.details = {
    ...(error.details || {}),
    operation: "delete-collection",
    ...progress,
    collectionDeleted: false,
    retryable: true,
  };
  return error;
};

export const executeCollectionDeletionForMode = ({
  groupingEnabled,
  deleteWithoutGrouping,
  deleteWithGrouping,
}) => (
  groupingEnabled === true ? deleteWithGrouping() : deleteWithoutGrouping()
);

export const executeUngroupedCollectionDeletionPlan = async ({
  loadItemChunks,
  deleteItemChunk,
  deleteCollectionDocument,
}) => {
  let deletedItemCount = 0;
  try {
    const itemChunks = await loadItemChunks();
    for (const itemChunk of itemChunks) {
      await deleteItemChunk(itemChunk);
      deletedItemCount += itemChunk.length;
    }
    await deleteCollectionDocument();
    return {
      data: { deletedItemCount, collectionDeleted: true },
      error: null,
    };
  } catch (error) {
    throw addDeletionProgress(error, {
      mode: "ungrouped",
      deletedItemCount,
    });
  }
};

export const executeCollectionDeletionPlan = async ({
  beginCollectionDeletion,
  loadGroupIds,
  loadItemChunks,
  deleteGroupById,
  deleteItemChunk,
  deleteCollectionDocument,
}) => {
  const deletedGroupIds = [];
  let deletedItemCount = 0;
  let deletionPrepared = false;
  try {
    await beginCollectionDeletion();
    deletionPrepared = true;
    const groupIds = await loadGroupIds();
    const itemChunks = await loadItemChunks();
    for (const groupId of groupIds) {
      await deleteGroupById(groupId);
      deletedGroupIds.push(groupId);
    }
    for (const itemChunk of itemChunks) {
      await deleteItemChunk(itemChunk);
      deletedItemCount += itemChunk.length;
    }
    await deleteCollectionDocument();
    return {
      data: { deletedGroupIds, deletedItemCount, collectionDeleted: true },
      error: null,
    };
  } catch (error) {
    throw addDeletionProgress(error, {
      mode: "grouped",
      deletedGroupIds,
      deletedItemCount,
      deletionPrepared,
    });
  }
};
