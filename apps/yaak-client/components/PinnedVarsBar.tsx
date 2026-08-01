import { useTranslation } from "@yaakapp-internal/i18n";
import { HStack, Icon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActiveEnvironment } from "../hooks/useActiveEnvironment";
import type { CommitVariableValueResult } from "../hooks/useVariableQuickSwitch";
import { useVariableQuickSwitch } from "../hooks/useVariableQuickSwitch";
import { editEnvironment } from "../lib/editEnvironment";
import { showErrorToast, showToast } from "../lib/toast";
import { Button } from "./core/Button";

type Props = {
  className?: string;
};

/** Collapsible workspace bar containing up to three variable-value switchers. */
export const PinnedVarsBar = memo(function PinnedVarsBar({ className }: Props) {
  const { t } = useTranslation();
  const qs = useVariableQuickSwitch();
  const activeEnvironment = useActiveEnvironment();
  const [openVariableName, setOpenVariableName] = useState<string | null>(null);

  useEffect(() => {
    if (qs.collapsed) setOpenVariableName(null);
  }, [qs.collapsed]);

  return (
    <div
      className={classNames(
        className,
        "w-full overflow-hidden bg-surface transition-[height] duration-150",
        qs.collapsed ? "border-b-0" : "border-b border-border-subtle",
      )}
      style={{ height: qs.collapsed ? 0 : 36 }}
    >
      <HStack space={0} className="items-center h-full min-w-0">
        <button
          className="h-full px-3 flex items-center gap-1.5 text-xs text-text-subtlest border-r border-border-subtle hover:text-text shrink-0"
          onClick={() => editEnvironment(activeEnvironment, { manageQuickVariables: true })}
          title={t("variableQuick.manageCandidates")}
        >
          <Icon icon="pin" size="xs" />
          <span>{t("variableQuick.quickVariables")}</span>
        </button>

        <HStack space={1} className="flex-1 min-w-0 px-2 items-center overflow-hidden">
          {qs.pinned.length === 0 ? (
            <button
              className="text-xs text-text-subtlest hover:text-text truncate"
              onClick={() => editEnvironment(activeEnvironment, { manageQuickVariables: true })}
            >
              {t("variableQuick.noPinnedHint")}
            </button>
          ) : (
            qs.pinned.map((name) => {
              const variable = qs.getVariable(name);
              return (
                <VarSlot
                  key={name}
                  name={name}
                  value={variable?.value ?? ""}
                  encrypted={qs.isVariableEncrypted(name)}
                  candidates={qs.getCandidateValues(name)}
                  open={openVariableName === name}
                  onOpenChange={(open) => setOpenVariableName(open ? name : null)}
                  onCommit={(value) => qs.commitValue(name, value)}
                  onManage={() =>
                    editEnvironment(activeEnvironment, {
                      manageQuickVariables: true,
                      candidateVariableName: name,
                    })
                  }
                />
              );
            })
          )}
        </HStack>

        <Button
          size="xs"
          className="px-1! mr-2 shrink-0"
          title={t("variableQuick.collapse")}
          onClick={qs.toggleCollapsed}
        >
          <Icon icon="chevrons_down_up" size="xs" />
        </Button>
      </HStack>
    </div>
  );
});

