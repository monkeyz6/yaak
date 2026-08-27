import { useTranslation } from "@yaakapp-internal/i18n";
import { httpResponsesAtom } from "@yaakapp-internal/models";
import { showAlert } from "../lib/alert";
import { showConfirmDelete } from "../lib/confirm";
import { jotaiStore } from "../lib/jotai";
import { getKeyValue } from "../lib/keyValueStore";
import { collectHttpResponseKeepIds } from "../lib/pruneHttpResponses";
import { invokeCmd } from "../lib/tauri";
import { activeWorkspaceIdAtom } from "./useActiveWorkspace";
import { useFastMutation } from "./useFastMutation";

function pinnedIdForLatest(latestResponseId: string): string | null {
  return getKeyValue<string | null>({
    namespace: "global",
    key: ["pinned_http_response_id", latestResponseId],
    fallback: null,
  });
}

export function usePruneHttpResponseHistory() {
  const { t } = useTranslation();

  return useFastMutation({
    mutationKey: ["prune_http_responses"],
    mutationFn: async () => {
      // Read at click time; useFastMutation would otherwise close over a stale snapshot.
      const httpResponses = jotaiStore.get(httpResponsesAtom);
      const { keepIds, deleteCount } = collectHttpResponseKeepIds(httpResponses, pinnedIdForLatest);

      if (deleteCount === 0) {
        showAlert({
          id: "no-http-responses-to-prune",
          title: t("response.pruneHttpHistoryNothingTitle"),
          body: t("response.pruneHttpHistoryNothingBody"),
        });
        return false;
      }

      const confirmed = await showConfirmDelete({
        id: "prune-http-responses",
        title: t("response.pruneHttpHistoryTitle"),
        description: t("response.pruneHttpHistoryConfirm", { count: deleteCount }),
      });
      if (!confirmed) return false;

      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      if (workspaceId == null) return false;

      await invokeCmd("cmd_prune_http_responses", { workspaceId, keepIds });
      return true;
    },
  });
}
