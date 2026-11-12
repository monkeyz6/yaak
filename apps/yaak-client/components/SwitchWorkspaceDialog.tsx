import type { Workspace } from "@yaakapp-internal/models";
import { Trans, useTranslation } from "@yaakapp-internal/i18n";
import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import { Icon, InlineCode, VStack } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { switchWorkspace } from "../commands/switchWorkspace";
import { Checkbox } from "./core/Checkbox";
import { DialogFooter } from "./core/Dialog";

interface Props {
  hide: () => void;
  workspace: Workspace;
}

export function SwitchWorkspaceDialog({ hide, workspace }: Props) {
  const { t } = useTranslation();
  const settings = useAtomValue(settingsAtom);
  const [remember, setRemember] = useState<boolean>(false);

  const open = async (inNewWindow: boolean) => {
    hide();
    switchWorkspace.mutate({ workspaceId: workspace.id, inNewWindow });
    if (remember) {
      await patchModel(settings, { openWorkspaceNewWindow: inNewWindow });
    }
  };

  return (
    <VStack space={3}>
      <p>
        <Trans
          i18nKey="workspace.openPrompt"
          values={{ name: workspace.name }}
          components={{ 1: <InlineCode /> }}
        />
      </p>
      {settings && (
        <Checkbox checked={remember} title={t("workspace.rememberChoice")} onChange={setRemember} />
      )}
      <DialogFooter
        inline
        actions={[
          {
            label: t("workspace.newWindow"),
            rightSlot: <Icon icon="external_link" />,
            onClick: () => open(true),
          },
          {
            label: t("workspace.thisWindow"),
            color: "primary",
            autoFocus: true,
            onClick: () => open(false),
          },
        ]}
      />
    </VStack>
  );
}
