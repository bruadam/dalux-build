import assert from "node:assert/strict";
import { test } from "node:test";
import { rankItems, tokenize } from "../src/lib/rank";

const fields = (item: { name: string; folder?: string }) => [
  { text: item.name, weight: 3 },
  { text: item.folder, weight: 1 },
];

test("tokenize splits on non-alphanumerics and lowercases", () => {
  assert.deepEqual(tokenize("A-101 Plan_Æble"), ["a", "101", "plan", "æble"]);
});

test("every term must match some field", () => {
  const items = [{ name: "Plan A-101" }, { name: "Section A-102" }];
  assert.deepEqual(rankItems(items, "plan 101", fields), [{ name: "Plan A-101" }]);
});

test("name matches outrank folder matches, whole tokens outrank substrings", () => {
  const items = [
    { name: "Notes", folder: "Facade" },
    { name: "Facadeplan" },
    { name: "Facade elevation" },
  ];
  assert.deepEqual(
    rankItems(items, "facade", fields).map((i) => i.name),
    ["Facade elevation", "Facadeplan", "Notes"],
  );
});

test("rare terms weigh more than common ones", () => {
  const items = [{ name: "plan level 1" }, { name: "plan level 2" }, { name: "plan roof" }];
  assert.equal(rankItems(items, "plan roof", fields)[0].name, "plan roof");
});

test("empty query keeps order", () => {
  const items = [{ name: "b" }, { name: "a" }];
  assert.deepEqual(rankItems(items, "  ", fields), items);
});
