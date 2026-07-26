import { openUrl } from "@tauri-apps/plugin-opener";
import { Trans, useTranslation } from "@yaakapp-internal/i18n";
import { useLicense } from "@yaakapp-internal/license";
import { Banner, HStack, Icon, VStack } from "@yaakapp-internal/ui";
import { differenceInDays } from "date-fns";
import { formatDate } from "date-fns/format";
import { useState } from "react";
import { useToggle } from "../../hooks/useToggle";
import { pricingUrl } from "../../lib/pricingUrl";
import { CargoFeature } from "../CargoFeature";
import { Button } from "../core/Button";
import { Link } from "../core/Link";
import { PlainInput } from "../core/PlainInput";
import { Separator } from "../core/Separator";

export function SettingsLicense() {
  return (
    <CargoFeature feature="license">
      <SettingsLicenseCmp />
    </CargoFeature>
  );
}

function SettingsLicenseCmp() {
  const { t } = useTranslation();
  const { check, activate, deactivate } = useLicense();
  const [key, setKey] = useState<string>("");
  const [activateFormVisible, toggleActivateFormVisible] = useToggle(false);

  if (check.isPending) {
    return null;
  }

  const renderBanner = () => {
    if (!check.data) return null;

    switch (check.data.status) {
      case "active":
        return <Banner color="success">{t("settings.licenseActive")}</Banner>;

      case "trialing": {
        const days = differenceInDays(check.data.data.end, new Date());
        return (
          <Banner color="info" className="max-w-lg">
            <p className="w-full">
              <Trans
                i18nKey={
                  days === 1 ? "settings.licenseTrialDayLeft" : "settings.licenseTrialDaysLeft"
                }
                values={{ count: days }}
                components={{ 1: <strong /> }}
              />
              <br />
              <span className="opacity-50">{t("settings.licensePersonalAlwaysFree")}</span>
              <Separator className="my-2" />
              <div className="flex flex-wrap items-center gap-x-2 text-sm text-notice">
                <Link noUnderline href={pricingUrl(`app.license.learn.${check.data.status}`)}>
                  {t("settings.licenseLearnMore")}
                </Link>
              </div>
            </p>
          </Banner>
        );
      }

      case "personal_use":
        return (
          <Banner color="notice" className="max-w-lg">
            <p className="w-full">
              {t("settings.licenseTrialEnded")}
              <br />
              <span className="opacity-50">
                {t("settings.licensePersonalOnly")}
                <br />
                {t("settings.licenseRequiredCommercial")}
              </span>
              <Separator className="my-2" />
              <div className="flex flex-wrap items-center gap-x-2 text-sm text-notice">
                <Link noUnderline href={pricingUrl(`app.license.learn.${check.data.status}`)}>
                  {t("settings.licenseLearnMore")}
                </Link>
              </div>
            </p>
          </Banner>
        );

      case "inactive":
        return (
          <Banner color="danger">
            <Trans
              i18nKey="settings.licenseInvalid"
              components={{ 1: <Link href="https://yaak.app/dashboard" /> }}
            />
          </Banner>
        );

      case "expired":
        return (
          <Banner color="notice">
            <Trans
              i18nKey="settings.licenseExpired"
              values={{ date: formatDate(check.data.data.periodEnd, "MMMM dd, yyyy") }}
              components={{ 1: <strong />, 2: <Link href="https://yaak.app/dashboard" /> }}
            />
            {check.data.data.changesUrl && (
              <>
                <br />
                <Link href={check.data.data.changesUrl}>{t("settings.licenseWhatsNew")}</Link>
              </>
            )}
          </Banner>
        );

      case "past_due":
        return (
          <Banner color="danger">
            <strong>{t("settings.licensePaymentIssue")}</strong>
            <br />
            <Trans
              i18nKey="settings.licenseUpdateBilling"
              components={{ 1: <Link href={check.data.data.billingUrl} /> }}
            />
          </Banner>
        );

      case "error":
        return (
          <Banner color="danger">
            {t("settings.licenseCheckFailed", {
              message: check.data.data.message,
              code: check.data.data.code,
            })}
          </Banner>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      {renderBanner()}

      {check.error && <Banner color="danger">{check.error}</Banner>}
      {activate.error && <Banner color="danger">{activate.error}</Banner>}

      {check.data?.status === "active" ? (
        <HStack space={2}>
          <Button variant="border" color="secondary" size="sm" onClick={() => deactivate.mutate()}>
            {t("settings.deactivateLicense")}
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() => openUrl("https://yaak.app/dashboard?intent=app.license.support")}
            rightSlot={<Icon icon="external_link" />}
          >
            {t("settings.directSupport")}
          </Button>
        </HStack>
      ) : (
        <HStack space={2}>
          <Button variant="border" color="secondary" size="sm" onClick={toggleActivateFormVisible}>
            {t("settings.activateLicense")}
          </Button>
          <Button
            size="sm"
            color="primary"
            rightSlot={<Icon icon="external_link" />}
            onClick={() =>
              openUrl(pricingUrl(`app.license.purchase.${check.data?.status ?? "unknown"}`))
            }
          >
            {t("mainMenu.purchaseLicense")}
          </Button>
        </HStack>
      )}

      {activateFormVisible && (
        <VStack
          as="form"
          space={3}
          className="max-w-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            await activate.mutateAsync({ licenseKey: key });
            toggleActivateFormVisible();
          }}
        >
          <PlainInput
            autoFocus
            label={t("settings.licenseKey")}
            name="key"
            onChange={setKey}
            placeholder="YK1-XXXXX-XXXXX-XXXXX-XXXXX"
          />
          <Button type="submit" color="primary" size="sm" isLoading={activate.isPending}>
            {t("common.submit")}
          </Button>
        </VStack>
      )}
    </div>
  );
}
