import { save } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "@yaakapp-internal/i18n";
import type { Folder } from "@yaakapp-internal/models";
import { HStack, VStack } from "@yaakapp-internal/ui";
import { useCallback, useState } from "react";
import slugify from "slugify";
import { showAlert } from "../lib/alert";
import { invokeCmd } from "../lib/tauri";
import { Button } from "./core/Button";
import { RadioCards } from "./core/RadioCards";

export type FolderExportFormat = "postman" | "openapi";

export interface FolderExportResult {
  exportedCount: number;
  skipped: Array<{
    name: string;
    id: string;
    reason:
      | "grpc"
      | "websocket"
      | "template_function"
      | "unsupported_auth"
      | "duplicate_path_method";
  }>;
}

interface Props {
  folder: Folder;
  onHide: () => void;
  onSuccess: (result: FolderExportResult) => void;
}

export function ExportFolderDialog({ folder, onHide, onSuccess }: Props) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<FolderExportFormat>("postman");

  const handleExport = useCallback(async () => {
    const slug = slugify(folder.name || "folder", { lower: true }) || "folder";
    const defaultPath =
      format === "postman" ? `${slug}.postman_collection.json` : `${slug}.openapi.json`;
    const exportPath = await save({
      title: t("contextMenu.exportFolder"),
      defaultPath,
    });
    if (exportPath == null) {
      return;
    }

    try {
      const result = await invokeCmd<FolderExportResult>("cmd_export_folder", {
        folderId: folder.id,
        format,
        exportPath,
      });
      onHide();
      onSuccess(result);
    } catch (err) {
      showAlert({
        id: "export-folder-failed",
        title: t("importExport.exportFailed"),
        body: String(err),
      });
    }
  }, [folder.id, folder.name, format, onHide, onSuccess, t]);

  return (
    <div className="h-full w-full grid grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-b-lg">
      <VStack space={3} className="overflow-auto px-5 pb-6 pt-1">
        <RadioCards
          name="folder-export-format"
          value={format}
          onChange={setFormat}
          options={[
            {
              value: "postman",
              label: t("importExport.formatPostman"),
              description: t("importExport.formatPostmanHelp"),
            },
            {
              value: "openapi",
              label: t("importExport.formatOpenapi"),
              description: t("importExport.formatOpenapiHelp"),
            },
          ]}
        />
      </VStack>
      <footer className="px-5 grid grid-cols-[1fr_auto] items-center bg-surface py-3 border-t border-border-subtle">
        <div />
        <HStack space={2} justifyContent="end">
          <Button size="sm" className="focus" variant="border" onClick={onHide}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" className="focus" color="primary" onClick={() => handleExport()}>
            {t("importExport.export")}
          </Button>
        </HStack>
      </footer>
    </div>
  );
}
