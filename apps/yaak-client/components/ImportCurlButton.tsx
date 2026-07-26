import { clear, readText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "@yaakapp-internal/i18n";
import * as m from "motion/react-m";
import { useEffect, useState } from "react";
import { useImportCurl } from "../hooks/useImportCurl";
import { useWindowFocus } from "../hooks/useWindowFocus";
import { Button } from "./core/Button";
import { Icon } from "@yaakapp-internal/ui";

export function ImportCurlButton() {
  const { t } = useTranslation();
  const focused = useWindowFocus();
  const [clipboardText, setClipboardText] = useState("");

  const importCurl = useImportCurl();
  const [isLoading, setIsLoading] = useState(false);

  // oxlint-disable-next-line react-hooks/exhaustive-deps -- none
  useEffect(() => {
    void readText().then(setClipboardText);
  }, [focused]);

  if (!clipboardText?.trim().startsWith("curl ")) {
    return null;
  }

  return (
    <m.div
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.5 }}
    >
      <Button
        size="2xs"
        variant="border"
        color="success"
        className="rounded-full"
        rightSlot={<Icon icon="import" size="sm" />}
        isLoading={isLoading}
        title={t("importExport.importCurlFromClipboard")}
        onClick={async () => {
          setIsLoading(true);
          try {
            await importCurl.mutateAsync({ command: clipboardText });
            await clear(); // Clear the clipboard so the button goes away
            setClipboardText("");
          } catch (e) {
            console.log("Failed to import curl", e);
          } finally {
            setIsLoading(false);
          }
        }}
      >
        {t("importExport.importCurl")}
      </Button>
    </m.div>
  );
}
