import { linter } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { jsoncLanguage } from "@shopify/lang-jsonc";
import { Trans, useTranslation } from "@yaakapp-internal/i18n";
import type { GrpcRequest } from "@yaakapp-internal/models";
import { FormattedError, InlineCode, VStack } from "@yaakapp-internal/ui";
import classNames from "classnames";
import {
  handleRefresh,
  jsonCompletion,
  jsonSchemaLinter,
  stateExtensions,
  updateSchema,
} from "codemirror-json-schema";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReflectResponseService } from "../hooks/useGrpc";
import { showAlert } from "../lib/alert";
import { showDialog } from "../lib/dialog";
import { Button } from "./core/Button";
import type { EditorProps } from "./core/Editor/Editor";
import { Editor } from "./core/Editor/LazyEditor";
import { GrpcProtoSelectionDialog } from "./GrpcProtoSelectionDialog";

type Props = Pick<EditorProps, "heightMode" | "onChange" | "className" | "forceUpdateKey"> & {
  services: ReflectResponseService[] | null;
  reflectionError?: string;
  reflectionLoading?: boolean;
  request: GrpcRequest;
  protoFiles: string[];
};

export function GrpcEditor({
  services,
  reflectionError,
  reflectionLoading,
  request,
  protoFiles,
  ...extraEditorProps
}: Props) {
  const { t } = useTranslation();
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const handleInitEditorViewRef = useCallback((h: EditorView | null) => {
    setEditorView(h);
  }, []);

  // Find the schema for the selected service and method and update the editor
  useEffect(() => {
    if (
      editorView == null ||
      services === null ||
      request.service === null ||
      request.method === null
    ) {
      return;
    }

    const s = services.find((s) => s.name === request.service);
    if (s == null) {
      console.log("Failed to find service", { service: request.service, services });
      showAlert({
        id: "grpc-find-service-error",
        title: t("grpc.cantFindService"),
        body: (
          <Trans
            i18nKey="grpc.findServiceFailed"
            values={{ service: request.service }}
            components={{ 1: <InlineCode /> }}
          />
        ),
      });
      return;
    }

    const schema = s.methods.find((m) => m.name === request.method)?.schema;
    if (request.method != null && schema == null) {
      console.log("Failed to find method", { method: request.method, methods: s?.methods });
      showAlert({
        id: "grpc-find-schema-error",
        title: t("grpc.cantFindMethod"),
        body: (
          <Trans
            i18nKey="grpc.findMethodFailed"
            values={{ method: request.method, service: request.service }}
            components={{ 1: <InlineCode />, 3: <InlineCode /> }}
          />
        ),
      });
      return;
    }

    if (schema == null) {
      return;
    }

    try {
      updateSchema(editorView, JSON.parse(schema));
    } catch (err) {
      showAlert({
        id: "grpc-parse-schema-error",
        title: t("grpc.parseSchemaFailed"),
        body: (
          <VStack space={4}>
            <p>
              <Trans
                i18nKey="grpc.forServiceMethod"
                values={{ service: request.service, method: request.method }}
                components={{ 1: <InlineCode />, 3: <InlineCode /> }}
              />
            </p>
            <FormattedError>{String(err)}</FormattedError>
          </VStack>
        ),
      });
    }
  }, [editorView, services, request.method, request.service, t]);

  const extraExtensions = useMemo(
    () => [
      linter(jsonSchemaLinter(), {
        delay: 200,
        needsRefresh: handleRefresh,
      }),
      jsoncLanguage.data.of({
        autocomplete: jsonCompletion(),
      }),
      stateExtensions({}),
    ],
    [],
  );

  const reflectionUnavailable = reflectionError?.match(/unimplemented/i);
  reflectionError = reflectionUnavailable ? undefined : reflectionError;

  const actions = useMemo(
    () => [
      <div key="reflection" className={classNames(services == null && "opacity-100!")}>
        <Button
          size="xs"
          color={
            reflectionLoading
              ? "secondary"
              : reflectionUnavailable
                ? "info"
                : reflectionError
                  ? "danger"
                  : "secondary"
          }
          isLoading={reflectionLoading}
          onClick={() => {
            showDialog({
              title: t("grpc.configureSchema"),
              size: "md",
              id: "reflection-failed",
              render: ({ hide }) => <GrpcProtoSelectionDialog onDone={hide} />,
            });
          }}
        >
          {reflectionLoading
            ? t("grpc.inspectingSchema")
            : reflectionUnavailable
              ? t("grpc.selectProtoFiles")
              : reflectionError
                ? t("grpc.serverError")
                : protoFiles.length > 0
                  ? protoFiles.length === 1
                    ? t("grpc.fileCountOne", { count: protoFiles.length })
                    : t("grpc.fileCountMany", { count: protoFiles.length })
                  : services != null && protoFiles.length === 0
                    ? t("grpc.schemaDetected")
                    : t("grpc.selectSchema")}
        </Button>
      </div>,
    ],
    [protoFiles.length, reflectionError, reflectionLoading, reflectionUnavailable, services, t],
  );

  return (
    <div className="h-full w-full grid grid-cols-1 grid-rows-[minmax(0,100%)_auto_auto_minmax(0,auto)]">
      <Editor
        setRef={handleInitEditorViewRef}
        language="json"
        autocompleteFunctions
        autocompleteVariables
        defaultValue={request.message}
        heightMode="auto"
        placeholder="..."
        extraExtensions={extraExtensions}
        actions={actions}
        stateKey={`grpc_message.${request.id}`}
        {...extraEditorProps}
      />
    </div>
  );
}
