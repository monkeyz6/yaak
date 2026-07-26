import { useTranslation } from "@yaakapp-internal/i18n";
import { VStack } from "@yaakapp-internal/ui";

export function EncryptionHelp() {
  const { t } = useTranslation();
  return (
    <VStack space={3}>
      <p>{t("encryption.helpIntro")}</p>
      <p>{t("encryption.helpDetails")}</p>
    </VStack>
  );
}
