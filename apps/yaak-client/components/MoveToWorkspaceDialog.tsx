import { Trans, useTranslation } from "@yaakapp-internal/i18n";
import type { GrpcRequest, HttpRequest, WebsocketRequest } from "@yaakapp-internal/models";
import { patchModel, workspacesAtom } from "@yaakapp-internal/models";
import { InlineCode, VStack } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { resolvedModelName } from "../lib/resolvedModelName";
import { router } from "../lib/router";
import { showToast } from "../lib/toast";
import { Button } from "./core/Button";
import { Select } from "./core/Select";

interface Props {
  activeWorkspaceId: string;
  requests: (HttpRequest | GrpcRequest | WebsocketRequest)[];
  onDone: () => void;
}

export function MoveToWorkspaceDialog({ onDone, requests, activeWorkspaceId }: Props) {
  const { t } = useTranslation();
  const workspaces = useAtomValue(workspacesAtom);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(activeWorkspaceId);

  const targetWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  const isSameWorkspace = selectedWorkspaceId === activeWorkspaceId;

  return (
    <VStack space={4} className="mb-4">
      <Select
        label={t("workspace.targetWorkspace")}
        name="workspace"
        value={selectedWorkspaceId}
        onChange={setSelectedWorkspaceId}
        options={workspaces.map((w) => ({
          label:
            w.id === activeWorkspaceId ? t("workspace.currentSuffix", { name: w.name }) : w.name,
          value: w.id,
        }))}
      />
      <Button
        color="primary"
        disabled={isSameWorkspace}
        onClick={async () => {
          const patch = {
            workspaceId: selectedWorkspaceId,
            folderId: null,
          };

          await Promise.all(requests.map((r) => patchModel(r, patch)));

          // Hide after a moment, to give time for requests to disappear
          setTimeout(onDone, 100);
          showToast({
            id: "workspace-moved",
            message:
              requests.length === 1 && requests[0] != null ? (
                <Trans
                  i18nKey="workspace.movedOneToast"
                  values={{
                    name: resolvedModelName(requests[0]),
                    workspace: targetWorkspace?.name ?? t("common.unknown"),
                  }}
                  components={{ 1: <InlineCode />, 2: <InlineCode /> }}
                />
              ) : (
                <Trans
                  i18nKey="workspace.movedManyToast"
                  values={{
                    count: requests.length,
                    workspace: targetWorkspace?.name ?? t("common.unknown"),
                  }}
                  components={{ 1: <InlineCode /> }}
                />
              ),
            action: ({ hide }) => (
              <Button
                size="xs"
                color="secondary"
                className="mr-auto min-w-20"
                onClick={async () => {
                  await router.navigate({
                    to: "/workspaces/$workspaceId",
                    params: { workspaceId: selectedWorkspaceId },
                  });
                  hide();
                }}
              >
                {t("workspace.switchToWorkspace")}
              </Button>
            ),
          });
        }}
      >
        {requests.length === 1
          ? t("contextMenu.move")
          : t("contextMenu.moveRequests", { count: requests.length })}
      </Button>
    </VStack>
  );
}
