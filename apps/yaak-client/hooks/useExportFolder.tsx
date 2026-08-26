import { useTranslation } from "@yaakapp-internal/i18n";
import type { Folder } from "@yaakapp-internal/models";
import { ExportFolderDialog, type FolderExportResult } from "../components/ExportFolderDialog";
import { showAlert } from "../lib/alert";
import { showDialog } from "../lib/dialog";
import { showToast } from "../lib/toast";
import { useFastMutation } from "./useFastMutation";

export function useExportFolder() {
  const { t } = useTranslation();

  return useFastMutation({
    mutationKey: ["export_folder"],
    onError: (err: string) => {
      showAlert({ id: "export-folder-failed", title: t("importExport.exportFailed"), body: err });
    },
    mutationFn: async (folder: Folder) => {
      showDialog({
        id: "export-folder",
        title: t("importExport.exportFolderTitle"),
        description: t("importExport.exportFolderDescription", { name: folder.name }),
        size: "sm",
        noPadding: true,
        render: ({ hide }) => (
          <ExportFolderDialog
            folder={folder}
            onHide={hide}
            onSuccess={(result) => {
              showToast({
                color: result.skipped.length > 0 ? "notice" : "success",
                message: formatFolderExportMessage(result, t),
              });
            }}
          />
        ),
      });
    },
  });
}

function formatFolderExportMessage(
  result: FolderExportResult,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const exported = t("importExport.exportFolderSuccess", { count: result.exportedCount });
  if (result.skipped.length === 0) {
    return exported;
  }

  const details = result.skipped
    .map((item) => `${item.name} (${skipReasonLabel(item.reason, t)})`)
    .join(", ");
  return t("importExport.exportFolderSuccessWithSkipped", {
    count: result.exportedCount,
    skipped: result.skipped.length,
    details,
  });
}

function skipReasonLabel(
  reason: FolderExportResult["skipped"][number]["reason"],
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (reason) {
    case "grpc":
      return t("importExport.skipGrpc");
    case "websocket":
      return t("importExport.skipWebsocket");
    case "template_function":
      return t("importExport.skipTemplateFunction");
    case "unsupported_auth":
      return t("importExport.skipUnsupportedAuth");
    case "duplicate_path_method":
      return t("importExport.skipDuplicatePathMethod");
  }
}
