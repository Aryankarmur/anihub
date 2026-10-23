import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/firebase/groupingServiceAdapter", () => ({
  defaultAnimeGroupingServices: {
    subscribeToGroupMetadata: () => {
      throw new Error("Production grouping services must not initialize in integration tests.");
    },
  },
}));

vi.mock("../src/firebase/firebaseConfig", () => ({
  isIsolatedFirebasePreview: false,
  isIsolatedFirestoreEmulator: false,
}));

import WatchlistSection from "../src/component/WatchlistSection";
import { evaluateWatchlistGroupingGate, isWatchlistGroupingEnabled } from "../src/firebase/groupingFeatureGate";

const savedAnime = [
  { id: "doc-1", animeId: "1", title: "One", image: "one.jpg", type: "TV", groupId: "g1" },
  { id: "doc-2", animeId: "2", title: "Two", image: "two.jpg", type: "TV", groupId: "g1" },
  { id: "doc-3", animeId: "3", title: "Three", image: "three.jpg", type: "Movie" },
  { id: "doc-4", animeId: "4", title: "Four", image: "four.jpg", type: "OVA" },
];

const group = {
  groupId: "g1",
  name: "Original",
  scopeKey: "watchlist",
  thumbnailAnimeId: "1",
  status: "active",
};

function makeServices(overrides = {}) {
  const subscriptions = [];
  const services = {
    subscribeToGroupMetadata: vi.fn((uid, scopeKey, onGroups, onError) => {
      const subscription = { uid, scopeKey, onGroups, onError, unsubscribe: vi.fn() };
      subscriptions.push(subscription);
      return subscription.unsubscribe;
    }),
    createGroup: vi.fn().mockResolvedValue({ id: "created", error: null }),
    addAnimeToGroup: vi.fn().mockResolvedValue({ data: { assignedCount: 1 }, error: null }),
    removeAnimeFromGroup: vi.fn().mockResolvedValue({ data: { dissolved: false }, error: null }),
    renameGroup: vi.fn().mockResolvedValue({ error: null }),
    updateGroup: vi.fn().mockResolvedValue({ error: null }),
    deleteGroup: vi.fn().mockResolvedValue({ data: { clearedCount: 2 }, error: null }),
    ...overrides,
  };
  return { services, subscriptions };
}

function renderSection(options = {}) {
  const fixture = makeServices(options.serviceOverrides);
  const onRemoveAnime = options.onRemoveAnime || vi.fn();
  let currentProps = {
    uid: "user-1",
    animeDocuments: savedAnime,
    isLoading: false,
    isMobile: false,
    showAll: false,
    onToggleShowAll: vi.fn(),
    onRemoveAnime,
    groupingEnabled: true,
    groupingServices: fixture.services,
    ...options.props,
  };
  const renderTree = () => (
    <MemoryRouter>
      <WatchlistSection {...currentProps} />
    </MemoryRouter>
  );
  const view = render(renderTree());
  return {
    ...fixture,
    ...view,
    onRemoveAnime,
    rerenderProps(next) {
      currentProps = { ...currentProps, ...next };
      view.rerender(renderTree());
    },
  };
}

async function emit(fixture, groups = [group], index = 0) {
  await waitFor(() => expect(fixture.subscriptions.length).toBeGreaterThan(index));
  act(() => fixture.subscriptions[index].onGroups(groups));
}

function manyAnime(count) {
  return Array.from({ length: count }, (_, index) => ({
    animeId: String(index + 1),
    title: `Anime ${index + 1}`,
    image: `${index + 1}.jpg`,
    type: "TV",
  }));
}

