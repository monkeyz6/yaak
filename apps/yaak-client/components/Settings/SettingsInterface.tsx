import { type } from "@tauri-apps/plugin-os";
import { useTranslation } from "@yaakapp-internal/i18n";
import { useFonts } from "@yaakapp-internal/fonts";
import { useLicense } from "@yaakapp-internal/license";
import type { EditorKeymap, Settings } from "@yaakapp-internal/models";
import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import { clamp, Heading, VStack } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { activeWorkspaceAtom } from "../../hooks/useActiveWorkspace";
import { showConfirm } from "../../lib/confirm";
import { pricingUrl } from "../../lib/pricingUrl";
import { invokeCmd } from "../../lib/tauri";
import { CargoFeature } from "../CargoFeature";
import { Button } from "../core/Button";
import { Checkbox } from "../core/Checkbox";
import { Link } from "../core/Link";
import {
  ModelSettingRowBoolean,
  ModelSettingRowSelect,
  SettingRow,
  SettingRowBoolean,
  SettingRowSelect,
  SettingSelectControl,
  SettingsList,
  SettingsSection,
} from "../core/SettingRow";

const NULL_FONT_VALUE = "__NULL_FONT__";

const fontSizeOptions = [
  8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
].map((n) => ({ label: `${n}`, value: `${n}` }));

const keymaps: { value: EditorKeymap; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "vim", label: "Vim" },
  { value: "vscode", label: "VSCode" },
  { value: "emacs", label: "Emacs" },
];

export function SettingsInterface() {
  const { t } = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const settings = useAtomValue(settingsAtom);
  const fonts = useFonts();

  if (settings == null || workspace == null) {
    return null;
  }

  return (
    <VStack space={1.5} className="mb-4">
      <div className="mb-3">
        <Heading>{t("settings.interface")}</Heading>
        <p className="text-text-subtle">{t("settings.interfaceDescription")}</p>
      </div>
      <SettingsList className="space-y-8">
        <SettingsSection title={t("settings.languageSection")}>
          <SettingRowSelect
            title={t("settings.language")}
            description={t("settings.languageDescription")}
            name="language"
            value={settings.language}
            onChange={(language) => patchModel(settings, { language })}
            options={[
              { label: t("settings.systemLanguage"), value: "system" },
              { label: t("settings.english"), value: "en" },
              { label: t("settings.simplifiedChinese"), value: "zh-CN" },
            ]}
          />
        </SettingsSection>

        <SettingsSection title={t("settings.workspaces")}>
          <SettingRowSelect
            title={t("settings.openWorkspaceBehavior")}
            description={t("settings.openWorkspaceDescription")}
            name="switchWorkspaceBehavior"
            value={
              settings.openWorkspaceNewWindow === true
                ? "new"
                : settings.openWorkspaceNewWindow === false
                  ? "current"
                  : "ask"
            }
            onChange={async (v) => {
              if (v === "current") await patchModel(settings, { openWorkspaceNewWindow: false });
              else if (v === "new") await patchModel(settings, { openWorkspaceNewWindow: true });
              else await patchModel(settings, { openWorkspaceNewWindow: null });
            }}
            options={[
              { label: t("settings.alwaysAsk"), value: "ask" },
              { label: t("settings.currentWindow"), value: "current" },
              { label: t("settings.newWindow"), value: "new" },
            ]}
          />
        </SettingsSection>

        <SettingsSection title={t("settings.fonts")}>
          <SettingRow
            title={t("settings.interfaceFont")}
            description={t("settings.interfaceFontDescription")}
            controlClassName="gap-1"
          >
            {fonts.data && (
              <SettingSelectControl
                name="uiFont"
                label={t("settings.interfaceFont")}
                selectClassName="w-72!"
                value={settings.interfaceFont ?? NULL_FONT_VALUE}
                defaultValue={NULL_FONT_VALUE}
                options={[
                  { label: t("settings.systemDefault"), value: NULL_FONT_VALUE },
                  ...fonts.data.uiFonts.map((f) => ({ label: f, value: f })),
                  ...fonts.data.editorFonts.map((f) => ({ label: f, value: f })),
                ]}
                onChange={async (v) => {
                  const interfaceFont = v === NULL_FONT_VALUE ? null : v;
                  await patchModel(settings, { interfaceFont });
                }}
              />
            )}
            <SettingSelectControl
              name="interfaceFontSize"
              label={t("settings.interfaceFontSize")}
              selectClassName="w-20!"
              value={`${settings.interfaceFontSize}`}
              defaultValue="14"
              options={fontSizeOptions}
              onChange={(v) => patchModel(settings, { interfaceFontSize: Number.parseInt(v, 10) })}
            />
          </SettingRow>

          <SettingRow
            title={t("settings.editorFont")}
            description={t("settings.editorFontDescription")}
            controlClassName="gap-1"
          >
            {fonts.data && (
              <SettingSelectControl
                name="editorFont"
                label={t("settings.editorFont")}
                selectClassName="w-72!"
                value={settings.editorFont ?? NULL_FONT_VALUE}
                defaultValue={NULL_FONT_VALUE}
                options={[
                  { label: t("settings.systemDefault"), value: NULL_FONT_VALUE },
                  ...fonts.data.editorFonts.map((f) => ({ label: f, value: f })),
                ]}
                onChange={async (v) => {
                  const editorFont = v === NULL_FONT_VALUE ? null : v;
                  await patchModel(settings, { editorFont });
                }}
              />
            )}
            <SettingSelectControl
              name="editorFontSize"
              label={t("settings.editorFontSize")}
              selectClassName="w-20!"
              value={`${settings.editorFontSize}`}
              defaultValue="12"
              options={fontSizeOptions}
              onChange={(v) =>
                patchModel(settings, {
                  editorFontSize: clamp(Number.parseInt(v, 10) || 14, 8, 30),
                })
              }
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection title={t("settings.editor")}>
          <ModelSettingRowSelect
            model={settings}
            modelKey="editorKeymap"
            title={t("settings.editorKeymap")}
            description={t("settings.editorKeymapDescription")}
            options={keymaps.map((k) =>
              k.value === "default" ? { ...k, label: t("settings.keymapDefault") } : k,
            )}
          />
          <ModelSettingRowBoolean
            model={settings}
            modelKey="editorSoftWrap"
            title={t("settings.wrapLines")}
            description={t("settings.wrapLinesDescription")}
          />
          <ModelSettingRowBoolean
            model={settings}
            modelKey="coloredMethods"
            title={t("settings.coloredMethods")}
            description={t("settings.coloredMethodsDescription")}
          />
        </SettingsSection>

        <SettingsSection title={t("settings.window")}>
          <NativeTitlebarSetting settings={settings} />
          {type() !== "macos" && (
            <ModelSettingRowBoolean
              model={settings}
              modelKey="hideWindowControls"
              title={t("settings.hideWindowControls")}
              description={t("settings.hideWindowControlsDescription")}
            />
          )}
        </SettingsSection>

        <CargoFeature feature="license">
          <LicenseSettings settings={settings} />
        </CargoFeature>
      </SettingsList>
    </VStack>
  );
}

