import { useTranslation } from "@yaakapp-internal/i18n";
import type { HttpRequest } from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import { Banner, HStack, Icon, VStack } from "@yaakapp-internal/ui";
import { useMemo, useState } from "react";
import {
  convertAiRequestBody,
  detectAiRequestFormat,
  parseAiRequestBody,
  stringifyAiRequestBody,
  type AiRequestFormat,
  type ConversionWarningCode,
} from "../lib/aiRequestConversion";
import { convertAiRequestEndpoint, type EndpointNote } from "../lib/aiRequestEndpoint";
import { Button } from "./core/Button";
import { Checkbox } from "./core/Checkbox";
import { DiffViewer } from "./core/Editor/DiffViewer";
import { Select } from "./core/Select";

interface Props {
  request: HttpRequest;
  hide: () => void;
}

const FORMATS: AiRequestFormat[] = [
  "anthropic_messages",
  "openai_chat_completions",
  "openai_responses",
];

const WARNING_KEYS: Record<ConversionWarningCode, string> = {
  dropped_field: "ai.warnDroppedField",
  dropped_content: "ai.warnDroppedContent",
  dropped_image: "ai.warnDroppedImage",
  dropped_tool: "ai.warnDroppedTool",
  dropped_tool_choice: "ai.warnDroppedToolChoice",
  dropped_tool_result_image: "ai.warnDroppedToolResultImage",
  dropped_stop: "ai.warnDroppedStop",
  unsupported_role: "ai.warnUnsupportedRole",
  non_message_item: "ai.warnNonMessageItem",
  model_preserved: "ai.warnModelPreserved",
  defaulted_max_tokens: "ai.warnDefaultedMaxTokens",
  invalid_tool_arguments: "ai.warnInvalidToolArguments",
};

const NOTE_KEYS: Record<EndpointNote, string> = {
  url_not_recognized: "ai.noteUrlNotRecognized",
  auth_token_missing: "ai.noteAuthTokenMissing",
};

export function AiRequestConversionDialog({ request, hide }: Props) {
  const { t } = useTranslation();
  const original = String(request.body?.text ?? "");
  const parsed = useMemo(() => {
    try {
      return { document: parseAiRequestBody(original), error: null };
    } catch (error) {
      return { document: null, error: String(error) };
    }
  }, [original]);
  const inferred =
    detectAiRequestFormat(parsed.document?.body, request.url) ?? "openai_chat_completions";
  const [source, setSource] = useState<AiRequestFormat>(inferred);
  const [target, setTarget] = useState<AiRequestFormat>(
    FORMATS.find((format) => format !== inferred) ?? "openai_responses",
  );
  const [updateEndpoint, setUpdateEndpoint] = useState<boolean>(true);

  const result = useMemo(() => {
    if (parsed.document == null || source === target) return null;
    try {
      return convertAiRequestBody(parsed.document.body, source, target);
    } catch {
      return null;
    }
  }, [parsed.document, source, target]);
  const endpoint = useMemo(
    () => convertAiRequestEndpoint({ url: request.url, headers: request.headers }, source, target),
    [request.url, request.headers, source, target],
  );
  const modified =
    result == null || parsed.document == null
      ? original
      : stringifyAiRequestBody(result.body, parsed.document.templates);
  const options = FORMATS.map((format) => ({ label: formatLabel(format, t), value: format }));
  const hasEndpointChanges = endpoint.url != null || endpoint.headers != null;

  return (
    <div className="h-full min-h-0 grid grid-rows-[auto_minmax(16rem,1fr)_auto] gap-3 pb-3">
      <HStack space={3} alignItems="end">
        <Select
          name="ai-conversion-source"
          label={t("ai.source")}
          value={source}
          options={options}
          onChange={setSource}
        />
        <Icon icon="arrow_right" className="mb-2" />
        <Select
          name="ai-conversion-target"
          label={t("ai.target")}
          value={target}
          options={options}
          onChange={setTarget}
        />
      </HStack>

      <div className="min-h-0 border border-border-subtle rounded-md overflow-hidden">
        <DiffViewer original={original} modified={modified} />
      </div>

      <VStack space={2}>
        {parsed.error != null ? <Banner color="danger">{t("ai.invalidJson")}</Banner> : null}
        {source === target ? <Banner color="notice">{t("ai.sameFormat")}</Banner> : null}
        {result != null ? (
          <VStack space={1.5}>
            <Checkbox
              checked={updateEndpoint}
              title={t("ai.updateEndpoint")}
              onChange={setUpdateEndpoint}
            />
            {updateEndpoint && (hasEndpointChanges || endpoint.notes.length > 0) ? (
              <ul className="list-disc pl-5 text-sm text-text-subtle space-y-0.5">
                {endpoint.url != null ? (
                  <li>{t("ai.endpointUrl", { url: endpoint.url })}</li>
                ) : null}
                {endpoint.headers != null ? <li>{t("ai.endpointHeaders")}</li> : null}
                {endpoint.notes.map((note) => (
                  <li key={note}>{t(NOTE_KEYS[note])}</li>
                ))}
              </ul>
            ) : null}
          </VStack>
        ) : null}
        {result != null && result.warnings.length > 0 ? (
          <Banner color="notice">
            <div className="font-medium mb-1">{t("ai.warnings")}</div>
            <ul className="list-disc pl-5 text-sm space-y-1">
              {result.warnings.map((warning, index) => (
                <li key={`${warning.path ?? warning.code}:${index}`}>
                  {warning.path ? `${warning.path}: ` : ""}
                  {t(WARNING_KEYS[warning.code], warning.params)}
                </li>
              ))}
            </ul>
          </Banner>
        ) : null}
        <HStack space={2} justifyContent="end">
          <Button variant="border" onClick={hide}>
            {t("common.cancel")}
          </Button>
          <Button
            color="primary"
            disabled={result == null}
            onClick={async () => {
              if (result == null) return;
              await patchModel(request, {
                body: { ...request.body, text: modified },
                ...(updateEndpoint && endpoint.url != null && { url: endpoint.url }),
                ...(updateEndpoint && endpoint.headers != null && { headers: endpoint.headers }),
              });
              hide();
            }}
          >
            {t("ai.apply")}
          </Button>
        </HStack>
      </VStack>
    </div>
  );
}

function formatLabel(format: AiRequestFormat, t: (key: string) => string): string {
  if (format === "anthropic_messages") return t("ai.anthropic");
  if (format === "openai_responses") return t("ai.responses");
  return t("ai.chat");
}
