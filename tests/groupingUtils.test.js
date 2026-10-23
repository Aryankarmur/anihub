import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGroupMetadata,
  chunkGroupOperation,
  deriveVisibleGroups,
  getGroupNameReservationId,
  getMembershipOperationKey,
  isVisibleGroup,
  normalizeInitialGroupAnimeIds,
  partitionAnimeByVisibleGroups
} from "../src/firebase/groupingUtils.js";

test("group creation accepts two distinct saved-anime identifiers", () => {
  assert.deepEqual(normalizeInitialGroupAnimeIds(["1", 2]), ["1", "2"]);
});

test("group creation rejects one member or duplicate-only input", () => {
  for (const animeIds of [["1"], ["1", "1"]]) {
    assert.throws(
      () => normalizeInitialGroupAnimeIds(animeIds),
      (error) => error.code === "grouping/not-enough-members"
    );
  }
});

test("three members reduced to two still produce a visible group", () => {
  assert.equal(isVisibleGroup({ status: "active" }, 3), true);
  assert.equal(isVisibleGroup({ status: "active" }, 2), true);
});

test("scope-level anime data derives exact visible group counts", () => {
  const groups = [
    { groupId: "visible", status: "active" },
    { groupId: "singleton", status: "active" },
    { groupId: "deleting", status: "deleting" }
  ];
  const anime = [
    { animeId: "1", groupId: "visible" },
    { animeId: "2", groupId: "visible" },
    { animeId: "3", groupId: "singleton" },
    { animeId: "4", groupId: "deleting" }
  ];
  assert.deepEqual(deriveVisibleGroups(groups, anime), [
    { groupId: "visible", status: "active", memberCount: 2 }
  ]);
});

test("two members reduced to one no longer produce a group card", () => {
  assert.equal(isVisibleGroup({ status: "active" }, 1), false);
  assert.equal(isVisibleGroup({ status: "active" }, 0), false);
});

test("deleting groups are hidden while their anime remain standalone", () => {
  const anime = [{ animeId: "1", groupId: "g1" }, { animeId: "2", groupId: "g1" }];
  const partition = partitionAnimeByVisibleGroups(anime, []);
  assert.deepEqual(partition.standalone, anime);
  assert.equal(isVisibleGroup({ status: "deleting" }, 2), false);
});

test("missing and invalid group references never hide anime", () => {
  const anime = [
    { animeId: "1", groupId: "missing" },
    { animeId: "2", groupId: "singleton" },
    { animeId: "3" }
  ];
  const partition = partitionAnimeByVisibleGroups(anime, []);
  assert.deepEqual(partition.standalone.map((item) => item.animeId), ["1", "2", "3"]);
});

test("membership operation keys are stable by member set and isolate operations", async () => {
  const first = await getMembershipOperationKey("remove", "g1", ["2", "1"]);
  const reordered = await getMembershipOperationKey("remove", "g1", ["1", "2"]);
  const different = await getMembershipOperationKey("remove", "g1", ["1", "3"]);
  assert.equal(first, reordered);
  assert.notEqual(first, different);
});

test("name reservation keys enforce scope isolation and deterministic uniqueness", async () => {
  const watchlist = await getGroupNameReservationId("watchlist", "monogatari");
  const repeated = await getGroupNameReservationId("watchlist", "monogatari");
  const completed = await getGroupNameReservationId("completed", "monogatari");
  assert.equal(watchlist, repeated);
  assert.notEqual(watchlist, completed);
});

test("large operations have no member cap and split into retryable bounded chunks", () => {
  const animeIds = Array.from({ length: 1001 }, (_, index) => String(index + 1));
  assert.equal(normalizeInitialGroupAnimeIds(animeIds).length, 1001);
  const chunks = chunkGroupOperation(animeIds);
  assert.equal(chunks.length, 101);
  assert.deepEqual(chunks.map((chunk) => chunk.length).slice(-2), [10, 1]);
  assert.deepEqual(chunks.flat(), animeIds);
});

test("group metadata contains no duplicated membership list or count", () => {
  const metadata = buildGroupMetadata({
    name: "Monogatari",
    normalizedName: "monogatari",
    reservationId: "reservation",
    scopeKey: "watchlist",
    thumbnailAnimeId: "1",
    status: "active",
    createdAt: "created",
    updatedAt: "updated"
  });
  assert.deepEqual(Object.keys(metadata).sort(), [
    "collectionId",
    "createdAt",
    "name",
    "normalizedName",
    "reservationId",
    "scopeKey",
    "status",
    "thumbnailAnimeId",
    "updatedAt"
  ]);
  assert.equal("animeIds" in metadata, false);
  assert.equal("memberCount" in metadata, false);
});
