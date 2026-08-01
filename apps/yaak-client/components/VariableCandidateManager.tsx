import { useTranslation } from "@yaakapp-internal/i18n";
import { Heading, HStack, Icon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import type { ReactNode } from "react";
import { memo, useMemo, useState } from "react";
import { useVariableQuickSwitch } from "../hooks/useVariableQuickSwitch";
import { fireAndForget } from "../lib/fireAndForget";
import { parseValues } from "../lib/variableQuickSwitch";
import { Button } from "./core/Button";
import { IconButton } from "./core/IconButton";
import { PlainInput } from "./core/PlainInput";

type Props = {
  variableName: string | null;
  onSelectVariable: (name: string) => void;
  onBack: () => void;
};

/** Controlled candidate index/detail panel used by the environment editor dialog. */
export const VariableCandidateManager = memo(function VariableCandidateManager({
  variableName,
  onSelectVariable,
  onBack,
}: Props) {
  if (variableName == null) {
    return <VariableCandidateIndex onBack={onBack} onSelectVariable={onSelectVariable} />;
  }
  return <VariableCandidateDetail variableName={variableName} onBack={onBack} />;
});

function VariableCandidateIndex({
  onBack,
  onSelectVariable,
}: {
  onBack: () => void;
  onSelectVariable: (name: string) => void;
}) {
  const { t } = useTranslation();
  const qs = useVariableQuickSwitch();
  const [query, setQuery] = useState("");
  const filteredNames = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return qs.allVariableNames;
    return qs.allVariableNames.filter((name) => name.toLowerCase().includes(normalizedQuery));
  }, [qs.allVariableNames, query]);

  return (
    <div className="h-full min-h-0 grid grid-rows-[auto_auto_minmax(0,1fr)] bg-surface">
      <CandidateHeader
        onBack={onBack}
        backTitle={t("variableQuick.backToEnvironment")}
        title={t("variableQuick.manageCandidates")}
      />
      <div className="px-4 py-3 border-b border-border-subtle bg-surface-highlight/30">
        <PlainInput
          label={t("variableQuick.variableName")}
          defaultValue={query}
          onChange={setQuery}
          placeholder={t("variableQuick.selectVariable")}
          autoFocus
        />
      </div>
      <div className="min-h-0 overflow-y-auto py-1">
        {filteredNames.length === 0 ? (
          <EmptyCandidates>{t("variableQuick.noMatchingVariables")}</EmptyCandidates>
        ) : (
          filteredNames.map((name) => {
            const isPinned = qs.pinned.includes(name);
            const candidateCount = qs.getCandidateValues(name).length;
            return (
              <button
                key={name}
                className="w-full min-h-9 flex items-center gap-2 px-4 text-left hover:bg-surface-highlight"
                onClick={() => onSelectVariable(name)}
              >
                <Icon
                  icon={isPinned ? "pin" : "empty"}
                  size="xs"
                  color={isPinned ? "primary" : "secondary"}
                />
                <span className="font-mono text-sm truncate flex-1 min-w-0">{name}</span>
                <span className="text-xs text-text-subtlest tabular-nums">{candidateCount}</span>
                <Icon icon="chevron_right" size="xs" color="secondary" />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function VariableCandidateDetail({
  variableName,
  onBack,
}: {
  variableName: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const qs = useVariableQuickSwitch();
  const [query, setQuery] = useState("");
  const [batchText, setBatchText] = useState("");

  const candidates = qs.getCandidateValues(variableName);
  const currentValue = qs.getVariable(variableName)?.value;
  const filteredCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return candidates;
    return candidates.filter((value) => value.toLowerCase().includes(normalizedQuery));
  }, [candidates, query]);
  const parsedPreview = useMemo(
    () => (batchText.trim() ? parseValues(batchText, candidates) : []),
    [batchText, candidates],
  );

  const handleBatchAdd = async () => {
    if (parsedPreview.length === 0) return;
    await qs.addCandidateValues(variableName, parsedPreview);
    setBatchText("");
  };

  return (
    <div className="h-full min-h-0 grid grid-rows-[auto_auto_auto_minmax(0,1fr)_auto_auto] bg-surface">
      <CandidateHeader
        onBack={onBack}
        backTitle={t("variableQuick.backToCandidates")}
        title={variableName}
      />

      <div className="px-4 py-2 text-xs text-text-subtle border-b border-border-subtle bg-surface-highlight/30">
        {t("variableQuick.candidateDescription", { name: variableName })}
      </div>

      <div className="px-4 py-2 border-b border-border-subtle">
        <PlainInput
          label={t("variableQuick.searchCandidates")}
          defaultValue={query}
          onChange={setQuery}
          placeholder={t("variableQuick.searchCandidates")}
        />
      </div>

      <div className="min-h-0 overflow-y-auto">
        {filteredCandidates.length === 0 ? (
          <EmptyCandidates>
            {query.trim() ? t("common.noMatches") : t("variableQuick.noCandidates")}
          </EmptyCandidates>
        ) : (
          filteredCandidates.map((value) => (
            <div
              key={value}
              className="group min-h-9 flex items-center gap-2 px-4 border-b border-border-subtle hover:bg-surface-highlight"
            >
              <Icon
                icon={value === currentValue ? "check" : "empty"}
                size="xs"
                color={value === currentValue ? "primary" : "secondary"}
              />
              <span className="font-mono text-sm truncate flex-1 min-w-0" title={value}>
                {value}
              </span>
              <IconButton
                size="sm"
                icon="trash"
                iconColor="secondary"
                title={t("variableQuick.removeCandidate")}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                onClick={() => fireAndForget(qs.removeCandidateValue(variableName, value))}
              />
            </div>
          ))
        )}
      </div>

      <div className="px-4 py-3 border-t border-border-subtle bg-surface-highlight/30">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <div>
            <div className="text-xs font-medium text-text-subtle">
              {t("variableQuick.batchAdd")}
            </div>
          </div>
          <Button
            size="xs"
            color="primary"
            disabled={parsedPreview.length === 0}
            onClick={() => fireAndForget(handleBatchAdd())}
          >
            {t("variableQuick.batchAddCount", { count: parsedPreview.length })}
          </Button>
        </div>
        <textarea
          className="w-full h-14 resize-none rounded-sm border border-border-subtle bg-surface px-2 py-1.5 text-xs font-mono text-text outline-none placeholder:text-text-subtlest focus:border-border-focus"
          value={batchText}
          placeholder={t("variableQuick.batchAddHint")}
          spellCheck={false}
          onChange={(event) => setBatchText(event.target.value)}
        />
        {parsedPreview.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5 min-w-0 text-xs text-text-subtle">
            <Icon icon="check_circle" size="xs" color="success" />
            <span>{t("variableQuick.newValuesCount", { count: parsedPreview.length })}</span>
            <span className="font-mono truncate text-text-subtlest">
              {parsedPreview.slice(0, 4).join(", ")}
              {parsedPreview.length > 4 ? "…" : ""}
            </span>
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-border-subtle text-xs text-text-subtlest">
        {t("variableQuick.candidateCount", { count: candidates.length })}
      </div>
    </div>
  );
}

function CandidateHeader({
  onBack,
  backTitle,
  title,
}: {
  onBack: () => void;
  backTitle: string;
  title: string;
}) {
  return (
    <HStack space={1} className="h-lg px-3 items-center border-b border-border-subtle min-w-0">
      <IconButton
        icon="arrow_left"
        size="sm"
        iconColor="secondary"
        title={backTitle}
        onClick={onBack}
      />
      <Heading className="font-mono truncate flex-1 min-w-0">{title}</Heading>
    </HStack>
  );
}

function EmptyCandidates({ children }: { children: ReactNode }) {
  return (
    <div
      className={classNames(
        "m-4 min-h-24 rounded-md border border-dashed border-border-subtle",
        "flex items-center justify-center text-sm text-text-subtlest",
      )}
    >
      {children}
    </div>
  );
}
