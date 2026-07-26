import { useMutation, useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Trans, useTranslation } from "@yaakapp-internal/i18n";
import type { Plugin } from "@yaakapp-internal/models";
import { patchModel, pluginsAtom } from "@yaakapp-internal/models";
import type { PluginVersion } from "@yaakapp-internal/plugins";
import {
  checkPluginUpdates,
  installPlugin,
  searchPlugins,
  uninstallPlugin,
} from "@yaakapp-internal/plugins";
import {
  HStack,
  Icon,
  InlineCode,
  LoadingIcon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  useDebouncedValue,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useInstallPlugin } from "../../hooks/useInstallPlugin";
import { usePluginInfo } from "../../hooks/usePluginInfo";
import { usePluginsKey, useRefreshPlugins } from "../../hooks/usePlugins";
import { showConfirmDelete } from "../../lib/confirm";
import { minPromiseMillis } from "../../lib/minPromiseMillis";
import { Button } from "../core/Button";
import { Checkbox } from "../core/Checkbox";
import { CountBadge } from "../core/CountBadge";
import { IconButton } from "../core/IconButton";
import { Link } from "../core/Link";
import { PlainInput } from "../core/PlainInput";
import { TabContent, Tabs } from "../core/Tabs/Tabs";
import { EmptyStateText } from "../EmptyStateText";
import { SelectFile } from "../SelectFile";

interface SettingsPluginsProps {
  defaultSubtab?: string;
}

export function SettingsPlugins({ defaultSubtab }: SettingsPluginsProps) {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState<string | null>(null);
  const plugins = useAtomValue(pluginsAtom);
  const bundledPlugins = plugins.filter((p) => p.source === "bundled");
  const installedPlugins = plugins.filter((p) => p.source !== "bundled");
  const createPlugin = useInstallPlugin();
  const refreshPlugins = useRefreshPlugins();
  return (
    <div className="h-full">
      <Tabs
        defaultValue={defaultSubtab}
        label={t("settings.plugins")}
        addBorders
        tabListClassName="px-6 pt-2"
        tabs={[
          { label: t("settings.pluginsDiscover"), value: "search" },
          {
            label: t("settings.pluginsInstalled"),
            value: "installed",
            rightSlot: <CountBadge count={installedPlugins.length} />,
          },
          {
            label: t("settings.pluginsBundled"),
            value: "bundled",
            rightSlot: <CountBadge count={bundledPlugins.length} />,
          },
        ]}
      >
        <TabContent value="search" className="px-6">
          <PluginSearch />
        </TabContent>
        <TabContent value="installed" className="pb-0">
          <div className="h-full grid grid-rows-[minmax(0,1fr)_auto]">
            <InstalledPlugins plugins={installedPlugins} className="px-6" />
            <footer className="grid grid-cols-[minmax(0,1fr)_auto] py-2 px-4 border-t bg-surface-highlight border-border-subtle min-w-0">
              <SelectFile
                size="xs"
                noun={t("settings.pluginNoun")}
                directory
                onChange={({ filePath }) => setDirectory(filePath)}
                filePath={directory}
              />
              <HStack>
                {directory && (
                  <Button
                    size="xs"
                    color="primary"
                    className="ml-auto"
                    onClick={() => {
                      if (directory == null) return;
                      createPlugin.mutate(directory);
                      setDirectory(null);
                    }}
                  >
                    {t("settings.addPlugin")}
                  </Button>
                )}
                <IconButton
                  size="sm"
                  icon="refresh"
                  title={t("settings.reloadPlugins")}
                  spin={refreshPlugins.isPending}
                  onClick={() => refreshPlugins.mutate()}
                />
                <IconButton
                  size="sm"
                  icon="help"
                  title={t("settings.viewDocumentation")}
                  onClick={() =>
                    openUrl("https://yaak.app/docs/plugin-development/plugins-quick-start")
                  }
                />
              </HStack>
            </footer>
          </div>
        </TabContent>
        <TabContent value="bundled" className="pb-0 px-6">
          <BundledPlugins plugins={bundledPlugins} />
        </TabContent>
      </Tabs>
    </div>
  );
}

