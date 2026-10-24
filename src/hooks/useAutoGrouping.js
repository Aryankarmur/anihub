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
 * - Gate check: does nothing when automatic reconciliation is unavailable.
 * - Does not write directly to Firestore; delegates to runAutoGroupingReconciliation.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as groupingFeatureGate from "../firebase/groupingFeatureGate.js";

const isAutoReconcileEnabled = (uid) => {
  try {
    if (typeof groupingFeatureGate.isAutomaticReconciliationEnabled === "function") {
      return groupingFeatureGate.isAutomaticReconciliationEnabled(uid);
    }
  } catch {
    // Fall back to isAnimeGroupingEnabled if mock does not define isAutomaticReconciliationEnabled
  }
  return Boolean(groupingFeatureGate.isAnimeGroupingEnabled);
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
  const identityKey = uid && scopeKey ? `${uid}\u0000${scopeKey}` : "";
  const [status, setStatus] = useState({
    identityKey: "",
    isReconciling: false,
    lastResult: null,
  });

  // Refs that survive re-renders without causing them.
  const activeIdentityRef = useRef(identityKey);
  const runningIdentitiesRef = useRef(new Set());
  const timerRef = useRef(null);
  const lastFingerprintRef = useRef(null);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    activeIdentityRef.current = identityKey;
    lastFingerprintRef.current = null;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [identityKey]);

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
      const reconciliationIdentity = `${currentUid}\u0000${currentScopeKey}`;
      if (
        !currentUid
        || !currentScopeKey
        || activeIdentityRef.current !== reconciliationIdentity
        || runningIdentitiesRef.current.has(reconciliationIdentity)
      ) return;

      runningIdentitiesRef.current.add(reconciliationIdentity);
      let completedResult = null;
      if (mountedRef.current) {
        setStatus((current) => ({
          identityKey: reconciliationIdentity,
          isReconciling: true,
          lastResult: current.identityKey === reconciliationIdentity
            ? current.lastResult
            : null,
        }));
      }

      try {
        const reconcileFn =
          services?.runAutoGroupingReconciliation || runAutoGroupingReconciliation;
        completedResult = await reconcileFn({
          uid: currentUid,
          scopeKey: currentScopeKey,
          animeDocuments: docs,
          services,
        });
      } catch (error) {
        console.warn("[useAutoGrouping] reconciliation error:", error?.message ?? error);
      } finally {
        runningIdentitiesRef.current.delete(reconciliationIdentity);
        if (mountedRef.current && activeIdentityRef.current === reconciliationIdentity) {
          setStatus((current) => ({
            identityKey: reconciliationIdentity,
            isReconciling: false,
            lastResult: completedResult || (
              current.identityKey === reconciliationIdentity ? current.lastResult : null
            ),
          }));
        }
      }
    },
    [services],
  );

  useEffect(() => {
    // Prerequisites: feature gate, auth, scope, and data loaded.
    if (!isAutoReconcileEnabled(uid) || !uid || !scopeKey || isLoading) {
      // Account/scope changes and sign-out invalidate pending work immediately.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      lastFingerprintRef.current = null;
      return;
    }

    // Compute fingerprint using only relation/groupId/exclusion fields
    // (not the full anime object to avoid false positives).
    const fingerprint = `${identityKey}|${buildStateFingerprint(animeDocuments, [])}`;

    if (fingerprint === lastFingerprintRef.current) return;
    lastFingerprintRef.current = fingerprint;

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const capturedDocs = animeDocuments;
    const capturedUid = uid;
    const capturedScopeKey = scopeKey;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (mountedRef.current && activeIdentityRef.current === identityKey) {
        void doReconcile(capturedDocs, capturedUid, capturedScopeKey);
      }
    }, DEBOUNCE_MS);
  });

  /** Manually trigger a reconciliation pass (e.g. from "Organize Library" button). */
  const triggerReconcile = useCallback(async (options = {}) => {
    if (!isAutoReconcileEnabled(uid) || !uid || !scopeKey || isLoading) return;
    const requestedIdentity = `${uid}\u0000${scopeKey}`;
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
    if (activeIdentityRef.current !== requestedIdentity) return;
    void doReconcile(docs, uid, scopeKey);
  }, [animeDocuments, doReconcile, isLoading, scopeKey, services, uid]);

  return {
    isReconciling: status.identityKey === identityKey && status.isReconciling,
    lastResult: status.identityKey === identityKey ? status.lastResult : null,
    triggerReconcile,
  };
}

export default useAutoGrouping;
