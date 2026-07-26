import type { UncommittedChangesStrategy } from "@yaakapp-internal/git";
import { i18n } from "@yaakapp-internal/i18n";
import { showConfirm } from "../../lib/confirm";

export async function promptUncommittedChangesStrategy(): Promise<UncommittedChangesStrategy> {
  const confirmed = await showConfirm({
    id: "git-uncommitted-changes",
    title: i18n.t("git.uncommittedChanges"),
    description: i18n.t("git.uncommittedChangesDescription"),
    confirmText: i18n.t("git.resetAndPull"),
    color: "danger",
  });
  return confirmed ? "reset" : "cancel";
}
