import { IoAddCircleOutline, IoRefreshOutline, IoTrashOutline } from "react-icons/io5";
import { Link } from "react-router-dom";
import Card from "./Card";
import GroupDeleteDialog from "./GroupDeleteDialog";
import GroupDetail from "./GroupDetail";
import GroupManagementModal from "./GroupManagementModal";
import LibraryGrid from "./LibraryGrid";
import LibrarySearch, { LibrarySearchEmptyState } from "./LibrarySearch";
import SkeletonCard from "./SkeletonCard";
import { getAnimeId, toCardAnime } from "./groupingUi";
import { useAnimeGrouping } from "../hooks/useAnimeGrouping";
import { useAutoGrouping } from "../hooks/useAutoGrouping";
import {
  createLibrarySearchView,
  getVisibleGroupMembersForSearch,
} from "../utils/librarySearch";

const EmptyWatchlist = () => (
  <div className="library-empty-state">
    <p>Your watchlist is empty.</p>
    <p style={{ fontSize: "0.9rem" }}>Add anime from the Anime Info page and they will appear here.</p>
    <Link to="/catalog" className="explore-btn">Explore Anime</Link>
  </div>
);

const WatchlistAnimeCard = ({ anime, onRemoveAnime, inGroupDetail = false }) => {
  const animeId = getAnimeId(anime);
  return (
    <div className={`library-card-wrapper ${inGroupDetail ? "group-detail-watchlist-card" : ""}`}>
      <button
        type="button"
        className="remove-btn watchlist-remove-btn"
        onClick={(event) => onRemoveAnime(event, animeId)}
        title="Remove from Watchlist"
        aria-label={`Remove ${anime.title || "anime"} from Watchlist`}
      >
        <IoTrashOutline aria-hidden="true" />
      </button>
      <Card animeInfo={toCardAnime(anime)} />
    </div>
  );
};

const WatchlistLoading = () => (
  <div className="grid-wrapper">
    {Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} />)}
  </div>
);

const LegacyWatchlist = ({ animeDocuments, displayLimit, showAll, onToggleShowAll, onRemoveAnime }) => {
  const visibleAnime = showAll ? animeDocuments : animeDocuments.slice(0, displayLimit);
  const hasMore = animeDocuments.length > displayLimit;
  return (
    <>
      <div className="grid-wrapper">
        {visibleAnime.map((anime) => (
          <WatchlistAnimeCard key={getAnimeId(anime)} anime={anime} onRemoveAnime={onRemoveAnime} />
        ))}
      </div>
      {hasMore && (
        <div className="show-more-container">
          <button type="button" className="show-more-btn" onClick={onToggleShowAll}>
            {showAll ? "Show Less ↑" : "Show More ↓"}
          </button>
        </div>
      )}
    </>
  );
};

