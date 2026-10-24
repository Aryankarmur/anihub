import { IoClose, IoTrashOutline } from "react-icons/io5";
import { useModalDialog } from "./useModalDialog";
import GroupRetryStatus from "./GroupRetryStatus";
import "../assets/css/AnimeGrouping.css";

const GroupDeleteDialog = ({
  isOpen,
  groupName,
  onClose,
  onConfirm,
  isLoading = false,
  error = "",
  retryableOperation = null,
  onRetry
}) => {
  const dialogRef = useModalDialog(isOpen, onClose);
  if (!isOpen) return null;

  return (
    <div className="group-modal-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isLoading) onClose?.();
    }}>
      <div
        className="group-dialog group-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="group-delete-title"
        aria-describedby="group-delete-description"
        ref={dialogRef}
        tabIndex={-1}
      >
        <button type="button" className="group-dialog-close" onClick={onClose} disabled={isLoading} aria-label="Close delete group dialog">
          <IoClose aria-hidden="true" />
        </button>
        <div className="group-delete-icon"><IoTrashOutline aria-hidden="true" /></div>
        <h2 id="group-delete-title">Delete “{groupName}”?</h2>
        <p id="group-delete-description">The group will be removed, but its anime will not be deleted from your library.</p>
        {error && <p className="group-ui-error" role="alert">{error}</p>}
        <GroupRetryStatus
          retryableOperation={retryableOperation}
          onRetry={onRetry}
          isLoading={isLoading}
        />
        <div className="group-dialog-actions">
          <button type="button" className="group-secondary-button" onClick={onClose} disabled={isLoading}>Cancel</button>
          <button type="button" className="group-danger-button" onClick={onConfirm} disabled={isLoading}>
            {isLoading ? "Deleting…" : "Delete group"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GroupDeleteDialog;
