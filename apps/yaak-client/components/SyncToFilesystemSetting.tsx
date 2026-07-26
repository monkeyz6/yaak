import { readDir } from "@tauri-apps/plugin-fs";
import { useTranslation } from "@yaakapp-internal/i18n";
import { Banner, VStack } from "@yaakapp-internal/ui";
import { useState } from "react";
import { openWorkspaceFromSyncDir } from "../commands/openWorkspaceFromSyncDir";
import { Button } from "./core/Button";
import { Checkbox } from "./core/Checkbox";
import { SettingRowBoolean, SettingRowDirectory } from "./core/SettingRow";
import { SelectFile } from "./SelectFile";

export interface SyncToFilesystemSettingProps {
  layout?: "form" | "settings";
  onChange: (args: { filePath: string | null; initGit?: boolean }) => void;
  onCreateNewWorkspace: () => void;
  value: { filePath: string | null; initGit?: boolean };
}

export function SyncToFilesystemSetting({
  layout = "form",
  onChange,
  onCreateNewWorkspace,
  value,
}: SyncToFilesystemSettingProps) {
  const { t } = useTranslation();
  const [syncDir, setSyncDir] = useState<string | null>(null);

  const handleFilePathChange = async (filePath: string | null) => {
    if (filePath != null) {
      const files = await readDir(filePath);
      if (files.length > 0) {
        setSyncDir(filePath);
        return;
      }
    }

    setSyncDir(null);
    onChange({ ...value, filePath });
  };

  if (layout === "settings") {
    return (
      <VStack className="w-full" space={0}>
        {syncDir && (
          <Banner color="notice" className="mb-3 flex flex-col gap-1.5">
            <p>{t("workspace.syncDirNotEmpty")}</p>
            <div>
              <Button
                variant="border"
                color="notice"
                size="xs"
                type="button"
                onClick={() => {
                  openWorkspaceFromSyncDir.mutate(syncDir);
                  onCreateNewWorkspace();
                }}
              >
                {t("workspace.openWorkspace")}
              </Button>
            </div>
          </Banner>
        )}

        <SettingRowDirectory
          title={t("workspace.syncDirectory")}
          description={t("workspace.syncDirectoryHelp")}
          filePath={value.filePath}
          onChange={handleFilePathChange}
        />

        {value.filePath && typeof value.initGit === "boolean" && (
          <SettingRowBoolean
            checked={value.initGit}
            title={t("workspace.initGitRepo")}
            description={t("workspace.initGitRepoDescription")}
            onChange={(initGit) => onChange({ ...value, initGit })}
          />
        )}
      </VStack>
    );
  }

  return (
    <VStack className="w-full my-2" space={3}>
      {syncDir && (
        <Banner color="notice" className="flex flex-col gap-1.5">
          <p>{t("workspace.syncDirNotEmpty")}</p>
          <div>
            <Button
              variant="border"
              color="notice"
              size="xs"
              type="button"
              onClick={() => {
                openWorkspaceFromSyncDir.mutate(syncDir);
                onCreateNewWorkspace();
              }}
            >
              {t("workspace.openWorkspace")}
            </Button>
          </div>
        </Banner>
      )}

      <SelectFile
        directory
        label={t("workspace.syncDirectory")}
        size="xs"
        noun={t("workspace.directoryNoun")}
        help={t("workspace.syncDirectoryHelp")}
        filePath={value.filePath}
        onChange={async ({ filePath }) => handleFilePathChange(filePath)}
      />

      {value.filePath && typeof value.initGit === "boolean" && (
        <Checkbox
          checked={value.initGit}
          onChange={(initGit) => onChange({ ...value, initGit })}
          title={t("workspace.initGitRepo")}
        />
      )}
    </VStack>
  );
}
