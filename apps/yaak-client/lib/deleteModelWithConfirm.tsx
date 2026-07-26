import type { AnyModel } from "@yaakapp-internal/models";
import { deleteModel } from "@yaakapp-internal/models";
import { i18n } from "@yaakapp-internal/i18n";
import { InlineCode } from "@yaakapp-internal/ui";
import { Prose } from "../components/Prose";
import { showConfirmDelete } from "./confirm";
import { resolvedModelName } from "./resolvedModelName";

export async function deleteModelWithConfirm(
  model: AnyModel | AnyModel[] | null,
  options: { confirmName?: string } = {},
): Promise<boolean> {
  if (model == null) {
    console.warn("Tried to delete null model");
    return false;
  }
  const models = Array.isArray(model) ? model : [model];
  const firstModel = models[0];
  if (firstModel == null) return false;

  const descriptor = tModelLabel(firstModel);
  const confirmed = await showConfirmDelete({
    id: `delete-model-${models.map((m) => m.id).join(",")}`,
    title:
      models.length === 1
        ? i18n.t("deleteModel.titleOne", { model: descriptor })
        : i18n.t("deleteModel.titleMany", { count: models.length }),
    requireTyping: options.confirmName,
    description: (
      <>
        {models.length === 1 ? (
          <>
            {i18n.t("deleteModel.permanentlyDeleteOne")}{" "}
            <InlineCode>{resolvedModelName(firstModel)}</InlineCode>?
          </>
        ) : models.length < 10 ? (
          <>
            {i18n.t("deleteModel.permanentlyDeleteFollowing")}
            <Prose className="mt-2">
              <ul className="space-y-1">
                {models.map((m) => (
                  <li key={m.id}>
                    <InlineCode
                      className="inline-block truncate align-bottom max-w-full"
                      title={resolvedModelName(m)}
                    >
                      {resolvedModelName(m)}
                    </InlineCode>
                  </li>
                ))}
              </ul>
            </Prose>
          </>
        ) : (
          i18n.t("deleteModel.permanentlyDeleteAll", { count: models.length })
        )}
      </>
    ),
  });

  if (!confirmed) {
    return false;
  }

  await Promise.allSettled(models.map((m) => deleteModel(m)));
  return true;
}

function tModelLabel(model: AnyModel) {
  switch (model.model) {
    case "workspace":
      return i18n.t("deleteModel.model.workspace");
    case "environment":
      return i18n.t("deleteModel.model.environment");
    case "folder":
      return i18n.t("deleteModel.model.folder");
    case "http_request":
      return i18n.t("deleteModel.model.httpRequest");
    case "grpc_request":
      return i18n.t("deleteModel.model.grpcRequest");
    case "websocket_request":
      return i18n.t("deleteModel.model.websocketRequest");
    case "cookie_jar":
      return i18n.t("deleteModel.model.cookieJar");
    default:
      return i18n.t("deleteModel.model.item");
  }
}
