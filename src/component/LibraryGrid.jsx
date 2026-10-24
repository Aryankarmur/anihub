import Card from "./Card";
import GroupCard from "./GroupCard";
import { deriveVisibleGroups, partitionAnimeByVisibleGroups } from "../firebase/groupingUtils";
import { getAnimeId, getGroupId, toCardAnime } from "./groupingUi";
import "../assets/css/AnimeGrouping.css";

const LibraryGrid = ({
  groups = [],
  animeDocuments = [],
  displayLimit = null,
  onOpenGroup,
  onEditGroup,
  onDeleteGroup,
  renderAnimeCard,
  emptyState = null,
  className = "",
  showGroupActions = true,
}) => {
  const visibleGroups = deriveVisibleGroups(groups, animeDocuments);
  const { grouped, standalone } = partitionAnimeByVisibleGroups(animeDocuments, visibleGroups);
  const combinedItems = [
    ...visibleGroups.map((group) => ({ type: "group", group })),
    ...standalone.map((anime) => ({ type: "anime", anime }))
  ];
  const normalizedLimit = Number.isInteger(displayLimit) && displayLimit >= 0
    ? displayLimit
    : combinedItems.length;
  const visibleItems = combinedItems.slice(0, normalizedLimit);

  if (visibleItems.length === 0) return emptyState;

  return (
    <div className={`library-group-grid ${className}`.trim()} data-total-items={combinedItems.length}>
      {visibleItems.map((item) => {
        if (item.type === "group") {
          const groupId = getGroupId(item.group);
          return (
            <GroupCard
              key={`group:${groupId}`}
              group={item.group}
              members={grouped.get(groupId) || []}
              onOpenGroup={onOpenGroup}
              onEditGroup={onEditGroup}
              onDeleteGroup={onDeleteGroup}
              showActions={showGroupActions}
            />
          );
        }
        const animeId = getAnimeId(item.anime);
        return (
          <div className="library-group-anime" key={`anime:${animeId}`} data-testid={`anime-card-${animeId}`}>
            {renderAnimeCard
              ? renderAnimeCard(item.anime)
              : <Card animeInfo={toCardAnime(item.anime)} />}
          </div>
        );
      })}
    </div>
  );
};

export default LibraryGrid;
