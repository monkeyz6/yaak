import type { EnvironmentVariable } from "@yaakapp-internal/models";
import { analyzeTemplate } from "./encryption";

/** Maximum number of variables that can be pinned to the quick-switch bar. */
export const MAX_PINNED = 5;

export type VariableQuickValueMap = Record<string, string[]>;

export type VariableQuickSwitchConfigV1 = {
  version: 1;
  pinnedNames: string[];
  candidatesByName: VariableQuickValueMap;
};

export const EMPTY_VARIABLE_QUICK_CONFIG: VariableQuickSwitchConfigV1 = {
  version: 1,
  pinnedNames: [],
  candidatesByName: {},
};

export const LEGACY_PINNED_KEY = ["variable_quick", "pinned"];
export const LEGACY_CANDIDATES_KEY = ["variable_quick", "candidates"];
export const LEGACY_HISTORY_KEY = ["variable_quick", "history"];
export const LEGACY_COLLAPSED_KEY = ["variable_quick", "collapsed"];
export const LEGACY_MIGRATION_KEY = ["variable_quick", "legacy_migrated_workspace"];

export function variableQuickConfigKey(workspaceId: string): string[] {
  return ["variable_quick", "config", workspaceId];
}

export function variableQuickCollapsedKey(workspaceId: string): string[] {
  return ["variable_quick", "collapsed", workspaceId];
}

/** Normalize persisted data at the boundary so corrupted or older values cannot leak into the UI. */
export function normalizeVariableQuickConfig(
  config: VariableQuickSwitchConfigV1 | null | undefined,
): VariableQuickSwitchConfigV1 {
  const pinnedNames = uniqueNonEmpty(config?.pinnedNames ?? []).slice(0, MAX_PINNED);
  const candidatesByName: VariableQuickValueMap = {};

  for (const [name, values] of Object.entries(config?.candidatesByName ?? {})) {
    if (!name || !Array.isArray(values)) continue;
    const normalized = uniqueNonEmpty(values);
    if (normalized.length > 0) candidatesByName[name] = normalized;
  }

  return { version: 1, pinnedNames, candidatesByName };
}

/** Build the workspace config used by the one-time migration from the experimental global keys. */
export function migrateLegacyVariableQuickConfig({
  pinnedNames,
  candidatesByName,
  historyByName,
}: {
  pinnedNames: string[];
  candidatesByName: VariableQuickValueMap;
  historyByName: VariableQuickValueMap;
}): VariableQuickSwitchConfigV1 {
  const names = new Set([...Object.keys(candidatesByName), ...Object.keys(historyByName)]);
  const migratedCandidates: VariableQuickValueMap = {};

  for (const name of names) {
    const values = uniqueNonEmpty([
      ...(candidatesByName[name] ?? []),
      ...(historyByName[name] ?? []),
    ]);
    if (values.length > 0) migratedCandidates[name] = values;
  }

  return normalizeVariableQuickConfig({
    version: 1,
    pinnedNames,
    candidatesByName: migratedCandidates,
  });
}

/** Decide whether the process-wide legacy payload belongs to this workspace. */
export function planLegacyVariableQuickMigration({
  workspaceId,
  migratedWorkspaceId,
  hasWorkspaceConfig,
  pinnedNames,
  candidatesByName,
  historyByName,
}: {
  workspaceId: string;
  migratedWorkspaceId: string | null;
  hasWorkspaceConfig: boolean;
  pinnedNames: string[];
  candidatesByName: VariableQuickValueMap;
  historyByName: VariableQuickValueMap;
}): { migratedWorkspaceId: string; configToWrite: VariableQuickSwitchConfigV1 | null } | null {
  if (migratedWorkspaceId != null) return null;
  return {
    migratedWorkspaceId: workspaceId,
    configToWrite: hasWorkspaceConfig
      ? null
      : migrateLegacyVariableQuickConfig({ pinnedNames, candidatesByName, historyByName }),
  };
}

/** Move a successfully used candidate to the front without imposing a list-size cap. */
export function promoteCandidate(candidates: string[], value: string): string[] {
  if (value === "") return candidates;
  return [value, ...candidates.filter((candidate) => candidate !== value)];
}

/** Put a batch of new values before older values, preserving the pasted order. */
export function prependCandidateValues(candidates: string[], values: string[]): string[] {
  const nextValues = uniqueNonEmpty(values);
  if (nextValues.length === 0) return candidates;
  const nextSet = new Set(nextValues);
  return [...nextValues, ...candidates.filter((candidate) => !nextSet.has(candidate))];
}

/** Remove a manually-managed candidate value. */
export function removeCandidate(candidates: string[], value: string): string[] {
  return candidates.filter((candidate) => candidate !== value);
}

/**
 * Update the first matching variable while preserving its id and metadata, or
 * create a direct override in the target environment when it is inherited.
 */
export function upsertEnvironmentVariable(
  variables: EnvironmentVariable[],
  name: string,
  value: string,
  generateVariableId: () => string,
): EnvironmentVariable[] {
  const index = variables.findIndex((variable) => variable.name === name);
  if (index < 0) {
    return [...variables, { enabled: true, id: generateVariableId(), name, value }];
  }

  return variables.map((variable, variableIndex) =>
    variableIndex === index ? { ...variable, enabled: true, value } : variable,
  );
}

/** Whether the active value is encrypted and therefore unsafe to expose in the quick switcher. */
export function isEncrypted(value: string): boolean {
  if (value === "") return false;
  return analyzeTemplate(value) !== "insecure";
}

/**
 * Split pasted values on commas, tabs, and newlines; trim whitespace and dedupe
 * against existing candidates. Designed for CSV/TSV and Excel cell ranges.
 */
export function parseValues(raw: string, existing: string[]): string[] {
  const seen = new Set(existing);
  const result: string[] = [];
  for (const part of raw.split(/[\t\n,]+/)) {
    const value = part.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
