import { gitMutations } from "@yaakapp-internal/git";
import { useTranslation } from "@yaakapp-internal/i18n";
import type { WorkspaceMeta } from "@yaakapp-internal/models";
import { createGlobalModel, updateModel } from "@yaakapp-internal/models";
import { VStack } from "@yaakapp-internal/ui";
import { useId, useState } from "react";
import { router } from "../lib/router";
import { setupOrConfigureEncryption } from "../lib/setupOrConfigureEncryption";
import { rpc } from "../lib/rpc";
import { showErrorToast } from "../lib/toast";
import { Checkbox } from "./core/Checkbox";
import { DialogFooter } from "./core/Dialog";
import { Label } from "./core/Label";
import { PlainInput } from "./core/PlainInput";
import { EncryptionHelp } from "./EncryptionHelp";
import { gitCallbacks } from "./git/callbacks";
import { SyncToFilesystemSetting } from "./SyncToFilesystemSetting";

interface Props {
  hide: () => void;
}

export function CreateWorkspaceDialog({ hide }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState<string>("");
  const [syncConfig, setSyncConfig] = useState<{
    filePath: string | null;
    initGit?: boolean;
  }>({ filePath: null, initGit: false });
  const [setupEncryption, setSetupEncryption] = useState<boolean>(false);
  const formId = useId();
  return (
    <VStack
      as="form"
      id={formId}
      space={3}
      alignItems="start"
      onSubmit={async (e) => {
        e.preventDefault();
        const workspaceId = await createGlobalModel({ model: "workspace", name });
        if (workspaceId == null) return;

        // Do getWorkspaceMeta instead of naively creating one because it might have
        // been created already when the store refreshes the workspace meta after
        const workspaceMeta = await rpc<WorkspaceMeta>("cmd_get_workspace_meta", {
          workspaceId,
        });
        await updateModel({
          ...workspaceMeta,
          settingSyncDir: syncConfig.filePath,
        });

        if (syncConfig.initGit && syncConfig.filePath) {
          gitMutations(syncConfig.filePath, gitCallbacks(syncConfig.filePath))
            .init.mutateAsync()
            .catch((err) => {
              showErrorToast({
                id: "git-init-error",
                title: t("git.initFailedTitle"),
                message: String(err),
              });
            });
        }

        // Navigate to workspace
        await router.navigate({
          to: "/workspaces/$workspaceId",
          params: { workspaceId },
        });

        hide();

        if (setupEncryption) {
          setupOrConfigureEncryption();
        }
      }}
    >
      <PlainInput required label={t("workspace.name")} defaultValue={name} onChange={setName} />

      <SyncToFilesystemSetting
        onChange={setSyncConfig}
        onCreateNewWorkspace={hide}
        value={syncConfig}
      />
      <div>
        <Label htmlFor={null} help={<EncryptionHelp />}>
          {t("workspace.encryption")}
        </Label>
        <Checkbox
          checked={setupEncryption}
          onChange={setSetupEncryption}
          title={t("workspace.enableEncryption")}
        />
      </div>
      <DialogFooter actions={[{ label: t("workspace.create"), color: "primary", form: formId }]} />
    </VStack>
  );
}
