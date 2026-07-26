import { linter } from "@codemirror/lint";
import type { HttpRequest } from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import { Banner, Icon } from "@yaakapp-internal/ui";
import { useTranslation } from "@yaakapp-internal/i18n";
import { useCallback, useMemo } from "react";
import { useKeyValue } from "../hooks/useKeyValue";
import { fireAndForget } from "../lib/fireAndForget";
import { textLikelyContainsJsonComments } from "../lib/jsonComments";
import type { DropdownItem } from "./core/Dropdown";
import { Dropdown } from "./core/Dropdown";
import type { EditorProps } from "./core/Editor/Editor";
import { jsonParseLinter } from "./core/Editor/json-lint";
import { Editor } from "./core/Editor/LazyEditor";
import { IconButton } from "./core/IconButton";
import { IconTooltip } from "./core/IconTooltip";
import { showDialog } from "../lib/dialog";
import { AiRequestConversionDialog } from "./AiRequestConversionDialog";

interface Props {
  forceUpdateKey: string;
  heightMode: EditorProps["heightMode"];
  request: HttpRequest;
}

export function JsonBodyEditor({ forceUpdateKey, heightMode, request }: Props) {
  const { t } = useTranslation();
  const handleChange = useCallback(
    (text: string) => patchModel(request, { body: { ...request.body, text } }),
    [request],
  );

  const autoFix = request.body?.sendJsonComments !== true;

  const lintExtension = useMemo(
    () =>
      linter(
        jsonParseLinter(
          autoFix
            ? { allowComments: true, allowTrailingCommas: true }
            : { allowComments: false, allowTrailingCommas: false },
        ),
      ),
    [autoFix],
  );

  const hasComments = useMemo(
    () => textLikelyContainsJsonComments(request.body?.text ?? ""),
    [request.body?.text],
  );

  const { value: bannerDismissed, set: setBannerDismissed } = useKeyValue<boolean>({
    namespace: "no_sync",
    key: ["json-fix-3", request.workspaceId],
    fallback: false,
  });

  const handleToggleAutoFix = useCallback(() => {
    const newBody = { ...request.body };
    if (autoFix) {
      newBody.sendJsonComments = true;
    } else {
      delete newBody.sendJsonComments;
    }
    fireAndForget(patchModel(request, { body: newBody }));
  }, [request, autoFix]);

  const handleDropdownOpen = useCallback(() => {
    if (!bannerDismissed) {
      fireAndForget(setBannerDismissed(true));
    }
  }, [bannerDismissed, setBannerDismissed]);

  const showBanner = hasComments && autoFix && !bannerDismissed;

  const stripMessage = t("jsonEditor.autoFixHelp");
  const actions = useMemo<EditorProps["actions"]>(
    () => [
      showBanner && (
        <Banner color="notice" className="opacity-100! h-sm py-0! px-2! flex items-center text-xs">
          <p className="inline-flex items-center gap-1 min-w-0">
            <span className="truncate">{t("jsonEditor.autoFixEnabled")}</span>
            <Icon icon="arrow_right" size="sm" className="opacity-disabled" />
          </p>
        </Banner>
      ),
      <div key="settings" className="opacity-100! shadow!">
        <Dropdown
          onOpen={handleDropdownOpen}
          items={
            [
              {
                label: t("jsonEditor.autoFix"),
                keepOpenOnSelect: true,
                onSelect: handleToggleAutoFix,
                rightSlot: <IconTooltip content={stripMessage} />,
                leftSlot: (
                  <Icon icon={autoFix ? "check_square_checked" : "check_square_unchecked"} />
                ),
              },
            ] satisfies DropdownItem[]
          }
        >
          <IconButton size="sm" variant="border" icon="settings" title={t("jsonEditor.settings")} />
        </Dropdown>
      </div>,
      <IconButton
        key="convert-ai"
        size="sm"
        variant="border"
        icon="arrow_up_down"
        title={t("ai.convert")}
        onClick={() =>
          showDialog({
            id: "convert-ai-request-body",
            title: t("ai.title"),
            size: "lg",
            noScroll: true,
            render: ({ hide }) => <AiRequestConversionDialog request={request} hide={hide} />,
          })
        }
      />,
    ],
    [handleDropdownOpen, handleToggleAutoFix, autoFix, request, showBanner, t],
  );

  return (
    <Editor
      forceUpdateKey={forceUpdateKey}
      autocompleteFunctions
      autocompleteVariables
      placeholder="..."
      heightMode={heightMode}
      defaultValue={`${request.body?.text ?? ""}`}
      language="json"
      onChange={handleChange}
      stateKey={`json.${request.id}`}
      actions={actions}
      lintExtension={lintExtension}
    />
  );
}
