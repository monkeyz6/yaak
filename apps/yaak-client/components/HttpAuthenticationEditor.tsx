import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from "@yaakapp-internal/models";
import { useTranslation } from "@yaakapp-internal/i18n";
import { patchModel } from "@yaakapp-internal/models";
import { HStack, Icon } from "@yaakapp-internal/ui";
import { useCallback } from "react";
import { openFolderSettings } from "../commands/openFolderSettings";
import { openWorkspaceSettings } from "../commands/openWorkspaceSettings";
import { useAuthDropdownOptions } from "../hooks/useAuthTab";
import { useHttpAuthenticationConfig } from "../hooks/useHttpAuthenticationConfig";
import { useInheritedAuthentication } from "../hooks/useInheritedAuthentication";
import { useRenderTemplate } from "../hooks/useRenderTemplate";
import { resolvedModelName } from "../lib/resolvedModelName";
import { Button } from "./core/Button";
import { Dropdown, type DropdownItem } from "./core/Dropdown";
import { IconButton } from "./core/IconButton";
import { Input, type InputProps } from "./core/Input";
import { Link } from "./core/Link";
import { RadioDropdown } from "./core/RadioDropdown";
import { SegmentedControl } from "./core/SegmentedControl";
import { DynamicForm } from "./DynamicForm";
import { EmptyStateText } from "./EmptyStateText";

interface Props {
  model: HttpRequest | GrpcRequest | WebsocketRequest | Folder | Workspace;
}

export function HttpAuthenticationEditor({ model }: Props) {
  const { t } = useTranslation();
  const inheritedAuth = useInheritedAuthentication(model);
  const authConfig = useHttpAuthenticationConfig(
    model.authenticationType,
    model.authentication,
    model,
  );

  const handleChange = useCallback(
    async (authentication: Record<string, unknown>) => await patchModel(model, { authentication }),
    [model],
  );

  if (model.authenticationType === "none") {
    return <EmptyStateText>{t("response.noAuthentication")}</EmptyStateText>;
  }

  if (model.authenticationType != null && authConfig.data == null) {
    return (
      <EmptyStateText>
        <p>{t("response.authPluginNotFound", { type: model.authenticationType })}</p>
      </EmptyStateText>
    );
  }

  if (inheritedAuth == null) {
    if (model.model === "workspace" || model.model === "folder") {
      return (
        <EmptyStateText className="flex-col gap-3">
          <div className="not-italic flex flex-col items-center gap-3 text-center">
            <p className="max-w-md text-sm text-text-subtle">
              {t("response.chooseAuthMethod", { name: resolvedModelName(model) })}
            </p>
            <AuthenticationTypeDropdown model={model} />
            <Link href="https://yaak.app/docs/using-yaak/request-inheritance">
              {t("response.documentation")}
            </Link>
          </div>
        </EmptyStateText>
      );
    }
    return <EmptyStateText>{t("response.noAuthentication")}</EmptyStateText>;
  }

  if (inheritedAuth.authenticationType === "none") {
    return <EmptyStateText>{t("response.noAuthentication")}</EmptyStateText>;
  }

  const wasAuthInherited = inheritedAuth?.id !== model.id;
  if (wasAuthInherited) {
    const name = resolvedModelName(inheritedAuth);
    const cta = inheritedAuth.model === "workspace" ? t("deleteModel.model.workspace") : name;
    return (
      <EmptyStateText>
        <p>
          {t("response.inheritedFrom")}{" "}
          <button
            type="submit"
            className="underline hover:text-text"
            onClick={() => {
              if (inheritedAuth.model === "folder") openFolderSettings(inheritedAuth.id, "auth");
              else openWorkspaceSettings("auth");
            }}
          >
            {cta}
          </button>
        </p>
      </EmptyStateText>
    );
  }

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)] gap-y-3">
      <div>
        <HStack space={2} alignItems="start">
          <SegmentedControl
            label={t("response.enabled")}
            hideLabel
            name="enabled"
            value={
              model.authentication.disabled === false || model.authentication.disabled == null
                ? "__TRUE__"
                : model.authentication.disabled === true
                  ? "__FALSE__"
                  : "__DYNAMIC__"
            }
            options={[
              { label: t("response.enabled"), value: "__TRUE__" },
              { label: t("response.disabled"), value: "__FALSE__" },
              { label: t("response.enabledWhen"), value: "__DYNAMIC__" },
            ]}
            onChange={async (enabled) => {
              let disabled: boolean | string;
              if (enabled === "__TRUE__") {
                disabled = false;
              } else if (enabled === "__FALSE__") {
                disabled = true;
              } else {
                disabled = "";
              }
              await handleChange({ ...model.authentication, disabled });
            }}
          />
          {authConfig.data?.actions && authConfig.data.actions.length > 0 && (
            <Dropdown
              items={authConfig.data.actions.map(
                (a): DropdownItem => ({
                  label: a.label,
                  leftSlot: a.icon ? <Icon icon={a.icon} /> : null,
                  onSelect: () => a.call(model),
                }),
              )}
            >
              <IconButton
                title={t("response.authenticationActions")}
                icon="settings"
                size="xs"
                className="text-secondary!"
              />
            </Dropdown>
          )}
        </HStack>
        {typeof model.authentication.disabled === "string" && (
          <div className="mt-3">
            <AuthenticationDisabledInput
              className="w-full"
              stateKey={`auth.${model.id}.dynamic`}
              value={model.authentication.disabled}
              onChange={(v) => handleChange({ ...model.authentication, disabled: v })}
            />
          </div>
        )}
      </div>
      <DynamicForm
        disabled={model.authentication.disabled === true}
        autocompleteVariables
        autocompleteFunctions
        stateKey={`auth.${model.id}.${model.authenticationType}`}
        inputs={authConfig.data?.args ?? []}
        data={model.authentication}
        onChange={handleChange}
      />
    </div>
  );
}

function AuthenticationTypeDropdown({ model }: Props) {
  const { t } = useTranslation();
  const options = useAuthDropdownOptions(model);

  if (options == null) return null;

  return (
    <RadioDropdown
      items={options.items}
      itemsAfter={options.itemsAfter}
      itemsBefore={options.itemsBefore}
      value={options.value}
      onChange={options.onChange}
    >
      <Button
        color="secondary"
        variant="border"
        size="sm"
        rightSlot={<Icon icon="chevron_down" size="sm" className="text-text-subtle" />}
      >
        {t("response.selectAuth")}
      </Button>
    </RadioDropdown>
  );
}

function AuthenticationDisabledInput({
  value,
  onChange,
  stateKey,
  className,
}: {
  value: string;
  onChange: InputProps["onChange"];
  stateKey: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const rendered = useRenderTemplate({
    template: value,
    enabled: true,
    purpose: "preview",
    refreshKey: value,
  });

  return (
    <Input
      size="sm"
      className={className}
      label={t("response.dynamicDisabled")}
      hideLabel
      defaultValue={value}
      placeholder={t("response.dynamicDisabledPlaceholder")}
      rightSlot={
        <div className="px-1 flex items-center">
          <div className="rounded-full bg-surface-highlight text-xs px-1.5 py-0.5 text-text-subtle whitespace-nowrap">
            {rendered.isPending
              ? t("response.dynamicStatusLoading")
              : rendered.data
                ? t("response.dynamicStatusEnabled")
                : t("response.dynamicStatusDisabled")}
          </div>
        </div>
      }
      autocompleteFunctions
      autocompleteVariables
      onChange={onChange}
      stateKey={stateKey}
    />
  );
}
