import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import { useTranslation } from "@yaakapp-internal/i18n";
import { Heading, VStack } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useCheckForUpdates } from "../../hooks/useCheckForUpdates";
import { appInfo } from "../../lib/appInfo";
import { revealInFinderText } from "../../lib/reveal";
import { CargoFeature } from "../CargoFeature";
import { CommercialUseBanner } from "../CommercialUseBanner";
import { DismissibleBanner } from "../core/DismissibleBanner";
import { IconButton } from "../core/IconButton";
import {
  ModelSettingRowBoolean,
  ModelSettingSelectControl,
  SettingValue,
  SettingRow,
  SettingRowBoolean,
  SettingRowSelect,
  SettingsList,
  SettingsSection,
} from "../core/SettingRow";

const WORKSPACE_SETTINGS_MOVED_AT = "2026-06-30";

export function SettingsGeneral() {
  const { t } = useTranslation();
  const settings = useAtomValue(settingsAtom);
  const checkForUpdates = useCheckForUpdates();

  if (settings == null) {
    return null;
  }

  const showWorkspaceSettingsMovedBanner =
    settings.createdAt.slice(0, 10) < WORKSPACE_SETTINGS_MOVED_AT;

  return (
    <VStack space={1.5} className="mb-4">
      <div>
        <Heading>{t("settings.general")}</Heading>
        <p className="text-text-subtle">{t("settings.generalDescription")}</p>
      </div>
      <div className="mt-3 mb-5">
        <CommercialUseBanner source="settings-general" title={t("settings.usingForWork")} />
      </div>
      <SettingsList className="space-y-8">
        <CargoFeature feature="updater">
          <SettingsSection title={t("settings.updates")}>
            <SettingRow
              title={t("settings.updateChannel")}
              description={t("settings.updateChannelDescription")}
            >
              <div className="grid grid-cols-[12rem_auto] gap-1">
                <ModelSettingSelectControl
                  model={settings}
                  modelKey="updateChannel"
                  label={t("settings.updateChannel")}
                  selectClassName="w-full!"
                  options={[
                    { label: t("settings.stable"), value: "stable" },
                    { label: t("settings.beta"), value: "beta" },
                  ]}
                />
                <IconButton
                  variant="border"
                  size="sm"
                  title={t("settings.checkForUpdates")}
                  icon="refresh"
                  spin={checkForUpdates.isPending}
                  onClick={() => checkForUpdates.mutateAsync()}
                />
              </div>
            </SettingRow>

            <SettingRowSelect
              title={t("settings.updateBehavior")}
              description={t("settings.updateBehaviorDescription")}
              name="autoupdate"
              value={settings.autoupdate ? "auto" : "manual"}
              onChange={(v) => patchModel(settings, { autoupdate: v === "auto" })}
              options={[
                { label: t("settings.automatic"), value: "auto" },
                { label: t("settings.manual"), value: "manual" },
              ]}
            />

            <ModelSettingRowBoolean
              model={settings}
              modelKey="autoDownloadUpdates"
              title={t("settings.autoDownloadUpdates")}
              description={t("settings.autoDownloadUpdatesDescription")}
              disabled={!settings.autoupdate}
            />

            <ModelSettingRowBoolean
              model={settings}
              modelKey="checkNotifications"
              title={t("settings.checkNotifications")}
              description={t("settings.checkNotificationsDescription")}
            />

            <SettingRowBoolean
              title={t("settings.anonymousStatistics")}
              description={t("settings.anonymousStatisticsDescription")}
              disabled
              checked={false}
              onChange={() => {}}
            />
          </SettingsSection>
        </CargoFeature>

        <CargoFeature feature="license">
          <SettingsSection title={t("settings.feedback")}>
            <SettingRowBoolean
              title={t("settings.promptFeedback")}
              description={t("settings.promptFeedbackDescription")}
              checked={settings.promptFeedback}
              onChange={(promptFeedback) => patchModel(settings, { promptFeedback })}
            />
          </SettingsSection>
        </CargoFeature>

        {showWorkspaceSettingsMovedBanner && (
          <DismissibleBanner
            id="workspace-settings-moved-2026-06-30"
            color="info"
            className="w-full p-4 max-w-xl mr-auto"
          >
            <p>{t("settings.workspaceSettingsMoved")}</p>
          </DismissibleBanner>
        )}

        <SettingsSection title={t("settings.appInfo")}>
          <SettingRow title={t("settings.version")} description={t("settings.versionDescription")}>
            <SettingValue value={appInfo.version} />
          </SettingRow>
          <SettingRow
            title={t("settings.dataDirectory")}
            description={t("settings.dataDirectoryDescription")}
            controlClassName="min-w-0 max-w-[min(42rem,55vw)] gap-2"
          >
            <SettingValue
              value={appInfo.appDataDir}
              actions={[
                {
                  title: revealInFinderText,
                  icon: "folder_open",
                  onClick: () => revealItemInDir(appInfo.appDataDir),
                },
              ]}
            />
          </SettingRow>
          <SettingRow
            title={t("settings.logsDirectory")}
            description={t("settings.logsDirectoryDescription")}
            controlClassName="min-w-0 max-w-[min(42rem,55vw)] gap-2"
          >
            <SettingValue
              value={appInfo.appLogDir}
              actions={[
                {
                  title: revealInFinderText,
                  icon: "folder_open",
                  onClick: () => revealItemInDir(appInfo.appLogDir),
                },
              ]}
            />
          </SettingRow>
        </SettingsSection>
      </SettingsList>
    </VStack>
  );
}
