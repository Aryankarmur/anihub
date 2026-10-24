import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/firebase/groupingServiceAdapter", () => ({
  defaultAnimeGroupingServices: {
    subscribeToGroupMetadata: () => {
      throw new Error("Production grouping services must not initialize in search tests.");
    },
  },
}));

vi.mock("../src/firebase/firebaseConfig", () => ({
  isIsolatedFirebasePreview: false,
  isIsolatedFirestoreEmulator: false,
}));

import CompletedSection from "../src/component/CompletedSection";
import CustomCollectionSection from "../src/component/CustomCollectionSection";
import WatchlistSection from "../src/component/WatchlistSection";
import {
  collectionSearchScope,
  useLibrarySearchQueries,
} from "../src/hooks/useLibrarySearchQueries";
import {
  animeMatchesLibrarySearch,
  createLibrarySearchView,
  normalizeLibrarySearchQuery,
} from "../src/utils/librarySearch";

const anime = [
  { animeId: "1", title: "Fullmetal Alchemist", image: "one.jpg", type: "TV", groupId: "g1" },
  { animeId: "2", title: "Fullmetal Alchemist: Brotherhood", image: "two.jpg", type: "TV", groupId: "g1" },
  { animeId: "3", title: "Cowboy Bebop", image: "three.jpg", type: "TV" },
  { animeId: "4", title: "Perfect Blue", image: "four.jpg", type: "Movie" },
];

const group = {
  groupId: "g1",
  name: "Elric Saga",
  scopeKey: "watchlist",
  thumbnailAnimeId: "1",
  status: "active",
};

function makeServices() {
  const subscriptions = [];
  const services = {
    subscribeToGroupMetadata: vi.fn((uid, scopeKey, onGroups) => {
      const subscription = { uid, scopeKey, onGroups, unsubscribe: vi.fn() };
      subscriptions.push(subscription);
      return subscription.unsubscribe;
    }),
    createGroup: vi.fn(),
    addAnimeToGroup: vi.fn(),
    removeAnimeFromGroup: vi.fn(),
    renameGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
  };
  return { services, subscriptions };
}

function ControlledWatchlist({ groupingEnabled = false, fixture = null, onRemoveAnime = vi.fn() }) {
  const [query, setQuery] = useState("");
  return (
    <MemoryRouter>
      <WatchlistSection
        uid="user-1"
        animeDocuments={anime}
        isLoading={false}
        isMobile={false}
        showAll
        onToggleShowAll={vi.fn()}
        onRemoveAnime={onRemoveAnime}
        groupingEnabled={groupingEnabled}
        groupingServices={fixture?.services}
        searchQuery={query}
        onSearchQueryChange={setQuery}
      />
    </MemoryRouter>
  );
}

async function emitGroup(fixture, metadata = [group]) {
  await waitFor(() => expect(fixture.subscriptions).toHaveLength(1));
  act(() => fixture.subscriptions[0].onGroups(metadata));
}

