import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveUpNextSuggestions } from "./upNextService.js";

const animeFingerprint = (anime) => {
  const relations = Array.isArray(anime?.anilistRelations)
    ? anime.anilistRelations.map((relation) => `${relation.relatedId}:${relation.relationType}`).sort().join(",")
    : "missing";
  return `${anime?.animeId ?? anime?.id ?? ""}:${relations}`;
};

const suggestionFingerprint = (suggestions) => suggestions.map((anime) => [
  anime?.animeId ?? anime?.id ?? "",
  anime?.title ?? "",
  anime?.status ?? "",
  anime?.year ?? "",
  animeFingerprint(anime),
].join(":"))
  .sort()
  .join("|");

const normalizeResult = (result) => (Array.isArray(result)
  ? { suggestions: result, warning: "", incomplete: false }
  : {
      suggestions: result?.suggestions || [],
      warning: result?.warning || "",
      incomplete: Boolean(result?.incomplete),
    });

const mergeVerifiedSuggestions = (existing, discovered) => {
  const byId = new Map(existing.map((anime) => [String(anime?.animeId ?? anime?.id ?? ""), anime]));
  discovered.forEach((anime) => {
    const animeId = String(anime?.animeId ?? anime?.id ?? "");
    if (animeId) byId.set(animeId, anime);
  });
  return [...byId.values()];
};

export const buildUpNextSourceFingerprint = (watchlist = [], completed = []) => [
  ...watchlist.map((anime) => `w:${animeFingerprint(anime)}`),
  ...completed.map((anime) => `c:${animeFingerprint(anime)}`),
].sort().join("|");

export const useUpNextSuggestions = ({
  watchlist = [],
  completed = [],
  isLoading = false,
  resolver = resolveUpNextSuggestions,
} = {}) => {
  const [state, setState] = useState({
    suggestions: [],
    error: "",
    incomplete: false,
    resolvedFingerprint: null,
    isDiscovering: false,
    discoveryMessage: "",
    discoveryError: "",
  });
  const refreshPromiseRef = useRef(null);
  const sourcesRef = useRef({ watchlist, completed });
  const fingerprint = useMemo(
    () => buildUpNextSourceFingerprint(watchlist, completed),
    [watchlist, completed],
  );
  const currentFingerprintRef = useRef(fingerprint);

  useEffect(() => {
    sourcesRef.current = { watchlist, completed };
    currentFingerprintRef.current = fingerprint;
  }, [completed, fingerprint, watchlist]);

  useEffect(() => {
    if (isLoading) return undefined;
    let active = true;

    Promise.resolve(resolver(sourcesRef.current))
      .then((result) => {
        if (!active) return;
        const normalized = normalizeResult(result);
        setState((previous) => ({
          ...previous,
          suggestions: normalized.suggestions,
          error: normalized.warning,
          incomplete: normalized.incomplete,
          resolvedFingerprint: fingerprint,
        }));
      })
      .catch((error) => {
        if (!active) return;
        setState((previous) => ({
          ...previous,
          suggestions: [],
          error: error?.message || "Up Next suggestions are temporarily unavailable.",
          incomplete: true,
          resolvedFingerprint: fingerprint,
        }));
      });

    return () => {
      active = false;
    };
  }, [fingerprint, isLoading, resolver]);

  useEffect(() => {
    if (!state.discoveryMessage) return undefined;
    const timeoutId = setTimeout(() => {
      setState((previous) => ({ ...previous, discoveryMessage: "" }));
    }, 4000);
    return () => clearTimeout(timeoutId);
  }, [state.discoveryMessage]);

  const discoverSequels = useCallback(() => {
    if (isLoading) return Promise.resolve(null);
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const requestedFingerprint = fingerprint;
    const sourceSnapshot = sourcesRef.current;
    setState((previous) => ({
      ...previous,
      isDiscovering: true,
      discoveryMessage: "",
      discoveryError: "",
    }));

    const refreshPromise = Promise.resolve(resolver({
      watchlist: sourceSnapshot.watchlist,
      completed: sourceSnapshot.completed,
      forceRefresh: true,
    })).then((result) => {
      if (currentFingerprintRef.current !== requestedFingerprint) return result;
      const normalized = normalizeResult(result);
      setState((previous) => {
        if (normalized.incomplete) {
          return {
            ...previous,
            suggestions: mergeVerifiedSuggestions(previous.suggestions, normalized.suggestions),
            incomplete: true,
            discoveryError: normalized.warning
              || "AniList could not finish discovering every sequel. Existing results were kept.",
          };
        }
        const changed = suggestionFingerprint(previous.suggestions)
          !== suggestionFingerprint(normalized.suggestions);
        return {
          ...previous,
          suggestions: normalized.suggestions,
          error: "",
          incomplete: false,
          resolvedFingerprint: requestedFingerprint,
          discoveryMessage: changed ? "New sequel information discovered." : "Already up to date.",
        };
      });
      return result;
    }).catch((error) => {
      if (currentFingerprintRef.current === requestedFingerprint) {
        setState((previous) => ({
          ...previous,
          discoveryError: error?.message
            || "AniList could not refresh sequel suggestions. Existing results were kept.",
        }));
      }
      return null;
    }).finally(() => {
      refreshPromiseRef.current = null;
      if (currentFingerprintRef.current === requestedFingerprint) {
        setState((previous) => ({ ...previous, isDiscovering: false }));
      }
    });

    refreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, [fingerprint, isLoading, resolver]);

  const hasCurrentResult = !isLoading && state.resolvedFingerprint === fingerprint;
  return {
    suggestions: hasCurrentResult ? state.suggestions : [],
    isLoading: !hasCurrentResult,
    error: hasCurrentResult ? state.error : "",
    incomplete: hasCurrentResult ? state.incomplete : false,
    isDiscovering: state.isDiscovering,
    discoveryMessage: state.discoveryMessage,
    discoveryError: state.discoveryError,
    discoverSequels,
  };
};

export default useUpNextSuggestions;
