import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useTranslation } from "@yaakapp-internal/i18n";
import classNames from "classnames";
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WrappedEnvironmentVariable } from "../../hooks/useEnvironmentVariables";
import { useRandomKey } from "../../hooks/useRandomKey";
import { useToggle } from "../../hooks/useToggle";
import { languageFromContentType } from "../../lib/contentType";
import { showDialog } from "../../lib/dialog";
import {
  findEmptyValueIds,
  rangeIds,
  removePairsById,
  restoreRemovedPairs,
  type RemovedPair,
} from "../../lib/pairBatchOps";
import { generateId } from "../../lib/generateId";
import { hideToastById, showToast } from "../../lib/toast";
import { computeSideForDragMove, DropMarker } from "@yaakapp-internal/ui";
import { showPrompt } from "../../lib/prompt";
import { SelectFile } from "../SelectFile";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import type { DropdownItem } from "./Dropdown";
import { Dropdown } from "./Dropdown";
import type { EditorProps } from "./Editor/Editor";
import type { GenericCompletionConfig } from "./Editor/genericCompletion";
import { Editor } from "./Editor/LazyEditor";
import { Icon } from "@yaakapp-internal/ui";
import { IconButton } from "./IconButton";
import type { InputHandle, InputProps } from "./Input";
import { Input } from "./Input";
import { ensurePairId } from "./PairEditor.util";
import type { RadioDropdownItem } from "./RadioDropdown";
import { RadioDropdown } from "./RadioDropdown";
import { platform } from "@yaakapp-internal/platform";

export interface PairEditorHandle {
  /**
   * Focus a row's name field once it's able to take focus. Focus can't land immediately when the
   * row isn't mounted yet or the editor is hidden — eg. sitting in a tab that's still becoming
   * active — so this retries for up to ~1s. A newer focus request cancels a pending one.
   */
  focusName(id: string): void;
  /** Focus a row's value field. See {@link PairEditorHandle.focusName} for timing. */
  focusValue(id: string): void;
  /** Delete every non-placeholder row whose value is empty. */
  removeEmptyValues(): void;
}

/** ~1s at 60fps, plenty for a tab switch to land without spinning forever if it never does */
const MAX_FOCUS_ATTEMPTS = 60;

export type PairEditorProps = {
  /** Grip selection, batch delete, and empty-value cleanup. Off for the drag preview. */
  batchActions?: boolean;
  /**
   * Render the hover "Remove N empty" button. Off when a wrapper renders its own entry point
   * (PairOrBulkEditor's corner buttons, the environment editor's header pill).
   */
  showEmptyCleanup?: boolean;
  allowFileValues?: boolean;
  allowMultilineValues?: boolean;
  className?: string;
  forcedEnvironmentId?: string;
  forceUpdateKey?: string;
  nameAutocomplete?: GenericCompletionConfig;
  nameAutocompleteFunctions?: boolean;
  nameAutocompleteVariables?: boolean;
  namePlaceholder?: string;
  nameValidate?: InputProps["validate"];
  noScroll?: boolean;
  onChange: (pairs: PairWithId[]) => void;
  onEmptyCountChange?: (count: number) => void;
  onSelectionChange?: (count: number) => void;
  pairs: EditablePair[];
  renderRowStartSlot?: (pair: PairWithId) => ReactNode;
  stateKey: InputProps["stateKey"];
  setRef?: (n: PairEditorHandle) => void;
  valueAutocomplete?: (name: string) => GenericCompletionConfig | undefined;
  valueAutocompleteFunctions?: boolean;
  valueAutocompleteVariables?: boolean | "environment";
  valuePlaceholder?: string;
  valueType?: InputProps["type"] | ((pair: Pair) => InputProps["type"]);
  valueValidate?: InputProps["validate"];
};

export type Pair = {
  id?: string;
  enabled?: boolean;
  name: string;
  value: string;
  contentType?: string;
  filename?: string;
  isFile?: boolean;
};

export type PairWithId = Pair & {
  id: string;
};

/**
 * A pair as handed to the editor. Adds behaviour that only the editor cares about, so the plain
 * `Pair` stays the shape that gets written to models.
 */
export type EditablePair = Pair & {
  /**
   * When set, name edits are held until the field blurs and then committed through this, instead
   * of calling `onChange` on every keystroke. Return false to reject the new name, which reverts
   * the field. For names that can't be written directly, like a URL path placeholder that lives
   * in the URL itself.
   */
  commitName?: (name: string) => boolean;
};

type EditablePairWithId = EditablePair & {
  id: string;
};

/** Strip the editor-only fields, so they can never reach a model write */
function toPairData({ commitName: _commitName, ...pair }: EditablePairWithId): PairWithId {
  return pair;
}

/** Max number of pairs to show before prompting the user to reveal the rest */
const MAX_INITIAL_PAIRS = 30;

// Keyed on `stateKey` so no state survives a change of owner. Row ids alone can't tell owners
// apart — two pair sets can share ids (eg. one duplicated from the other), and the same-rows
// fast path below would swap in the new data without rebuilding the row editors, leaving any
// still-focused input showing the old owner's text.
export function PairEditor(props: PairEditorProps) {
  return <PairEditorInner key={props.stateKey} {...props} />;
}

