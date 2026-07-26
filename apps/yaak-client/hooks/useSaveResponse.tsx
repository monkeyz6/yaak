import { save } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "@yaakapp-internal/i18n";
import type { HttpResponse } from "@yaakapp-internal/models";
import { getModel } from "@yaakapp-internal/models";
import mime from "mime";
import slugify from "slugify";
import { InlineCode } from "@yaakapp-internal/ui";
import { getContentTypeFromHeaders } from "../lib/model_util";
import { invokeCmd } from "../lib/tauri";
import { showToast } from "../lib/toast";
import { useFastMutation } from "./useFastMutation";

export function useSaveResponse(response: HttpResponse | null) {
  const { t } = useTranslation();
  return useFastMutation({
    mutationKey: ["save_response", response?.id],
    mutationFn: async () => {
      if (response == null) return null;

      const request = getModel("http_request", response.requestId);
      if (request == null) return null;

      const contentType = getContentTypeFromHeaders(response.headers) ?? "unknown";
      const ext = mime.getExtension(contentType);
      const slug = slugify(request.name || "response", { lower: true });
      const filepath = await save({
        defaultPath: ext ? `${slug}.${ext}` : slug,
        title: t("response.saveResponseTitle"),
      });
      await invokeCmd("cmd_save_response", { responseId: response.id, filepath });
      showToast({
        message: (
          <>
            {t("response.responseSavedTo")} <InlineCode>{filepath}</InlineCode>
          </>
        ),
      });
    },
  });
}