function PluginTableRowForInstalledPlugin({ plugin }: { plugin: Plugin }) {
  const info = usePluginInfo(plugin.id).data;
  if (info == null) {
    return null;
  }

  return (
    <PluginTableRow
      plugin={plugin}
      version={info.version}
      name={info.name}
      displayName={info.displayName}
      url={plugin.url}
      showCheckbox={true}
      showUninstall={true}
    />
  );
}

function PluginTableRowForBundledPlugin({ plugin }: { plugin: Plugin }) {
  const info = usePluginInfo(plugin.id).data;
  if (info == null) {
    return null;
  }

  return (
    <PluginTableRow
      plugin={plugin}
      version={info.version}
      name={info.name}
      displayName={info.displayName}
      url={plugin.url}
      showCheckbox={true}
      showUninstall={false}
    />
  );
}

function PluginTableRowForRemotePluginVersion({ pluginVersion }: { pluginVersion: PluginVersion }) {
  const plugin = useAtomValue(pluginsAtom).find((p) => p.id === pluginVersion.id);
  const pluginInfo = usePluginInfo(plugin?.id ?? null).data;

  return (
    <PluginTableRow
      plugin={plugin ?? null}
      version={pluginInfo?.version ?? pluginVersion.version}
      name={pluginVersion.name}
      displayName={pluginVersion.displayName}
      url={pluginVersion.url}
      showCheckbox={false}
    />
  );
}

function PluginTableRow({
  plugin,
  name,
  version,
  displayName,
  url,
  showCheckbox = true,
  showUninstall = true,
}: {
  plugin: Plugin | null;
  name: string;
  version: string;
  displayName: string;
  url: string | null;
  showCheckbox?: boolean;
  showUninstall?: boolean;
}) {
  const { t } = useTranslation();
  const updates = usePluginUpdates();
  const latestVersion = updates.data?.plugins.find((u) => u.name === name)?.version;
  const installPluginMutation = useMutation({
    mutationKey: ["install_plugin", name],
    mutationFn: (name: string) => installPlugin(name, null),
  });
  const uninstall = usePromptUninstall(plugin?.id ?? null, displayName);
  const refreshPlugins = useRefreshPlugins();

  return (
    <TableRow>
      {showCheckbox && (
        <TableCell className="py-0!">
          <Checkbox
            hideLabel
            title={plugin?.enabled ? t("settings.disablePlugin") : t("settings.enablePlugin")}
            checked={plugin?.enabled ?? false}
            disabled={plugin == null}
            onChange={async (enabled) => {
              if (plugin) {
                await patchModel(plugin, { enabled });
                refreshPlugins.mutate();
              }
            }}
          />
        </TableCell>
      )}
      <TableCell className="font-semibold">
        {url ? (
          <Link noUnderline href={url}>
            {displayName}
          </Link>
        ) : (
          displayName
        )}
      </TableCell>
      <TableCell>
        <InlineCode>{name}</InlineCode>
      </TableCell>
      <TableCell>
        <HStack space={1.5}>
          <InlineCode>{version}</InlineCode>
          {latestVersion != null && (
            <InlineCode className="text-success flex items-center gap-1">
              <Icon icon="arrow_up" size="sm" />
              {latestVersion}
            </InlineCode>
          )}
        </HStack>
      </TableCell>
      <TableCell className="py-0!">
        <HStack justifyContent="end" space={1.5}>
          {plugin != null && latestVersion != null ? (
            <Button
              variant="border"
              color="success"
              title={t("settings.updateToVersion", { version: latestVersion })}
              size="xs"
              isLoading={installPluginMutation.isPending}
              onClick={() => installPluginMutation.mutate(name)}
            >
              {t("settings.updatePlugin")}
            </Button>
          ) : plugin == null ? (
            <Button
              variant="border"
              color="primary"
              title={t("settings.installVersion", { version })}
              size="xs"
              isLoading={installPluginMutation.isPending}
              onClick={() => installPluginMutation.mutate(name)}
            >
              {t("settings.installPlugin")}
            </Button>
          ) : null}
          {showUninstall && uninstall != null && (
            <Button
              size="xs"
              title={t("settings.uninstallPluginTitle")}
              variant="border"
              isLoading={uninstall.isPending}
              onClick={() => uninstall.mutate()}
            >
              {t("settings.uninstallPlugin")}
            </Button>
          )}
        </HStack>
      </TableCell>
    </TableRow>
  );
}

function PluginSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState<string>("");
  const debouncedQuery = useDebouncedValue(query);
  const results = useQuery({
    queryKey: ["plugins", debouncedQuery],
    queryFn: () => searchPlugins(query),
  });

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)] gap-3">
      <HStack space={1.5}>
        <PlainInput
          hideLabel
          label={t("common.search")}
          placeholder={t("settings.searchPluginsPlaceholder")}
          onChange={setQuery}
          defaultValue={query}
        />
      </HStack>
      <div className="w-full h-full">
        {results.data == null ? (
          <EmptyStateText>
            <LoadingIcon size="xl" className="text-text-subtlest" />
          </EmptyStateText>
        ) : (results.data.plugins ?? []).length === 0 ? (
          <EmptyStateText>{t("settings.noPluginsFound")}</EmptyStateText>
        ) : (
          <Table scrollable>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("settings.pluginDisplayName")}</TableHeaderCell>
                <TableHeaderCell>{t("settings.pluginName")}</TableHeaderCell>
                <TableHeaderCell>{t("settings.version")}</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {results.data.plugins.map((p) => (
                <PluginTableRowForRemotePluginVersion key={p.id} pluginVersion={p} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function InstalledPlugins({ plugins, className }: { plugins: Plugin[]; className?: string }) {
  const { t } = useTranslation();
  return plugins.length === 0 ? (
    <div className={classNames(className, "pb-4")}>
      <EmptyStateText className="text-center">
        {t("settings.pluginsEmptyTitle")}
        <br />
        {t("settings.pluginsEmptyAction")}
      </EmptyStateText>
    </div>
  ) : (
    <Table scrollable className={className}>
      <TableHead>
        <TableRow>
          <TableHeaderCell className="w-0" />
          <TableHeaderCell>{t("settings.pluginDisplayName")}</TableHeaderCell>
          <TableHeaderCell>{t("settings.pluginName")}</TableHeaderCell>
          <TableHeaderCell>{t("settings.version")}</TableHeaderCell>
          <TableHeaderCell />
        </TableRow>
      </TableHead>
      <tbody className="divide-y divide-surface-highlight">
        {plugins.map((p) => (
          <PluginTableRowForInstalledPlugin key={p.id} plugin={p} />
        ))}
      </tbody>
    </Table>
  );
}

function BundledPlugins({ plugins }: { plugins: Plugin[] }) {
  const { t } = useTranslation();
  return plugins.length === 0 ? (
    <div className="pb-4">
      <EmptyStateText className="text-center">{t("settings.noBundledPlugins")}</EmptyStateText>
    </div>
  ) : (
    <Table scrollable>
      <TableHead>
        <TableRow>
          <TableHeaderCell className="w-0" />
          <TableHeaderCell>{t("settings.pluginDisplayName")}</TableHeaderCell>
          <TableHeaderCell>{t("settings.pluginName")}</TableHeaderCell>
          <TableHeaderCell>{t("settings.version")}</TableHeaderCell>
          <TableHeaderCell />
        </TableRow>
      </TableHead>
      <tbody className="divide-y divide-surface-highlight">
        {plugins.map((p) => (
          <PluginTableRowForBundledPlugin key={p.id} plugin={p} />
        ))}
      </tbody>
    </Table>
  );
}

function usePromptUninstall(pluginId: string | null, name: string) {
  const { t } = useTranslation();
  const mut = useMutation({
    mutationKey: ["uninstall_plugin", pluginId],
    mutationFn: async () => {
      if (pluginId == null) return;

      const confirmed = await showConfirmDelete({
        id: `uninstall-plugin-${pluginId}`,
        title: t("settings.uninstallPluginDialogTitle"),
        confirmText: t("settings.uninstallPlugin"),
        description: (
          <Trans
            i18nKey="settings.uninstallPluginConfirm"
            values={{ name }}
            components={{ 1: <InlineCode /> }}
          />
        ),
      });
      if (confirmed) {
        await minPromiseMillis(uninstallPlugin(pluginId), 700);
      }
    },
  });

  return pluginId == null ? null : mut;
}

function usePluginUpdates() {
  return useQuery({
    queryKey: ["plugin_updates", usePluginsKey()],
    queryFn: () => checkPluginUpdates(),
  });
}
