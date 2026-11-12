import { useTranslation } from "@yaakapp-internal/i18n";
import classNames from "classnames";
import { useCallback, useRef, useState } from "react";
import { useKeyValue } from "../../hooks/useKeyValue";
import { BulkPairEditor } from "./BulkPairEditor";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import type { PairEditorHandle, PairEditorProps } from "./PairEditor";
import { PairEditor } from "./PairEditor";

interface Props extends PairEditorProps {
  preferenceName: string;
  forcedEnvironmentId?: string;
}

export function PairOrBulkEditor({
  preferenceName,
  onSelectionChange,
  onEmptyCountChange,
  setRef,
  showEmptyCleanup = true,
  ...props
}: Props) {
  const { t } = useTranslation();
  const { value: useBulk, set: setUseBulk } = useKeyValue<boolean>({
    namespace: "global",
    key: ["bulk_edit", preferenceName],
    fallback: false,
  });
  const [selectionCount, setSelectionCount] = useState(0);
  const [emptyCount, setEmptyCount] = useState(0);
  const handleRef = useRef<PairEditorHandle | null>(null);

  const handleSelectionChange = useCallback(
    (count: number) => {
      setSelectionCount(count);
      onSelectionChange?.(count);
    },
    [onSelectionChange],
  );
  const handleEmptyCountChange = useCallback(
    (count: number) => {
      setEmptyCount(count);
      onEmptyCountChange?.(count);
    },
    [onEmptyCountChange],
  );
  const handleSetRef = useCallback(
    (handle: PairEditorHandle) => {
      handleRef.current = handle;
      setRef?.(handle);
    },
    [setRef],
  );

  const showCleanup = showEmptyCleanup && !useBulk && emptyCount > 0;

  return (
    <div className="relative h-full w-full group/wrapper">
      {useBulk ? (
        <BulkPairEditor {...props} setRef={setRef} />
      ) : (
        <PairEditor
          {...props}
          setRef={handleSetRef}
          showEmptyCleanup={false}
          onEmptyCountChange={handleEmptyCountChange}
          onSelectionChange={handleSelectionChange}
        />
      )}
      {selectionCount === 0 && (
        <div
          className={classNames(
            "absolute right-0 bottom-0 flex items-center gap-1",
            "transition-opacity opacity-0 group-hover/wrapper:opacity-100 focus-within:opacity-100",
          )}
        >
          {showCleanup && (
            <Button
              size="xs"
              variant="border"
              className="bg-surface shadow"
              title={t("pairEditor.removeEmptyTitle")}
              onClick={() => handleRef.current?.removeEmptyValues()}
            >
              {t("pairEditor.removeEmpty", { count: emptyCount })}
            </Button>
          )}
          <IconButton
            size="sm"
            variant="border"
            title={useBulk ? "Enable form edit" : "Enable bulk edit"}
            className="shadow bg-surface hover:text opacity-80 hover:opacity-100!"
            onClick={() => setUseBulk((b) => !b)}
            icon={useBulk ? "table" : "file_code"}
          />
        </div>
      )}
    </div>
  );
}
