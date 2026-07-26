import { useTimedBoolean } from "@yaakapp-internal/ui";
import { useTranslation } from "@yaakapp-internal/i18n";
import { copyToClipboard } from "../lib/copy";
import { showToast } from "../lib/toast";
import type { ButtonProps } from "./core/Button";
import { Button } from "./core/Button";

interface Props extends Omit<ButtonProps, "onClick"> {
  text: string | (() => Promise<string | null>);
}

export function CopyButton({ text, ...props }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useTimedBoolean();
  return (
    <Button
      {...props}
      onClick={async () => {
        const content = typeof text === "function" ? await text() : text;
        if (content == null) {
          showToast({
            id: "failed-to-copy",
            color: "danger",
            message: t("response.failedToCopy"),
          });
        } else {
          copyToClipboard(content, { disableToast: true });
          setCopied();
        }
      }}
    >
      {copied ? t("response.copied") : t("response.copy")}
    </Button>
  );
}
