import { describe, expect, test } from "vitest";
import type { DropdownItem } from "./Dropdown";
import { filterMenuItems, isNavigableItem, stepSelection } from "./Dropdown.util";

const noop = () => undefined;
const item = (label: string, extra: Partial<DropdownItem> = {}): DropdownItem =>
  ({ label, onSelect: noop, ...extra }) as DropdownItem;

describe("filterMenuItems", () => {
  test("matches labels case-insensitively and drops separators while filtering", () => {
    const items: DropdownItem[] = [item("Seedance"), { type: "separator" }, item("kling")];
    expect(filterMenuItems(items, "SEED").map((i) => i.label)).toEqual(["Seedance"]);
    expect(filterMenuItems(items, "")).toHaveLength(3);
  });
});

describe("isNavigableItem", () => {
  test("skips separators, content, hidden and disabled rows", () => {
    expect(isNavigableItem(item("a"))).toBe(true);
    expect(isNavigableItem({ type: "separator" })).toBe(false);
    expect(isNavigableItem({ type: "content", label: "x" })).toBe(false);
    expect(isNavigableItem(item("a", { hidden: true }))).toBe(false);
    expect(isNavigableItem(item("a", { disabled: true }))).toBe(false);
    expect(isNavigableItem(undefined)).toBe(false);
  });
});

describe("stepSelection", () => {
  const list: DropdownItem[] = [
    item("a"),
    { type: "separator" },
    item("b", { disabled: true }),
    item("c"),
  ];

  test("starts at the first or last row when nothing is highlighted", () => {
    expect(stepSelection(list, null, 1)).toBe(0);
    expect(stepSelection(list, null, -1)).toBe(3);
  });

  test("skips rows that can't be highlighted and wraps around", () => {
    expect(stepSelection(list, 0, 1)).toBe(3);
    expect(stepSelection(list, 3, 1)).toBe(0);
    expect(stepSelection(list, 0, -1)).toBe(3);
  });

  test("handles empty lists and lists with nothing to highlight", () => {
    expect(stepSelection([], null, 1)).toBeNull();
    expect(stepSelection([{ type: "separator" }], null, 1)).toBeNull();
  });
});
