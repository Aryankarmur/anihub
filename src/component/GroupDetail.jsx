import { IoArrowBack, IoCreateOutline, IoTrashOutline, IoRemoveCircleOutline } from "react-icons/io5";
import Card from "./Card";
import GroupingImage from "./GroupingImage";
import GroupRetryStatus from "./GroupRetryStatus";
import { getAnimeId, getAnimeImage, getGroupThumbnailMember, toCardAnime } from "./groupingUi";
import "../assets/css/AnimeGrouping.css";

const GroupDetail = ({
  group,
  members = [],
  onBack,
  onEditGroup,
  onRemoveMember,
  onDeleteGroup,
  isLoading = false,
  error = "",
  retryableOperation = null,
  onRetry,
  renderAnimeCard,
  visibleMembers = null,
  searchQuery = "",
  showManagementActions = true,
  showMemberRemove = true,
  backLabel = "Back to collection",
}) => {
  const valid = group?.status === "active" && members.length >= 2;
  if (!valid) {
    return (
      <section className="group-detail group-detail-unavailable" aria-labelledby="group-detail-state-title">
        <button type="button" className="group-back-button" onClick={onBack}>
          <IoArrowBack aria-hidden="true" /> {backLabel}
        </button>
        <h2 id="group-detail-state-title">This group is no longer available</h2>
        <p>Its remaining anime are still in this library and will appear as standalone cards.</p>
        {error && <p className="group-ui-error" role="alert">{error}</p>}
        <GroupRetryStatus
          retryableOperation={retryableOperation}
          onRetry={onRetry}
          isLoading={isLoading}
        />
      </section>
    );
  }

  const thumbnail = getGroupThumbnailMember(group, members);
  const displayedMembers = Array.isArray(visibleMembers) ? visibleMembers : members;
  return (
    <section className="group-detail" aria-labelledby="group-detail-title">
      <button type="button" className="group-back-button" onClick={onBack}>
        <IoArrowBack aria-hidden="true" /> {backLabel}
      </button>
      <header className="group-detail-header">
        <GroupingImage src={getAnimeImage(thumbnail)} alt="" className="group-detail-thumbnail" />
        <div className="group-detail-heading">
          <span className="group-detail-eyebrow">Anime group</span>
          <h2 id="group-detail-title">{group.name}</h2>
          <p>{members.length} anime</p>
        </div>
        {showManagementActions && (
          <div className="group-detail-actions">
            <button type="button" onClick={() => onEditGroup?.(group)} disabled={isLoading}>
              <IoCreateOutline aria-hidden="true" /> Edit group
            </button>
            <button type="button" className="danger" onClick={() => onDeleteGroup?.(group)} disabled={isLoading}>
              <IoTrashOutline aria-hidden="true" /> Delete group
            </button>
          </div>
        )}
      </header>
      {error && <p className="group-ui-error" role="alert">{error}</p>}
      <GroupRetryStatus
        retryableOperation={retryableOperation}
        onRetry={onRetry}
        isLoading={isLoading}
      />
      {displayedMembers.length === 0 ? (
        <div className="library-search-empty group-detail-search-empty" role="status">
          <p>No anime in this group match “{String(searchQuery).trim()}”.</p>
          <span>Change the search or return to the collection.</span>
        </div>
      ) : (
      <div className="library-group-grid group-detail-grid">
        {displayedMembers.map((anime) => {
          const animeId = getAnimeId(anime);
          return (
            <div className="group-detail-member" key={animeId}>
              {showMemberRemove && (
                <button
                  type="button"
                  className="group-member-remove"
                  onClick={() => onRemoveMember?.(anime, group)}
                  disabled={isLoading}
                  aria-label={`Remove ${anime.title || "anime"} from ${group.name}`}
                >
                  <IoRemoveCircleOutline aria-hidden="true" />
                </button>
              )}
              {renderAnimeCard ? renderAnimeCard(anime) : <Card animeInfo={toCardAnime(anime)} />}
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
};

export default GroupDetail;
