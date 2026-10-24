import assert from "node:assert/strict";
import test from "node:test";

import {
  ANILIST_RELATIONS_MAX_COUNT,
  normalizeAniListId,
  normalizeAniListRelations,
  relationFieldForWrite,
  selectAutomaticGroupingRelations,
} from "../src/firebase/anilistRelations.js";

test("AniList IDs and relation entries normalize to a bounded canonical schema", () => {
  assert.equal(normalizeAniListId(" 123 "), "123");
  assert.deepEqual(normalizeAniListRelations([
    { relatedId: 456, relationType: "sequel" }
  ]), [{ relatedId: "456", relationType: "SEQUEL" }]);
  assert.deepEqual(relationFieldForWrite({}), {});
  assert.deepEqual(relationFieldForWrite({ anilistRelations: [] }), {});
});

test("invalid, duplicate, and oversized relationship input is rejected", () => {
  const invalidValues = [
    "not-a-list",
    [{ relatedId: "01", relationType: "SEQUEL" }],
    [{ relatedId: "1", relationType: "OTHER" }],
    [{ relatedId: "1", relationType: "SEQUEL", extra: true }],
    [
      { relatedId: "1", relationType: "SEQUEL" },
      { relatedId: "1", relationType: "PREQUEL" }
    ],
    Array.from({ length: ANILIST_RELATIONS_MAX_COUNT + 1 }, (_, index) => ({
      relatedId: String(index + 1), relationType: "SEQUEL"
    }))
  ];
  invalidValues.forEach((value) => assert.throws(
    () => normalizeAniListRelations(value),
    (error) => error.code === "anime/invalid-anilist-relations"
  ));
});

test("external AniList edges are filtered, de-duplicated, and capped", () => {
  const selected = selectAutomaticGroupingRelations([
    { relatedId: "2", relationType: "SEQUEL" },
    { relatedId: "2", relationType: "PREQUEL" },
    { relatedId: "3", relationType: "SIDE_STORY" },
    ...Array.from({ length: 12 }, (_, index) => ({
      relatedId: String(index + 10), relationType: "PREQUEL"
    }))
  ]);
  assert.equal(selected.length, ANILIST_RELATIONS_MAX_COUNT);
  assert.equal(selected.filter((relation) => relation.relatedId === "2").length, 1);
  assert.equal(selected.some((relation) => relation.relatedId === "3"), false);
});
