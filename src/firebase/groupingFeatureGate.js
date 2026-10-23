import { isIsolatedFirebasePreview } from "./firebaseConfig";

export const evaluateAnimeGroupingGate = ({ featureRequested, isolatedEmulator }) => (
  featureRequested === true && isolatedEmulator === true
);

export const isAnimeGroupingEnabled = evaluateAnimeGroupingGate({
  featureRequested: import.meta.env.VITE_ENABLE_WATCHLIST_GROUPING === "true",
  isolatedEmulator: isIsolatedFirebasePreview,
});

// Compatibility aliases for the approved Phase D Watchlist integration.
export const evaluateWatchlistGroupingGate = evaluateAnimeGroupingGate;
export const isWatchlistGroupingEnabled = isAnimeGroupingEnabled;
