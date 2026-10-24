import { useCallback, useState } from "react";

export const WATCHLIST_SEARCH_SCOPE = "watchlist";
export const COMPLETED_SEARCH_SCOPE = "completed";
export const collectionSearchScope = (collectionId) => `collection:${collectionId}`;

export const useLibrarySearchQueries = () => {
  const [queries, setQueries] = useState({});

  const getSearchQuery = useCallback((scopeKey) => queries[scopeKey] || "", [queries]);
  const setSearchQuery = useCallback((scopeKey, query) => {
    setQueries((current) => ({ ...current, [scopeKey]: query }));
  }, []);

  return { getSearchQuery, setSearchQuery };
};

export default useLibrarySearchQueries;

