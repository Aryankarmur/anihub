import { deriveVisibleGroups, partitionAnimeByVisibleGroups } from "../firebase/groupingUtils";
import { getAnimeId, getGroupId } from "../component/groupingUi";

export const normalizeLibrarySearchQuery = (query) => String(query ?? "").trim().toLocaleLowerCase();

const searchableAnimeTitle = (anime) => [anime?.title_english, anime?.title]
  .filter((value) => typeof value === "string")
  .join(" ")
  .toLocaleLowerCase();

export const animeMatchesLibrarySearch = (anime, query) => {
  const normalizedQuery = normalizeLibrarySearchQuery(query);
  return !normalizedQuery || searchableAnimeTitle(anime).includes(normalizedQuery);
};

export const groupNameMatchesLibrarySearch = (group, query) => {
  const normalizedQuery = normalizeLibrarySearchQuery(query);
  return !normalizedQuery
    || (typeof group?.name === "string" && group.name.toLocaleLowerCase().includes(normalizedQuery));
};

export const createLibrarySearchView = ({ groups = [], animeDocuments = [], query = "" }) => {
  const normalizedQuery = normalizeLibrarySearchQuery(query);
  if (!normalizedQuery) {
    return {
      groups,
      animeDocuments,
      isActive: false,
      resultCount: null,
    };
  }

  const visibleGroups = deriveVisibleGroups(groups, animeDocuments);
  const { grouped, standalone } = partitionAnimeByVisibleGroups(animeDocuments, visibleGroups);
  const matchingGroups = visibleGroups.filter((group) => {
    const members = grouped.get(getGroupId(group)) || [];
    return groupNameMatchesLibrarySearch(group, normalizedQuery)
      || members.some((anime) => animeMatchesLibrarySearch(anime, normalizedQuery));
  });
  const matchingStandalone = standalone.filter((anime) => (
    animeMatchesLibrarySearch(anime, normalizedQuery)
  ));
  const includedAnimeIds = new Set(matchingStandalone.map(getAnimeId));

  matchingGroups.forEach((group) => {
    (grouped.get(getGroupId(group)) || []).forEach((anime) => includedAnimeIds.add(getAnimeId(anime)));
  });

  return {
    groups: matchingGroups,
    animeDocuments: animeDocuments.filter((anime) => includedAnimeIds.has(getAnimeId(anime))),
    isActive: true,
    resultCount: matchingGroups.length + matchingStandalone.length,
  };
};

export const getVisibleGroupMembersForSearch = ({ group, members = [], query = "" }) => {
  const normalizedQuery = normalizeLibrarySearchQuery(query);
  if (!normalizedQuery || groupNameMatchesLibrarySearch(group, normalizedQuery)) return members;
  return members.filter((anime) => animeMatchesLibrarySearch(anime, normalizedQuery));
};

