import { useTranslation } from "@yaakapp-internal/i18n";
import { useCallback } from "react";
import { CreateWorkspaceDialog } from "../components/CreateWorkspaceDialog";
import { showDialog } from "../lib/dialog";

export function useCreateWorkspace() {
  const { t } = useTranslation();
  return useCallback(() => {
    showDialog({
      id: "create-workspace",
      title: t("workspace.create"),
      size: "sm",
      render: ({ hide }) => <CreateWorkspaceDialog hide={hide} />,
    });
  }, [t]);
}
