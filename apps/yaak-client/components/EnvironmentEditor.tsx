import { useTranslation } from "@yaakapp-internal/i18n";
import type { Environment } from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import type { GenericCompletionOption } from "@yaakapp-internal/plugins";
import { Heading } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useCallback, useMemo } from "react";
import { useEnvironmentsBreakdown } from "../hooks/useEnvironmentsBreakdown";
import { useIsEncryptionEnabled } from "../hooks/useIsEncryptionEnabled";
import { useKeyValue } from "../hooks/useKeyValue";
import { useRandomKey } from "../hooks/useRandomKey";
import { useVariableQuickSwitch } from "../hooks/useVariableQuickSwitch";
import { analyzeTemplate, convertTemplateToSecure } from "../lib/encryption";
import { fireAndForget } from "../lib/fireAndForget";
import { isBaseEnvironment } from "../lib/model_util";
import { MAX_PINNED } from "../lib/variableQuickSwitch";
import {
  setupOrConfigureEncryption,
  withEncryptionEnabled,
} from "../lib/setupOrConfigureEncryption";
import { DismissibleBanner } from "./core/DismissibleBanner";
import type { GenericCompletionConfig } from "./core/Editor/genericCompletion";
import { IconButton } from "./core/IconButton";
import type { PairEditorHandle, PairWithId } from "./core/PairEditor";
import { ensurePairId } from "./core/PairEditor.util";
import { PairOrBulkEditor } from "./core/PairOrBulkEditor";
import { PillButton } from "./core/PillButton";
import { EnvironmentColorIndicator } from "./EnvironmentColorIndicator";
import { EnvironmentSharableTooltip } from "./EnvironmentSharableTooltip";

interface Props {
  environment: Environment;
  hideName?: boolean;
  className?: string;
  setRef?: (n: PairEditorHandle | null) => void;
}

