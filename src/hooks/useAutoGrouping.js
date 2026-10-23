/**
 * useAutoGrouping.js
 *
 * React hook that triggers a single auto-grouping reconciliation pass whenever
 * the saved-anime list for a scope changes in a meaningful way.
 *
 * Design constraints
 * ------------------
 * - Reconciliation is NOT triggered on every render — only when the stable
 *   content fingerprint of animeDocuments changes AND loading is complete.
 * - A debounce delay (default 600 ms) prevents bursts during rapid Firestore
 *   snapshot delivery.
 * - A running lock prevents overlapping reconciliation passes for the same scope.
 * - Gate check: does nothing when isAnimeGroupingEnabled is false.
 * - Does not write directly to Firestore; delegates to runAutoGroupingReconciliation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as groupingFeatureGate from "../firebase/groupingFeatureGate.js";

const isAutoReconcileEnabled = () => {
  if (!groupingFeatureGate.isAnimeGroupingEnabled) {
    return false;
  }
  try {
    if (typeof groupingFeatureGate.isAutomaticReconciliationEnabled === "function") {
      return groupingFeatureGate.isAutomaticReconciliationEnabled();
    }
  } catch {
    // mock fallback
  }
  return true;
};


import {
  ANILIST_RELATIONS_FIELD,
  backfillRelationsFromAniList,
  buildStateFingerprint,
  runAutoGroupingReconciliation,
} from "../firebase/autoGroupingService.js";

const DEBOUNCE_MS = 600;

/**
 * @param {object} params
 * @param {string|null|undefined} params.uid
 * @param {string|null|undefined} params.scopeKey
 * @param {Array<object>} params.animeDocuments  - live anime docs from subscription
 * @param {boolean} [params.isLoading]           - true while initial load is in progress
 * @param {object} [params.services]             - injectable service overrides for tests
 * @returns {{ isReconciling: boolean, lastResult: object|null, triggerReconcile: Function }}
 */
export function useAutoGrouping({
  uid,
  scopeKey,
  animeDocuments = [],
  isLoading = false,
  services = {},
} = {}) {
  const [isReconciling, setIsReconciling] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  // Refs that survive re-renders without causing them.
  const runningRef = useRef(false);
  const timerRef = useRef(null);
  const lastFingerprintRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const doReconcile = useCallback(
    async (docs, currentUid, currentScopeKey) => {
      if (runningRef.current) return;
      runningRef.current = true;
      if (mountedRef.current) setIsReconciling(true);

      try {
        const reconcileFn =
          services?.runAutoGroupingReconciliation || runAutoGroupingReconciliation;
        const result = await reconcileFn({
          uid: currentUid,
          scopeKey: currentScopeKey,
          animeDocuments: docs,
          services,
        });
        if (mountedRef.current && result) {
          setLastResult(result);
        }
      } catch (error) {
        console.warn("[useAutoGrouping] reconciliation error:", error?.message ?? error);
      } finally {
        runningRef.current = false;
        if (mountedRef.current) setIsReconciling(false);
      }
    },
    [services],
  );

  useEffect(() => {
    // Prerequisites: feature gate, auth, scope, and data loaded.
    if (!isAutoReconcileEnabled() || !uid || !scopeKey || isLoading) return;

    // Compute fingerprint using only relation/groupId/exclusion fields
    // (not the full anime object to avoid false positives).
    const fingerprint = buildStateFingerprint(animeDocuments, []);

    if (fingerprint === lastFingerprintRef.current) return;
    lastFingerprintRef.current = fingerprint;

    // Debounce: cancel any pending reconciliation triggered by a previous snapshot.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    const capturedDocs = animeDocuments;
    const capturedUid = uid;
    const capturedScopeKey = scopeKey;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (mountedRef.current) {
        void doReconcile(capturedDocs, capturedUid, capturedScopeKey);
      }
    }, DEBOUNCE_MS);
  });

  /** Manually trigger a reconciliation pass (e.g. from "Organize Library" button). */
  const triggerReconcile = useCallback(async (options = {}) => {
    if (!isAutoReconcileEnabled() || !uid || !scopeKey || isLoading) return;
    lastFingerprintRef.current = null; // force re-run
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    let docs = animeDocuments;
    if (options?.scanMissing !== false) {
      try {
        const backfillMap = await backfillRelationsFromAniList(docs, services?.fetchImpl);
        if (backfillMap && backfillMap.size > 0) {
          docs = docs.map((doc) => {
            const id = String(doc.animeId ?? doc.id ?? "");
            if (!doc[ANILIST_RELATIONS_FIELD] && backfillMap.has(id)) {
              return { ...doc, [ANILIST_RELATIONS_FIELD]: backfillMap.get(id) };
            }
            return doc;
          });
        }
      } catch (err) {
        console.warn("[useAutoGrouping] backfill error:", err);
      }
    }
    void doReconcile(docs, uid, scopeKey);
  }, [animeDocuments, doReconcile, isLoading, scopeKey, services, uid]);

  return { isReconciling, lastResult, triggerReconcile };
}

export default useAutoGrouping;
