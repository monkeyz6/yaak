import { openUrl } from "@tauri-apps/plugin-opener";
import { i18n } from "@yaakapp-internal/i18n";
import type { LicenseCheckStatus } from "@yaakapp-internal/license";
import { useLicense } from "@yaakapp-internal/license";
import { settingsAtom } from "@yaakapp-internal/models";
import { differenceInCalendarDays } from "date-fns";
import { formatDate } from "date-fns/format";
import { useAtomValue } from "jotai";
import type { ReactNode } from "react";
import { openSettings } from "../commands/openSettings";
import { atomWithKVStorage } from "../lib/atoms/atomWithKVStorage";
import { jotaiStore } from "../lib/jotai";
import { CargoFeature } from "./CargoFeature";
import type { ButtonProps } from "./core/Button";
import { Dropdown, type DropdownItem } from "./core/Dropdown";
import { Icon } from "@yaakapp-internal/ui";
import { PillButton } from "./core/PillButton";

const dismissedAtom = atomWithKVStorage<string | null>("dismissed_license_expired", null);

function getDetail(
  data: LicenseCheckStatus,
  dismissedExpired: string | null,
): { label: ReactNode; color: ButtonProps["color"]; options?: DropdownItem[] } | null | undefined {
  const dismissedAt = dismissedExpired ? new Date(dismissedExpired).getTime() : null;

  switch (data.status) {
    case "active":
      return null;
    case "personal_use":
      return { label: i18n.t("license.personalUse"), color: "notice" };
    case "trialing":
      return { label: i18n.t("license.commercialTrial"), color: "secondary" };
    case "error":
      return { label: i18n.t("license.checkError"), color: "danger" };
    case "inactive":
      return { label: i18n.t("license.personalUse"), color: "notice" };
    case "past_due":
      return { label: i18n.t("license.pastDue"), color: "danger" };
    case "expired":
      // Don't show the expired message if it's been less than 14 days since the last dismissal
      if (dismissedAt && differenceInCalendarDays(new Date(), dismissedAt) < 14) {
        return null;
      }

      return {
        color: "notice",
        label: data.data.changes > 0 ? i18n.t("license.updatesPaused") : i18n.t("license.expired"),
        options: [
          {
            label: i18n.t("license.newUpdates", { count: data.data.changes }),
            color: "success",
            leftSlot: <Icon icon="gift" />,
            rightSlot: <Icon icon="external_link" size="sm" className="opacity-disabled" />,
            hidden: data.data.changes === 0 || data.data.changesUrl == null,
            onSelect: () => openUrl(data.data.changesUrl ?? ""),
          },
          {
            type: "separator",
            label: i18n.t("license.expiredOn", {
              date: formatDate(data.data.periodEnd, "MMM dd, yyyy"),
            }),
          },
          {
            label: <div className="min-w-48">{i18n.t("license.renew")}</div>,
            leftSlot: <Icon icon="refresh" />,
            rightSlot: <Icon icon="external_link" size="sm" className="opacity-disabled" />,
            hidden: data.data.changesUrl == null,
            onSelect: () => openUrl(data.data.billingUrl),
          },
          {
            label: i18n.t("license.enterKey"),
            leftSlot: <Icon icon="key_round" />,
            hidden: data.data.changesUrl == null,
            onSelect: openLicenseDialog,
          },
          { type: "separator" },
          {
            label: <span className="text-text-subtle">{i18n.t("license.remindLater")}</span>,
            leftSlot: <Icon icon="alarm_clock" className="text-text-subtle" />,
            onSelect: () => jotaiStore.set(dismissedAtom, new Date().toISOString()),
          },
        ],
      };
  }
}

export function LicenseBadge() {
  return (
    <CargoFeature feature="license">
      <LicenseBadgeCmp />
    </CargoFeature>
  );
}

function LicenseBadgeCmp() {
  const { check } = useLicense();
  const settings = useAtomValue(settingsAtom);
  const dismissed = useAtomValue(dismissedAtom);

  // Dismissed license badge
  if (settings.hideLicenseBadge) {
    return null;
  }

  if (check.error) {
    // Failed to check for license. Probably a network or server error, so just don't show anything.
    return null;
  }

  // Hasn't loaded yet
  if (check.data == null) {
    return null;
  }

  const detail = getDetail(check.data, dismissed);
  if (detail == null) {
    return null;
  }

  if (detail.options && detail.options.length > 0) {
    return (
      <Dropdown items={detail.options}>
        <PillButton color={detail.color}>
          <div className="flex items-center gap-0.5">
            {detail.label} <Icon icon="chevron_down" className="opacity-60" />
          </div>
        </PillButton>
      </Dropdown>
    );
  }

  return (
    <PillButton color={detail.color} onClick={openLicenseDialog}>
      {detail.label}
    </PillButton>
  );
}

function openLicenseDialog() {
  openSettings.mutate("license");
}
