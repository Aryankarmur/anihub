import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/firebase/groupingServiceAdapter", () => ({
  defaultAnimeGroupingServices: {
    subscribeToGroupMetadata: () => {
      throw new Error("Production grouping services must not initialize in Collection tests.");
    },
  },
}));

import CustomCollectionSection from "../src/component/CustomCollectionSection";
import { executeCollectionDeletionPlan } from "../src/firebase/collectionDeletionUtils";

const favoritesAnime = [
  { animeId: "1", title: "One", image: "one.jpg", type: "TV", groupId: "fav-group" },
  { animeId: "2", title: "Two", image: "two.jpg", type: "TV", groupId: "fav-group" },
  { animeId: "3", title: "Three", image: "three.jpg", type: "Movie" },
  { animeId: "4", title: "Four", image: "four.jpg", type: "OVA" },
];
const favoritesGroup = {
  groupId: "fav-group",
  name: "Shared Name",
  scopeKey: "collection:favorites",
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

function renderCollection(options = {}) {
  const fixture = makeServices(options.serviceOverrides);
  const onRemoveAnime = options.onRemoveAnime || vi.fn();
  let currentProps = {
    uid: "user-1",
    collectionId: "favorites",
    animeDocuments: favoritesAnime,
    isLoading: false,
    onRemoveAnime,
    groupingEnabled: true,
    groupingServices: fixture.services,
    ...options.props,
  };
  const renderTree = () => (
    <MemoryRouter>
      <CustomCollectionSection {...currentProps} />
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

async function emit(fixture, groups = [favoritesGroup], index = 0) {
  await waitFor(() => expect(fixture.subscriptions.length).toBeGreaterThan(index));
  act(() => fixture.subscriptions[index].onGroups(groups));
}

async function submitCreate(fixture, name = "New Group") {
  fireEvent.click(screen.getByRole("button", { name: /create group/i }));
  const dialog = screen.getByRole("dialog", { name: /create group/i });
  fireEvent.change(within(dialog).getByLabelText("Group name"), { target: { value: name } });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /three/i }));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /four/i }));
  fireEvent.click(within(dialog).getByRole("button", { name: /create group/i }));
  await waitFor(() => expect(fixture.services.createGroup).toHaveBeenCalled());
}

