import { getNodeText } from "../../lib/getNodeText";
import type { DropdownItem } from "./Dropdown";

export function filterMenuItems(items: DropdownItem[], filter: string): DropdownItem[] {
  const needle = filter.toLowerCase();
  return items.filter((i) => getNodeText(i.label).toLowerCase().includes(needle));
}

export function isNavigableItem(item: DropdownItem | undefined): boolean {
  if (item == null || item.hidden) return false;
  if (item.type === "separator" || item.type === "content") return false;
  return !("disabled" in item && item.disabled);
}

/** Move the highlight by `delta`, wrapping and skipping rows that can't be highlighted. */
export function stepSelection(
  list: DropdownItem[],
  current: number | null,
  delta: number,
): number | null {
  const count = list.length;
  if (count === 0) return null;
  let index = current ?? (delta > 0 ? -1 : 0);
  for (let tries = 0; tries < count; tries++) {
    index = (((index + (tries === 0 ? delta : Math.sign(delta))) % count) + count) % count;
    if (isNavigableItem(list[index])) return index;
  }
  return current;
}

/** True while an IME is composing (eg. pinyin); its Enter/arrows/Escape belong to the IME. */
export function isComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}
