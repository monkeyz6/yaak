import { Trans, useTranslation } from "@yaakapp-internal/i18n";
import type { Folder } from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import { HStack, Icon, InlineCode } from "@yaakapp-internal/ui";
import { useMemo } from "react";
import { openFolderSettings } from "../commands/openFolderSettings";
import { openWorkspaceSettings } from "../commands/openWorkspaceSettings";
import { IconTooltip } from "../components/core/IconTooltip";
import type { RadioDropdownProps } from "../components/core/RadioDropdown";
import type { TabItem } from "../components/core/Tabs/Tabs";
import { showConfirm } from "../lib/confirm";
import { resolvedModelName } from "../lib/resolvedModelName";
import { useHttpAuthenticationSummaries } from "./useHttpAuthentication";
import type { AuthenticatedModel } from "./useInheritedAuthentication";
import { useInheritedAuthentication } from "./useInheritedAuthentication";
import { useModelAncestors } from "./useModelAncestors";

export function useAuthTab<T extends string>(tabValue: T, model: AuthenticatedModel | null) {
  const { t } = useTranslation();
  const options = useAuthDropdownOptions(model);

  return useMemo<TabItem[]>(() => {
    if (model == null || options == null) return [];

    const tab: TabItem = {
      value: tabValue,
      label: t("request.auth"),
      options,
    };

    return [tab];
  }, [model, options, t, tabValue]);
}

export function useAuthDropdownOptions(
  model: AuthenticatedModel | null,
): Omit<RadioDropdownProps, "children"> | null {
  const { t } = useTranslation();
  const authentication = useHttpAuthenticationSummaries();
  const inheritedAuth = useInheritedAuthentication(model);
  const ancestors = useModelAncestors(model);
  const parentModel = ancestors[0] ?? null;

  return useMemo(() => {
    if (model == null) return null;

    return {
      value: model.authenticationType,
      items: [
        ...authentication.map((a) => ({
          label: a.label || "UNKNOWN",
          shortLabel: a.shortLabel,
          value: a.name,
        })),
        { type: "separator" },
        {
          label: t("response.inheritFromParent"),
          shortLabel:
            inheritedAuth != null && inheritedAuth.authenticationType !== "none" ? (
              <HStack space={1.5}>
                {authentication.find((a) => a.name === inheritedAuth.authenticationType)
                  ?.shortLabel ?? "UNKNOWN"}
                <IconTooltip
                  icon="zap_off"
                  iconSize="xs"
                  content={t("response.authInheritedTooltip")}
                />
              </HStack>
            ) : (
              t("request.auth")
            ),
          value: null,
        },
        {
          label: t("response.noAuth"),
          shortLabel: t("response.noAuth"),
          value: "none",
        },
      ],
      itemsAfter: (() => {
        const actions: (
          | { type: "separator"; label: string }
          | {
              label: string;
              leftSlot: React.ReactNode;
              onSelect: () => Promise<void>;
            }
        )[] = [];

        // Promote: move auth from current model up to parent
        if (
          parentModel &&
          model.authenticationType &&
          model.authenticationType !== "none" &&
          (parentModel.authenticationType == null || parentModel.authenticationType === "none")
        ) {
          actions.push(
            { type: "separator", label: t("navigation.actions") },
            {
              label: t("response.promoteAuthTo", {
                parent:
                  parentModel.model === "workspace"
                    ? t("deleteModel.model.workspace")
                    : t("deleteModel.model.folder"),
              }),
              leftSlot: (
                <Icon icon={parentModel.model === "workspace" ? "corner_right_up" : "folder_up"} />
              ),
              onSelect: async () => {
                const confirmed = await showConfirm({
                  id: "promote-auth-confirm",
                  title: t("response.promoteAuthTitle"),
                  confirmText: t("response.promote"),
                  description: (
                    <Trans
                      i18nKey="response.promoteAuthDescription"
                      values={{ name: resolvedModelName(parentModel) }}
                      components={{ 1: <InlineCode /> }}
                    />
                  ),
                });
                if (confirmed) {
                  await patchModel(model, {
                    authentication: {},
                    authenticationType: null,
                  });
                  await patchModel(parentModel, {
                    authentication: model.authentication,
                    authenticationType: model.authenticationType,
                  });

                  if (parentModel.model === "folder") {
                    openFolderSettings(parentModel.id, "auth");
                  } else {
                    openWorkspaceSettings("auth");
                  }
                }
              },
            },
          );
        }

        // Copy from ancestor: copy auth config down to current model
        const ancestorWithAuth = ancestors.find(
          (a) => a.authenticationType != null && a.authenticationType !== "none",
        );
        if (ancestorWithAuth) {
          const ancestorTypeLabel =
            ancestorWithAuth.model === "workspace"
              ? t("deleteModel.model.workspace")
              : t("deleteModel.model.folder");
          if (actions.length === 0) {
            actions.push({ type: "separator", label: t("navigation.actions") });
          }
          actions.push({
            label: t("response.copyAuthFrom", { model: ancestorTypeLabel }),
            leftSlot: (
              <Icon
                icon={ancestorWithAuth.model === "workspace" ? "corner_right_down" : "folder_down"}
              />
            ),
            onSelect: async () => {
              const confirmed = await showConfirm({
                id: "copy-auth-confirm",
                title: t("response.copyAuthTitle"),
                confirmText: t("response.copy"),
                description: (
                  <Trans
                    i18nKey="response.copyAuthDescription"
                    values={{
                      auth:
                        authentication.find((a) => a.name === ancestorWithAuth.authenticationType)
                          ?.label ?? t("response.authGeneric"),
                      from: resolvedModelName(ancestorWithAuth),
                      model: ancestorTypeLabel.toLowerCase(),
                    }}
                    components={{ 1: <InlineCode /> }}
                  />
                ),
              });
              if (confirmed) {
                await patchModel(model, {
                  authentication: { ...ancestorWithAuth.authentication },
                  authenticationType: ancestorWithAuth.authenticationType,
                });
              }
            },
          });
        }

        return actions.length > 0 ? actions : undefined;
      })(),
      onChange: async (authenticationType) => {
        let authentication: Folder["authentication"] = model.authentication;
        if (model.authenticationType !== authenticationType) {
          authentication = {
            // Reset auth if changing types
          };
        }
        await patchModel(model, { authentication, authenticationType });
      },
    };
  }, [authentication, inheritedAuth, model, parentModel, ancestors, t]);
}
