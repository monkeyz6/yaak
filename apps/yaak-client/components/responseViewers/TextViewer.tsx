import classNames from "classnames";
import { useTranslation } from "@yaakapp-internal/i18n";
import type { ReactNode } from "react";
import { Children, useCallback, useMemo } from "react";
import { createGlobalState } from "react-use";
import { useDebouncedValue } from "@yaakapp-internal/ui";
import { useFormatText } from "../../hooks/useFormatText";
import type { JsonPathAtPosition } from "../../lib/responseJsonPath";
import type { EditorProps } from "../core/Editor/Editor";
import { hyperlink } from "../core/Editor/hyperlink/extension";
import { Editor } from "../core/Editor/LazyEditor";
import { postActionExtractor } from "../core/Editor/postAction/extension";
import { IconButton } from "../core/IconButton";
import { Input } from "../core/Input";

const defaultExtraExtensions = [hyperlink];

interface Props {
  text: string;
  language: EditorProps["language"];
  stateKey: string | null;
  filterStateKey?: string | null;
  pretty?: boolean;
  className?: string;
  footerActions?: ReactNode;
  onFilter?: (filter: string) => {
    data: string | null | undefined;
    isPending: boolean;
    error: boolean;
  };
  /** Offer to extract hovered JSON values into a post-response action */
  onExtractJsonPath?: (result: JsonPathAtPosition) => void;
}

const useFilterText = createGlobalState<Record<string, string | null>>({});

export function TextViewer({
  language,
  text,
  stateKey,
  filterStateKey,
  pretty,
  className,
  footerActions,
  onFilter,
  onExtractJsonPath,
}: Props) {
  const { t } = useTranslation();
  const extraExtensions = useMemo(
    () =>
      onExtractJsonPath != null && language === "json"
        ? [hyperlink, postActionExtractor(onExtractJsonPath)]
        : defaultExtraExtensions,
    [onExtractJsonPath, language],
  );
  const filterKey = filterStateKey ?? stateKey;
  const [filterTextMap, setFilterTextMap] = useFilterText();
  const filterText = filterKey ? (filterTextMap[filterKey] ?? null) : null;
  const debouncedFilterText = useDebouncedValue(filterText);
  const setFilterText = useCallback(
    (v: string | null) => {
      if (!filterKey) return;
      setFilterTextMap((m) => ({ ...m, [filterKey]: v }));
    },
    [filterKey, setFilterTextMap],
  );

  const isSearching = filterText != null;
  const filteredResponse =
    onFilter && debouncedFilterText
      ? onFilter(debouncedFilterText)
      : { data: null, isPending: false, error: false };

  const toggleSearch = useCallback(() => {
    if (isSearching) {
      setFilterText(null);
    } else {
      setFilterText("");
    }
  }, [isSearching, setFilterText]);

  const canFilter = onFilter && (language === "json" || language === "xml" || language === "html");

  const actions = useMemo<ReactNode[]>(() => {
    const nodes: ReactNode[] = isSearching ? [] : Children.toArray(footerActions);

    if (!canFilter) return nodes;

    if (isSearching) {
      nodes.push(
        <div key="input" className="w-full opacity-100!">
          <Input
            key={filterKey ?? "filter"}
            validate={!filteredResponse.error}
            hideLabel
            autoFocus
            containerClassName="bg-surface"
            size="sm"
            placeholder={
              language === "json" ? t("response.jsonPathExpression") : t("response.xpathExpression")
            }
            label={t("response.filterExpression")}
            name="filter"
            defaultValue={filterText}
            onKeyDown={(e) => e.key === "Escape" && toggleSearch()}
            onChange={setFilterText}
            stateKey={filterKey ? `filter.${filterKey}` : null}
          />
        </div>,
      );
    }

    nodes.push(
      <IconButton
        key="icon"
        size="sm"
        isLoading={filteredResponse.isPending}
        icon={isSearching ? "x" : "filter"}
        title={isSearching ? t("response.closeFilter") : t("response.filterResponse")}
        onClick={toggleSearch}
        className={classNames("border border-border-subtle!", isSearching && "opacity-100!")}
      />,
    );

    return nodes;
  }, [
    canFilter,
    footerActions,
    filterKey,
    filterText,
    filteredResponse.error,
    filteredResponse.isPending,
    isSearching,
    language,
    setFilterText,
    toggleSearch,
  ]);

  const formattedBody = useFormatText({ text, language, pretty: pretty ?? false });
  if (formattedBody == null) {
    return null;
  }

  let body: string;
  if (isSearching && filterText?.length > 0) {
    if (filteredResponse.error) {
      body = "";
    } else {
      body = filteredResponse.data != null ? filteredResponse.data : "";
    }
  } else {
    body = formattedBody;
  }

  // Decode unicode sequences in the text to readable characters
  if (language === "json" && pretty) {
    body = decodeUnicodeLiterals(body);
    body = body.replace(/\\\//g, "/"); // Hide unnecessary escaping of '/' by some older frameworks
  }

  return (
    <Editor
      readOnly
      className={className}
      defaultValue={body}
      language={language}
      actions={actions}
      extraExtensions={extraExtensions}
      stateKey={stateKey}
    />
  );
}

/** Convert \uXXXX to actual Unicode characters */
function decodeUnicodeLiterals(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    const charCode = Number.parseInt(hex, 16);
    return String.fromCharCode(charCode);
  });
}
