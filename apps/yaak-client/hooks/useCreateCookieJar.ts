import { i18n } from "@yaakapp-internal/i18n";
import { createWorkspaceModel } from "@yaakapp-internal/models";
import { jotaiStore } from "../lib/jotai";
import { showPrompt } from "../lib/prompt";
import { setWorkspaceSearchParams } from "../lib/setWorkspaceSearchParams";
import { activeWorkspaceIdAtom } from "./useActiveWorkspace";
import { useFastMutation } from "./useFastMutation";

export function useCreateCookieJar() {
  return useFastMutation({
    mutationKey: ["create_cookie_jar"],
    mutationFn: async () => {
      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      if (workspaceId == null) {
        throw new Error("Cannot create cookie jar when there's no active workspace");
      }

      const name = await showPrompt({
        id: "new-cookie-jar",
        title: i18n.t("workspace.newCookieJar"),
        placeholder: i18n.t("workspace.cookieJarNamePlaceholder"),
        confirmText: i18n.t("common.create"),
        label: i18n.t("workspace.name"),
        defaultValue: i18n.t("workspace.cookieJarNamePlaceholder"),
      });
      if (name == null) return null;

      return createWorkspaceModel({ model: "cookie_jar", workspaceId, name });
    },
    onSuccess: async (cookieJarId) => {
      setWorkspaceSearchParams({ cookie_jar_id: cookieJarId });
    },
  });
}