function NativeTitlebarSetting({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const [nativeTitlebar, setNativeTitlebar] = useState(settings.useNativeTitlebar);

  return (
    <SettingRow
      title={t("settings.nativeTitlebar")}
      description={t("settings.nativeTitlebarDescription")}
      controlClassName="gap-2"
    >
      <Checkbox
        hideLabel
        size="md"
        checked={nativeTitlebar}
        title={t("settings.nativeTitlebar")}
        onChange={setNativeTitlebar}
      />
      {settings.useNativeTitlebar !== nativeTitlebar && (
        <Button
          color="primary"
          size="xs"
          onClick={async () => {
            await patchModel(settings, { useNativeTitlebar: nativeTitlebar });
            await invokeCmd("cmd_restart");
          }}
        >
          {t("settings.applyRestart")}
        </Button>
      )}
    </SettingRow>
  );
}

function LicenseSettings({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const license = useLicense();
  if (license.check.data?.status !== "personal_use") {
    return null;
  }

  return (
    <SettingsSection title={t("settings.license")}>
      <SettingRowBoolean
        checked={settings.hideLicenseBadge}
        title={t("settings.hideLicenseBadge")}
        description={t("settings.hideLicenseBadgeDescription")}
        onChange={async (hideLicenseBadge) => {
          if (hideLicenseBadge) {
            const confirmed = await showConfirm({
              id: "hide-license-badge",
              title: t("settings.confirmPersonalUse"),
              confirmText: t("common.confirm"),
              description: (
                <VStack space={3}>
                  <p>{t("settings.licenseGreeting")}</p>
                  <p>
                    {t("settings.licensePersonalFree")}{" "}
                    <strong>{t("settings.licenseWorkRequired")}</strong>
                  </p>
                  <p>
                    {t("settings.licenseSustain")}{" "}
                    <Link href={pricingUrl("app.license.badge-hide-confirm")}>
                      {t("settings.purchaseLicenseLink")}
                    </Link>
                  </p>
                </VStack>
              ),
              requireTyping: t("settings.personalUse"),
              color: "info",
            });
            if (!confirmed) {
              return;
            }
          }
          await patchModel(settings, { hideLicenseBadge });
        }}
      />
    </SettingsSection>
  );
}
