import { linter } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { jsoncLanguage } from "@shopify/lang-jsonc";
import { type GrpcRequest, patchModel } from "@yaakapp-internal/models";
import { Banner, FormattedError, Icon, InlineCode, VStack } from "@yaakapp-internal/ui";
import { Trans, useTranslation } from "@yaakapp-internal/i18n";
import {
  handleRefresh,
  jsonCompletion,
  jsonSchemaLinter,
  stateExtensions,
  updateSchema,
} from "codemirror-json-schema";
import type { JSONSchema7 } from "json-schema";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReflectResponseService } from "../hooks/useGrpc";
import { wasUpdatedExternally } from "../hooks/useRequestUpdateKey";
import { showAlert } from "../lib/alert";
import { showConfirm } from "../lib/confirm";
import { showDialog } from "../lib/dialog";
import type { JsonSchema } from "../lib/jsonSchemaExample";
import { buildExampleFromSchema } from "../lib/jsonSchemaExample";
import { queryClient } from "../lib/queryClient";
import { Button } from "./core/Button";
import { Dropdown } from "./core/Dropdown";
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

type MethodSchema =
  | { type: "none" }
  | { type: "schema"; schema: JsonSchema }
  | { type: "error"; id: string; title: string; body: ReactNode; log: unknown[] };

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

  // Find the schema for the selected service and method
  const methodSchema = useMemo<MethodSchema>(() => {
    if (services === null || request.service === null || request.method === null) {
      return { type: "none" };
    }

    const s = services.find((s) => s.name === request.service);
    if (s == null) {
      return {
        type: "error",
        id: "grpc-find-service-error",
        title: t("grpc.cantFindService"),
        body: (
          <Trans
            i18nKey="grpc.findServiceFailed"
            values={{ service: request.service }}
            components={{ 1: <InlineCode /> }}
          />
        ),
        log: ["Failed to find service", { service: request.service, services }],
      };
    }

    const schema = s.methods.find((m) => m.name === request.method)?.schema;
    if (schema == null) {
      return {
        type: "error",
        id: "grpc-find-schema-error",
        title: t("grpc.cantFindMethod"),
        body: (
          <Trans
            i18nKey="grpc.findMethodFailed"
            values={{ method: request.method, service: request.service }}
            components={{ 1: <InlineCode />, 3: <InlineCode /> }}
          />
        ),
        log: ["Failed to find method", { method: request.method, methods: s.methods }],
      };
    }

    try {
      return { type: "schema", schema: JSON.parse(schema) as JsonSchema };
    } catch (err) {
      return {
        type: "error",
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
        log: ["Failed to parse schema", err],
      };
    }
  }, [services, request.method, request.service, t]);

  useEffect(() => {
    if (methodSchema.type !== "error") return;
    console.log(...methodSchema.log);
    showAlert({ id: methodSchema.id, title: methodSchema.title, body: methodSchema.body });
  }, [methodSchema]);

  // Update the editor whenever the schema changes
  useEffect(() => {
    if (editorView == null || methodSchema.type !== "schema") return;
    updateSchema(editorView, methodSchema.schema as JSONSchema7);
  }, [editorView, methodSchema]);

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

  const handleGenerateExample = useCallback(async () => {
    if (methodSchema.type !== "schema") return;

    if (request.message.trim() !== "") {
      const confirmed = await showConfirm({
        id: "grpc-generate-example",
        title: t("grpc.generateExample"),
        description: t("grpc.generateExampleConfirm"),
        confirmText: t("grpc.generate"),
      });
      if (!confirmed) return;
    }

    const message = JSON.stringify(buildExampleFromSchema(methodSchema.schema), null, 2);
    await patchModel(request, { message });

    // Force the editor to pick up the new message
    wasUpdatedExternally(request.id);
  }, [methodSchema, request, t]);

  // The reflect query is keyed by request, url and proto files, so a prefix invalidate
  // reaches it without threading a refetch down from the connection layout.
  const handleReloadSchema = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["grpc_reflect", request.id] }),
    [request.id],
  );

  const handleShowReflectionError = useCallback(() => {
    showDialog({
      id: "grpc-reflection-error",
      title: t("grpc.reflectionFailedTitle"),
      size: "sm",
      render: ({ hide }) => (
        <>
          <FormattedError>{reflectionError ?? "unknown"}</FormattedError>
          <div className="w-full my-4">
            <Button
              className="ml-auto"
              color="primary"
              size="sm"
              onClick={async () => {
                hide();
                await handleReloadSchema();
              }}
            >
              {t("common.retry")}
            </Button>
          </div>
        </>
      ),
    });
  }, [handleReloadSchema, reflectionError, t]);

  const actions = useMemo(
    () => [
      // Matches the GraphQL editor: one always-visible control labelled by schema state,
      // with everything schema-related behind it.
      <div key="schema" className="opacity-100!">
        <Dropdown
          items={[
            {
              // Hidden for servers without reflection, which isn't an error
              hidden: !reflectionError,
              type: "content",
              label: (
                <Banner color="danger">
                  <p className="mb-1">{t("grpc.reflectionFailed")}</p>
                  <Button
                    size="xs"
                    color="danger"
                    variant="border"
                    onClick={handleShowReflectionError}
                  >
                    {t("grpc.viewError")}
                  </Button>
                </Banner>
              ),
            },
            {
              label: t("grpc.generateExampleMessage"),
              leftSlot: <Icon icon="magic_wand" />,
              disabled: methodSchema.type !== "schema",
              onSelect: handleGenerateExample,
            },
            { type: "separator" },
            {
              label: t("grpc.reloadSchema"),
              leftSlot: <Icon icon="refresh" spin={reflectionLoading} />,
              keepOpenOnSelect: true,
              onSelect: handleReloadSchema,
            },
            {
              label:
                protoFiles.length > 0
                  ? t("grpc.selectProtoFilesEllipsis")
                  : t("grpc.configureSchemaEllipsis"),
              leftSlot: <Icon icon="settings" />,
              onSelect: () => {
                showDialog({
                  title: t("grpc.configureSchema"),
                  size: "md",
                  className: "h-[30rem]",
                  id: "grpc-configure-schema",
                  render: ({ hide }) => <GrpcProtoSelectionDialog onDone={hide} />,
                });
              },
            },
          ]}
        >
          <Button
            size="sm"
            variant="border"
            title={t("grpc.schema")}
            forDropdown
            isLoading={reflectionLoading}
            color={reflectionUnavailable ? "info" : reflectionError ? "danger" : "default"}
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
                    : services != null
                      ? t("grpc.schemaDetected")
                      : t("grpc.selectSchema")}
          </Button>
        </Dropdown>
      </div>,
    ],
    [
      handleGenerateExample,
      handleReloadSchema,
      handleShowReflectionError,
      methodSchema.type,
      protoFiles.length,
      reflectionError,
      reflectionLoading,
      reflectionUnavailable,
      services,
      t,
    ],
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
