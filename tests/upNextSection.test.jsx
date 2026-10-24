import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/firebase/groupingServiceAdapter", () => ({
  defaultAnimeGroupingServices: {},
}));

import LibrarySearch from "../src/component/LibrarySearch";
import UpNextSection from "../src/features/upNext/UpNextSection";
import { useLibrarySearchQueries } from "../src/hooks/useLibrarySearchQueries";

const suggestions = [
  {
    animeId: "2",
    title: "Saga Two",
    image: "two.jpg",
    type: "TV",
    anilistRelations: [{ relatedId: "3", relationType: "SEQUEL" }],
    upNextSources: [{ animeId: "1", title: "Saga One", scope: "watchlist" }],
  },
  {
    animeId: "3",
    title: "Saga Three",
    image: "three.jpg",
    type: "TV",
    anilistRelations: [{ relatedId: "2", relationType: "PREQUEL" }],
    upNextSources: [{ animeId: "8", title: "Another Source", scope: "completed" }],
  },
  {
    animeId: "9",
    title: "Standalone Sequel",
    image: "nine.jpg",
    type: "MOVIE",
    status: "NOT_YET_RELEASED",
    anilistRelations: [],
    upNextSources: [{ animeId: "7", title: "Standalone Original", scope: "watchlist" }],
  },
];

const Harness = ({
  initialSuggestions = suggestions,
  error = "",
  isLoading = false,
  add = vi.fn().mockResolvedValue(undefined),
  complete = vi.fn().mockResolvedValue(undefined),
  discover = vi.fn(),
  isDiscovering = false,
  discoveryMessage = "",
  discoveryError = "",
}) => {
  const [query, setQuery] = useState("");
  return (
    <MemoryRouter>
      <UpNextSection
        suggestions={initialSuggestions}
        isLoading={isLoading}
        error={error}
        searchQuery={query}
        onSearchQueryChange={setQuery}
        onAddToWatchlist={add}
        onMarkCompleted={complete}
        onDiscoverSequels={discover}
        isDiscovering={isDiscovering}
        discoveryMessage={discoveryMessage}
        discoveryError={discoveryError}
      />
    </MemoryRouter>
  );
};

