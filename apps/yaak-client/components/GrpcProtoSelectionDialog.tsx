import { Trans, useTranslation } from "@yaakapp-internal/i18n";
import type { GrpcRequest } from "@yaakapp-internal/models";
import { Banner, InlineCode, VStack } from "@yaakapp-internal/ui";
import { useActiveRequest } from "../hooks/useActiveRequest";
import { useGrpc } from "../hooks/useGrpc";
import { useGrpcProtoFiles } from "../hooks/useGrpcProtoFiles";
import { DialogFooter } from "./core/Dialog";
import { PathList } from "./core/PathList";
import { Link } from "./core/Link";
import { platform } from "@yaakapp-internal/platform";

interface Props {
  onDone: () => void;
}

export function GrpcProtoSelectionDialog(props: Props) {
  const request = useActiveRequest();
  if (request?.model !== "grpc_request") return null;

  return <GrpcProtoSelectionDialogWithRequest request={request} {...props} />;
}

function GrpcProtoSelectionDialogWithRequest({
  request,
  onDone,
}: Props & { request: GrpcRequest }) {
  const { t } = useTranslation();
  const protoFilesKv = useGrpcProtoFiles(request.id);
  const protoFiles = protoFilesKv.value ?? [];
  const grpc = useGrpc(request, null, protoFiles);
  const services = grpc.reflect.data;
  const serverReflection = protoFiles.length === 0 && services != null;
  let reflectError = grpc.reflect.error ?? null;
  const reflectionUnimplemented = String(reflectError).match(/unimplemented/i);

  if (reflectionUnimplemented) {
    reflectError = null;
  }

  if (request == null) {
    return null;
  }

  return (
    <>
      <VStack space={5} className="pb-4">
        {reflectError && (
          <Banner color="warning">
            <h1 className="font-bold">
              <Trans
                i18nKey="grpc.reflectionFailedOnUrl"
                values={{ url: request.url || "n/a" }}
                components={{ 1: <InlineCode /> }}
              />
            </h1>
            <p>{reflectError.trim()}</p>
          </Banner>
        )}
        {!serverReflection && services != null && services.length > 0 && (
          <Banner className="flex flex-col gap-2">
            <p>
              {t("grpc.foundServices")}{" "}
              {services?.slice(0, 5).map((s, i) => {
                return (
                  <span key={s.name + s.methods.map((m) => m.name).join(",")}>
                    <InlineCode>{s.name}</InlineCode>
                    {i === services.length - 1
                      ? ""
                      : i === services.length - 2
                        ? t("grpc.listAnd")
                        : t("grpc.listComma")}
                  </span>
                );
              })}
              {services != null &&
                services.length > 5 &&
                (services.length - 5 === 1
                  ? t("grpc.otherCountOne", { count: services.length - 5 })
                  : t("grpc.otherCountMany", { count: services.length - 5 }))}
            </p>
          </Banner>
        )}
        {serverReflection && services != null && services.length > 0 && (
          <Banner className="flex flex-col gap-2">
            <p>
              {t("grpc.serverReflectionFoundServices")}
              {services?.map((s, i) => {
                return (
                  <span key={s.name + s.methods.map((m) => m.name).join(",")}>
                    <InlineCode>{s.name}</InlineCode>
                    {i === services.length - 1
                      ? ""
                      : i === services.length - 2
                        ? t("grpc.listAnd")
                        : t("grpc.listComma")}
                  </span>
                );
              })}
              <Trans i18nKey="grpc.overrideSchemaHint" components={{ 1: <InlineCode /> }} />
            </p>
          </Banner>
        )}

        <PathList
          items={protoFiles.map((path) => ({
            path,
            icon: path.endsWith(".proto") ? "file_code" : "folder_code",
          }))}
          onRemove={async (path) => {
            await protoFilesKv.set(protoFiles.filter((p) => p !== path));
            await grpc.reflect.refetch();
          }}
          addLabel={t("grpc.addProtoFilesOrFolder")}
          addItems={[
            {
              label: t("grpc.protoFilesOption"),
              icon: "file_code",
              onSelect: async () => {
                const selected = await platform.dialog.open({
                  title: t("grpc.selectProtoFiles"),
                  multiple: true,
                  filters: [{ name: t("grpc.protoFiles"), extensions: ["proto"] }],
                });
                if (selected == null) return;
                const newFiles = selected.filter((p) => !protoFiles.includes(p));
                await protoFilesKv.set([...protoFiles, ...newFiles]);
                await grpc.reflect.refetch();
              },
            },
            {
              label: t("grpc.importFolderOption"),
              icon: "folder_code",
              onSelect: async () => {
                const selected = await platform.dialog.open({
                  title: t("grpc.selectProtoDirectory"),
                  directory: true,
                });
                if (selected == null) return;
                await protoFilesKv.set([...protoFiles.filter((f) => f !== selected), selected]);
                await grpc.reflect.refetch();
              },
            },
          ]}
        />
        {reflectionUnimplemented && protoFiles.length === 0 && (
          <Banner>
            <Trans
              i18nKey="grpc.reflectionUnimplemented"
              values={{ url: request.url }}
              components={{
                1: <InlineCode />,
                3: (
                  <Link href="https://github.com/grpc/grpc/blob/9aa3c5835a4ed6afae9455b63ed45c761d695bca/doc/server-reflection.md" />
                ),
                5: <InlineCode />,
              }}
            />
          </Banner>
        )}
      </VStack>
      <DialogFooter
        actions={[
          {
            label: t("grpc.refreshSchema"),
            isLoading: grpc.reflect.isFetching,
            disabled: grpc.reflect.isFetching,
            onClick: () => grpc.reflect.refetch(),
          },
          { label: t("common.done"), color: "primary", onClick: onDone },
        ]}
      />
    </>
  );
}
