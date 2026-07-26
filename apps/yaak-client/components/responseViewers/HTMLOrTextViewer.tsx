import { i18n, useTranslation } from "@yaakapp-internal/i18n";
import type { HttpResponse, PostResponseAction } from "@yaakapp-internal/models";
import { getModel, patchModelById } from "@yaakapp-internal/models";
import { useCallback, useMemo, useState } from "react";
import { useCopyHttpResponse } from "../../hooks/useCopyHttpResponse";
import { useResponseBodyText } from "../../hooks/useResponseBodyText";
import { useSaveResponse } from "../../hooks/useSaveResponse";
import { languageFromContentType } from "../../lib/contentType";
import { generateId } from "../../lib/generateId";
import { getContentTypeFromHeaders } from "../../lib/model_util";
import { jotaiStore } from "../../lib/jotai";
import { showPromptForm } from "../../lib/prompt-form";
import { recentlyAddedPostActionIdAtom } from "../../lib/postActionHighlight";
import type { JsonPathAtPosition } from "../../lib/responseJsonPath";
import { showToast } from "../../lib/toast";
import type { EditorProps } from "../core/Editor/Editor";
import { IconButton } from "../core/IconButton";
import { setActiveTab } from "../core/Tabs/Tabs";
import { EmptyStateText } from "../EmptyStateText";
import { HTTP_REQUEST_TABS_STORAGE_KEY, TAB_POST_RESPONSE } from "../HttpRequestPane";
import { TextViewer } from "./TextViewer";
import { WebPageViewer } from "./WebPageViewer";

interface Props {
  response: HttpResponse;
  pretty: boolean;
  textViewerClassName?: string;
}

export function HTMLOrTextViewer({ response, pretty, textViewerClassName }: Props) {
  const { t } = useTranslation();
  const rawTextBody = useResponseBodyText({ response, filter: null });
  const contentType = getContentTypeFromHeaders(response.headers);
  const language = languageFromContentType(contentType, rawTextBody.data ?? "");

  if (rawTextBody.isLoading || response.state === "initialized") {
    return null;
  }

  if (language === "html" && pretty) {
    return <WebPageViewer html={rawTextBody.data ?? ""} baseUrl={response.url} />;
  }
  if (rawTextBody.data == null) {
    return <EmptyStateText>{t("response.emptyResponse")}</EmptyStateText>;
  }
  return (
    <HttpTextViewer
      response={response}
      text={rawTextBody.data}
      language={language}
      pretty={pretty}
      className={textViewerClassName}
    />
  );
}

interface HttpTextViewerProps {
  response: HttpResponse;
  text: string;
  language: EditorProps["language"];
  pretty: boolean;
  className?: string;
}

function HttpTextViewer({ response, text, language, pretty, className }: HttpTextViewerProps) {
  const { t } = useTranslation();
  const [currentFilter, setCurrentFilter] = useState<string | null>(null);
  const filteredBody = useResponseBodyText({ response, filter: currentFilter });
  const saveResponse = useSaveResponse(response);
  const copyResponse = useCopyHttpResponse(response);
  const actionsDisabled = response.state !== "closed" && response.status >= 100;

  const filterCallback = useMemo(
    () => (filter: string) => {
      setCurrentFilter(filter);
      return {
        data: filteredBody.data,
        isPending: filteredBody.isPending,
        error: !!filteredBody.error,
      };
    },
    [filteredBody],
  );

  const handleExtractJsonPath = useCallback(
    async (result: JsonPathAtPosition) => {
      const requestId = response.requestId;
      const values = await showPromptForm({
        id: "post-action-extract",
        title: i18n.t("postResponse.extractTitle"),
        inputs: [
          {
            type: "text",
            name: "jsonPath",
            label: i18n.t("postResponse.jsonPath"),
            defaultValue: result.path,
          },
          {
            type: "text",
            name: "variableName",
            label: i18n.t("postResponse.variable"),
            defaultValue: result.lastSegment ?? "",
          },
        ],
      });
      if (values == null) return;
      const jsonPath = String(values.jsonPath ?? "").trim();
      const variableName = String(values.variableName ?? "").trim();
      if (jsonPath === "" || variableName === "") return;

      const request = getModel("http_request", requestId);
      if (request == null) return;
      const action: PostResponseAction = {
        id: generateId(),
        enabled: true,
        type: "set_environment_variable",
        jsonPath,
        variableName,
        secure: false,
      };
      await patchModelById("http_request", requestId, {
        postResponseActions: [...request.postResponseActions, action],
      });
      jotaiStore.set(recentlyAddedPostActionIdAtom, action.id ?? null);
      await setActiveTab({
        storageKey: HTTP_REQUEST_TABS_STORAGE_KEY,
        activeTabKey: requestId,
        value: TAB_POST_RESPONSE,
      });
      showToast({
        id: "post-action-added",
        color: "success",
        message: i18n.t("postResponse.extractAdded", { name: variableName }),
      });
    },
    [response.requestId],
  );

  return (
    <TextViewer
      text={text}
      language={language}
      stateKey={`response.body.${response.id}`}
      filterStateKey={`response.body.${response.requestId}`}
      pretty={pretty}
      className={className}
      footerActions={[
        <IconButton
          key="save"
          size="sm"
          icon="save"
          title={t("response.saveResponseToFile")}
          disabled={actionsDisabled}
          onClick={() => saveResponse.mutate()}
          className="border !border-border-subtle"
        />,
        <IconButton
          key="copy"
          size="sm"
          icon="copy"
          title={t("response.copyResponseBody")}
          disabled={actionsDisabled}
          onClick={() => copyResponse.mutate()}
          className="border !border-border-subtle"
        />,
      ]}
      onFilter={filterCallback}
      onExtractJsonPath={handleExtractJsonPath}
    />
  );
}