describe("Custom Collection grouping integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a Collection with no groups as standalone anime", async () => {
    const fixture = renderCollection({
      props: { animeDocuments: favoritesAnime.map((anime) => ({ ...anime, groupId: undefined })) },
    });
    await emit(fixture, []);
    expect(screen.getAllByTestId(/^anime-card-/)).toHaveLength(4);
  });

  it("renders one valid group with two members", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    expect(screen.getByTestId("group-card-fav-group")).toBeInTheDocument();
    expect(screen.queryByTestId("anime-card-1")).not.toBeInTheDocument();
  });

  it("renders multiple groups inside one Collection", async () => {
    const anime = favoritesAnime.map((item) => ["3", "4"].includes(item.animeId)
      ? { ...item, groupId: "second" }
      : item);
    const fixture = renderCollection({ props: { animeDocuments: anime } });
    await emit(fixture, [favoritesGroup, {
      ...favoritesGroup,
      groupId: "second",
      name: "Second",
      thumbnailAnimeId: "3",
    }]);
    expect(screen.getAllByTestId(/^group-card-/)).toHaveLength(2);
  });

  it("renders groups before standalone Collection anime", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    const items = document.querySelector(".library-group-grid").children;
    expect(items[0]).toHaveAttribute("data-testid", "group-card-fav-group");
    expect(items[1]).toHaveAttribute("data-testid", "anime-card-3");
  });

  it("supports the same anime ID in two different Collections", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    fixture.rerenderProps({
      collectionId: "plan",
      animeDocuments: [
        { animeId: "1", title: "One in Plan", image: "plan-one.jpg", type: "TV" },
        { animeId: "5", title: "Five", image: "five.jpg", type: "TV" },
      ],
    });
    await emit(fixture, [], 1);
    expect(screen.getByRole("link", { name: /one in plan image/i })).toHaveAttribute("href", "/anime/1");
    expect(fixture.subscriptions.map((item) => item.scopeKey)).toEqual([
      "collection:favorites",
      "collection:plan",
    ]);
  });

  it("keeps membership independent when switching Collections", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    fixture.rerenderProps({
      collectionId: "plan",
      animeDocuments: favoritesAnime.map((item) => ({ ...item, groupId: undefined })),
    });
    await emit(fixture, [], 1);
    expect(screen.queryByTestId("group-card-fav-group")).not.toBeInTheDocument();
    expect(screen.getByTestId("anime-card-1")).toBeInTheDocument();
  });

  it("allows identical group names in different Collection scopes", async () => {
    const anime = favoritesAnime.map((item) => ({ ...item, groupId: undefined }));
    const fixture = renderCollection({ props: { animeDocuments: anime } });
    await emit(fixture, []);
    await submitCreate(fixture, "Same Name");
    fixture.rerenderProps({ collectionId: "plan", animeDocuments: anime });
    await emit(fixture, [], 1);
    await submitCreate(fixture, "Same Name");
    expect(fixture.services.createGroup.mock.calls.map((call) => call[1].scopeKey)).toEqual([
      "collection:favorites",
      "collection:plan",
    ]);
  });

  it("shows duplicate-name rejection within one Collection", async () => {
    const duplicate = Object.assign(new Error("duplicate"), { code: "grouping/duplicate-name" });
    const fixture = renderCollection({
      props: { animeDocuments: favoritesAnime.map((item) => ({ ...item, groupId: undefined })) },
      serviceOverrides: { createGroup: vi.fn().mockRejectedValue(duplicate) },
    });
    await emit(fixture, []);
    await submitCreate(fixture, "Duplicate");
    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
    expect(screen.getByRole("dialog", { name: /create group/i })).toBeInTheDocument();
  });

  it("creates a group with the canonical Collection document-ID scope", async () => {
    const fixture = renderCollection({
      props: { animeDocuments: favoritesAnime.map((item) => ({ ...item, groupId: undefined })) },
    });
    await emit(fixture, []);
    await submitCreate(fixture, "Created");
    expect(fixture.services.createGroup).toHaveBeenCalledWith("user-1", {
      name: "Created",
      scopeKey: "collection:favorites",
      animeIds: ["3", "4"],
      thumbnailAnimeId: "3",
    });
  });

  it("edits Collection group membership through the existing diff", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /edit shared name group/i }));
    const dialog = screen.getByRole("dialog", { name: /edit group/i });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /three/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fixture.services.addAnimeToGroup).toHaveBeenCalledWith(
      "user-1",
      "fav-group",
      ["3"],
    ));
  });

  it("renames a group only through the scoped group service", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /edit shared name group/i }));
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fixture.services.renameGroup).toHaveBeenCalledWith(
      "user-1",
      "fav-group",
      "Renamed",
    ));
  });

  it("changes the thumbnail using a member of the current Collection", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /edit shared name group/i }));
    fireEvent.click(screen.getByRole("radio", { name: /use two as group thumbnail/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fixture.services.updateGroup).toHaveBeenCalledWith(
      "user-1",
      "fav-group",
      { thumbnailAnimeId: "2" },
    ));
  });

  it("removes only group membership from Collection detail", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /open shared name group/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove one from shared name/i }));
    await waitFor(() => expect(fixture.services.removeAnimeFromGroup).toHaveBeenCalledWith(
      "user-1",
      "fav-group",
      ["1"],
    ));
    expect(fixture.onRemoveAnime).not.toHaveBeenCalled();
  });

  it("handles singleton dissolution and preserves Collection anime", async () => {
    const fixture = renderCollection({
      serviceOverrides: {
        removeAnimeFromGroup: vi.fn().mockResolvedValue({ data: { dissolved: true }, error: null }),
      },
    });
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /open shared name group/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove one from shared name/i }));
    await waitFor(() => expect(fixture.services.removeAnimeFromGroup).toHaveBeenCalled());
    act(() => fixture.subscriptions[0].onGroups([]));
    fixture.rerenderProps({
      animeDocuments: favoritesAnime.map((item) => ({ ...item, groupId: undefined })),
    });
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(fixture.onRemoveAnime).not.toHaveBeenCalled();
  });

  it("deletes a group without removing Collection anime", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /delete shared name group/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete group$/i }));
    await waitFor(() => expect(fixture.services.deleteGroup).toHaveBeenCalledWith("user-1", "fav-group"));
    expect(fixture.onRemoveAnime).not.toHaveBeenCalled();
  });

  it("retries interrupted group deletion", async () => {
    const partial = Object.assign(new Error("interrupted"), {
      code: "unavailable",
      details: { operation: "delete-group", clearedCount: 1, retryable: true },
    });
    const deletion = vi.fn().mockRejectedValueOnce(partial).mockResolvedValue({ data: {}, error: null });
    const fixture = renderCollection({ serviceOverrides: { deleteGroup: deletion } });
    await emit(fixture);
    fireEvent.click(screen.getByRole("button", { name: /delete shared name group/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete group$/i }));
    await waitFor(() => screen.getByRole("button", { name: /retry operation/i }));
    fireEvent.click(screen.getByRole("button", { name: /retry operation/i }));
    await waitFor(() => expect(deletion).toHaveBeenCalledTimes(2));
  });

  it("ignores stale callbacks during rapid Collection switching", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    fixture.rerenderProps({
      collectionId: "plan",
      animeDocuments: [
        { animeId: "5", title: "Five", groupId: "plan-group" },
        { animeId: "6", title: "Six", groupId: "plan-group" },
      ],
    });
    await waitFor(() => expect(fixture.subscriptions).toHaveLength(2));
    act(() => fixture.subscriptions[0].onGroups([favoritesGroup]));
    act(() => fixture.subscriptions[1].onGroups([{
      ...favoritesGroup,
      groupId: "plan-group",
      name: "Plan Group",
      scopeKey: "collection:plan",
      thumbnailAnimeId: "5",
    }]));
    expect(screen.queryByTestId("group-card-fav-group")).not.toBeInTheDocument();
    expect(screen.getByTestId("group-card-plan-group")).toBeInTheDocument();
    expect(fixture.subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("falls back to standalone anime when metadata subscription fails", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    act(() => fixture.subscriptions[0].onError(Object.assign(new Error("denied"), { code: "permission-denied" })));
    expect(screen.getByRole("alert")).toHaveTextContent(/every collection anime is still shown/i);
    expect(screen.getAllByTestId(/^anime-card-/)).toHaveLength(4);
  });

  it("unsubscribes and disables grouping on authentication loss", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    fixture.rerenderProps({ uid: null });
    expect(fixture.subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /create group/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("preserves existing Collection card navigation and removal", () => {
    const onRemoveAnime = vi.fn();
    renderCollection({ props: { groupingEnabled: false }, onRemoveAnime });
    expect(screen.getByRole("link", { name: /one image/i })).toHaveAttribute("href", "/anime/1");
    fireEvent.click(screen.getByRole("button", { name: /remove one from collection/i }));
    expect(onRemoveAnime).toHaveBeenCalledWith(expect.anything(), "1");
  });

  it("preserves the actual anime-document count when cards are grouped", async () => {
    const fixture = renderCollection();
    await emit(fixture);
    expect(document.querySelector(".custom-collection-content")).toHaveAttribute(
      "data-collection-anime-count",
      "4",
    );
    expect(document.querySelector(".library-group-grid")).toHaveAttribute("data-total-items", "3");
  });

  it("keeps custom Collection grouping disabled by default", () => {
    const fixture = renderCollection({ props: { groupingEnabled: undefined } });
    expect(fixture.services.subscribeToGroupMetadata).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /create group/i })).not.toBeInTheDocument();
    expect(document.querySelector(".custom-collection-content")).toHaveAttribute(
      "data-grouping-enabled",
      "false",
    );
  });

  it("does not initialize production grouping services", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const fixture = renderCollection({ props: { groupingEnabled: false } });
    expect(fixture.services.subscribeToGroupMetadata).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps invalid and singleton references visible as standalone anime", async () => {
    const anime = favoritesAnime.map((item) => {
      if (item.animeId === "3") return { ...item, groupId: "missing" };
      if (item.animeId === "4") return { ...item, groupId: "singleton" };
      return item;
    });
    const fixture = renderCollection({ props: { animeDocuments: anime } });
    await emit(fixture, [favoritesGroup, {
      ...favoritesGroup,
      groupId: "singleton",
      name: "Singleton",
      thumbnailAnimeId: "4",
    }]);
    expect(screen.getByTestId("anime-card-3")).toBeInTheDocument();
    expect(screen.getByTestId("anime-card-4")).toBeInTheDocument();
    expect(screen.queryByTestId("group-card-singleton")).not.toBeInTheDocument();
  });

  it("executes safe Collection cleanup in groups-items-parent order", async () => {
    const order = [];
    const result = await executeCollectionDeletionPlan({
      beginCollectionDeletion: async () => { order.push("mark-deleting"); },
      loadGroupIds: async () => {
        order.push("load-groups");
        return ["g1", "g2"];
      },
      loadItemChunks: async () => {
        order.push("load-items");
        return [["a", "b"], ["c"]];
      },
      deleteGroupById: async (groupId) => { order.push(`group:${groupId}`); },
      deleteItemChunk: async (chunk) => { order.push(`items:${chunk.join(",")}`); },
      deleteCollectionDocument: async () => { order.push("collection"); },
    });
    expect(order).toEqual([
      "mark-deleting",
      "load-groups",
      "load-items",
      "group:g1",
      "group:g2",
      "items:a,b",
      "items:c",
      "collection",
    ]);
    expect(result.data).toEqual({
      deletedGroupIds: ["g1", "g2"],
      deletedItemCount: 3,
      collectionDeleted: true,
    });
  });

  it("never deletes Collection metadata after interrupted cleanup", async () => {
    const deleteCollectionDocument = vi.fn();
    const failure = new Error("item chunk failed");
    await expect(executeCollectionDeletionPlan({
      beginCollectionDeletion: vi.fn().mockResolvedValue(undefined),
      loadGroupIds: vi.fn().mockResolvedValue(["g1"]),
      loadItemChunks: vi.fn().mockResolvedValue([["a"], ["b"]]),
      deleteGroupById: vi.fn().mockResolvedValue(undefined),
      deleteItemChunk: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure),
      deleteCollectionDocument,
    })).rejects.toMatchObject({
      details: {
        operation: "delete-collection",
        deletedGroupIds: ["g1"],
        deletedItemCount: 1,
        deletionPrepared: true,
        collectionDeleted: false,
        retryable: true,
      },
    });
    expect(deleteCollectionDocument).not.toHaveBeenCalled();
  });

  it("does not clean up anything when the deletion marker is denied", async () => {
    const deleteGroupById = vi.fn();
    const deleteItemChunk = vi.fn();
    const deleteCollectionDocument = vi.fn();
    await expect(executeCollectionDeletionPlan({
      beginCollectionDeletion: vi.fn().mockRejectedValue(new Error("permission denied")),
      loadGroupIds: vi.fn().mockResolvedValue(["g1"]),
      loadItemChunks: vi.fn().mockResolvedValue([["a"]]),
      deleteGroupById,
      deleteItemChunk,
      deleteCollectionDocument,
    })).rejects.toMatchObject({
      details: {
        deletionPrepared: false,
        collectionDeleted: false,
        retryable: true,
      },
    });
    expect(deleteGroupById).not.toHaveBeenCalled();
    expect(deleteItemChunk).not.toHaveBeenCalled();
    expect(deleteCollectionDocument).not.toHaveBeenCalled();
  });
});