describe("individual library search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes surrounding whitespace and case", () => {
    expect(normalizeLibrarySearchQuery("  CoWbOy  ")).toBe("cowboy");
    expect(animeMatchesLibrarySearch(anime[2], "  COWBOY ")).toBe(true);
  });

  it("matches both displayed English titles and fallback titles", () => {
    const localized = { title: "Shingeki no Kyojin", title_english: "Attack on Titan" };
    expect(animeMatchesLibrarySearch(localized, "attack")).toBe(true);
    expect(animeMatchesLibrarySearch(localized, "kyojin")).toBe(true);
  });

  it("filters Watchlist results immediately and case-insensitively", () => {
    render(<ControlledWatchlist />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Watchlist" }), {
      target: { value: "bEbOp" },
    });
    expect(screen.getByText("Cowboy Bebop")).toBeInTheDocument();
    expect(screen.queryByText("Perfect Blue")).not.toBeInTheDocument();
    expect(screen.getByText("1 result")).toBeInTheDocument();
  });

  it("shows a dedicated no-results state", () => {
    render(<ControlledWatchlist />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Watchlist" }), {
      target: { value: "no such anime" },
    });
    expect(screen.getByText(/No anime or groups match/)).toBeInTheDocument();
    expect(screen.queryByText("Cowboy Bebop")).not.toBeInTheDocument();
  });

  it("clear restores the complete Watchlist", () => {
    render(<ControlledWatchlist />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Watchlist" }), {
      target: { value: "perfect" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear Watchlist search" }));
    expect(screen.getByText("Cowboy Bebop")).toBeInTheDocument();
    expect(screen.getByText("Perfect Blue")).toBeInTheDocument();
  });

  it("a group-name match keeps the complete group available", () => {
    const view = createLibrarySearchView({ groups: [group], animeDocuments: anime, query: "elric" });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]).toMatchObject(group);
    expect(view.animeDocuments.map((entry) => entry.animeId)).toEqual(["1", "2"]);
    expect(view.resultCount).toBe(1);
  });

  it("a member-title match exposes its parent group and the matching member in detail", async () => {
    const fixture = makeServices();
    render(<ControlledWatchlist groupingEnabled fixture={fixture} />);
    await emitGroup(fixture);

    expect(screen.getByRole("button", { name: /organize library/i })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search Watchlist" }), {
      target: { value: "brotherhood" },
    });
    expect(screen.getByTestId("group-card-g1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open elric saga group/i }));
    expect(screen.getByText("Fullmetal Alchemist: Brotherhood")).toBeInTheDocument();
    expect(screen.queryByText("Fullmetal Alchemist", { exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to collection/i }));
    expect(screen.getByTestId("group-card-g1")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search Watchlist" })).toHaveValue("brotherhood");
  });

  it("search works when grouping is disabled", () => {
    render(<ControlledWatchlist groupingEnabled={false} />);
    expect(screen.queryByRole("button", { name: /organize library/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Watchlist" }), {
      target: { value: "fullmetal" },
    });
    expect(screen.getAllByText(/Fullmetal Alchemist/)).toHaveLength(2);
    expect(screen.queryByText("Cowboy Bebop")).not.toBeInTheDocument();
  });

  it("filters the system Completed location independently", () => {
    const CompletedHarness = () => {
      const [query, setQuery] = useState("");
      return (
        <MemoryRouter>
          <CompletedSection
            uid="user-1"
            animeDocuments={anime}
            onRemoveAnime={vi.fn()}
            groupingEnabled={false}
            searchQuery={query}
            onSearchQueryChange={setQuery}
          />
        </MemoryRouter>
      );
    };
    render(<CompletedHarness />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Completed" }), {
      target: { value: "perfect" },
    });
    expect(screen.getByText("Perfect Blue")).toBeInTheDocument();
    expect(screen.queryByText("Cowboy Bebop")).not.toBeInTheDocument();
  });

  it("preserves a separate query for every custom Collection when switching", () => {
    const CollectionHarness = () => {
      const [collectionId, setCollectionId] = useState("favorites");
      const { getSearchQuery, setSearchQuery } = useLibrarySearchQueries();
      const scopeKey = collectionSearchScope(collectionId);
      const documents = collectionId === "favorites" ? anime : [
        { animeId: "5", title: "Monster", image: "monster.jpg", type: "TV" },
        { animeId: "6", title: "Pluto", image: "pluto.jpg", type: "TV" },
      ];
      return (
        <MemoryRouter>
          <button type="button" onClick={() => setCollectionId("favorites")}>Favorites</button>
          <button type="button" onClick={() => setCollectionId("plan")}>Plan</button>
          <CustomCollectionSection
            uid="user-1"
            collectionId={collectionId}
            animeDocuments={documents}
            onRemoveAnime={vi.fn()}
            groupingEnabled={false}
            searchQuery={getSearchQuery(scopeKey)}
            onSearchQueryChange={(query) => setSearchQuery(scopeKey, query)}
            searchLabel={collectionId}
          />
        </MemoryRouter>
      );
    };

    render(<CollectionHarness />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search favorites" }), {
      target: { value: "bebop" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByRole("searchbox", { name: "Search plan" })).toHaveValue("");
    expect(screen.getByText("Monster")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search plan" }), {
      target: { value: "pluto" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    expect(screen.getByRole("searchbox", { name: "Search favorites" })).toHaveValue("bebop");
    expect(screen.getByText("Cowboy Bebop")).toBeInTheDocument();
  });

  it("keeps Watchlist, Completed, and Collection query state isolated", () => {
    const { result } = renderHook(() => useLibrarySearchQueries());
    act(() => {
      result.current.setSearchQuery("watchlist", "cowboy");
      result.current.setSearchQuery("completed", "perfect");
      result.current.setSearchQuery(collectionSearchScope("favorites"), "fullmetal");
    });
    expect(result.current.getSearchQuery("watchlist")).toBe("cowboy");
    expect(result.current.getSearchQuery("completed")).toBe("perfect");
    expect(result.current.getSearchQuery(collectionSearchScope("favorites"))).toBe("fullmetal");
    expect(result.current.getSearchQuery(collectionSearchScope("other"))).toBe("");
  });

  it("does not subscribe again, mutate grouping state, remove anime, or fetch while typing", async () => {
    const fixture = makeServices();
    const onRemoveAnime = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ControlledWatchlist groupingEnabled fixture={fixture} onRemoveAnime={onRemoveAnime} />);
    await emitGroup(fixture);
    const subscriptionCalls = fixture.services.subscribeToGroupMetadata.mock.calls.length;

    fireEvent.change(screen.getByRole("searchbox", { name: "Search Watchlist" }), {
      target: { value: "elric" },
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Watchlist" }), {
      target: { value: "brotherhood" },
    });

    expect(fixture.services.subscribeToGroupMetadata).toHaveBeenCalledTimes(subscriptionCalls);
    expect(fixture.services.createGroup).not.toHaveBeenCalled();
    expect(fixture.services.addAnimeToGroup).not.toHaveBeenCalled();
    expect(fixture.services.removeAnimeFromGroup).not.toHaveBeenCalled();
    expect(fixture.services.renameGroup).not.toHaveBeenCalled();
    expect(fixture.services.updateGroup).not.toHaveBeenCalled();
    expect(fixture.services.deleteGroup).not.toHaveBeenCalled();
    expect(onRemoveAnime).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
