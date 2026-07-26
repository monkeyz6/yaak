import { useTranslation } from "@yaakapp-internal/i18n";
import {
  grpcConnectionsAtom,
  httpResponsesAtom,
  websocketConnectionsAtom,
} from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { showAlert } from "../lib/alert";
import { showConfirmDelete } from "../lib/confirm";
import { jotaiStore } from "../lib/jotai";
import { invokeCmd } from "../lib/tauri";
import { activeWorkspaceIdAtom } from "./useActiveWorkspace";
import { useFastMutation } from "./useFastMutation";

export function useDeleteSendHistory() {
  const { t } = useTranslation();
  const httpResponses = useAtomValue(httpResponsesAtom);
  const grpcConnections = useAtomValue(grpcConnectionsAtom);
  const websocketConnections = useAtomValue(websocketConnectionsAtom);

  const labels = [
    httpResponses.length > 0
      ? httpResponses.length === 1
        ? t("response.sendHistoryHttpResponseOne", { count: httpResponses.length })
        : t("response.sendHistoryHttpResponseMany", { count: httpResponses.length })
      : null,
    grpcConnections.length > 0
      ? grpcConnections.length === 1
        ? t("response.sendHistoryGrpcConnectionOne", { count: grpcConnections.length })
        : t("response.sendHistoryGrpcConnectionMany", { count: grpcConnections.length })
      : null,
    websocketConnections.length > 0
      ? websocketConnections.length === 1
        ? t("response.sendHistoryWebsocketConnectionOne", { count: websocketConnections.length })
        : t("response.sendHistoryWebsocketConnectionMany", { count: websocketConnections.length })
      : null,
  ].filter((l) => l != null);

  return useFastMutation({
    mutationKey: ["delete_send_history", labels],
    mutationFn: async () => {
      if (labels.length === 0) {
        showAlert({
          id: "no-responses",
          title: t("response.sendHistoryNothingTitle"),
          body: t("response.sendHistoryNothingBody"),
        });
        return;
      }

      const confirmed = await showConfirmDelete({
        id: "delete-send-history",
        title: t("response.sendHistoryClearTitle"),
        description: (
          <>
            {t("response.sendHistoryDeleteConfirm", { labels: labels.join(t("common.joinAnd")) })}
          </>
        ),
      });
      if (!confirmed) return false;

      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      await invokeCmd("cmd_delete_send_history", { workspaceId });
      return true;
    },
  });
}
