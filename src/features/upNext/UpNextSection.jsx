import { useMemo, useState } from "react";
import { IoCheckmarkCircleOutline, IoListOutline, IoRefreshOutline } from "react-icons/io5";
import Card from "../../component/Card";
import GroupDetail from "../../component/GroupDetail";
import LibraryGrid from "../../component/LibraryGrid";
import LibrarySearch, { LibrarySearchEmptyState } from "../../component/LibrarySearch";
import SkeletonCard from "../../component/SkeletonCard";
import { getAnimeId, getGroupId, toCardAnime } from "../../component/groupingUi";
import {
  createLibrarySearchView,
  getVisibleGroupMembersForSearch,
} from "../../utils/librarySearch";
import { deriveUpNextGroups } from "./upNextService";

const UpNextEmptyState = ({ hasError = false }) => (
  <div className="library-empty-state up-next-empty-state">
    <p>{hasError ? "Up Next suggestions could not be refreshed." : "No sequel suggestions are ready yet."}</p>
    <p className="up-next-empty-hint">
      {hasError
        ? "Your saved library is still available. Try again after AniList is reachable."
        : "Save anime with verified sequel information to build this collection automatically."}
    </p>
  </div>
);

export const UpNextSuggestionCard = ({ anime, onAddToWatchlist, onMarkCompleted }) => {
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const isBusy = action === "watchlist" || action === "completed";
  const isSaved = action === "saved";

  const runAction = async (type, callback) => {
    if (isBusy || isSaved) return;
    setAction(type);
    setError("");
    try {
      await callback?.(anime);
      setAction("saved");
    } catch (actionError) {
      setAction("");
      setError(actionError?.message || "The suggestion could not be saved.");
    }
  };

  const sourceTitle = anime.upNextSources?.[0]?.title;
  const releaseStatus = anime.status
    ? String(anime.status).toLocaleLowerCase().replaceAll("_", " ")
    : "";

  return (
    <article className="up-next-suggestion-card" data-testid={`up-next-card-${getAnimeId(anime)}`}>
      <Card animeInfo={toCardAnime(anime)} />
      {sourceTitle && <p className="up-next-source">Sequel to {sourceTitle}</p>}
      {releaseStatus && (
        <p className="up-next-release-status">
          <span>Status</span> {releaseStatus}
        </p>
      )}
      <div className="up-next-card-actions">
        <button
          type="button"
          onClick={() => runAction("watchlist", onAddToWatchlist)}
          disabled={isBusy || isSaved}
          aria-label={`Add ${anime.title} to Watchlist`}
        >
          <IoListOutline aria-hidden="true" />
          {action === "watchlist" ? "Adding…" : isSaved ? "Saved" : "Watchlist"}
        </button>
        <button
          type="button"
          onClick={() => runAction("completed", onMarkCompleted)}
          disabled={isBusy || isSaved}
          aria-label={`Mark ${anime.title} Completed`}
        >
          <IoCheckmarkCircleOutline aria-hidden="true" />
          {action === "completed" ? "Saving…" : isSaved ? "Saved" : "Completed"}
        </button>
      </div>
      {error && <p className="up-next-action-error" role="alert">{error}</p>}
    </article>
  );
};

const UpNextSection = ({
  suggestions = [],
  isLoading = false,
  error = "",
  searchQuery = "",
  onSearchQueryChange,
  onAddToWatchlist,
  onMarkCompleted,
  onDiscoverSequels,
  isDiscovering = false,
  discoveryMessage = "",
  discoveryError = "",
}) => {
  const [openGroupId, setOpenGroupId] = useState(null);
  const derived = useMemo(() => deriveUpNextGroups(suggestions), [suggestions]);
  const searchView = createLibrarySearchView({
    groups: derived.groups,
    animeDocuments: derived.animeDocuments,
    query: searchQuery,
  });
  const selectedGroup = derived.groups.find((group) => getGroupId(group) === openGroupId) || null;
  const selectedMembers = selectedGroup
    ? derived.animeDocuments.filter((anime) => anime.groupId === openGroupId)
    : [];
  const renderSuggestion = (anime) => (
    <UpNextSuggestionCard
      anime={anime}
      onAddToWatchlist={onAddToWatchlist}
      onMarkCompleted={onMarkCompleted}
    />
  );

  return (
    <section className="up-next-content" data-up-next-count={suggestions.length}>
      <div className="up-next-toolbar">
        <LibrarySearch
          query={searchQuery}
          onQueryChange={onSearchQueryChange}
          locationLabel="Up Next"
          resultCount={searchView.resultCount}
        />
        <button
          type="button"
          className="up-next-discover-button"
          onClick={onDiscoverSequels}
          disabled={isLoading || isDiscovering}
        >
          <IoRefreshOutline
            className={isDiscovering ? "up-next-discover-spinner" : ""}
            aria-hidden="true"
          />
          {isDiscovering ? "Discovering..." : "Discover Sequels"}
        </button>
      </div>

      {discoveryMessage && (
        <p className="up-next-discovery-feedback success" role="status">{discoveryMessage}</p>
      )}
      {discoveryError && (
        <p className="up-next-discovery-feedback error" role="alert">{discoveryError}</p>
      )}

      {error && suggestions.length > 0 && (
        <p className="grouping-subscription-warning" role="alert">{error}</p>
      )}

      {isLoading ? (
        <div className="grid-wrapper">
          {Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} />)}
        </div>
      ) : suggestions.length === 0 ? (
        <UpNextEmptyState hasError={Boolean(error || discoveryError)} />
      ) : selectedGroup ? (
        <GroupDetail
          group={selectedGroup}
          members={selectedMembers}
          visibleMembers={getVisibleGroupMembersForSearch({
            group: selectedGroup,
            members: selectedMembers,
            query: searchQuery,
          })}
          searchQuery={searchQuery}
          onBack={() => setOpenGroupId(null)}
          renderAnimeCard={renderSuggestion}
          showManagementActions={false}
          showMemberRemove={false}
          backLabel="Back to Up Next"
        />
      ) : (
        <LibraryGrid
          groups={searchView.groups}
          animeDocuments={searchView.animeDocuments}
          onOpenGroup={(group) => setOpenGroupId(getGroupId(group))}
          renderAnimeCard={renderSuggestion}
          showGroupActions={false}
          emptyState={<LibrarySearchEmptyState query={searchQuery} />}
          className="up-next-grid"
        />
      )}
    </section>
  );
};

export default UpNextSection;