const EnabledWatchlistGrouping = ({
  uid,
  animeDocuments,
  displayLimit,
  showAll,
  onToggleShowAll,
  onRemoveAnime,
  isLoading,
  services,
  searchQuery,
  onSearchQueryChange,
}) => {
  const grouping = useAnimeGrouping({
    uid,
    scopeKey: "watchlist",
    animeDocuments,
    services,
  });
  const autoGrouping = useAutoGrouping({
    uid,
    scopeKey: "watchlist",
    animeDocuments,
    isLoading,
    services,
  });
  const searchView = createLibrarySearchView({
    groups: grouping.groups,
    animeDocuments,
    query: searchQuery,
  });
  const totalDisplayUnits = searchView.isActive
    ? searchView.resultCount
    : grouping.visibleGroups.length + grouping.standaloneAnime.length;
  const hasMore = !searchView.isActive && totalDisplayUnits > displayLimit;
  const limitedDisplay = searchView.isActive || showAll ? null : displayLimit;
  const subscriptionError = grouping.error?.operation === "subscribe" ? grouping.error : null;

  const renderAnimeCard = (anime, inGroupDetail = false) => (
    <WatchlistAnimeCard
      anime={anime}
      onRemoveAnime={onRemoveAnime}
      inGroupDetail={inGroupDetail}
    />
  );

  return (
    <>
      <div className="watchlist-section-heading">
        <h2 className="section-title">Watchlist</h2>
        {!grouping.selectedGroup && (
          <div className="auto-grouping-toolbar">
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
      </div>

      <LibrarySearch
        query={searchQuery}
        onQueryChange={onSearchQueryChange}
        locationLabel="Watchlist"
        resultCount={searchView.resultCount}
      />

      {subscriptionError && (
        <p className="grouping-subscription-warning" role="alert">
          Groups are temporarily unavailable. Every Watchlist anime is still shown below.
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
          visibleMembers={getVisibleGroupMembersForSearch({
            group: grouping.selectedGroup,
            members: grouping.selectedMembers,
            query: searchQuery,
          })}
          searchQuery={searchQuery}
          renderAnimeCard={(anime) => renderAnimeCard(anime, true)}
        />
      ) : (
        <>
          <LibraryGrid
            {...grouping.libraryGridProps}
            groups={searchView.groups}
            animeDocuments={searchView.animeDocuments}
            displayLimit={limitedDisplay}
            renderAnimeCard={renderAnimeCard}
            emptyState={<LibrarySearchEmptyState query={searchQuery} />}
          />
          {hasMore && (
            <div className="show-more-container">
              <button type="button" className="show-more-btn" onClick={onToggleShowAll}>
                {showAll ? "Show Less ↑" : "Show More ↓"}
              </button>
            </div>
          )}
        </>
      )}

      <GroupManagementModal {...grouping.managementModalProps} />
      <GroupDeleteDialog {...grouping.deleteDialogProps} />
    </>
  );
};

const WatchlistSection = ({
  uid,
  animeDocuments = [],
  isLoading = false,
  isMobile = false,
  showAll = false,
  onToggleShowAll,
  onRemoveAnime,
  groupingEnabled = false,
  groupingServices,
  searchQuery = "",
  onSearchQueryChange,
}) => {
  const displayLimit = isMobile ? 6 : 12;
  const legacySearchView = createLibrarySearchView({ animeDocuments, query: searchQuery });


  return (
    <div className="library-section" data-grouping-enabled={groupingEnabled && Boolean(uid)}>
      {isLoading ? (
        <>
          <h2 className="section-title">Watchlist</h2>
          <WatchlistLoading />
        </>
      ) : animeDocuments.length === 0 ? (
        <>
          <h2 className="section-title">Watchlist</h2>
          <LibrarySearch
            query={searchQuery}
            onQueryChange={onSearchQueryChange}
            locationLabel="Watchlist"
            resultCount={0}
          />
          <EmptyWatchlist />
        </>
      ) : groupingEnabled && uid ? (
        <EnabledWatchlistGrouping
          uid={uid}
          animeDocuments={animeDocuments}
          displayLimit={displayLimit}
          showAll={showAll}
          onToggleShowAll={onToggleShowAll}
          onRemoveAnime={onRemoveAnime}
          isLoading={isLoading}
          services={groupingServices}
          searchQuery={searchQuery}
          onSearchQueryChange={onSearchQueryChange}
        />
      ) : (
        <>
          <h2 className="section-title">Watchlist</h2>
          <LibrarySearch
            query={searchQuery}
            onQueryChange={onSearchQueryChange}
            locationLabel="Watchlist"
            resultCount={legacySearchView.resultCount}
          />
          {legacySearchView.animeDocuments.length > 0 ? (
            <LegacyWatchlist
              animeDocuments={legacySearchView.animeDocuments}
              displayLimit={displayLimit}
              showAll={legacySearchView.isActive || showAll}
              onToggleShowAll={onToggleShowAll}
              onRemoveAnime={onRemoveAnime}
            />
          ) : (
            <LibrarySearchEmptyState query={searchQuery} />
          )}
        </>
      )}
    </div>
  );
};

export { EnabledWatchlistGrouping, LegacyWatchlist, WatchlistAnimeCard };
export default WatchlistSection;