function PairEditorInner({
  allowFileValues,
  allowMultilineValues,
  batchActions = true,
  showEmptyCleanup = true,
  className,
  forcedEnvironmentId,
  forceUpdateKey,
  nameAutocomplete,
  nameAutocompleteFunctions,
  nameAutocompleteVariables,
  namePlaceholder,
  nameValidate,
  noScroll,
  onChange,
  onEmptyCountChange,
  onSelectionChange,
  pairs: originalPairs,
  renderRowStartSlot,
  stateKey,
  valueAutocomplete,
  valueAutocompleteFunctions,
  valueAutocompleteVariables,
  valuePlaceholder,
  valueType,
  valueValidate,
  setRef,
}: PairEditorProps) {
  const { t } = useTranslation();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<EditablePairWithId | null>(null);
  const [pairs, setPairs] = useState<EditablePairWithId[]>([]);
  const [showAll, toggleShowAll, setShowAll] = useToggle(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const anchorIdRef = useRef<string | null>(null);
  anchorIdRef.current = anchorId;
  // NOTE: Use local force update key because we trigger an effect on forceUpdateKey change. If
  //  we simply pass forceUpdateKey to the editor, the data set by useEffect will be stale.
  const [localForceUpdateKey, regenerateLocalForceUpdateKey] = useRandomKey();

  const rowsRef = useRef<Record<string, RowHandle | null>>({});

  const pendingFocusFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pendingFocusFrame.current != null) cancelAnimationFrame(pendingFocusFrame.current);
    },
    [],
  );

  const focusWhenReady = useCallback((id: string, field: "name" | "value") => {
    if (pendingFocusFrame.current != null) cancelAnimationFrame(pendingFocusFrame.current);

    let attemptsLeft = MAX_FOCUS_ATTEMPTS;
    const attempt = () => {
      pendingFocusFrame.current = null;
      const row = rowsRef.current[id];
      const landed = field === "name" ? row?.focusName() : row?.focusValue();
      if (landed || --attemptsLeft <= 0) return;
      pendingFocusFrame.current = requestAnimationFrame(attempt);
    };
    attempt();
  }, []);

  const removeEmptyValuesRef = useRef<() => void>(() => undefined);
  const handle = useMemo<PairEditorHandle>(
    () => ({
      focusName(id: string) {
        focusWhenReady(id, "name");
      },
      focusValue(id: string) {
        focusWhenReady(id, "value");
      },
      removeEmptyValues() {
        removeEmptyValuesRef.current();
      },
    }),
    [focusWhenReady],
  );

  const initPairEditorRow = useCallback(
    (id: string, n: RowHandle | null) => {
      const isLast = id === pairs[pairs.length - 1]?.id;
      if (isLast) return; // Never add the last pair

      rowsRef.current[id] = n;
    },
    [pairs],
  );

  // Publish immediately. Rows past the initial cutoff are not mounted, so waiting for every
  // row would leave "Remove N empty" visible but with no handle to call.
  useEffect(() => {
    setRef?.(handle);
  }, [handle, setRef]);

  // oxlint-disable-next-line react-hooks/exhaustive-deps -- Only care about forceUpdateKey
  useEffect(() => {
    // Remove empty headers on initial render and ensure they all have valid ids (pairs didn't use to have IDs)
    const newPairs: EditablePairWithId[] = [];
    for (let i = 0; i < originalPairs.length; i++) {
      const p = originalPairs[i];
      if (!p) continue; // Make TS happy
      if (isPairEmpty(p)) continue;
      newPairs.push(ensurePairId(p));
    }

    // When the reset holds the exact same rows (eg. renaming a URL path placeholder, which keeps
    // every row id), swap the data in without rebuilding the row editors. Unfocused inputs re-seed
    // themselves when `defaultValue` changes, and a rebuild would drop the user's focus and
    // selection — like tabbing from a placeholder's name into its value.
    const trailingPair = pairs[pairs.length - 1];
    const sameRows =
      trailingPair != null &&
      isPairEmpty(trailingPair) &&
      pairs.length === newPairs.length + 1 &&
      newPairs.every((p, i) => p.id === pairs[i]?.id);
    if (sameRows) {
      setPairs([...newPairs, trailingPair]);
      return;
    }

    // Add empty last pair if there is none
    const lastPair = newPairs[newPairs.length - 1];
    if (lastPair == null || !isPairEmpty(lastPair)) {
      newPairs.push(emptyPair());
    }

    setPairs(newPairs);
    setSelectedIds(new Set());
    setAnchorId(null);
    regenerateLocalForceUpdateKey();
  }, [forceUpdateKey]);

  const setPairsAndSave = useCallback(
    (fn: (pairs: EditablePairWithId[]) => EditablePairWithId[]) => {
      setPairs((oldPairs) => {
        const pairs = fn(oldPairs);
        onChange(pairs.map(toPairData));
        return pairs;
      });
    },
    [onChange],
  );

  const handleChange = useCallback(
    (pair: EditablePairWithId) =>
      setPairsAndSave((pairs) => pairs.map((p) => (pair.id !== p.id ? p : pair))),
    [setPairsAndSave],
  );

  // The row whose name/value field is being edited never counts as "empty": while adding a
  // variable its value is blank by definition, and offering to delete it would be a trap.
  const rootRef = useRef<HTMLDivElement>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const cancelPendingEditClearRef = useRef<(() => void) | null>(null);
  const cancelPendingEditClear = useCallback(() => {
    cancelPendingEditClearRef.current?.();
    cancelPendingEditClearRef.current = null;
  }, []);
  useEffect(() => cancelPendingEditClear, [cancelPendingEditClear]);

  const handleFocusCapture = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      cancelPendingEditClear();
      const target = event.target;
      if (isEditableTarget(target)) {
        setEditingRowId(
          target.closest("[data-pair-row-id]")?.getAttribute("data-pair-row-id") ?? null,
        );
        return;
      }
      // Focus moved to an in-editor control such as "Remove N empty". Keep the row out of the
      // empty set until that click has run; clearing now would delete the row being typed.
      const clear = () => {
        cancelPendingEditClear();
        setEditingRowId(null);
      };
      window.addEventListener("click", clear);
      cancelPendingEditClearRef.current = () => window.removeEventListener("click", clear);
    },
    [cancelPendingEditClear],
  );

  const handleBlurCapture = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget;
      // Moving within the editor is handled by the focus handler
      if (next instanceof Node && rootRef.current?.contains(next)) return;
      cancelPendingEditClear();
      // Leaving the editor with the mouse: keep the row excluded until the click that caused the
      // blur has finished. Otherwise pressing "Remove N empty" would grow N between mousedown and
      // click, and delete the row the user was just typing in.
      const clear = () => {
        cancelPendingEditClear();
        setEditingRowId(null);
      };
      window.addEventListener("click", clear);
      window.addEventListener("keydown", clear);
      cancelPendingEditClearRef.current = () => {
        window.removeEventListener("click", clear);
        window.removeEventListener("keydown", clear);
      };
    },
    [cancelPendingEditClear],
  );

  // A row left completely blank (no name, no value) is dropped when focus leaves it. It's what
  // clicking the trailing "new row" and then clicking away leaves behind, and otherwise it would
  // linger and show up as "Remove 1 empty".
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;
  const originalPairsRef = useRef(originalPairs);
  originalPairsRef.current = originalPairs;
  const prevEditingRowIdRef = useRef<string | null>(null);
  useEffect(() => {
    const leftId = prevEditingRowIdRef.current;
    prevEditingRowIdRef.current = editingRowId;
    if (leftId == null || leftId === editingRowId) return;

    const current = pairsRef.current;
    const index = current.findIndex((pair) => pair.id === leftId);
    const pair = current[index];
    if (pair == null || index === current.length - 1) return; // Gone, or the trailing new row
    if (!isPairEmpty(pair) || pair.commitName != null) return;

    const drop = (old: EditablePairWithId[]) => old.filter((p) => p.id !== leftId);
    // Only write when the blank row was actually persisted; a row that only ever existed locally
    // needs no save.
    if (originalPairsRef.current.some((p) => p.id === leftId)) {
      setPairsAndSave(drop);
    } else {
      setPairs(drop);
    }
  }, [editingRowId, setPairsAndSave]);

  const emptyIds = useMemo(
    () => (batchActions ? findEmptyValueIds(pairs).filter((id) => id !== editingRowId) : []),
    [batchActions, editingRowId, pairs],
  );
  const emptyCount = emptyIds.length;
  const selectableIds = useMemo(
    () =>
      pairs
        .filter((pair, index) => index < pairs.length - 1 && pair.commitName == null)
        .map((pair) => pair.id),
    [pairs],
  );
  const selectableCount = selectableIds.length;

  useEffect(() => {
    if (!batchActions) return;
    const live = new Set(selectableIds);
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    setAnchorId((prev) => (prev != null && live.has(prev) ? prev : null));
  }, [batchActions, pairs, selectableIds]);

  useEffect(() => {
    onEmptyCountChange?.(emptyCount);
    return () => onEmptyCountChange?.(0);
  }, [emptyCount, onEmptyCountChange]);

  useEffect(() => {
    onSelectionChange?.(batchActions ? selectedIds.size : 0);
    return () => onSelectionChange?.(0);
  }, [batchActions, onSelectionChange, selectedIds.size]);

  // Per instance, so the delayed hide on unmount can't close the toast of an editor that remounts
  // with the same stateKey
  const instanceId = useRef(generateId()).current;
  const toastId = `pair-editor-undo::${String(stateKey)}::${instanceId}`;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      hideToastById(toastId);
      // showToast inserts on a short timer when replacing an existing toast.
      window.setTimeout(() => hideToastById(toastId), 300);
    };
  }, [toastId]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAnchorId(null);
  }, []);

  const deleteIds = useCallback(
    (ids: ReadonlySet<string>, kind: "selection" | "empty") => {
      const allowed = new Set(selectableIds);
      const { next, removed } = removePairsById(
        pairs,
        new Set([...ids].filter((id) => allowed.has(id))),
        { keepLastPlaceholder: true },
      );
      clearSelection();
      if (removed.length === 0) return;
      setPairsAndSave(() => next);
      const snapshot: RemovedPair<EditablePairWithId>[] = removed;
      showToast({
        id: toastId,
        timeout: 8000,
        message: t(kind === "empty" ? "pairEditor.removedEmpty" : "pairEditor.removedSelected", {
          count: snapshot.length,
        }),
        action: ({ hide }) => (
          <Button
            size="xs"
            variant="border"
            onClick={() => {
              if (!mountedRef.current) {
                hide();
                return;
              }
              setPairsAndSave((current) => restoreRemovedPairs(current, snapshot));
              regenerateLocalForceUpdateKey();
              hide();
            }}
          >
            {t("common.undo")}
          </Button>
        ),
      });
    },
    [
      clearSelection,
      pairs,
      regenerateLocalForceUpdateKey,
      selectableIds,
      setPairsAndSave,
      t,
      toastId,
    ],
  );

  const removeEmptyValues = useCallback(
    () => deleteIds(new Set(emptyIds), "empty"),
    [deleteIds, emptyIds],
  );
  removeEmptyValuesRef.current = removeEmptyValues;

  const handleSelectGrip = useCallback(
    (id: string, shiftKey: boolean) => {
      if (!selectableIds.includes(id)) return;
      if (shiftKey) {
        const anchor = anchorIdRef.current ?? id;
        if (anchorIdRef.current == null) setAnchorId(id);
        const ids = rangeIds(pairs, anchor, id).filter((rangeId) =>
          selectableIds.includes(rangeId),
        );
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const rangeId of ids) next.add(rangeId);
          return next;
        });
        return;
      }
      setAnchorId(id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [pairs, selectableIds],
  );

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(selectableIds));
    setAnchorId(selectableIds[0] ?? null);
    setShowAll(true);
  }, [selectableIds, setShowAll]);

  const selectEmpty = useCallback(() => {
    setSelectedIds(new Set(emptyIds));
    setAnchorId(emptyIds[0] ?? null);
    if (emptyIds.length > 0) setShowAll(true);
  }, [emptyIds, setShowAll]);

  // While rows are selected, Delete/Backspace/Escape act on this editor when focus is inside it.
  // WebKit leaves focus on <body> after a selection-bar click, so Delete/Backspace also work then,
  // but only for the topmost editor that is actually on screen.
  useEffect(() => {
    if (!batchActions || selectedIds.size === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      // Inactive request tabs stay mounted with display:none. A hidden editor must not see keys.
      if (root == null || !isShown(root)) return;
      const target = event.target;
      const inside = target instanceof Node && root.contains(target);
      const onBody =
        target == null || target === document.body || target === document.documentElement;
      if (!inside && !onBody) return;
      if (isEditableTarget(target)) return;
      if (!inside) {
        const topmost = shownPairEditors().at(-1);
        if (topmost !== root) return;
        // Body-level Escape belongs to an open row menu or the dialog, not a selection.
        if (event.key === "Escape") return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        clearSelection();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        deleteIds(selectedIds, "selection");
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [batchActions, clearSelection, deleteIds, selectedIds]);

  const handleDelete = useCallback(
    (pair: Pair, focusPrevious: boolean) => {
      if (focusPrevious) {
        const index = pairs.findIndex((p) => p.id === pair.id);
        const id = pairs[index - 1]?.id ?? null;
        rowsRef.current[id ?? "n/a"]?.focusName();
      }
      return setPairsAndSave((oldPairs) => oldPairs.filter((p) => p.id !== pair.id));
    },
    [setPairsAndSave, pairs],
  );

  const handleFocusName = useCallback(
    (pair: Pair) => {
      const isLast = pair.id === pairs[pairs.length - 1]?.id;
      if (isLast) setPairs([...pairs, emptyPair()]);
    },
    [pairs],
  );

  const handleFocusValue = useCallback(
    (pair: Pair) => {
      const isLast = pair.id === pairs[pairs.length - 1]?.id;
      if (isLast) setPairs([...pairs, emptyPair()]);
    },
    [pairs],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // dnd-kit: show the “between rows” marker while hovering
  const onDragMove = useCallback(
    (e: DragMoveEvent) => {
      const overId = e.over?.id as string | undefined;
      if (!overId) return setHoveredIndex(null);

      const overPair = pairs.find((p) => p.id === overId);
      if (overPair == null) return setHoveredIndex(null);

      const side = computeSideForDragMove(overPair.id, e);
      const overIndex = pairs.findIndex((p) => p.id === overId);
      const hoveredIndex = overIndex + (side === "before" ? 0 : 1);

      setHoveredIndex(hoveredIndex);
    },
    [pairs],
  );

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const pair = pairs.find((p) => p.id === e.active.id);
      setIsDragging(pair ?? null);
    },
    [pairs],
  );

  const onDragCancel = useCallback(() => setIsDragging(null), []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setIsDragging(null);
      setHoveredIndex(null);
      const activeId = e.active.id as string | undefined;
      const overId = e.over?.id as string | undefined;
      if (!activeId || !overId) return;

      const from = pairs.findIndex((p) => p.id === activeId);
      const baseTo = pairs.findIndex((p) => p.id === overId);
      const to = hoveredIndex ?? (baseTo === -1 ? from : baseTo);

      if (from !== -1 && to !== -1 && from !== to) {
        setPairsAndSave((ps) => {
          const next = [...ps];
          const [moved] = next.splice(from, 1);
          if (moved === undefined) return ps; // Make TS happy
          next.splice(to > from ? to - 1 : to, 0, moved);
          return next;
        });
      }
    },
    [pairs, hoveredIndex, setPairsAndSave],
  );

  const showSelectionBar = batchActions && selectedIds.size > 0;
  const showEmptyButton = batchActions && showEmptyCleanup && !showSelectionBar && emptyCount > 0;
  const allSelected = selectableCount > 0 && selectedIds.size >= selectableCount;

  return (
    <div
      className={classNames(
        className,
        "group/pair-editor @container relative",
        "pb-2 mb-auto h-full",
        !noScroll && "overflow-y-auto max-h-full",
        // Move over the width of the drag handle
        "-mr-2 pr-2",
        // Pad to make room for the drag divider
        "pt-0.5",
        "grid grid-rows-[auto_1fr_auto]",
      )}
      ref={rootRef}
      data-pair-editor=""
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      <div>
        <DndContext
          autoScroll
          sensors={sensors}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          onDragCancel={onDragCancel}
          collisionDetection={pointerWithin}
        >
          {pairs.map((p, i) => {
            if (!showAll && i > MAX_INITIAL_PAIRS) return null;

            const isLast = i === pairs.length - 1;
            return (
              <Fragment key={p.id}>
                {hoveredIndex === i && <DropMarker />}
                <PairEditorRow
                  setRef={initPairEditorRow}
                  allowFileValues={allowFileValues}
                  allowMultilineValues={allowMultilineValues}
                  anySelected={selectedIds.size > 0}
                  batchActions={batchActions && !isLast && p.commitName == null}
                  className="py-1"
                  forcedEnvironmentId={forcedEnvironmentId}
                  forceUpdateKey={localForceUpdateKey}
                  index={i}
                  isLast={isLast}
                  isDraggingGlobal={!!isDragging}
                  nameAutocomplete={nameAutocomplete}
                  nameAutocompleteFunctions={nameAutocompleteFunctions}
                  nameAutocompleteVariables={nameAutocompleteVariables}
                  namePlaceholder={namePlaceholder}
                  nameValidate={nameValidate}
                  onChange={handleChange}
                  onDelete={handleDelete}
                  onFocusName={handleFocusName}
                  onFocusValue={handleFocusValue}
                  onSelectGrip={handleSelectGrip}
                  pair={p}
                  renderRowStartSlot={renderRowStartSlot}
                  selected={selectedIds.has(p.id)}
                  stateKey={stateKey}
                  valueAutocomplete={valueAutocomplete}
                  valueAutocompleteFunctions={valueAutocompleteFunctions}
                  valueAutocompleteVariables={valueAutocompleteVariables}
                  valuePlaceholder={valuePlaceholder}
                  valueType={valueType}
                  valueValidate={valueValidate}
                />
              </Fragment>
            );
          })}
          {!showAll && pairs.length > MAX_INITIAL_PAIRS && (
            <Button onClick={toggleShowAll} variant="border" className="m-2" size="xs">
              {t("common.showCountMore", { count: pairs.length - MAX_INITIAL_PAIRS })}
            </Button>
          )}
          <DragOverlay dropAnimation={null}>
            {isDragging && (
              <PairEditorRow
                batchActions={false}
                namePlaceholder={namePlaceholder}
                valuePlaceholder={valuePlaceholder}
                className="opacity-80"
                pair={isDragging}
                index={0}
                stateKey={null}
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>

      <div
        // There's a weird bug where clicking below one of the above Codemirror inputs will cause
        // it to focus. Putting this element here prevents that
        aria-hidden
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      {showSelectionBar ? (
        <div
          className={classNames(
            "sticky bottom-0 z-10 flex items-center gap-3 h-8 pl-2 pr-0.5 text-xs",
            "bg-surface border-t border-border-subtle",
          )}
        >
          <span className="text-text font-medium whitespace-nowrap">
            {t("pairEditor.selectedCount", { count: selectedIds.size })}
          </span>
          <Button
            size="xs"
            variant="border"
            color="danger"
            title={`${t("pairEditor.deleteSelected")} (⌫)`}
            onClick={() => deleteIds(selectedIds, "selection")}
            rightSlot={<span className="ml-1.5 opacity-60">⌫</span>}
          >
            {t("pairEditor.deleteSelected")}
          </Button>
          <span aria-hidden className="w-px h-4 bg-border-subtle" />
          <SelectionTextButton onClick={allSelected ? clearSelection : selectAll}>
            {allSelected ? t("pairEditor.deselectAll") : t("pairEditor.selectAll")}
          </SelectionTextButton>
          {emptyCount > 0 && (
            <SelectionTextButton onClick={selectEmpty}>
              {t("pairEditor.selectEmpty", { count: emptyCount })}
            </SelectionTextButton>
          )}
          <IconButton
            icon="x"
            size="xs"
            iconSize="sm"
            className="ml-auto"
            title={`${t("pairEditor.cancelSelection")} (Esc)`}
            onClick={clearSelection}
          />
        </div>
      ) : (
        showEmptyButton && (
          // Zero-height sticky anchor: the button floats over the bottom-right corner on hover
          // instead of reserving a strip of empty space under the table.
          <div className="sticky bottom-0 z-10 h-0">
            <div
              className={classNames(
                "absolute right-0 bottom-0 transition-opacity",
                "opacity-0 group-hover/pair-editor:opacity-100 focus-within:opacity-100",
              )}
            >
              <Button
                size="xs"
                variant="border"
                className="bg-surface shadow"
                title={t("pairEditor.removeEmptyTitle")}
                onClick={removeEmptyValues}
              >
                {t("pairEditor.removeEmpty", { count: emptyCount })}
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

type PairEditorRowProps = {
  anySelected?: boolean;
  batchActions?: boolean;
  className?: string;
  onSelectGrip?: (id: string, shiftKey: boolean) => void;
  pair: EditablePairWithId;
  selected?: boolean;
  forceFocusNamePairId?: string | null;
  forceFocusValuePairId?: string | null;
  onChange?: (pair: EditablePairWithId) => void;
  onDelete?: (pair: EditablePairWithId, focusPrevious: boolean) => void;
  onFocusName?: (pair: EditablePairWithId) => void;
  onFocusValue?: (pair: EditablePairWithId) => void;
  onSubmit?: (pair: EditablePairWithId) => void;
  isLast?: boolean;
  disabled?: boolean;
  disableDrag?: boolean;
  index: number;
  isDraggingGlobal?: boolean;
  setRef?: (id: string, n: RowHandle | null) => void;
} & Pick<
  PairEditorProps,
  | "allowFileValues"
  | "allowMultilineValues"
  | "forcedEnvironmentId"
  | "forceUpdateKey"
  | "nameAutocomplete"
  | "nameAutocompleteVariables"
  | "namePlaceholder"
  | "nameValidate"
  | "nameAutocompleteFunctions"
  | "renderRowStartSlot"
  | "stateKey"
  | "valueAutocomplete"
  | "valueAutocompleteFunctions"
  | "valueAutocompleteVariables"
  | "valuePlaceholder"
  | "valueType"
  | "valueValidate"
>;

interface RowHandle {
  focusName(): boolean;
  focusValue(): boolean;
}

export function PairEditorRow({
  allowFileValues,
  allowMultilineValues,
  anySelected,
  batchActions,
  className,
  disableDrag,
  disabled,
  forceUpdateKey,
  forcedEnvironmentId,
  index,
  isLast,
  nameAutocomplete,
  nameAutocompleteFunctions,
  nameAutocompleteVariables,
  namePlaceholder,
  nameValidate,
  isDraggingGlobal,
  onChange,
  onDelete,
  onFocusName,
  onFocusValue,
  onSelectGrip,
  pair,
  selected,
  renderRowStartSlot,
  stateKey,
  valueAutocomplete,
  valueAutocompleteFunctions,
  valueAutocompleteVariables,
  valuePlaceholder,
  valueType,
  valueValidate,
  setRef,
}: PairEditorRowProps) {
  const { t } = useTranslation();
  const nameInputRef = useRef<InputHandle>(null);
  const valueInputRef = useRef<InputHandle>(null);
  const gripPointerStart = useRef<{ x: number; y: number } | null>(null);
  const handle = useRef<RowHandle>({
    focusName() {
      nameInputRef.current?.focus();
      return nameInputRef.current?.isFocused() ?? false;
    },
    focusValue() {
      valueInputRef.current?.focus();
      return valueInputRef.current?.isFocused() ?? false;
    },
  });

  const initNameInputRef = useCallback(
    (n: InputHandle | null) => {
      nameInputRef.current = n;
      if (nameInputRef.current && valueInputRef.current) {
        setRef?.(pair.id, handle.current);
      }
    },
    [pair.id, setRef],
  );

  const initValueInputRef = useCallback(
    (n: InputHandle | null) => {
      valueInputRef.current = n;
      if (nameInputRef.current && valueInputRef.current) {
        setRef?.(pair.id, handle.current);
      }
    },
    [pair.id, setRef],
  );

  const handleFocusName = useCallback(() => onFocusName?.(pair), [onFocusName, pair]);
  const handleFocusValue = useCallback(() => onFocusValue?.(pair), [onFocusValue, pair]);
  const handleDelete = useCallback(() => onDelete?.(pair, false), [onDelete, pair]);

  const handleChangeEnabled = useMemo(
    () => (enabled: boolean) => onChange?.({ ...pair, enabled }),
    [onChange, pair],
  );

  // The name being typed into a deferred-commit field, before it's committed or reverted
  const pendingName = useRef<string | null>(null);

  const handleChangeName = useMemo(
    () => (name: string) => {
      // Keep the edit local until commit. Writing on every keystroke would reset the editor from
      // beneath the cursor, since the pairs are derived from the name being edited.
      if (pair.commitName != null) pendingName.current = name;
      else onChange?.({ ...pair, name });
    },
    [onChange, pair],
  );

  const revertName = useCallback(() => {
    const nameInput = nameInputRef.current;
    if (nameInput != null) {
      const changes = { from: 0, to: nameInput.value().length, insert: pair.name };
      nameInput.dispatch({ changes });
    }
    pendingName.current = null;
  }, [pair.name]);

  const handleBlurName = useCallback(() => {
    if (pair.commitName == null) return;

    const name = pendingName.current;
    pendingName.current = null;
    if (name == null || name === pair.name) return;
    if (!pair.commitName(name)) revertName();
  }, [pair, revertName]);

  const handleChangeValueText = useMemo(
    () => (value: string) => onChange?.({ ...pair, value, isFile: false }),
    [onChange, pair],
  );

  const handleChangeValueFile = useMemo(
    () =>
      ({ filePath }: { filePath: string | null }) =>
        onChange?.({ ...pair, value: filePath ?? "", isFile: true }),
    [onChange, pair],
  );

  const handleChangeValueContentType = useMemo(
    () => (contentType: string) => onChange?.({ ...pair, contentType }),
    [onChange, pair],
  );

  const handleChangeValueFilename = useMemo(
    () => (filename: string) => onChange?.({ ...pair, filename }),
    [onChange, pair],
  );

  const handleEditMultiLineValue = useCallback(
    () =>
      showDialog({
        id: "pair-edit-multiline",
        size: "dynamic",
        title: t("common.editItem", { name: pair.name }),
        render: ({ hide }) => (
          <MultilineEditDialog
            hide={hide}
            onChange={handleChangeValueText}
            defaultValue={pair.value}
            contentType={pair.contentType ?? null}
          />
        ),
      }),
    [handleChangeValueText, pair.contentType, pair.name, pair.value, t],
  );

  const defaultItems = useMemo(
    (): DropdownItem[] => [
      {
        label: t("common.editMultiLine"),
        onSelect: handleEditMultiLineValue,
        hidden: !allowMultilineValues,
      },
      {
        label: t("common.delete"),
        onSelect: handleDelete,
        color: "danger",
      },
    ],
    [allowMultilineValues, handleDelete, handleEditMultiLineValue, t],
  );

  const { attributes, listeners, setNodeRef: setDraggableRef } = useDraggable({ id: pair.id });
  const { setNodeRef: setDroppableRef } = useDroppable({ id: pair.id });

  // Filter out the current pair name
  const valueAutocompleteVariablesFiltered = useMemo<EditorProps["autocompleteVariables"]>(() => {
    if (valueAutocompleteVariables === "environment") {
      return (v: WrappedEnvironmentVariable): boolean => v.variable.name !== pair.name;
    }
    return valueAutocompleteVariables;
  }, [pair.name, valueAutocompleteVariables]);

  const handleSetRef = useCallback(
    (n: HTMLDivElement | null) => {
      setDraggableRef(n);
      setDroppableRef(n);
    },
    [setDraggableRef, setDroppableRef],
  );

  // Skip the trailing placeholder row. It exists to start a new pair, so a picker there would
  // imply it's already a real row. `Input` handles the rest, including having no options to show.
  const showOptionsPicker = !isLast;

  return (
    <div
      ref={handleSetRef}
      data-pair-row-id={pair.id}
      className={classNames(
        className,
        "group/pair-row grid",
        renderRowStartSlot
          ? "grid-cols-[auto_auto_auto_minmax(0,1fr)_auto]"
          : "grid-cols-[auto_auto_minmax(0,1fr)_auto]",
        "grid-rows-1 items-center rounded-sm",
        !pair.enabled && "opacity-60",
        selected && [
          "bg-surface-active shadow-[inset_2px_0_0_var(--primary)]",
          // Inputs paint their own background, so the row tint alone barely shows: tint their
          // borders too, but leave the focused field's own focus border alone.
          "[&_.x-theme-input:not(:focus-within)]:border-primary/60",
        ],
      )}
    >
      {renderRowStartSlot && (
        <div className="w-5 h-7 flex items-center justify-center">
          {!isLast && renderRowStartSlot(pair)}
        </div>
      )}
      <Checkbox
        hideLabel
        title={pair.enabled ? t("common.disableItem") : t("common.enableItem")}
        disabled={isLast || disabled}
        checked={isLast ? false : !!pair.enabled}
        className={classNames(isLast && "opacity-disabled!")}
        onChange={handleChangeEnabled}
      />
      {!isLast && !disableDrag ? (
        <div
          {...attributes}
          {...listeners}
          role={batchActions ? "button" : undefined}
          tabIndex={batchActions ? 0 : undefined}
          data-pair-grip={batchActions ? "" : undefined}
          aria-pressed={batchActions ? !!selected : undefined}
          aria-label={batchActions ? t("pairEditor.selectRow") : undefined}
          title={batchActions ? t("pairEditor.gripTitle") : undefined}
          {...(batchActions
            ? {
                onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
                  listeners?.onPointerDown?.(event);
                  gripPointerStart.current = { x: event.clientX, y: event.clientY };
                },
                onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
                  const start = gripPointerStart.current;
                  gripPointerStart.current = null;
                  if (
                    start != null &&
                    Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
                  ) {
                    return;
                  }
                  event.stopPropagation();
                  event.currentTarget.focus();
                  onSelectGrip?.(pair.id, event.shiftKey);
                },
                onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelectGrip?.(pair.id, event.shiftKey);
                },
              }
            : null)}
          className={classNames(
            "h-7 w-5 flex items-center justify-center rounded-sm",
            batchActions && [
              "cursor-pointer outline-hidden",
              "hover:bg-surface-highlight hover:opacity-100!",
              "focus-visible:ring-1 focus-visible:ring-border-focus",
            ],
            batchActions && anySelected
              ? "opacity-100"
              : "opacity-0 group-hover/pair-row:opacity-70",
            selected ? "text-primary" : batchActions && anySelected && "text-text-subtlest",
          )}
        >
          <Icon
            size="sm"
            icon={selected ? "check" : "grip_vertical"}
            className="pointer-events-none"
          />
        </div>
      ) : (
        <span className="w-5" />
      )}
      <div
        className={classNames(
          "grid items-center",
          "@xs:gap-2 @xs:grid-rows-1! @xs:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]!",
          "gap-0.5 grid-cols-1 grid-rows-2",
        )}
      >
        <Input
          setRef={initNameInputRef}
          hideLabel
          stateKey={`name.${pair.id}.${stateKey}`}
          disabled={disabled}
          wrapLines={false}
          readOnly={isDraggingGlobal}
          size="sm"
          required={!isLast && !!pair.enabled && !!pair.value}
          validate={nameValidate}
          forcedEnvironmentId={forcedEnvironmentId}
          forceUpdateKey={forceUpdateKey}
          containerClassName={classNames("bg-surface", isLast && "border-dashed")}
          defaultValue={pair.name}
          label={t("common.name")}
          name={`name[${index}]`}
          onBlur={handleBlurName}
          onChange={handleChangeName}
          onFocus={handleFocusName}
          placeholder={namePlaceholder ?? t("common.namePlaceholder")}
          autocomplete={nameAutocomplete}
          autocompleteVariables={nameAutocompleteVariables}
          autocompleteFunctions={nameAutocompleteFunctions}
          showOptionsPicker={showOptionsPicker}
        />
        <div className="w-full grid grid-cols-[minmax(0,1fr)_auto] gap-1 items-center">
          {pair.isFile ? (
            <SelectFile
              disabled={disabled}
              inline
              size="xs"
              filePath={pair.value}
              nameOverride={pair.filename || null}
              onChange={handleChangeValueFile}
            />
          ) : pair.value.includes("\n") ? (
            <Button
              color="secondary"
              size="sm"
              onClick={handleEditMultiLineValue}
              title={pair.value}
              className="text-xs font-mono"
            >
              {pair.value.split("\n").join(" ")}
            </Button>
          ) : (
            <Input
              setRef={initValueInputRef}
              hideLabel
              stateKey={`value.${pair.id}.${stateKey}`}
              wrapLines={false}
              size="sm"
              disabled={disabled}
              readOnly={isDraggingGlobal}
              containerClassName={classNames("bg-surface", isLast && "border-dashed")}
              validate={valueValidate}
              forcedEnvironmentId={forcedEnvironmentId}
              forceUpdateKey={forceUpdateKey}
              defaultValue={pair.value}
              label={t("common.value")}
              name={`value[${index}]`}
              onChange={handleChangeValueText}
              onFocus={handleFocusValue}
              type={isLast ? "text" : typeof valueType === "function" ? valueType(pair) : valueType}
              placeholder={valuePlaceholder ?? t("common.valuePlaceholder")}
              autocomplete={valueAutocomplete?.(pair.name)}
              autocompleteFunctions={valueAutocompleteFunctions}
              autocompleteVariables={valueAutocompleteVariablesFiltered}
              showOptionsPicker={showOptionsPicker}
            />
          )}
        </div>
      </div>
      {allowFileValues ? (
        <FileActionsDropdown
          pair={pair}
          onChangeFile={handleChangeValueFile}
          onChangeText={handleChangeValueText}
          onChangeContentType={handleChangeValueContentType}
          onChangeFilename={handleChangeValueFilename}
          onDelete={handleDelete}
          editMultiLine={handleEditMultiLineValue}
        />
      ) : (
        <Dropdown items={defaultItems}>
          <IconButton
            iconSize="sm"
            size="xs"
            // Ellipsis rather than a chevron: the name and value fields now carry chevrons for
            // picking a suggestion, and this menu acts on the row instead of filling in a field.
            icon={isLast || disabled ? "empty" : "ellipsis_vertical"}
            title={t("request.moreActions")}
            className="text-text-subtlest"
          />
        </Dropdown>
      )}
    </div>
  );
}

function FileActionsDropdown({
  pair,
  onChangeFile,
  onChangeText,
  onChangeContentType,
  onChangeFilename,
  onDelete,
  editMultiLine,
}: {
  pair: Pair;
  onChangeFile: ({ filePath }: { filePath: string | null }) => void;
  onChangeText: (text: string) => void;
  onChangeContentType: (contentType: string) => void;
  onChangeFilename: (filename: string) => void;
  onDelete: () => void;
  editMultiLine: () => void;
}) {
  const { t } = useTranslation();
  const onChange = useCallback(
    (v: string) => {
      if (v === "file") onChangeFile({ filePath: "" });
      else onChangeText("");
    },
    [onChangeFile, onChangeText],
  );

  const fileItems = useMemo<RadioDropdownItem<string>[]>(
    () => [
      { label: t("timeline.text"), value: "text" },
      { label: t("common.file"), value: "file" },
    ],
    [t],
  );

  const itemsAfter = useMemo<DropdownItem[]>(
    () => [
      {
        label: t("common.editMultiLine"),
        leftSlot: <Icon icon="file_code" />,
        hidden: pair.isFile,
        onSelect: editMultiLine,
      },
      {
        label: t("request.setContentType"),
        leftSlot: <Icon icon="pencil" />,
        onSelect: async () => {
          const contentType = await showPrompt({
            id: "content-type",
            title: t("request.overrideContentType"),
            label: "Content-Type",
            required: false,
            placeholder: "text/plain",
            defaultValue: pair.contentType ?? "",
            confirmText: t("common.set"),
            description: t("request.leaveBlankAutoDetect"),
          });
          if (contentType == null) return;
          onChangeContentType(contentType);
        },
      },
      {
        label: t("request.setFileName"),
        leftSlot: <Icon icon="file_code" />,
        onSelect: async () => {
          console.log("PAIR", pair);
          const defaultFilename = await platform.files.basename(pair.value ?? "");
          const filename = await showPrompt({
            id: "filename",
            title: t("request.overrideFilename"),
            label: t("request.filename"),
            required: false,
            placeholder: defaultFilename ?? "myfile.png",
            defaultValue: pair.filename,
            confirmText: t("common.set"),
            description: t("request.leaveBlankUseSelectedFile"),
          });
          if (filename == null) return;
          onChangeFilename(filename);
        },
      },
      {
        label: t("request.unsetFile"),
        leftSlot: <Icon icon="x" />,
        hidden: pair.isFile,
        onSelect: async () => {
          onChangeFile({ filePath: null });
        },
      },
      {
        label: t("common.delete"),
        onSelect: onDelete,
        variant: "danger",
        leftSlot: <Icon icon="trash" />,
        color: "danger",
      },
    ],
    [
      editMultiLine,
      onChangeContentType,
      onChangeFile,
      onDelete,
      pair.contentType,
      pair.isFile,
      onChangeFilename,
      pair.filename,
      pair,
      t,
    ],
  );

  return (
    <RadioDropdown
      value={pair.isFile ? "file" : "text"}
      onChange={onChange}
      items={fileItems}
      itemsAfter={itemsAfter}
    >
      <IconButton
        iconSize="sm"
        size="xs"
        // Matches the plain row menu, so the actions column reads the same for file and text rows
        icon="ellipsis_vertical"
        title={t("request.selectFormDataType")}
        className="text-text-subtlest"
      />
    </RadioDropdown>
  );
}

function emptyPair(): EditablePairWithId {
  return ensurePairId({ enabled: true, name: "", value: "" });
}

function isPairEmpty(pair: Pair): boolean {
  return !pair.name && !pair.value;
}

function MultilineEditDialog({
  defaultValue,
  contentType,
  onChange,
  hide,
}: {
  defaultValue: string;
  contentType: string | null;
  onChange: (value: string) => void;
  hide: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<string>(defaultValue);
  const language = languageFromContentType(contentType, value);
  return (
    <div className="w-screen max-w-160 h-[50vh] max-h-full grid grid-rows-[minmax(0,1fr)_auto]">
      <Editor
        heightMode="auto"
        defaultValue={defaultValue}
        language={language}
        onChange={setValue}
        stateKey={null}
        autocompleteFunctions
        autocompleteVariables
      />
      <div>
        <Button
          color="primary"
          className="ml-auto my-2"
          onClick={() => {
            onChange(value);
            hide();
          }}
        >
          {t("common.done")}
        </Button>
      </div>
    </div>
  );
}

function isShown(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

function shownPairEditors(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-pair-editor]")].filter(isShown);
}

/** Text fields (inputs, CodeMirror) own their keys; batch shortcuts must never fire from them. */
function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !=
    null
  );
}

function SelectionTextButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="whitespace-nowrap text-text-subtle hover:text-text hover:underline underline-offset-2"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
