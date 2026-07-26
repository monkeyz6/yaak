import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import type { ProxySetting } from "@yaakapp-internal/models";
import { useTranslation } from "@yaakapp-internal/i18n";
import { Heading, VStack } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { CommercialUseBanner } from "../CommercialUseBanner";
import {
  SettingRowBoolean,
  SettingRowSelect,
  SettingRowText,
  SettingsList,
  SettingsSection,
} from "../core/SettingRow";

export function SettingsProxy() {
  const { t } = useTranslation();
  const settings = useAtomValue(settingsAtom);
  const proxy = enabledProxyOrDefault(settings.proxy);

  const patchProxy = async (patch: Partial<EnabledProxySetting>) => {
    await patchModel(settings, {
      proxy: {
        ...proxy,
        ...patch,
        auth: Object.hasOwn(patch, "auth") ? (patch.auth ?? null) : proxy.auth,
      },
    });
  };

  return (
    <VStack space={1.5} className="mb-4">
      <div className="mb-3">
        <Heading>{t("settings.proxy")}</Heading>
        <p className="text-text-subtle">{t("settings.proxyDescription")}</p>
      </div>
      <CommercialUseBanner source="proxy-settings" title={t("settings.usingProxyForWork")} />
      <SettingsList className="space-y-8">
        <SettingsSection title={t("settings.proxy")}>
          <SettingRowSelect
            title={t("settings.proxy")}
            description={t("settings.proxyModeDescription")}
            name="proxy"
            value={settings.proxy?.type ?? "automatic"}
            onChange={async (v) => {
              if (v === "automatic") {
                await patchModel(settings, { proxy: undefined });
              } else if (v === "enabled") {
                await patchModel(settings, { proxy });
              } else {
                await patchModel(settings, { proxy: { type: "disabled" } });
              }
            }}
            options={[
              { label: t("settings.proxyAutomatic"), value: "automatic" },
              { label: t("settings.proxyCustom"), value: "enabled" },
              { label: t("settings.proxyNone"), value: "disabled" },
            ]}
            selectClassName="w-64!"
          />
        </SettingsSection>

        {settings.proxy?.type === "enabled" && (
          <>
            <SettingsSection title={t("settings.customProxy")}>
              <SettingRowBoolean
                checked={!settings.proxy.disabled}
                title={t("settings.enableProxy")}
                description={t("settings.enableProxyDescription")}
                onChange={(enabled) => patchProxy({ disabled: !enabled })}
              />
              <SettingRowText
                name="proxyHttp"
                title={t("settings.httpProxy")}
                description={t("settings.httpProxyDescription")}
                value={settings.proxy.http}
                placeholder="localhost:9090"
                onChange={(http) => patchProxy({ http })}
              />
              <SettingRowText
                name="proxyHttps"
                title={t("settings.httpsProxy")}
                description={t("settings.httpsProxyDescription")}
                value={settings.proxy.https}
                placeholder="localhost:9090"
                onChange={(https) => patchProxy({ https })}
              />
              <SettingRowText
                name="proxyBypass"
                title={t("settings.proxyBypass")}
                description={t("settings.proxyBypassDescription")}
                value={settings.proxy.bypass}
                placeholder="127.0.0.1, *.example.com, localhost:3000"
                inputWidthClassName="w-96!"
                onChange={(bypass) => patchProxy({ bypass })}
              />
            </SettingsSection>

            <SettingsSection title={t("settings.authentication")}>
              <SettingRowBoolean
                checked={settings.proxy.auth != null}
                title={t("settings.enableAuthentication")}
                description={t("settings.enableAuthenticationDescription")}
                onChange={(enabled) =>
                  patchProxy({ auth: enabled ? { user: "", password: "" } : null })
                }
              />

              {settings.proxy.auth != null && (
                <>
                  <SettingRowText
                    required
                    name="proxyUser"
                    title={t("settings.user")}
                    description={t("settings.proxyUserDescription")}
                    value={settings.proxy.auth.user}
                    placeholder="myUser"
                    onChange={(user) =>
                      patchProxy({
                        auth: {
                          user,
                          password:
                            settings.proxy?.type === "enabled"
                              ? (settings.proxy.auth?.password ?? "")
                              : "",
                        },
                      })
                    }
                  />
                  <SettingRowText
                    name="proxyPassword"
                    title={t("settings.password")}
                    description={t("settings.proxyPasswordDescription")}
                    value={settings.proxy.auth.password}
                    placeholder="s3cretPassw0rd"
                    type="password"
                    onChange={(password) =>
                      patchProxy({
                        auth: {
                          user:
                            settings.proxy?.type === "enabled"
                              ? (settings.proxy.auth?.user ?? "")
                              : "",
                          password,
                        },
                      })
                    }
                  />
                </>
              )}
            </SettingsSection>
          </>
        )}
      </SettingsList>
    </VStack>
  );
}

type EnabledProxySetting = Extract<ProxySetting, { type: "enabled" }>;

function enabledProxyOrDefault(proxy: ProxySetting | null): EnabledProxySetting {
  if (proxy?.type === "enabled") return proxy;

  return {
    disabled: false,
    type: "enabled",
    http: "",
    https: "",
    auth: { user: "", password: "" },
    bypass: "",
  };
}
