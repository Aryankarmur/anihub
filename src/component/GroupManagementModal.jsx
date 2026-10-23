import { useState } from "react";
import { IoAlbumsOutline, IoClose, IoLockClosedOutline } from "react-icons/io5";
import { GROUP_NAME_MAX_LENGTH, normalizeGroupName } from "../firebase/groupingUtils";
import GroupThumbnailPicker from "./GroupThumbnailPicker";
import GroupRetryStatus from "./GroupRetryStatus";
import GroupingImage from "./GroupingImage";
import { getAnimeId, getAnimeImage, getAnimeTitle, getGroupId } from "./groupingUi";
import { useModalDialog } from "./useModalDialog";
import "../assets/css/AnimeGrouping.css";

const getInitialIds = (availableAnime, group, initialAnimeIds) => {
  const editingGroupId = getGroupId(group);
  const requested = initialAnimeIds || availableAnime
    .filter((anime) => editingGroupId && String(anime.groupId || "") === editingGroupId)
    .map(getAnimeId);
  return [...new Set(requested.map(String))].filter((animeId) => {
    const anime = availableAnime.find((candidate) => getAnimeId(candidate) === animeId);
    return anime && (!anime.groupId || String(anime.groupId) === editingGroupId);
  });
};

const GroupManagementForm = ({
  mode,
  group,
  availableAnime,
  initialAnimeIds,
  onClose,
  onSaveGroup,
  isLoading,
  error,
  retryableOperation,
  onRetry,
  dialogRef
}) => {
  const uniqueAvailableAnime = [...new Map(
    availableAnime.map((anime) => [getAnimeId(anime), anime])
  ).values()].filter((anime) => getAnimeId(anime));
  const initialIds = getInitialIds(uniqueAvailableAnime, group, initialAnimeIds);
  const [name, setName] = useState(group?.name || "");
  const [selectedIds, setSelectedIds] = useState(initialIds);
  const [thumbnailAnimeId, setThumbnailAnimeId] = useState(
    String(group?.thumbnailAnimeId || initialIds[0] || "")
  );
  const editingGroupId = getGroupId(group);
  const selectedMembers = selectedIds
    .map((id) => uniqueAvailableAnime.find((anime) => getAnimeId(anime) === id))
    .filter(Boolean);

  let nameError = "";
  try {
    normalizeGroupName(name);
  } catch (validationError) {
    nameError = validationError.message;
  }
  const memberError = selectedMembers.length < 2
    ? "Select at least two anime to create a visible group."
    : "";
  const canSubmit = !nameError && !memberError && !isLoading;

  const toggleAnime = (anime) => {
    const animeId = getAnimeId(anime);
    const assignedElsewhere = anime.groupId && String(anime.groupId) !== editingGroupId;
    if (assignedElsewhere || isLoading) return;
    if (selectedIds.includes(animeId)) {
      const next = selectedIds.filter((id) => id !== animeId);
      setSelectedIds(next);
      if (thumbnailAnimeId === animeId) setThumbnailAnimeId(next[0] || "");
      return;
    }
    setSelectedIds([...selectedIds, animeId]);
    if (!thumbnailAnimeId) setThumbnailAnimeId(animeId);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    const normalized = normalizeGroupName(name);
    onSaveGroup?.({
      name: normalized.name,
      animeIds: selectedMembers.map(getAnimeId),
      thumbnailAnimeId: thumbnailAnimeId || getAnimeId(selectedMembers[0])
    });
  };

  return (
    <div
      className="group-dialog group-management-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-management-title"
      ref={dialogRef}
      tabIndex={-1}
    >
      <header className="group-management-header">
        <div>
          <span className="group-detail-eyebrow"><IoAlbumsOutline aria-hidden="true" /> Anime group</span>
          <h2 id="group-management-title">{mode === "edit" ? "Edit group" : "Create group"}</h2>
        </div>
        <button type="button" className="group-dialog-close" onClick={onClose} disabled={isLoading} aria-label="Close group editor">
          <IoClose aria-hidden="true" />
        </button>
      </header>

      <form onSubmit={handleSubmit} className="group-management-form" noValidate>
        {error && <p className="group-ui-error" role="alert">{error}</p>}
        <GroupRetryStatus
          retryableOperation={retryableOperation}
          onRetry={onRetry}
          isLoading={isLoading}
        />
        <div className="group-form-field">
          <div className="group-form-label-row">
            <label htmlFor="group-name">Group name</label>
            <span>{name.length}/{GROUP_NAME_MAX_LENGTH}</span>
          </div>
          <input
            id="group-name"
            name="groupName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={GROUP_NAME_MAX_LENGTH}
            autoComplete="off"
            disabled={isLoading}
            aria-describedby={nameError ? "group-name-error" : undefined}
            aria-invalid={Boolean(nameError)}
            placeholder="e.g. Monogatari Series"
          />
          {nameError && <p id="group-name-error" className="group-field-error">{nameError}</p>}
        </div>

        <fieldset className="group-anime-selector">
          <legend>Choose anime</legend>
          <div className="group-selection-summary" aria-live="polite">
            <strong>{selectedMembers.length}</strong> selected
          </div>
          {memberError && <p className="group-field-error">{memberError}</p>}
          {uniqueAvailableAnime.length > 0 ? (
            <div className="group-anime-options">
              {uniqueAvailableAnime.map((anime) => {
                const animeId = getAnimeId(anime);
                const selected = selectedIds.includes(animeId);
                const assignedElsewhere = anime.groupId && String(anime.groupId) !== editingGroupId;
                return (
                  <label className={`group-anime-option ${selected ? "selected" : ""} ${assignedElsewhere ? "unavailable" : ""}`} key={animeId}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleAnime(anime)}
                      disabled={Boolean(assignedElsewhere) || isLoading}
                    />
                    <GroupingImage src={getAnimeImage(anime)} alt="" />
                    <span className="group-anime-option-copy">
                      <strong>{getAnimeTitle(anime)}</strong>
                      <small>{assignedElsewhere ? <><IoLockClosedOutline aria-hidden="true" /> Already in another group</> : anime.type || "Anime"}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="group-thumbnail-empty">No saved anime are available in this library location.</p>
          )}
        </fieldset>

        <fieldset className="group-thumbnail-fieldset">
          <legend>Group thumbnail</legend>
          <GroupThumbnailPicker
            members={selectedMembers}
            selectedAnimeId={thumbnailAnimeId}
            onChange={setThumbnailAnimeId}
            disabled={isLoading}
          />
        </fieldset>

        <div className="group-dialog-actions group-management-actions">
          <button type="button" className="group-secondary-button" onClick={onClose} disabled={isLoading}>Cancel</button>
          <button type="submit" className="group-primary-button" disabled={!canSubmit}>
            {isLoading ? "Saving…" : mode === "edit" ? "Save changes" : "Create group"}
          </button>
        </div>
      </form>
    </div>
  );
};

const GroupManagementModal = ({
  isOpen,
  mode = "create",
  group = null,
  availableAnime = [],
  initialAnimeIds,
  onClose,
  onSaveGroup,
  isLoading = false,
  error = "",
  retryableOperation = null,
  onRetry
}) => {
  const dialogRef = useModalDialog(isOpen, onClose);
  if (!isOpen) return null;
  const formKey = `${mode}:${getGroupId(group) || "new"}`;

  return (
    <div className="group-modal-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isLoading) onClose?.();
    }}>
      <GroupManagementForm
        key={formKey}
        mode={mode}
        group={group}
        availableAnime={availableAnime}
        initialAnimeIds={initialAnimeIds}
        onClose={onClose}
        onSaveGroup={onSaveGroup}
        isLoading={isLoading}
        error={error}
        retryableOperation={retryableOperation}
        onRetry={onRetry}
        dialogRef={dialogRef}
      />
    </div>
  );
};

export default GroupManagementModal;