export function EnvironmentEditor({ environment, hideName, className, setRef }: Props) {
  const { t } = useTranslation();
  const workspaceId = environment.workspaceId;
  const isEncryptionEnabled = useIsEncryptionEnabled();
  const valueVisibility = useKeyValue<boolean>({
    namespace: "global",
    key: ["environmentValueVisibility", workspaceId],
    fallback: false,
  });
  const { allEnvironments } = useEnvironmentsBreakdown();
  const qs = useVariableQuickSwitch();
  const handleChange = useCallback(
    (variables: PairWithId[]) => patchModel(environment, { variables }),
    [environment],
  );
  const [forceUpdateKey, regenerateForceUpdateKey] = useRandomKey();

  // Gather a list of env names from other environments to help the user get them aligned
  const nameAutocomplete = useMemo<GenericCompletionConfig>(() => {
    const options: GenericCompletionOption[] = [];
    if (isBaseEnvironment(environment)) {
      return { options };
    }

    const allVariables = allEnvironments.flatMap((e) => e?.variables);
    const allVariableNames = new Set(allVariables.map((v) => v?.name));
    for (const name of allVariableNames) {
      const containingEnvs = allEnvironments.filter((e) =>
        e.variables.some((v) => v.name === name),
      );
      const isAlreadyInActive = containingEnvs.find((e) => e.id === environment.id);
      if (isAlreadyInActive) {
        continue;
      }
      options.push({
        label: name,
        type: "constant",
        detail: containingEnvs.map((e) => e.name).join(", "),
      });
    }
    return { options };
  }, [environment, allEnvironments]);

  const validateName = useCallback((name: string) => {
    // Empty just means the variable doesn't have a name yet and is unusable
    if (name === "") return true;
    return name.match(/^[a-z_][a-z0-9_.-]*$/i) != null;
  }, []);

  const valueType = !isEncryptionEnabled && valueVisibility.value ? "text" : "password";
  const allVariableAreEncrypted = useMemo(
    () =>
      environment.variables.every((v) => v.value === "" || analyzeTemplate(v.value) !== "insecure"),
    [environment.variables],
  );

  const encryptEnvironment = (environment: Environment) => {
    withEncryptionEnabled(async () => {
      const encryptedVariables: PairWithId[] = [];
      for (const variable of environment.variables) {
        const value = variable.value ? await convertTemplateToSecure(variable.value) : "";
        encryptedVariables.push(ensurePairId({ ...variable, value }));
      }
      await handleChange(encryptedVariables);
      regenerateForceUpdateKey();
    });
  };

  const renderPinButton = useCallback(
    (variable: PairWithId) => {
      const isPinned = qs.pinned.includes(variable.name);
      const atLimit = !isPinned && qs.pinned.length >= MAX_PINNED;
      const isValidVariable = variable.name !== "" && validateName(variable.name);
      return (
        <IconButton
          icon="pin"
          size="2xs"
          iconSize="xs"
          iconColor={isPinned ? "primary" : "secondary"}
          disabled={atLimit || !isValidVariable}
          className={classNames(
            "border-0!",
            isPinned ? "opacity-100" : "opacity-0 group-hover/pair-row:opacity-70",
          )}
          title={
            isPinned
              ? t("variableQuick.unpinVariable")
              : atLimit
                ? t("variableQuick.maxPinned", { count: MAX_PINNED })
                : t("variableQuick.pinVariable")
          }
          onClick={() => fireAndForget(qs.togglePinned(variable.name))}
        />
      );
    },
    [qs.pinned, qs.togglePinned, t, validateName],
  );

  return (
    <div
      className={classNames(
        className,
        "h-full grid grid-rows-[auto_minmax(0,1fr)] gap-2 pr-3 pb-3",
      )}
    >
      <div className="flex flex-col gap-4">
        <Heading className="w-full flex items-center gap-0.5">
          <EnvironmentColorIndicator
            className="mr-2"
            clickToEdit
            environment={environment ?? null}
          />
          {!hideName && <div className="mr-2">{environment?.name}</div>}
          {isEncryptionEnabled ? (
            !allVariableAreEncrypted ? (
              <PillButton color="notice" onClick={() => encryptEnvironment(environment)}>
                {t("environment.encryptAllVariables")}
              </PillButton>
            ) : (
              <PillButton color="secondary" onClick={setupOrConfigureEncryption}>
                {t("environment.encryptionSettings")}
              </PillButton>
            )
          ) : (
            <PillButton color="secondary" onClick={() => valueVisibility.set((v) => !v)}>
              {valueVisibility.value ? t("environment.hideValues") : t("environment.showValues")}
            </PillButton>
          )}
          <PillButton
            color="secondary"
            rightSlot={<EnvironmentSharableTooltip />}
            onClick={async () => {
              await patchModel(environment, { public: !environment.public });
            }}
          >
            {environment.public ? t("environment.sharable") : t("environment.private")}
          </PillButton>
        </Heading>
        {environment.public && (!isEncryptionEnabled || !allVariableAreEncrypted) && (
          <DismissibleBanner
            id={`warn-unencrypted-${environment.id}`}
            color="notice"
            className="mr-3"
            actions={[
              {
                label: t("environment.encryptVariables"),
                onClick: () => encryptEnvironment(environment),
                color: "success",
              },
            ]}
          >
            {t("environment.plainTextSecretsWarning")}
          </DismissibleBanner>
        )}
      </div>
      <PairOrBulkEditor
        setRef={setRef}
        className="h-full"
        allowMultilineValues
        preferenceName="environment"
        nameAutocomplete={nameAutocomplete}
        namePlaceholder="VAR_NAME"
        nameValidate={validateName}
        valueType={valueType}
        valueAutocompleteVariables="environment"
        valueAutocompleteFunctions
        forceUpdateKey={`${environment.id}::${forceUpdateKey}`}
        pairs={environment.variables}
        renderRowStartSlot={renderPinButton}
        onChange={handleChange}
        stateKey={`environment.${environment.id}`}
        forcedEnvironmentId={environment.id}
      />
    </div>
  );
}