function VarSlot({
  name,
  value,
  encrypted,
  candidates,
  open,
  onOpenChange,
  onCommit,
  onManage,
}: {
  name: string;
  value: string;
  encrypted: boolean;
  candidates: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (value: string) => Promise<CommitVariableValueResult>;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const [draft, setDraft] = useState(value);
  const [filterText, setFilterText] = useState("");
  const [pending, setPending] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });

  const options = useMemo(
    () => (value ? [value, ...candidates.filter((candidate) => candidate !== value)] : candidates),
    [candidates, value],
  );
  const filteredCandidates = useMemo(() => {
    const normalizedFilter = filterText.toLowerCase();
    if (!normalizedFilter) return options;
    return options.filter((candidate) => candidate.toLowerCase().includes(normalizedFilter));
  }, [filterText, options]);

  const positionPanel = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const panelWidth = Math.min(320, window.innerWidth - 16);
    const panelHeight = panelRef.current?.offsetHeight ?? 300;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8));
    const below = rect.bottom + 4;
    const top =
      below + panelHeight <= window.innerHeight - 8
        ? below
        : Math.max(8, rect.top - panelHeight - 4);
    setPanelPosition({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setFilterText("");
    positionPanel();
    requestAnimationFrame(() => inputRef.current?.focus());

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        onOpenChange(false);
      }
    };
    const handlePositionChange = () => positionPanel();
    window.addEventListener("mousedown", handleOutsideClick, true);
    window.addEventListener("resize", handlePositionChange);
    window.addEventListener("scroll", handlePositionChange, true);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick, true);
      window.removeEventListener("resize", handlePositionChange);
      window.removeEventListener("scroll", handlePositionChange, true);
    };
  }, [onOpenChange, open, positionPanel, value]);

  useEffect(() => {
    if (!open) setDraft(value);
  }, [open, value]);

  useEffect(() => {
    if (open) positionPanel();
  }, [filteredCandidates.length, open, positionPanel]);

  const commit = useCallback(
    async (nextValue: string) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      try {
        const result = await onCommit(nextValue);
        onOpenChange(false);
        if (!result.candidateSaved) {
          showToast({
            id: "quick-variable-candidate-save-failed",
            color: "warning",
            message: t("variableQuick.candidateSaveFailed"),
          });
        }
      } catch (error) {
        showErrorToast({
          id: "quick-variable-switch-failed",
          title: t("variableQuick.switchFailed"),
          message: error,
        });
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [onCommit, onOpenChange, t],
  );

  return (
    <>
      <button
        ref={triggerRef}
        disabled={encrypted}
        className={classNames(
          "h-6 max-w-64 px-2 rounded-sm border border-border-subtle",
          "flex items-center gap-1.5 text-xs font-mono shrink-0",
          encrypted
            ? "cursor-not-allowed text-text-subtlest"
            : "hover:bg-surface-highlight hover:border-border cursor-pointer",
          open && "border-border-focus bg-surface-highlight",
        )}
        title={encrypted ? t("variableQuick.encrypted") : `${name}: ${value}`}
        onClick={() => onOpenChange(!open)}
      >
        <span className="text-text-subtle truncate">{name}</span>
        <span className="text-text-subtlest">:</span>
        <span className={classNames("truncate", encrypted && "italic")}>
          {encrypted ? "••••" : value || t("variableQuick.emptyValue")}
        </span>
        <Icon icon={encrypted ? "lock" : "chevron_down"} size="2xs" color="secondary" />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`${name} ${t("variableQuick.quickVariables")}`}
            className="fixed z-50 w-[min(20rem,calc(100vw-1rem))] rounded-md border border-border bg-surface shadow-xl overflow-hidden"
            style={panelPosition}
          >
            <div className="p-2 border-b border-border-subtle">
              <input
                ref={inputRef}
                className="w-full h-7 px-2 rounded-sm border border-border-subtle bg-surface-highlight text-xs font-mono text-text outline-none placeholder:text-text-subtlest focus:border-border-focus"
                value={draft}
                disabled={pending}
                placeholder={t("variableQuick.inputNewValue")}
                spellCheck={false}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setFilterText(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void commit(draft);
                  } else if (event.key === "Escape") {
                    onOpenChange(false);
                  }
                }}
              />
            </div>

            <div className="max-h-56 overflow-y-auto py-1" role="listbox">
              {filteredCandidates.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-subtlest">
                  {filterText ? t("common.noMatches") : t("variableQuick.noCandidates")}
                </div>
              ) : (
                filteredCandidates.map((candidate) => (
                  <button
                    key={candidate}
                    role="option"
                    aria-selected={candidate === value}
                    disabled={pending}
                    className="w-full min-h-8 flex items-center gap-2 px-3 text-xs font-mono text-left hover:bg-surface-highlight disabled:opacity-disabled"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void commit(candidate)}
                  >
                    <Icon
                      icon={candidate === value ? "check" : "empty"}
                      size="xs"
                      color={candidate === value ? "primary" : "secondary"}
                    />
                    <span className="truncate flex-1 min-w-0">{candidate}</span>
                  </button>
                ))
              )}
            </div>

            <button
              className="w-full min-h-8 px-3 border-t border-border-subtle flex items-center gap-2 text-xs text-text-subtle hover:bg-surface-highlight hover:text-text"
              onClick={() => {
                onOpenChange(false);
                onManage();
              }}
            >
              <Icon icon="settings" size="xs" />
              {t("variableQuick.manageCandidates")}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
