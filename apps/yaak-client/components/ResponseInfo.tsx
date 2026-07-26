import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "@yaakapp-internal/i18n";
import type { HttpResponse } from "@yaakapp-internal/models";
import { IconButton } from "./core/IconButton";
import { KeyValueRow, KeyValueRows } from "./core/KeyValueRow";

interface Props {
  response: HttpResponse;
}

export function ResponseInfo({ response }: Props) {
  const { t } = useTranslation();
  return (
    <div className="overflow-auto h-full pb-4">
      <KeyValueRows>
        <KeyValueRow labelColor="info" label={t("response.version")}>
          {response.version ?? <span className="text-text-subtlest">--</span>}
        </KeyValueRow>
        <KeyValueRow labelColor="info" label={t("response.remoteAddress")}>
          {response.remoteAddr ?? <span className="text-text-subtlest">--</span>}
        </KeyValueRow>
        <KeyValueRow
          labelColor="info"
          label={
            <div className="flex items-center">
              URL
              <IconButton
                iconSize="sm"
                className="inline-block w-auto ml-1 h-auto! opacity-50 hover:opacity-100"
                icon="external_link"
                onClick={() => openUrl(response.url)}
                title={t("response.openInBrowser")}
              />
            </div>
          }
        >
          {
            <div className="flex">
              <span className="select-text cursor-text">{response.url}</span>
            </div>
          }
        </KeyValueRow>
      </KeyValueRows>
    </div>
  );
}
