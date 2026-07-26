import { i18n } from "@yaakapp-internal/i18n";
import type { AnyModel } from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import { InlineCode } from "@yaakapp-internal/ui";
import { showPrompt } from "./prompt";

export async function renameModelWithPrompt(model: Extract<AnyModel, { name: string }> | null) {
  if (model == null) {
    throw new Error("Tried to rename null model");
  }

  const name = await showPrompt({
    id: "rename-request",
    title: i18n.t("navigation.renameRequest"),
    required: false,
    description:
      model.name === "" ? (
        i18n.t("common.enterNewName")
      ) : (
        <>
          {i18n.t("common.enterNewNameFor")} <InlineCode>{model.name}</InlineCode>
        </>
      ),
    label: i18n.t("common.name"),
    placeholder: i18n.t("common.newNamePlaceholder"),
    defaultValue: model.name,
    confirmText: i18n.t("common.save"),
  });

  if (name == null) return;

  await patchModel(model, { name });
}
