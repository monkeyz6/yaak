import { useMutation } from "@tanstack/react-query";
import { i18n } from "@yaakapp-internal/i18n";
import { InlineCode } from "@yaakapp-internal/ui";
import { showAlert } from "../lib/alert";
import { appInfo } from "../lib/appInfo";
import { minPromiseMillis } from "../lib/minPromiseMillis";
import { invokeCmd } from "../lib/tauri";

export function useCheckForUpdates() {
  return useMutation({
    mutationKey: ["check_for_updates"],
    mutationFn: async () => {
      const hasUpdate: boolean = await minPromiseMillis(invokeCmd("cmd_check_for_updates"), 500);
      if (!hasUpdate) {
        showAlert({
          id: "no-updates",
          title: i18n.t("settings.noUpdateAvailable"),
          body: (
            <>
              {i18n.t("settings.onLatestVersion")} <InlineCode>{appInfo.version}</InlineCode>
            </>
          ),
        });
      }
    },
  });
}
