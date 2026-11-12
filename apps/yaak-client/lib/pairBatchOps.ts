export type RemovedPair<T> = { pair: T; index: number };

type EmptyCheckPair = { value: string; isFile?: boolean; commitName?: unknown };

/** Value counts as empty for cleanup. Path-placeholder rows and file rows with a path do not. */
export function isValueEmpty(pair: EmptyCheckPair): boolean {
  if (pair.commitName != null) return false;
  if (pair.isFile && pair.value.trim() !== "") return false;
  return pair.value.trim() === "";
}

/**
 * Remove ids. `removed` keeps each row's index in `pairs`.
 * The last row stays when `keepLastPlaceholder` is set, even if its id was selected.
 */
export function removePairsById<T extends { id: string }>(
  pairs: T[],
  ids: ReadonlySet<string>,
  opts: { keepLastPlaceholder: boolean },
): { next: T[]; removed: RemovedPair<T>[] } {
  const lastIndex = pairs.length - 1;
  const removed: RemovedPair<T>[] = [];
  const next: T[] = [];

  pairs.forEach((pair, index) => {
    const keep = opts.keepLastPlaceholder && index === lastIndex;
    if (!keep && ids.has(pair.id)) {
      removed.push({ pair, index });
      return;
    }
    next.push(pair);
  });

  return { next, removed };
}

/** Ids of rows whose value is empty, excluding the trailing placeholder. */
export function findEmptyValueIds<T extends { id: string } & EmptyCheckPair>(pairs: T[]): string[] {
  const ids: string[] = [];
  for (let index = 0; index < pairs.length - 1; index++) {
    const pair = pairs[index];
    if (pair != null && isValueEmpty(pair)) ids.push(pair.id);
  }
  return ids;
}

/**
 * Insert `removed` back into `current` at the indexes they had when they were deleted.
 * The last item of `current` is the trailing placeholder and stays last.
 * Ids already in `current` are skipped, and indexes are clamped into the body.
 */
export function restoreRemovedPairs<T extends { id: string }>(
  current: T[],
  removed: RemovedPair<T>[],
): T[] {
  if (removed.length === 0) return current;

  const ordered = [...removed].sort((a, b) => a.index - b.index);
  if (current.length === 0) {
    const next: T[] = [];
    const seen = new Set<string>();
    for (const entry of ordered) {
      if (seen.has(entry.pair.id)) continue;
      seen.add(entry.pair.id);
      next.splice(clamp(entry.index, 0, next.length), 0, entry.pair);
    }
    return next;
  }

  const placeholder = current[current.length - 1] as T;
  const body = current.slice(0, -1);
  const seen = new Set(current.map((pair) => pair.id));
  for (const entry of ordered) {
    if (seen.has(entry.pair.id)) continue;
    seen.add(entry.pair.id);
    body.splice(clamp(entry.index, 0, body.length), 0, entry.pair);
  }
  return [...body, placeholder];
}

/** Inclusive range in the current order. A missing anchor selects only the target row. */
export function rangeIds<T extends { id: string }>(
  pairs: T[],
  anchorId: string,
  targetId: string,
): string[] {
  const targetIndex = pairs.findIndex((pair) => pair.id === targetId);
  if (targetIndex === -1) return [];
  const anchorIndex = pairs.findIndex((pair) => pair.id === anchorId);
  if (anchorIndex === -1) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return pairs.slice(start, end + 1).map((pair) => pair.id);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
