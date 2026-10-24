const getProgressMessage = (retryableOperation) => {
  const progress = retryableOperation?.progress;
  if (!progress) return "The operation was interrupted and can be retried safely.";
  if (progress.completedCount != null && progress.remainingCount != null) {
    return `${progress.completedCount} completed, ${progress.remainingCount} remaining.`;
  }
  if (progress.clearedCount != null) {
    return `${progress.clearedCount} group memberships cleared so far.`;
  }
  return "The operation was interrupted and can be retried safely.";
};

const GroupRetryStatus = ({ retryableOperation, onRetry, isLoading = false }) => {
  if (!retryableOperation) return null;
  return (
    <div className="group-retry-status" role="status">
      <p>{getProgressMessage(retryableOperation)}</p>
      <button type="button" onClick={onRetry} disabled={isLoading}>
        {isLoading ? "Retrying…" : "Retry operation"}
      </button>
    </div>
  );
};

export default GroupRetryStatus;