describe("Up Next system Collection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders an automatic empty state without saved sources", () => {
    render(<Harness initialSuggestions={[]} />);
    expect(screen.getByRole("searchbox", { name: "Search Up Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discover Sequels" })).toBeInTheDocument();
    expect(screen.getByText(/No sequel suggestions are ready yet/i)).toBeInTheDocument();
  });

  it("starts manual discovery from the toolbar", () => {
    const discover = vi.fn();
    render(<Harness discover={discover} />);
    fireEvent.click(screen.getByRole("button", { name: "Discover Sequels" }));
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("shows discovery progress and prevents repeated clicks", () => {
    const discover = vi.fn();
    render(<Harness discover={discover} isDiscovering />);
    const button = screen.getByRole("button", { name: "Discovering..." });
    expect(button).toBeDisabled();
    expect(button.querySelector(".up-next-discover-spinner")).toBeInTheDocument();
    fireEvent.click(button);
    expect(discover).not.toHaveBeenCalled();
  });

  it("renders nonintrusive success and failure feedback", () => {
    const { rerender } = render(<Harness discoveryMessage="Already up to date." />);
    expect(screen.getByRole("status")).toHaveTextContent("Already up to date.");
    rerender(<Harness discoveryError="AniList HTTP 429" />);
    expect(screen.getByRole("alert")).toHaveTextContent("AniList HTTP 429");
    expect(screen.getByText("Standalone Sequel")).toBeInTheDocument();
  });

  it("shows loading skeletons without blocking the rest of the library", () => {
    const { container } = render(<Harness initialSuggestions={[]} isLoading />);
    expect(container.querySelectorAll(".skeleton-card")).toHaveLength(4);
  });

  it("shows a graceful AniList failure state", () => {
    render(<Harness initialSuggestions={[]} error="AniList request timed out." />);
    expect(screen.getByText(/could not be refreshed/i)).toBeInTheDocument();
    expect(screen.getByText(/Try again after AniList is reachable/i)).toBeInTheDocument();
  });

  it("places derived groups before standalone suggestions without manual controls", () => {
    render(<Harness />);
    const items = document.querySelector(".up-next-grid").children;
    expect(items[0]).toHaveAttribute("data-testid", expect.stringMatching(/^group-card-/));
    expect(items[1]).toHaveAttribute("data-testid", "anime-card-9");
    expect(screen.queryByRole("button", { name: /edit saga group/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete saga group/i })).not.toBeInTheDocument();
    expect(screen.getByText("not yet released")).toBeInTheDocument();
  });

  it("searches standalone suggestion titles and clears the filter", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Up Next" }), {
      target: { value: "  STANDALONE  " },
    });
    expect(screen.getByText("Standalone Sequel")).toBeInTheDocument();
    expect(screen.queryByTestId(/^group-card-/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear Up Next search" }));
    expect(screen.getByTestId(/^group-card-/)).toBeInTheDocument();
  });

  it("searches group names and keeps all members accessible", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Up Next" }), {
      target: { value: "saga" },
    });
    fireEvent.click(screen.getByRole("button", { name: /open saga group/i }));
    expect(screen.getByText("Saga Two")).toBeInTheDocument();
    expect(screen.getByText("Saga Three")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove .* from saga/i })).not.toBeInTheDocument();
  });

  it("searches member titles, opens the parent group, and returns to filtered results", () => {
    render(<Harness />);
    const search = screen.getByRole("searchbox", { name: "Search Up Next" });
    fireEvent.change(search, { target: { value: "three" } });
    fireEvent.click(screen.getByRole("button", { name: /open saga group/i }));
    expect(screen.getByText("Saga Three")).toBeInTheDocument();
    expect(screen.queryByText("Saga Two")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to up next/i }));
    expect(screen.getByTestId(/^group-card-/)).toBeInTheDocument();
    expect(search).toHaveValue("three");
  });

  it("keeps a suggestion until its Watchlist save succeeds", async () => {
    let resolveSave;
    const add = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    const ActionHarness = () => {
      const [items, setItems] = useState([suggestions[2]]);
      return (
        <Harness
          initialSuggestions={items}
          add={async (anime) => {
            await add(anime);
            setItems([]);
          }}
        />
      );
    };
    render(<ActionHarness />);
    fireEvent.click(screen.getByRole("button", { name: /add standalone sequel to watchlist/i }));
    expect(screen.getByText("Standalone Sequel")).toBeInTheDocument();
    resolveSave();
    await waitFor(() => expect(screen.queryByText("Standalone Sequel")).not.toBeInTheDocument());
  });

  it("marks a suggestion Completed and leaves failures visible for retry", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("Permission denied"));
    render(<Harness initialSuggestions={[suggestions[2]]} complete={complete} />);
    fireEvent.click(screen.getByRole("button", { name: /mark standalone sequel completed/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied");
    expect(screen.getByText("Standalone Sequel")).toBeInTheDocument();
  });

  it("removes a suggestion after its Completed save succeeds", async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    const CompletedActionHarness = () => {
      const [items, setItems] = useState([suggestions[2]]);
      return (
        <Harness
          initialSuggestions={items}
          complete={async (anime) => {
            await complete(anime);
            setItems([]);
          }}
        />
      );
    };
    render(<CompletedActionHarness />);
    fireEvent.click(screen.getByRole("button", { name: /mark standalone sequel completed/i }));
    await waitFor(() => expect(screen.queryByText("Standalone Sequel")).not.toBeInTheDocument());
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("keeps Up Next search independent and typing causes no saves or API requests", () => {
    const add = vi.fn();
    const complete = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const SearchScopes = () => {
      const { getSearchQuery, setSearchQuery } = useLibrarySearchQueries();
      return (
        <MemoryRouter>
          <LibrarySearch
            query={getSearchQuery("watchlist")}
            onQueryChange={(query) => setSearchQuery("watchlist", query)}
            locationLabel="Watchlist"
          />
          <UpNextSection
            suggestions={suggestions}
            searchQuery={getSearchQuery("up-next")}
            onSearchQueryChange={(query) => setSearchQuery("up-next", query)}
            onAddToWatchlist={add}
            onMarkCompleted={complete}
          />
        </MemoryRouter>
      );
    };
    render(<SearchScopes />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Watchlist" }), {
      target: { value: "watch query" },
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Up Next" }), {
      target: { value: "standalone" },
    });
    expect(screen.getByRole("searchbox", { name: "Search Watchlist" })).toHaveValue("watch query");
    expect(screen.getByRole("searchbox", { name: "Search Up Next" })).toHaveValue("standalone");
    expect(add).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps search and group navigation while discovery expands a derived group", () => {
    const initial = suggestions.slice(0, 2).map((anime) => ({
      ...anime,
      upNextSeriesId: "1",
      upNextSeriesName: "Saga",
    }));
    const later = {
      animeId: "4",
      title: "Saga Four",
      image: "four.jpg",
      type: "TV",
      anilistRelations: [],
      upNextSeriesId: "1",
      upNextSeriesName: "Saga",
      upNextSources: initial[0].upNextSources,
    };
    const RefreshHarness = () => {
      const [items, setItems] = useState(initial);
      const [query, setQuery] = useState("saga");
      return (
        <MemoryRouter>
          <UpNextSection
            suggestions={items}
            searchQuery={query}
            onSearchQueryChange={setQuery}
            onDiscoverSequels={() => setItems([...initial, later])}
          />
        </MemoryRouter>
      );
    };
    render(<RefreshHarness />);
    fireEvent.click(screen.getByRole("button", { name: /open saga group/i }));
    expect(screen.getByText("2 anime")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discover Sequels" }));
    expect(screen.getByText("3 anime")).toBeInTheDocument();
    expect(screen.getByText("Saga Four")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search Up Next" })).toHaveValue("saga");
    fireEvent.click(screen.getByRole("button", { name: /back to up next/i }));
    expect(screen.getByTestId(/^group-card-/)).toBeInTheDocument();
  });

  it("uses a responsive toolbar container for mobile layout", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector(".up-next-toolbar")).toContainElement(
      screen.getByRole("button", { name: "Discover Sequels" }),
    );
  });
});
