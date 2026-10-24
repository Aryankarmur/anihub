import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/firebase/groupingServiceAdapter", () => ({
  defaultAnimeGroupingServices: {
    subscribeToGroupMetadata: () => {
      throw new Error("A grouping service adapter must be injected in controller tests.");
    },
  },
}));

import { useAnimeGrouping } from "../src/hooks/useAnimeGrouping";

const anime = [
  { animeId: "1", title: "One", groupId: "g1" },
  { animeId: "2", title: "Two", groupId: "g1" },
  { animeId: "3", title: "Three" },
  { animeId: "4", title: "Four" },
  { animeId: "5", title: "Five", groupId: "other" },
];
const group = {
  groupId: "g1",
  name: "Original",
  scopeKey: "watchlist",
  thumbnailAnimeId: "1",
  status: "active",
};
const values = { name: "New group", animeIds: ["3", "4"], thumbnailAnimeId: "3" };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeServices(overrides = {}) {
  const subscriptions = [];
  const services = {
    subscribeToGroupMetadata: vi.fn((uid, scopeKey, onGroups, onError) => {
      const subscription = { uid, scopeKey, onGroups, onError, unsubscribe: vi.fn() };
      subscriptions.push(subscription);
      return subscription.unsubscribe;
    }),
    createGroup: vi.fn().mockResolvedValue({ id: "created", data: { groupId: "created" }, error: null }),
    addAnimeToGroup: vi.fn().mockResolvedValue({ data: { assignedCount: 1 }, error: null }),
    removeAnimeFromGroup: vi.fn().mockResolvedValue({ data: { dissolved: false }, error: null }),
    renameGroup: vi.fn().mockResolvedValue({ error: null }),
    updateGroup: vi.fn().mockResolvedValue({ error: null }),
    deleteGroup: vi.fn().mockResolvedValue({ data: { clearedCount: 2 }, error: null }),
    ...overrides,
  };
  return { services, subscriptions };
}

function setup(options = {}) {
  const fixture = makeServices(options.serviceOverrides);
  const props = {
    uid: "user-1",
    scopeKey: "watchlist",
    animeDocuments: anime,
    services: fixture.services,
    ...options.props,
  };
  const hook = renderHook((input) => useAnimeGrouping(input), { initialProps: props });
  return { ...fixture, ...hook, props };
}

async function emit(fixture, groups = [group], index = 0) {
  await waitFor(() => expect(fixture.subscriptions.length).toBeGreaterThan(index));
  act(() => fixture.subscriptions[index].onGroups(groups));
}

async function openCreateAndSave(fixture, nextValues = values) {
  act(() => fixture.result.current.actions.openCreateGroup());
  let output;
  await act(async () => {
    output = await fixture.result.current.actions.saveManagement(nextValues);
  });
  return output;
}

async function openEditAndSave(fixture, nextValues) {
  await emit(fixture);
  act(() => fixture.result.current.actions.openEditGroup(group));
  let output;
  await act(async () => {
    output = await fixture.result.current.actions.saveManagement(nextValues);
  });
  return output;
}