describe("Watchlist grouping integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a Watchlist with no groups as standalone anime", async () => {
    const fixture = renderSection();
    await emit(fixture, []);
    expect(screen.getAllByTestId(/^anime-card-/)).toHaveLength(4);
    expect(screen.queryByTestId(/^group-card-/)).not.toBeInTheDocument();
  });

  it("renders one valid two-member group as one display unit", async () => {
    const fixture = renderSection();
    await emit(fixture);
    expect(screen.getByTestId("group-card-g1")).toBeInTheDocument();
    expect(screen.queryByTestId("anime-card-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("anime-card-2")).not.toBeInTheDocument();
  });

  it("renders multiple groups independently", async () => {
    const anime = savedAnime.map((item) => ["3", "4"].includes(item.animeId)
      ? { ...item, groupId: "g2" }
      : item);
    const fixture = renderSection({ props: { animeDocuments: anime } });
    await emit(fixture, [group, { ...group, groupId: "g2", name: "Second", thumbnailAnimeId: "3" }]);
    expect(screen.getAllByTestId(/^group-card-/)).toHaveLength(2);
  });

  it("renders a group together with standalone anime", async () => {
    const fixture = renderSection();
    await emit(fixture);
    expect(screen.getByTestId("group-card-g1")).toBeInTheDocument();
    expect(screen.getByTestId("anime-card-3")).toBeInTheDocument();
    expect(screen.getByTestId("anime-card-4")).toBeInTheDocument();
  });

  it("keeps invalid group references visible as standalone anime", async () => {
    const anime = savedAnime.map((item) => item.animeId === "3" ? { ...item, groupId: "missing" } : item);
    const fixture = renderSection({ props: { animeDocuments: anime } });
    await emit(fixture);
    expect(screen.getByTestId("anime-card-3")).toBeInTheDocument();
  });

  it("hides singleton group cards and shows their anime standalone", async () => {
    const anime = savedAnime.map((item) => item.animeId === "3" ? { ...item, groupId: "single" } : item);
    const fixture = renderSection({ props: { animeDocuments: anime } });
    await emit(fixture, [group, { ...group, groupId: "single", name: "Singleton", thumbnailAnimeId: "3" }]);
    expect(screen.queryByTestId("group-card-single")).not.toBeInTheDocument();
    expect(screen.getByTestId("anime-card-3")).toBeInTheDocument();
  });

  it("orders every group before standalone anime", async () => {
    const fixture = renderSection();
    await emit(fixture);
    const items = document.querySelector(".library-group-grid").children;
    expect(items[0]).toHaveAttribute("data-testid", "group-card-g1");
    expect(items[1]).toHaveAttribute("data-testid", "anime-card-3");
  });

  it("applies mobile Show More limits to combined display units", async () => {
    const anime = manyAnime(9).map((item) => {
      if (["1", "2"].includes(item.animeId)) return { ...item, groupId: "g1" };
      if (["3", "4"].includes(item.animeId)) return { ...item, groupId: "g2" };
      return item;
    });
    const fixture = renderSection({ props: { animeDocuments: anime, isMobile: true } });
    await emit(fixture, [group, { ...group, groupId: "g2", name: "Second", thumbnailAnimeId: "3" }]);
    expect(document.querySelector(".library-group-grid").children).toHaveLength(6);
    expect(screen.getByRole("button", { name: /show more/i })).toBeInTheDocument();
  });

  it("opens inline group detail with every member regardless of the parent limit", async () => {
    const anime = manyAnime(9).map((item) => ["1", "2", "3"].includes(item.animeId)
      ? { ...item, groupId: "g1" }
      : item);
    const fixture = renderSection({ props: { animeDocuments: anime, isMobile: true } });
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /open original group/i }));
    expect(screen.getByRole("heading", { name: "Original" })).toBeInTheDocument();
    expect(document.querySelectorAll(".group-detail-member")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /show more/i })).not.toBeInTheDocument();
  });

  it("returns from inline group detail to the Watchlist grid", async () => {
    const fixture = renderSection();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /open original group/i }));
    fireEvent.click(screen.getByRole("button", { name: /back to collection/i }));
    expect(screen.getByTestId("group-card-g1")).toBeInTheDocument();
  });

  it("opens the existing Create Group modal", async () => {
    const fixture = renderSection();
    await emit(fixture, []);
    fireEvent.click(screen.getByRole("button", { name: /create group/i }));
    expect(screen.getByRole("dialog", { name: /create group/i })).toBeInTheDocument();
  });

  it("creates a group through the Watchlist controller and returns to the grid", async () => {
    const ungroupedAnime = savedAnime.map((item) => ({ ...item, groupId: undefined }));
    const fixture = renderSection({ props: { animeDocuments: ungroupedAnime } });
    await emit(fixture, []);
    fireEvent.click(screen.getByRole("button", { name: /create group/i }));
    const dialog = screen.getByRole("dialog", { name: /create group/i });
    fireEvent.change(within(dialog).getByLabelText("Group name"), {
      target: { value: "New Series" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /one/i }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /two/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /create group/i }));
    await waitFor(() => expect(fixture.services.createGroup).toHaveBeenCalledWith("user-1", {
      name: "New Series",
      scopeKey: "watchlist",
      animeIds: ["1", "2"],
      thumbnailAnimeId: "1",
    }));
    expect(screen.queryByRole("dialog", { name: /create group/i })).not.toBeInTheDocument();
    expect(document.querySelector(".library-group-grid")).toBeInTheDocument();
    expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
  });

  it("edits membership through the controller diff", async () => {
    const fixture = renderSection();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /edit original group/i }));
    const dialog = screen.getByRole("dialog", { name: /edit group/i });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /three/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fixture.services.addAnimeToGroup).toHaveBeenCalledWith("user-1", "g1", ["3"]));
  });

  it("connects rename and thumbnail changes", async () => {
    const fixture = renderSection();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /edit original group/i }));
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("radio", { name: /use two as group thumbnail/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fixture.services.renameGroup).toHaveBeenCalledWith("user-1", "g1", "Renamed"));
    expect(fixture.services.updateGroup).toHaveBeenCalledWith("user-1", "g1", { thumbnailAnimeId: "2" });
  });

  it("handles member removal and singleton dissolution without deleting anime", async () => {
    const fixture = renderSection({
      serviceOverrides: {
        removeAnimeFromGroup: vi.fn().mockResolvedValue({ data: { dissolved: true }, error: null }),
      },
    });
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /open original group/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove one from original/i }));
    await waitFor(() => expect(fixture.services.removeAnimeFromGroup).toHaveBeenCalledWith("user-1", "g1", ["1"]));
    act(() => fixture.subscriptions[0].onGroups([]));
    fixture.rerenderProps({ animeDocuments: savedAnime.map((item) => ({ ...item, groupId: undefined })) });
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(fixture.services.deleteGroup).not.toHaveBeenCalled();
    expect(fixture.onRemoveAnime).not.toHaveBeenCalled();
  });

  it("confirms deletion and exposes a retry after interruption", async () => {
    const partial = Object.assign(new Error("interrupted"), {
      code: "unavailable",
      details: { operation: "delete-group", clearedCount: 1, retryable: true },
    });
    const deletion = vi.fn().mockRejectedValueOnce(partial).mockResolvedValue({ data: { clearedCount: 2 }, error: null });
    const fixture = renderSection({ serviceOverrides: { deleteGroup: deletion } });
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /delete original group/i }));
    expect(deletion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^delete group$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /retry operation/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /retry operation/i }));
    await waitFor(() => expect(deletion).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fixture.onRemoveAnime).not.toHaveBeenCalled();
  });

  it("unsubscribes and falls back safely on authentication loss", async () => {
    const fixture = renderSection();
    await emit(fixture);
    fixture.rerenderProps({ uid: null });
    expect(fixture.subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /create group/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("shows every anime when the group subscription fails", async () => {
    const fixture = renderSection();
    await emit(fixture);
    act(() => fixture.subscriptions[0].onError(Object.assign(new Error("denied"), { code: "permission-denied" })));
    expect(screen.getByRole("alert")).toHaveTextContent(/every watchlist anime is still shown/i);
    expect(screen.getAllByTestId(/^anime-card-/)).toHaveLength(4);
    expect(screen.queryByTestId("group-card-g1")).not.toBeInTheDocument();
  });

  it("reacts to live membership updates from the existing Watchlist listener", async () => {
    const fixture = renderSection();
    await emit(fixture);
    fixture.rerenderProps({
      animeDocuments: savedAnime.map((item) => item.animeId === "2" ? { ...item, groupId: undefined } : item),
    });
    expect(screen.queryByTestId("group-card-g1")).not.toBeInTheDocument();
    expect(screen.getByTestId("anime-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("anime-card-2")).toBeInTheDocument();
  });

  it("does not duplicate grouped anime as standalone cards", async () => {
    const fixture = renderSection();
    await emit(fixture);
    expect(document.querySelectorAll('[data-testid="group-card-g1"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="anime-card-1"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="anime-card-2"]')).toHaveLength(0);
    expect(document.querySelector(".library-group-grid")).toHaveAttribute("data-total-items", "3");
  });

  it("preserves Watchlist navigation and removal behavior", () => {
    const onRemoveAnime = vi.fn();
    renderSection({ props: { groupingEnabled: false }, onRemoveAnime });
    expect(screen.getByRole("link", { name: /one image/i })).toHaveAttribute("href", "/anime/1");
    fireEvent.click(screen.getByRole("button", { name: /remove one from watchlist/i }));
    expect(onRemoveAnime).toHaveBeenCalledWith(expect.anything(), "1");
  });

  it("keeps the feature gate disabled by default", () => {
    const fixture = renderSection({ props: { groupingEnabled: undefined } });
    expect(fixture.services.subscribeToGroupMetadata).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /create group/i })).not.toBeInTheDocument();
    expect(isWatchlistGroupingEnabled).toBe(false);
  });

  it("requires both an explicit flag and isolated emulator for the gate", () => {
    expect(evaluateWatchlistGroupingGate({ featureRequested: true, isolatedEmulator: false })).toBe(false);
    expect(evaluateWatchlistGroupingGate({ featureRequested: false, isolatedEmulator: true })).toBe(false);
    expect(evaluateWatchlistGroupingGate({ featureRequested: true, isolatedEmulator: true })).toBe(true);
  });

  it("never initializes a production grouping connection during tests", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const fixture = renderSection({ props: { groupingEnabled: false } });
    expect(fixture.services.subscribeToGroupMetadata).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("preserves the desktop twelve-unit limit and Show More control", () => {
    const StatefulWatchlist = () => {
      const [showAll, setShowAll] = useState(false);
      return (
        <MemoryRouter>
          <WatchlistSection
            uid="user-1"
            animeDocuments={manyAnime(13)}
            showAll={showAll}
            onToggleShowAll={() => setShowAll((current) => !current)}
            onRemoveAnime={vi.fn()}
          />
        </MemoryRouter>
      );
    };
    render(<StatefulWatchlist />);
    expect(screen.getAllByRole("link")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(screen.getAllByRole("link")).toHaveLength(13);
    expect(screen.getByRole("button", { name: /show less/i })).toBeInTheDocument();
  });
});
