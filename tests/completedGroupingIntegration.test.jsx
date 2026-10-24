import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/firebase/groupingServiceAdapter", () => ({
  defaultAnimeGroupingServices: {
    subscribeToGroupMetadata: () => {
      throw new Error("Production grouping services must not initialize in Completed tests.");
    },
  },
}));

import CompletedSection from "../src/component/CompletedSection";

const completedAnime = [
  { animeId: "1", title: "One", image: "one.jpg", type: "TV", groupId: "completed-group", _migratedFromLegacy: true },
  { animeId: "2", title: "Two", image: "two.jpg", type: "TV", groupId: "completed-group" },
  { animeId: "3", title: "Three", image: "three.jpg", type: "Movie" },
  { animeId: "4", title: "Four", image: "four.jpg", type: "OVA" },
];
const completedGroup = {
  groupId: "completed-group",
  name: "Completed Series",
  scopeKey: "completed",
  thumbnailAnimeId: "1",
  status: "active",
};
const withoutGroup = (anime) => {
  const copy = { ...anime };
  delete copy.groupId;
  return copy;
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

function renderCompleted(options = {}) {
  const fixture = makeServices(options.serviceOverrides);
  const onRemoveAnime = options.onRemoveAnime || vi.fn();
  let props = {
    uid: "user-1",
    animeDocuments: completedAnime,
    isLoading: false,
    onRemoveAnime,
    groupingEnabled: true,
    groupingServices: fixture.services,
    ...options.props,
  };
  const tree = () => <MemoryRouter><CompletedSection {...props} /></MemoryRouter>;
  const view = render(tree());
  return {
    ...fixture,
    ...view,
    onRemoveAnime,
    rerenderProps(next) {
      props = { ...props, ...next };
      view.rerender(tree());
    },
  };
}

async function emit(fixture, groups = [completedGroup]) {
  await waitFor(() => expect(fixture.subscriptions).toHaveLength(1));
  act(() => fixture.subscriptions[0].onGroups(groups));
}

describe("System Completed grouping integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders Completed with no groups as standalone anime", async () => {
    const fixture = renderCompleted({
      props: { animeDocuments: completedAnime.map(withoutGroup) },
    });
    await emit(fixture, []);
    expect(screen.getAllByTestId(/^anime-card-/)).toHaveLength(4);
  });

  it("renders one valid Completed group", async () => {
    const fixture = renderCompleted();
    await emit(fixture);
    expect(screen.getByTestId("group-card-completed-group")).toBeInTheDocument();
    expect(screen.queryByTestId("anime-card-1")).not.toBeInTheDocument();
  });

  it("renders multiple Completed groups", async () => {
    const animeDocuments = completedAnime.map((anime) => ["3", "4"].includes(anime.animeId)
      ? { ...anime, groupId: "second" }
      : anime);
    const fixture = renderCompleted({ props: { animeDocuments } });
    await emit(fixture, [completedGroup, {
      ...completedGroup,
      groupId: "second",
      name: "Second",
      thumbnailAnimeId: "3",
    }]);
    expect(screen.getAllByTestId(/^group-card-/)).toHaveLength(2);
  });

  it("renders groups before standalone Completed anime", async () => {
    const fixture = renderCompleted();
    await emit(fixture);
    const items = document.querySelector(".library-group-grid").children;
    expect(items[0]).toHaveAttribute("data-testid", "group-card-completed-group");
    expect(items[1]).toHaveAttribute("data-testid", "anime-card-3");
  });

  it("creates a Completed group with two members and canonical scope", async () => {
    const animeDocuments = completedAnime.map(withoutGroup);
    const fixture = renderCompleted({ props: { animeDocuments } });
    await emit(fixture, []);
    fireEvent.click(screen.getByRole("button", { name: /create group/i }));
    const dialog = screen.getByRole("dialog", { name: /create group/i });
    fireEvent.change(within(dialog).getByLabelText("Group name"), { target: { value: "New" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /one/i }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /two/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /create group/i }));
    await waitFor(() => expect(fixture.services.createGroup).toHaveBeenCalledWith("user-1", {
      name: "New",
      scopeKey: "completed",
      animeIds: ["1", "2"],
      thumbnailAnimeId: "1",
    }));
  });

  it("rejects Completed group creation with only one member", async () => {
    const animeDocuments = completedAnime.map(withoutGroup);
    const fixture = renderCompleted({ props: { animeDocuments } });
    await emit(fixture, []);
    fireEvent.click(screen.getByRole("button", { name: /create group/i }));
    const dialog = screen.getByRole("dialog", { name: /create group/i });
    fireEvent.change(within(dialog).getByLabelText("Group name"), { target: { value: "One" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /one/i }));
    expect(within(dialog).getByRole("button", { name: /create group/i })).toBeDisabled();
    expect(fixture.services.createGroup).not.toHaveBeenCalled();
  });

  it("renames a Completed group", async () => {
    const fixture = renderCompleted();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /edit completed series group/i }));
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fixture.services.renameGroup).toHaveBeenCalledWith(
      "user-1", "completed-group", "Renamed",
    ));
  });

  it("changes a Completed group thumbnail", async () => {
    const fixture = renderCompleted();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /edit completed series group/i }));
    fireEvent.click(screen.getByRole("radio", { name: /use two as group thumbnail/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fixture.services.updateGroup).toHaveBeenCalledWith(
      "user-1", "completed-group", { thumbnailAnimeId: "2" },
    ));
  });

  it("adds a Completed member through safe membership diffing", async () => {
    const fixture = renderCompleted();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /edit completed series group/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /three/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fixture.services.addAnimeToGroup).toHaveBeenCalledWith(
      "user-1", "completed-group", ["3"],
    ));
  });

  it("removes only group membership from Completed detail", async () => {
    const fixture = renderCompleted();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /open completed series group/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove one from completed series/i }));
    await waitFor(() => expect(fixture.services.removeAnimeFromGroup).toHaveBeenCalledWith(
      "user-1", "completed-group", ["1"],
    ));
    expect(fixture.onRemoveAnime).not.toHaveBeenCalled();
  });

  it("dissolves a singleton without removing Completed anime", async () => {
    const fixture = renderCompleted({
      serviceOverrides: {
        removeAnimeFromGroup: vi.fn().mockResolvedValue({ data: { dissolved: true }, error: null }),
      },
    });
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /open completed series group/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove one from completed series/i }));
    await waitFor(() => expect(fixture.services.removeAnimeFromGroup).toHaveBeenCalled());
    expect(fixture.onRemoveAnime).not.toHaveBeenCalled();
  });

  it("deletes a group without deleting Completed anime", async () => {
    const fixture = renderCompleted();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /delete completed series group/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete group$/i }));
    await waitFor(() => expect(fixture.services.deleteGroup).toHaveBeenCalledWith(
      "user-1", "completed-group",
    ));
    expect(fixture.onRemoveAnime).not.toHaveBeenCalled();
  });

  it("retries interrupted Completed group deletion", async () => {
    const partial = Object.assign(new Error("interrupted"), {
      code: "unavailable",
      details: { operation: "delete-group", clearedCount: 1, retryable: true },
    });
    const deletion = vi.fn().mockRejectedValueOnce(partial).mockResolvedValue({ data: {}, error: null });
    const fixture = renderCompleted({ serviceOverrides: { deleteGroup: deletion } });
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /delete completed series group/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete group$/i }));
    await waitFor(() => screen.getByRole("button", { name: /retry operation/i }));
    fireEvent.click(screen.getByRole("button", { name: /retry operation/i }));
    await waitFor(() => expect(deletion).toHaveBeenCalledTimes(2));
  });

  it("falls back to standalone anime after metadata subscription failure", async () => {
    const fixture = renderCompleted();
    await emit(fixture);
    act(() => fixture.subscriptions[0].onError(Object.assign(new Error("denied"), {
      code: "permission-denied",
    })));
    expect(screen.getByRole("alert")).toHaveTextContent(/every completed anime is still shown/i);
    expect(screen.getAllByTestId(/^anime-card-/)).toHaveLength(4);
  });

  it("unsubscribes and disables grouping on authentication loss", async () => {
    const fixture = renderCompleted();
    await emit(fixture);
    fixture.rerenderProps({ uid: null });
    expect(fixture.subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /create group/i })).not.toBeInTheDocument();
  });

  it("keeps Completed grouping disabled by default with no production service", () => {
    const fixture = renderCompleted({ props: { groupingEnabled: undefined } });
    expect(fixture.services.subscribeToGroupMetadata).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /create group/i })).not.toBeInTheDocument();
    expect(document.querySelector(".completed-collection-content")).toHaveAttribute(
      "data-grouping-enabled", "false",
    );
  });

  it("preserves Completed document counts and migrated metadata", async () => {
    const fixture = renderCompleted();
    await emit(fixture);
    expect(document.querySelector(".completed-collection-content")).toHaveAttribute(
      "data-completed-anime-count", "4",
    );
    expect(completedAnime[0]._migratedFromLegacy).toBe(true);
  });

  it("keeps orphan and singleton references visible as standalone anime", async () => {
    const animeDocuments = completedAnime.map((anime) => {
      if (anime.animeId === "3") return { ...anime, groupId: "missing" };
      if (anime.animeId === "4") return { ...anime, groupId: "singleton" };
      return anime;
    });
    const fixture = renderCompleted({ props: { animeDocuments } });
    await emit(fixture, [completedGroup, {
      ...completedGroup,
      groupId: "singleton",
      name: "Singleton",
      thumbnailAnimeId: "4",
    }]);
    expect(screen.getByTestId("anime-card-3")).toBeInTheDocument();
    expect(screen.getByTestId("anime-card-4")).toBeInTheDocument();
  });
});
