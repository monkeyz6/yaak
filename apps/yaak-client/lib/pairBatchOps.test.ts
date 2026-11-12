import { describe, expect, test } from "vitest";
import {
  findEmptyValueIds,
  isValueEmpty,
  rangeIds,
  removePairsById,
  restoreRemovedPairs,
} from "./pairBatchOps";

type Row = {
  id: string;
  name: string;
  value: string;
  enabled?: boolean;
  isFile?: boolean;
  commitName?: (name: string) => boolean;
};

function row(partial: Partial<Row> & Pick<Row, "id">): Row {
  return { name: partial.name ?? "", value: partial.value ?? "", ...partial };
}

describe("isValueEmpty", () => {
  test("treats whitespace-only values as empty, including disabled rows", () => {
    expect(isValueEmpty(row({ id: "a", value: "   ", enabled: false }))).toBe(true);
    expect(isValueEmpty(row({ id: "a", name: "", value: "" }))).toBe(true);
  });

  test("keeps template values", () => {
    expect(isValueEmpty(row({ id: "a", value: "${[ x ]}" }))).toBe(false);
    expect(isValueEmpty(row({ id: "a", value: "${[ secure(password='x') ]}" }))).toBe(false);
  });

  test("never treats a path placeholder or a file with a path as empty", () => {
    expect(isValueEmpty(row({ id: "a", value: "", commitName: () => true }))).toBe(false);
    expect(isValueEmpty(row({ id: "a", value: "/tmp/a.txt", isFile: true }))).toBe(false);
    expect(isValueEmpty(row({ id: "a", value: "  ", isFile: true }))).toBe(true);
  });
});

describe("findEmptyValueIds", () => {
  test("skips the trailing placeholder and keeps non-empty rows", () => {
    const pairs = [
      row({ id: "named-empty", name: "A", value: "" }),
      row({ id: "blank", name: "", value: "  " }),
      row({ id: "template", value: "${[ secure(password='x') ]}" }),
      row({ id: "placeholder", value: "" }),
    ];
    expect(findEmptyValueIds(pairs)).toEqual(["named-empty", "blank"]);
  });
});

describe("removePairsById", () => {
  test("keeps the trailing placeholder and records original indexes", () => {
    const pairs = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" }), row({ id: "ph" })];
    const result = removePairsById(pairs, new Set(["b", "ph", "missing"]), {
      keepLastPlaceholder: true,
    });
    expect(result.next.map((pair) => pair.id)).toEqual(["a", "c", "ph"]);
    expect(result.removed).toEqual([{ pair: pairs[1], index: 1 }]);
  });
});

describe("restoreRemovedPairs", () => {
  test("restores original order around later edits and keeps the placeholder last", () => {
    const removed = removePairsById(
      [
        row({ id: "a", value: "1" }),
        row({ id: "b", value: "2" }),
        row({ id: "c", value: "3" }),
        row({ id: "ph" }),
      ],
      new Set(["b"]),
      { keepLastPlaceholder: true },
    ).removed;
    const current = [
      row({ id: "e", value: "added" }),
      row({ id: "a", value: "1" }),
      row({ id: "c", value: "3" }),
      row({ id: "ph" }),
    ];
    expect(restoreRemovedPairs(current, removed).map((pair) => pair.id)).toEqual([
      "e",
      "b",
      "a",
      "c",
      "ph",
    ]);
  });

  test("skips ids that are already present", () => {
    const current = [row({ id: "a" }), row({ id: "b" }), row({ id: "ph" })];
    const restored = restoreRemovedPairs(current, [
      { pair: row({ id: "b", value: "stale" }), index: 0 },
    ]);
    expect(restored).toEqual(current);
  });

  test("clamps indexes and does not duplicate rows", () => {
    const current = [row({ id: "a" }), row({ id: "ph" })];
    const restored = restoreRemovedPairs(current, [
      { pair: row({ id: "z" }), index: 99 },
      { pair: row({ id: "z" }), index: 1 },
      { pair: row({ id: "y" }), index: -4 },
    ]);
    expect(restored.map((pair) => pair.id)).toEqual(["y", "z", "a", "ph"]);
  });
});

describe("rangeIds", () => {
  const pairs = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];

  test("selects either direction", () => {
    expect(rangeIds(pairs, "a", "c")).toEqual(["a", "b", "c"]);
    expect(rangeIds(pairs, "c", "a")).toEqual(["a", "b", "c"]);
  });

  test("falls back to the target when the anchor is gone", () => {
    expect(rangeIds(pairs, "missing", "b")).toEqual(["b"]);
    expect(rangeIds(pairs, "a", "missing")).toEqual([]);
  });
});