describe("useAnimeGrouping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses one metadata subscription and derives visible groups locally", async () => {
    const fixture = setup();
    await emit(fixture, [group, { ...group, groupId: "empty", name: "Empty" }]);
    expect(fixture.services.subscribeToGroupMetadata).toHaveBeenCalledTimes(1);
    expect(fixture.result.current.visibleGroups.map((item) => item.groupId)).toEqual(["g1"]);
    expect(fixture.result.current.standaloneAnime.map((item) => item.animeId)).toEqual(["3", "4", "5"]);
  });

  it("unsubscribes and resubscribes when scope changes", async () => {
    const fixture = setup();
    await emit(fixture);
    fixture.rerender({ ...fixture.props, scopeKey: "completed" });
    await waitFor(() => expect(fixture.subscriptions).toHaveLength(2));
    expect(fixture.subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(fixture.subscriptions[1].scopeKey).toBe("completed");
    expect(fixture.result.current.groups).toEqual([]);
  });

  it("ignores a stale subscription callback after rapid scope switching", async () => {
    const fixture = setup();
    await emit(fixture);
    fixture.rerender({ ...fixture.props, scopeKey: "completed" });
    await waitFor(() => expect(fixture.subscriptions).toHaveLength(2));
    act(() => fixture.subscriptions[0].onGroups([{ ...group, groupId: "stale" }]));
    expect(fixture.result.current.groups).toEqual([]);
    act(() => fixture.subscriptions[1].onGroups([{ ...group, groupId: "fresh", scopeKey: "completed" }]));
    expect(fixture.result.current.groups[0].groupId).toBe("fresh");
  });

  it("cleans up and exposes no stale state when authentication is lost", async () => {
    const fixture = setup();
    await emit(fixture);
    fixture.rerender({ ...fixture.props, uid: null });
    expect(fixture.subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(fixture.result.current.groups).toEqual([]);
    const response = await fixture.result.current.actions.createGroup(values);
    expect(response.error.code).toBe("auth/required");
  });

  it("rejects an unsupported scope without opening a listener", () => {
    const fixture = setup({ props: { scopeKey: "up-next" } });
    expect(fixture.services.subscribeToGroupMetadata).not.toHaveBeenCalled();
    expect(fixture.result.current.error.code).toBe("grouping/unsupported-scope");
  });

  it("creates a group with the exact Phase A service contract", async () => {
    const fixture = setup();
    const response = await openCreateAndSave(fixture);
    expect(response).toEqual({ ok: true, groupId: "created" });
    expect(fixture.services.createGroup).toHaveBeenCalledWith("user-1", {
      name: "New group",
      scopeKey: "watchlist",
      animeIds: ["3", "4"],
      thumbnailAnimeId: "3",
    });
    expect(fixture.result.current.management.isOpen).toBe(false);
  });

  it("prevents empty and singleton group creation before calling services", async () => {
    const fixture = setup();
    const response = await fixture.result.current.actions.createGroup({ name: "No", animeIds: ["3"] });
    expect(response.error.code).toBe("grouping/minimum-members");
    expect(fixture.services.createGroup).not.toHaveBeenCalled();
  });

  it("rejects selections assigned to another group", async () => {
    const fixture = setup();
    const response = await fixture.result.current.actions.createGroup({
      name: "Conflict",
      animeIds: ["3", "5"],
    });
    expect(response.error.code).toBe("grouping/anime-already-grouped");
    expect(fixture.services.createGroup).not.toHaveBeenCalled();
  });

  it("resumes a partial create without creating a duplicate group", async () => {
    const partial = Object.assign(new Error("interrupted"), {
      code: "unavailable",
      details: { operation: "create-group", groupId: "partial", assignedCount: 2, retryable: true },
    });
    const fixture = setup({ serviceOverrides: { createGroup: vi.fn().mockRejectedValueOnce(partial) } });
    const first = await openCreateAndSave(fixture);
    expect(first.ok).toBe(false);
    expect(fixture.result.current.retryableOperation.payload.groupId).toBe("partial");
    fixture.rerender({
      ...fixture.props,
      animeDocuments: anime.map((item) => ["3", "4"].includes(item.animeId)
        ? { ...item, groupId: "partial" }
        : item),
    });
    let retry;
    await act(async () => { retry = await fixture.result.current.actions.retryLastOperation(); });
    expect(retry.ok).toBe(true);
    expect(fixture.services.createGroup).toHaveBeenCalledTimes(1);
    expect(fixture.services.addAnimeToGroup).toHaveBeenCalledWith("user-1", "partial", ["3", "4"]);
    expect(fixture.services.updateGroup).toHaveBeenCalledWith("user-1", "partial", { thumbnailAnimeId: "3" });
  });

  it("maps unique-name conflicts and keeps the create modal open", async () => {
    const duplicate = Object.assign(new Error("reservation exists"), { code: "grouping/duplicate-name" });
    const fixture = setup({ serviceOverrides: { createGroup: vi.fn().mockRejectedValue(duplicate) } });
    await openCreateAndSave(fixture);
    expect(fixture.result.current.error.message).toMatch(/already exists/i);
    expect(fixture.result.current.management.isOpen).toBe(true);
    expect(fixture.result.current.debugError).toBe("reservation exists");
  });

  it("adds replacement members before removing old members", async () => {
    const order = [];
    const fixture = setup({
      serviceOverrides: {
        addAnimeToGroup: vi.fn(async () => { order.push("add"); return { error: null }; }),
        removeAnimeFromGroup: vi.fn(async () => { order.push("remove"); return { data: { dissolved: false }, error: null }; }),
      },
    });
    await openEditAndSave(fixture, {
      name: "Original",
      animeIds: ["2", "3"],
      thumbnailAnimeId: "2",
    });
    expect(order).toEqual(["add", "remove"]);
    expect(fixture.services.addAnimeToGroup).toHaveBeenCalledWith("user-1", "g1", ["3"]);
    expect(fixture.services.removeAnimeFromGroup).toHaveBeenCalledWith("user-1", "g1", ["1"]);
  });

  it("applies rename and thumbnail changes through their dedicated services", async () => {
    const fixture = setup();
    await openEditAndSave(fixture, {
      name: "Renamed",
      animeIds: ["1", "2"],
      thumbnailAnimeId: "2",
    });
    expect(fixture.services.renameGroup).toHaveBeenCalledWith("user-1", "g1", "Renamed");
    expect(fixture.services.updateGroup).toHaveBeenCalledWith("user-1", "g1", { thumbnailAnimeId: "2" });
    expect(fixture.services.addAnimeToGroup).not.toHaveBeenCalled();
    expect(fixture.services.removeAnimeFromGroup).not.toHaveBeenCalled();
  });

  it("detects membership changes made after the edit modal opened", async () => {
    const fixture = setup();
    await emit(fixture);
    act(() => fixture.result.current.actions.openEditGroup(group));
    fixture.rerender({
      ...fixture.props,
      animeDocuments: anime.map((item) => item.animeId === "2" ? { ...item, groupId: undefined } : item),
    });
    let response;
    await act(async () => {
      response = await fixture.result.current.actions.saveManagement({
        name: "Original",
        animeIds: ["1", "2"],
        thumbnailAnimeId: "1",
      });
    });
    expect(response.error.code).toBe("grouping/membership-changed");
    expect(fixture.services.addAnimeToGroup).not.toHaveBeenCalled();
  });

  it("retries a partially completed edit idempotently", async () => {
    const partial = Object.assign(new Error("offline"), {
      code: "unavailable",
      details: { operation: "add-members", processedCount: 0, retryable: true },
    });
    const add = vi.fn().mockRejectedValueOnce(partial).mockResolvedValue({ error: null });
    const fixture = setup({ serviceOverrides: { addAnimeToGroup: add } });
    await openEditAndSave(fixture, {
      name: "Original",
      animeIds: ["1", "2", "3"],
      thumbnailAnimeId: "1",
    });
    expect(fixture.result.current.retryableOperation.progress.stage).toBe("add-members");
    let response;
    await act(async () => { response = await fixture.result.current.actions.retryLastOperation(); });
    expect(response.ok).toBe(true);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("removes a member without invoking group deletion", async () => {
    const fixture = setup();
    await emit(fixture);
    act(() => fixture.result.current.actions.openGroup(group));
    let response;
    await act(async () => { response = await fixture.result.current.actions.removeMember("1"); });
    expect(response).toEqual({ ok: true, dissolved: false });
    expect(fixture.services.removeAnimeFromGroup).toHaveBeenCalledWith("user-1", "g1", ["1"]);
    expect(fixture.services.deleteGroup).not.toHaveBeenCalled();
  });

  it("marks an opened group unavailable after singleton dissolution", async () => {
    const fixture = setup({
      serviceOverrides: {
        removeAnimeFromGroup: vi.fn().mockResolvedValue({ data: { dissolved: true }, error: null }),
      },
    });
    await emit(fixture);
    act(() => fixture.result.current.actions.openGroup(group));
    await act(async () => { await fixture.result.current.actions.removeMember("1"); });
    expect(fixture.result.current.selectedGroup.status).toBe("active");
    act(() => fixture.subscriptions[0].onGroups([]));
    expect(fixture.result.current.selectedGroup.status).toBe("missing");
  });

  it("retries interrupted member removal against the original group", async () => {
    const partial = Object.assign(new Error("interrupted"), {
      code: "unavailable",
      details: { operation: "remove-members", removedCount: 0, retryable: true },
    });
    const removal = vi.fn().mockRejectedValueOnce(partial).mockResolvedValue({
      data: { dissolved: false },
      error: null,
    });
    const fixture = setup({ serviceOverrides: { removeAnimeFromGroup: removal } });
    await emit(fixture);
    act(() => fixture.result.current.actions.openGroup(group));
    await act(async () => { await fixture.result.current.actions.removeMember("1"); });
    act(() => fixture.result.current.actions.closeGroup());
    await act(async () => { await fixture.result.current.actions.retryLastOperation(); });
    expect(removal).toHaveBeenNthCalledWith(2, "user-1", "g1", ["1"]);
  });

  it("requires explicit confirmation before deleting a group", async () => {
    const fixture = setup();
    await emit(fixture);
    act(() => fixture.result.current.actions.requestDeleteGroup(group));
    expect(fixture.result.current.deletion.isOpen).toBe(true);
    expect(fixture.services.deleteGroup).not.toHaveBeenCalled();
    await act(async () => { await fixture.result.current.actions.confirmDeleteGroup(); });
    expect(fixture.services.deleteGroup).toHaveBeenCalledWith("user-1", "g1");
    expect(fixture.result.current.deletion.isOpen).toBe(false);
  });

  it("retries interrupted deletion and preserves its confirmation target", async () => {
    const partial = Object.assign(new Error("interrupted"), {
      code: "unavailable",
      details: { operation: "delete-group", clearedCount: 1, retryable: true },
    });
    const deletion = vi.fn().mockRejectedValueOnce(partial).mockResolvedValue({ data: { clearedCount: 2 }, error: null });
    const fixture = setup({ serviceOverrides: { deleteGroup: deletion } });
    await emit(fixture);
    act(() => fixture.result.current.actions.requestDeleteGroup(group));
    await act(async () => { await fixture.result.current.actions.confirmDeleteGroup(); });
    expect(fixture.result.current.deletion.group.groupId).toBe("g1");
    expect(fixture.result.current.retryableOperation.progress.clearedCount).toBe(1);
    await act(async () => { await fixture.result.current.actions.retryLastOperation(); });
    expect(deletion).toHaveBeenCalledTimes(2);
    expect(fixture.result.current.deletion.isOpen).toBe(false);
  });

  it("never passes anime documents to group deletion", async () => {
    const fixture = setup();
    await emit(fixture);
    act(() => fixture.result.current.actions.requestDeleteGroup(group));
    await act(async () => { await fixture.result.current.actions.confirmDeleteGroup(); });
    expect(fixture.services.deleteGroup.mock.calls[0]).toEqual(["user-1", "g1"]);
    expect(anime).toHaveLength(5);
  });

  it("prevents duplicate submissions while a mutation is pending", async () => {
    const pending = deferred();
    const createGroup = vi.fn(() => pending.promise);
    const fixture = setup({ serviceOverrides: { createGroup } });
    let first;
    let second;
    act(() => {
      first = fixture.result.current.actions.createGroup(values);
      second = fixture.result.current.actions.createGroup(values);
    });
    await act(async () => { second = await second; });
    expect(second.error.code).toBe("grouping/operation-in-progress");
    expect(createGroup).toHaveBeenCalledTimes(1);
    pending.resolve({ id: "created", error: null });
    await act(async () => { await first; });
  });

  it("ignores a mutation completion from a previous scope", async () => {
    const pending = deferred();
    const fixture = setup({ serviceOverrides: { createGroup: vi.fn(() => pending.promise) } });
    let creation;
    act(() => { creation = fixture.result.current.actions.createGroup(values); });
    fixture.rerender({ ...fixture.props, scopeKey: "completed" });
    pending.resolve({ id: "old-scope", error: null });
    await act(async () => { await creation; });
    expect(fixture.result.current.groups).toEqual([]);
    expect(fixture.result.current.management.isOpen).toBe(false);
    expect(fixture.result.current.error).toBeNull();
  });

  it("renders an opened group as unavailable after metadata disappears", async () => {
    const fixture = setup();
    await emit(fixture);
    act(() => fixture.result.current.actions.openGroup(group));
    act(() => fixture.subscriptions[0].onGroups([]));
    expect(fixture.result.current.selectedGroup).toMatchObject({ groupId: "g1", status: "missing" });
    expect(fixture.result.current.groupDetailProps.group.status).toBe("missing");
  });

  it("maps Firestore permission failures to a user-safe message", async () => {
    const denied = Object.assign(new Error("raw firebase denial"), { code: "permission-denied" });
    const fixture = setup({ serviceOverrides: { createGroup: vi.fn().mockRejectedValue(denied) } });
    await act(async () => { await fixture.result.current.actions.createGroup(values); });
    expect(fixture.result.current.error.message).toMatch(/permission/i);
    expect(fixture.result.current.debugError).toBe("raw firebase denial");
  });

  it("maps network failures and preserves retry progress", async () => {
    const unavailable = Object.assign(new Error("transport down"), {
      code: "firestore/unavailable",
      details: { retryable: true, groupId: "partial" },
    });
    const fixture = setup({ serviceOverrides: { createGroup: vi.fn().mockRejectedValue(unavailable) } });
    await act(async () => { await fixture.result.current.actions.createGroup(values); });
    expect(fixture.result.current.error.message).toMatch(/temporarily unavailable/i);
    expect(fixture.result.current.retryableOperation.progress.retryable).toBe(true);
  });

  it("exposes callback bundles matching all Phase B component contracts", async () => {
    const fixture = setup();
    await emit(fixture);
    expect(fixture.result.current.libraryGridProps).toMatchObject({
      groups: [group],
      animeDocuments: anime,
    });
    expect(fixture.result.current.groupDetailProps.onBack).toBeTypeOf("function");
    expect(fixture.result.current.managementModalProps.onSaveGroup).toBeTypeOf("function");
    expect(fixture.result.current.deleteDialogProps.onClose).toBeTypeOf("function");
    act(() => fixture.result.current.actions.openGroup(group));
    await act(async () => {
      await fixture.result.current.groupDetailProps.onRemoveMember(anime[0], group);
    });
    expect(fixture.services.removeAnimeFromGroup).toHaveBeenCalledWith("user-1", "g1", ["1"]);
  });

  it("does not initialize production services or perform network requests in tests", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const fixture = setup();
    expect(fixture.services.subscribeToGroupMetadata).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
