import { IoAddCircleOutline, IoRefreshOutline, IoTrashOutline } from "react-icons/io5";
import Card from "./Card";
import GroupDeleteDialog from "./GroupDeleteDialog";
import GroupDetail from "./GroupDetail";
import GroupManagementModal from "./GroupManagementModal";
import LibraryGrid from "./LibraryGrid";
import SkeletonCard from "./SkeletonCard";
import { getAnimeId, toCardAnime } from "./groupingUi";
import { useAnimeGrouping } from "../hooks/useAnimeGrouping";
import { useAutoGrouping } from "../hooks/useAutoGrouping";

const CollectionEmptyState = () => (
  <div className="library-empty-state">
    <p>This collection is empty.</p>
    <p style={{ fontSize: "0.9rem" }}>Add anime from an Anime Info page.</p>
  </div>
);

const CollectionAnimeCard = ({ anime, onRemoveAnime, inGroupDetail = false }) => {
  const animeId = getAnimeId(anime);
  return (
    <div className={`library-card-wrapper ${inGroupDetail ? "group-detail-collection-card" : ""}`}>
      <button
        type="button"
        className="remove-btn collection-remove-btn"
        onClick={(event) => onRemoveAnime(event, animeId)}
        title="Remove from Collection"
        aria-label={`Remove ${anime.title || "anime"} from Collection`}
      >
        <IoTrashOutline aria-hidden="true" />
      </button>
      <Card animeInfo={toCardAnime(anime)} />
    </div>
  );
};

const LegacyCollectionItems = ({ animeDocuments, onRemoveAnime }) => (
  <div className="grid-wrapper">
    {animeDocuments.map((anime) => (
      <CollectionAnimeCard key={getAnimeId(anime)} anime={anime} onRemoveAnime={onRemoveAnime} />
    ))}
  </div>
);

const EnabledCustomCollectionGrouping = ({
  uid,
  collectionId,
  animeDocuments,
  onRemoveAnime,
  isLoading,
  services,
}) => {
  const grouping = useAnimeGrouping({
    uid,
    scopeKey: `collection:${collectionId}`,
    animeDocuments,
    services,
  });
  const autoGrouping = useAutoGrouping({
    uid,
    scopeKey: `collection:${collectionId}`,
    animeDocuments,
    isLoading,
    services,
  });
  const subscriptionError = grouping.error?.operation === "subscribe" ? grouping.error : null;
  const renderAnimeCard = (anime, inGroupDetail = false) => (
    <CollectionAnimeCard
      anime={anime}
      onRemoveAnime={onRemoveAnime}
      inGroupDetail={inGroupDetail}
    />
  );

  return (
    <>
      {!grouping.selectedGroup && (
        <div className="collection-grouping-toolbar auto-grouping-toolbar">
          <button
            type="button"
            className="watchlist-organize-btn"
            onClick={autoGrouping.triggerReconcile}
            disabled={autoGrouping.isReconciling || animeDocuments.length < 1}
            title="Automatically group related anime by sequel/prequel relationships"
          >
            <IoRefreshOutline
              aria-hidden="true"
              className={autoGrouping.isReconciling ? "spinning" : ""}
            />
            {autoGrouping.isReconciling ? "Organizing…" : "Organize Library"}
          </button>
          <button
            type="button"
            className="watchlist-create-group-btn watchlist-create-group-btn--secondary"
            onClick={grouping.actions.openCreateGroup}
            disabled={animeDocuments.length < 2}
            title="Manually create a group"
          >
            <IoAddCircleOutline aria-hidden="true" /> Create Group
          </button>
        </div>
      )}

      {subscriptionError && (
        <p className="grouping-subscription-warning" role="alert">
          Groups are temporarily unavailable. Every Collection anime is still shown below.
        </p>
      )}

      {autoGrouping.lastResult && (
        autoGrouping.lastResult.created.length > 0 ||
        autoGrouping.lastResult.updated.length > 0 ||
        autoGrouping.lastResult.dissolved.length > 0
      ) && (
        <p className="auto-grouping-status" role="status">
          Library organized:
          {autoGrouping.lastResult.created.length > 0 && (
            <> {autoGrouping.lastResult.created.length} group{autoGrouping.lastResult.created.length !== 1 ? "s" : ""} created</>)
          }
          {autoGrouping.lastResult.updated.length > 0 && (
            <>, {autoGrouping.lastResult.updated.length} updated</>)
          }
          {autoGrouping.lastResult.dissolved.length > 0 && (
            <>, {autoGrouping.lastResult.dissolved.length} dissolved</>)
          }.
        </p>
      )}

      {grouping.selectedGroup ? (
        <GroupDetail
          {...grouping.groupDetailProps}
          renderAnimeCard={(anime) => renderAnimeCard(anime, true)}
        />
      ) : (
        <LibraryGrid
          {...grouping.libraryGridProps}
          renderAnimeCard={renderAnimeCard}
        />
      )}

      <GroupManagementModal {...grouping.managementModalProps} />
      <GroupDeleteDialog {...grouping.deleteDialogProps} />
    </>
  );
};

const CustomCollectionSection = ({
  uid,
  collectionId,
  animeDocuments = [],
  isLoading = false,
  onRemoveAnime,
  groupingEnabled = false,
  groupingServices,
}) => {
  let content;
  if (isLoading) {
    content = (
      <div className="grid-wrapper">
        {Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} />)}
      </div>
    );
  } else if (animeDocuments.length === 0) {
    content = <CollectionEmptyState />;
  } else if (!groupingEnabled || !uid || !collectionId) {
    content = <LegacyCollectionItems animeDocuments={animeDocuments} onRemoveAnime={onRemoveAnime} />;
  } else {
    content = (
      <EnabledCustomCollectionGrouping
        key={collectionId}
        uid={uid}
        collectionId={collectionId}
        animeDocuments={animeDocuments}
        isLoading={isLoading}
        onRemoveAnime={onRemoveAnime}
        services={groupingServices}
      />
    );
  }
  return (
    <div
      className="custom-collection-content"
      data-collection-anime-count={animeDocuments.length}
      data-grouping-enabled={groupingEnabled && Boolean(uid) && Boolean(collectionId)}
    >
      {content}
    </div>
  );
};

export { CollectionAnimeCard, EnabledCustomCollectionGrouping, LegacyCollectionItems };
export default CustomCollectionSection;
