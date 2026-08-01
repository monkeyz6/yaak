import type { Environment } from "@yaakapp-internal/models";
import { patchModelById } from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { generateId } from "../lib/generateId";
import { getKeyValue, getKeyValueRaw, setKeyValue } from "../lib/keyValueStore";
import {
  EMPTY_VARIABLE_QUICK_CONFIG,
  LEGACY_CANDIDATES_KEY,
  LEGACY_COLLAPSED_KEY,
  LEGACY_HISTORY_KEY,
  LEGACY_MIGRATION_KEY,
  LEGACY_PINNED_KEY,
  MAX_PINNED,
  type VariableQuickSwitchConfigV1,
  type VariableQuickValueMap,
  isEncrypted,
  normalizeVariableQuickConfig,
  planLegacyVariableQuickMigration,
  prependCandidateValues,
  promoteCandidate,
  removeCandidate,
  upsertEnvironmentVariable,
  variableQuickCollapsedKey,
  variableQuickConfigKey,
} from "../lib/variableQuickSwitch";
import { useActiveEnvironment } from "./useActiveEnvironment";
import { useActiveEnvironmentVariables } from "./useActiveEnvironmentVariables";
import { activeWorkspaceIdAtom } from "./useActiveWorkspace";
import { useEnvironmentsBreakdown } from "./useEnvironmentsBreakdown";
import { useKeyValue } from "./useKeyValue";

export type CommitVariableValueResult = {
  candidateSaved: boolean;
};

const configSnapshots = new Map<string, VariableQuickSwitchConfigV1>();
const configQueues = new Map<string, Promise<void>>();
let legacyMigrationRun: Promise<void> | null = null;

/**
 * Workspace-scoped state and mutations for the variable quick switcher. All
 * writes for a workspace are serialized so rapid actions cannot overwrite each
 * other with a stale React render.
 */
export function useVariableQuickSwitch() {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const storageWorkspaceId = workspaceId ?? "n/a";
  const configState = useKeyValue<VariableQuickSwitchConfigV1>({
    namespace: "global",
    key: variableQuickConfigKey(storageWorkspaceId),
    fallback: EMPTY_VARIABLE_QUICK_CONFIG,
  });
  const collapsedState = useKeyValue<boolean>({
    namespace: "no_sync",
    key: variableQuickCollapsedKey(storageWorkspaceId),
    fallback: true,
  });

  const activeEnvironment = useActiveEnvironment();
  const { allEnvironments, baseEnvironment } = useEnvironmentsBreakdown();
  const activeVariables = useActiveEnvironmentVariables();

  const config = useMemo(
    () => normalizeVariableQuickConfig(configState.value),
    [configState.value],
  );
  const pinned = config.pinnedNames;
  const candidates = config.candidatesByName;
  const collapsed = collapsedState.value ?? true;

  useEffect(() => {
    if (!configQueues.has(storageWorkspaceId)) {
      configSnapshots.set(storageWorkspaceId, config);
    }
  }, [config, storageWorkspaceId]);

  useEffect(() => {
    if (workspaceId == null || configState.isLoading) return;
    void migrateLegacyConfigOnce(workspaceId).catch((error) => {
      console.error("Failed to migrate legacy quick-variable config", error);
    });
  }, [configState.isLoading, workspaceId]);

  const updateConfig = useCallback(
    async (update: (current: VariableQuickSwitchConfigV1) => VariableQuickSwitchConfigV1) => {
      if (workspaceId == null) throw new Error("No active workspace");
      await migrateLegacyConfigOnce(workspaceId);
      await enqueueConfigUpdate(workspaceId, config, update);
    },
    [config, workspaceId],
  );

  const pin = useCallback(
    async (name: string) => {
      if (!name) return false;
      let didPin = false;
      let wasEmpty = false;
      await updateConfig((current) => {
        wasEmpty = current.pinnedNames.length === 0;
        if (current.pinnedNames.includes(name) || current.pinnedNames.length >= MAX_PINNED) {
          return current;
        }
        didPin = true;
        return { ...current, pinnedNames: [...current.pinnedNames, name] };
      });
      if (didPin && wasEmpty) await collapsedState.set(false);
      return didPin;
    },
    [collapsedState.set, updateConfig],
  );

  const unpin = useCallback(
    async (name: string) => {
      await updateConfig((current) => ({
        ...current,
        pinnedNames: current.pinnedNames.filter((pinnedName) => pinnedName !== name),
      }));
    },
    [updateConfig],
  );

  const togglePinned = useCallback(
    async (name: string) => {
      const current = configSnapshots.get(storageWorkspaceId) ?? config;
      if (current.pinnedNames.includes(name)) {
        await unpin(name);
        return true;
      }
      return pin(name);
    },
    [config, pin, storageWorkspaceId, unpin],
  );

  const addCandidateValue = useCallback(
    async (name: string, value: string) => {
      if (!name || value === "") return;
      await updateConfig((current) => ({
        ...current,
        candidatesByName: {
          ...current.candidatesByName,
          [name]: promoteCandidate(current.candidatesByName[name] ?? [], value),
        },
      }));
    },
    [updateConfig],
  );

  const addCandidateValues = useCallback(
    async (name: string, values: string[]) => {
      if (!name || values.length === 0) return;
      await updateConfig((current) => ({
        ...current,
        candidatesByName: {
          ...current.candidatesByName,
          [name]: prependCandidateValues(current.candidatesByName[name] ?? [], values),
        },
      }));
    },
    [updateConfig],
  );

  const removeCandidateValue = useCallback(
    async (name: string, value: string) => {
      await updateConfig((current) => {
        const nextCandidates = removeCandidate(current.candidatesByName[name] ?? [], value);
        const candidatesByName = { ...current.candidatesByName };
        if (nextCandidates.length === 0) delete candidatesByName[name];
        else candidatesByName[name] = nextCandidates;
        return { ...current, candidatesByName };
      });
    },
    [updateConfig],
  );

  const commitValue = useCallback(
    async (name: string, value: string): Promise<CommitVariableValueResult> => {
      if (!name) throw new Error("Variable name is empty");
      const target: Environment | null = activeEnvironment ?? baseEnvironment;
      if (target == null) throw new Error("No active environment");

      await patchModelById("environment", target.id, (current: Environment) => ({
        ...current,
        variables: upsertEnvironmentVariable(current.variables, name, value, generateId),
      }));

      if (value === "") return { candidateSaved: true };
      try {
        await addCandidateValue(name, value);
        return { candidateSaved: true };
      } catch (error) {
        console.error("Failed to save quick-variable candidate", error);
        return { candidateSaved: false };
      }
    },
    [activeEnvironment, addCandidateValue, baseEnvironment],
  );

  const toggleCollapsed = useCallback(
    async () => collapsedState.set((previous) => !(previous ?? true)),
    [collapsedState.set],
  );

  const allVariableNames = useMemo(() => {
    const names = new Set<string>();
    for (const environment of allEnvironments) {
      for (const variable of environment.variables) {
        if (variable.name) names.add(variable.name);
      }
    }
    for (const name of pinned) names.add(name);
    for (const name of Object.keys(candidates)) names.add(name);
    return [...names].sort();
  }, [allEnvironments, candidates, pinned]);

  const availableVariables = useMemo(() => {
    const names = new Set(activeVariables.map((variable) => variable.name).filter(Boolean));
    for (const name of pinned) names.add(name);
    return [...names].sort();
  }, [activeVariables, pinned]);

  const getVariable = useCallback(
    (name: string) => activeVariables.find((variable) => variable.name === name),
    [activeVariables],
  );

  const getCandidateValues = useCallback((name: string) => candidates[name] ?? [], [candidates]);

  const isVariableEncrypted = useCallback(
    (name: string) => isEncrypted(getVariable(name)?.value ?? ""),
    [getVariable],
  );

  return {
    pinned,
    candidates,
    collapsed,
    allVariableNames,
    availableVariables,
    activeVariables,
    isLoading: configState.isLoading,
    pin,
    unpin,
    togglePinned,
    addCandidateValue,
    addCandidateValues,
    removeCandidateValue,
    commitValue,
    toggleCollapsed,
    getVariable,
    getCandidateValues,
    isVariableEncrypted,
  };
}

