import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/firebase/firestore.js", () => ({
  createGroup: vi.fn(),
  addAnimeToGroup: vi.fn(),
  removeAnimeFromGroup: vi.fn(),
  deleteGroup: vi.fn(),
  subscribeToGroupMetadata: vi.fn(),
}));

import { useUpNextSuggestions } from "../src/features/upNext/useUpNextSuggestions";

const source = {
  animeId: "1",
  title: "First",
  anilistRelations: [{ relatedId: "2", relationType: "SEQUEL" }],
};
const suggestion = { animeId: "2", title: "Second", anilistRelations: [] };
const newSuggestion = { animeId: "3", title: "Third", anilistRelations: [] };

describe("useUpNextSuggestions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves suggestions from current Watchlist and Completed snapshots", async () => {
    const resolver = vi.fn().mockResolvedValue([suggestion]);
    const { result } = renderHook(() => useUpNextSuggestions({
      watchlist: [source],
      completed: [],
      resolver,
    }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.suggestions).toEqual([suggestion]);
    expect(resolver).toHaveBeenCalledWith({ watchlist: [source], completed: [] });
  });

  it("updates when a source disappears", async () => {
    const resolver = vi.fn(({ watchlist }) => Promise.resolve(watchlist.length ? [suggestion] : []));
    const { result, rerender } = renderHook(
      ({ watchlist }) => useUpNextSuggestions({ watchlist, completed: [], resolver }),
      { initialProps: { watchlist: [source] } },
    );
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    rerender({ watchlist: [] });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.suggestions).toEqual([]));
  });

  it("drops an already-saved suggestion after the subscription snapshot changes", async () => {
    const resolver = vi.fn(({ watchlist }) => Promise.resolve(
      watchlist.some((anime) => anime.animeId === "2") ? [] : [suggestion]
    ));
    const { result, rerender } = renderHook(
      ({ watchlist }) => useUpNextSuggestions({ watchlist, completed: [], resolver }),
      { initialProps: { watchlist: [source] } },
    );
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    rerender({ watchlist: [source, suggestion] });
    await waitFor(() => expect(result.current.suggestions).toEqual([]));
  });

  it("fails gracefully when AniList is unavailable", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("AniList HTTP 429"));
    const { result } = renderHook(() => useUpNextSuggestions({ resolver }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.error).toBe("AniList HTTP 429");
  });

  it("keeps verified partial suggestions and exposes an incomplete warning", async () => {
    const resolver = vi.fn().mockResolvedValue({
      suggestions: [suggestion],
      incomplete: true,
      warning: "More sequels may be unavailable.",
    });
    const { result } = renderHook(() => useUpNextSuggestions({ resolver }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.suggestions).toEqual([suggestion]);
    expect(result.current.incomplete).toBe(true);
    expect(result.current.error).toMatch(/more sequels/i);
  });

  it("does not resolve repeatedly for a stable source snapshot", async () => {
    const watchlist = [source];
    const completed = [];
    const resolver = vi.fn().mockResolvedValue([suggestion]);
    const { result, rerender } = renderHook(() => useUpNextSuggestions({
      watchlist,
      completed,
      resolver,
    }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => rerender());
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("forces a new discovery pass and updates suggestions without a browser refresh", async () => {
    const resolver = vi.fn((options) => Promise.resolve(options.forceRefresh
      ? { suggestions: [suggestion, newSuggestion], incomplete: false }
      : [suggestion]));
    const { result } = renderHook(() => useUpNextSuggestions({
      watchlist: [source],
      resolver,
    }));
    await waitFor(() => expect(result.current.suggestions).toEqual([suggestion]));

    await act(() => result.current.discoverSequels());

    expect(resolver).toHaveBeenLastCalledWith({
      watchlist: [source],
      completed: [],
      forceRefresh: true,
    });
    expect(result.current.suggestions).toEqual([suggestion, newSuggestion]);
    expect(result.current.discoveryMessage).toMatch(/new sequel information/i);
  });

  it("reports already up to date when forced discovery does not change results", async () => {
    const resolver = vi.fn().mockResolvedValue([suggestion]);
    const { result } = renderHook(() => useUpNextSuggestions({ resolver }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => result.current.discoverSequels());
    expect(result.current.discoveryMessage).toBe("Already up to date.");
  });

  it("preserves existing suggestions when forced discovery fails", async () => {
    const resolver = vi.fn((options) => options.forceRefresh
      ? Promise.reject(new Error("AniList HTTP 429"))
      : Promise.resolve([suggestion]));
    const { result } = renderHook(() => useUpNextSuggestions({ resolver }));
    await waitFor(() => expect(result.current.suggestions).toEqual([suggestion]));
    await act(() => result.current.discoverSequels());
    expect(result.current.suggestions).toEqual([suggestion]);
    expect(result.current.discoveryError).toBe("AniList HTTP 429");
  });

  it("deduplicates repeated manual discovery calls while one is running", async () => {
    let finishRefresh;
    const resolver = vi.fn((options) => options.forceRefresh
      ? new Promise((resolve) => { finishRefresh = resolve; })
      : Promise.resolve([suggestion]));
    const { result } = renderHook(() => useUpNextSuggestions({ resolver }));
    await waitFor(() => expect(result.current.suggestions).toEqual([suggestion]));

    let firstPromise;
    let secondPromise;
    act(() => {
      firstPromise = result.current.discoverSequels();
      secondPromise = result.current.discoverSequels();
    });
    expect(firstPromise).toBe(secondPromise);
    expect(result.current.isDiscovering).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(2);
    await act(async () => finishRefresh([suggestion]));
    await waitFor(() => expect(result.current.isDiscovering).toBe(false));
  });
});