async function enqueueConfigUpdate(
  workspaceId: string,
  fallback: VariableQuickSwitchConfigV1,
  update: (current: VariableQuickSwitchConfigV1) => VariableQuickSwitchConfigV1,
): Promise<void> {
  const previous = configQueues.get(workspaceId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const persisted = getKeyValue<VariableQuickSwitchConfigV1>({
        namespace: "global",
        key: variableQuickConfigKey(workspaceId),
        fallback,
      });
      const current = configSnapshots.get(workspaceId) ?? normalizeVariableQuickConfig(persisted);
      const updated = normalizeVariableQuickConfig(update(current));
      configSnapshots.set(workspaceId, updated);
      await setKeyValue({
        namespace: "global",
        key: variableQuickConfigKey(workspaceId),
        value: updated,
      });
    });

  configQueues.set(workspaceId, next);
  try {
    await next;
  } finally {
    if (configQueues.get(workspaceId) === next) configQueues.delete(workspaceId);
  }
}

function migrateLegacyConfigOnce(workspaceId: string): Promise<void> {
  if (legacyMigrationRun) return legacyMigrationRun;

  const migration = (async () => {
    const migratedWorkspaceId = getKeyValue<string | null>({
      namespace: "global",
      key: LEGACY_MIGRATION_KEY,
      fallback: null,
    });
    const migrationPlan = planLegacyVariableQuickMigration({
      workspaceId,
      migratedWorkspaceId,
      hasWorkspaceConfig:
        getKeyValueRaw({ namespace: "global", key: variableQuickConfigKey(workspaceId) }) != null,
      pinnedNames: getKeyValue<string[]>({
        namespace: "global",
        key: LEGACY_PINNED_KEY,
        fallback: [],
      }),
      candidatesByName: getKeyValue<VariableQuickValueMap>({
        namespace: "global",
        key: LEGACY_CANDIDATES_KEY,
        fallback: {},
      }),
      historyByName: getKeyValue<VariableQuickValueMap>({
        namespace: "global",
        key: LEGACY_HISTORY_KEY,
        fallback: {},
      }),
    });
    if (migrationPlan == null) return;

    if (migrationPlan.configToWrite != null) {
      configSnapshots.set(workspaceId, migrationPlan.configToWrite);
      await setKeyValue({
        namespace: "global",
        key: variableQuickConfigKey(workspaceId),
        value: migrationPlan.configToWrite,
      });
    }

    if (
      getKeyValueRaw({ namespace: "no_sync", key: variableQuickCollapsedKey(workspaceId) }) == null
    ) {
      const collapsed = getKeyValue<boolean>({
        namespace: "global",
        key: LEGACY_COLLAPSED_KEY,
        fallback: true,
      });
      await setKeyValue({
        namespace: "no_sync",
        key: variableQuickCollapsedKey(workspaceId),
        value: collapsed,
      });
    }

    await setKeyValue({
      namespace: "global",
      key: LEGACY_MIGRATION_KEY,
      value: migrationPlan.migratedWorkspaceId,
    });
  })();

  legacyMigrationRun = migration.catch((error) => {
    legacyMigrationRun = null;
    throw error;
  });
  return legacyMigrationRun;
}
