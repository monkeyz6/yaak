import type { EnvironmentVariable } from "@yaakapp-internal/models";
import { describe, expect, it } from "vitest";
import {
  MAX_PINNED,
  isEncrypted,
  migrateLegacyVariableQuickConfig,
  normalizeVariableQuickConfig,
  parseValues,
  planLegacyVariableQuickMigration,
  prependCandidateValues,
  promoteCandidate,
  removeCandidate,
  upsertEnvironmentVariable,
  variableQuickCollapsedKey,
  variableQuickConfigKey,
} from "./variableQuickSwitch";

describe("variable quick-switch helpers", () => {
  it("builds workspace-isolated storage keys", () => {
    expect(variableQuickConfigKey("workspace-a")).toEqual([
      "variable_quick",
      "config",
      "workspace-a",
    ]);
    expect(variableQuickConfigKey("workspace-b")).not.toEqual(
      variableQuickConfigKey("workspace-a"),
    );
    expect(variableQuickCollapsedKey("workspace-a")).toEqual([
      "variable_quick",
      "collapsed",
      "workspace-a",
    ]);
  });

  it("normalizes pinned names and enforces the maximum", () => {
    const config = normalizeVariableQuickConfig({
      version: 1,
      pinnedNames: ["a", "b", "a", "", "c", "d", "e", "f"],
      candidatesByName: { a: ["one", "one", "", "two"] },
    });
    expect(config.pinnedNames).toEqual(["a", "b", "c", "d", "e"]);
    expect(config.pinnedNames).toHaveLength(MAX_PINNED);
    expect(config.candidatesByName.a).toEqual(["one", "two"]);
  });

  it("migrates legacy candidates and history without truncating them", () => {
    const history = Array.from({ length: 15 }, (_, index) => `history-${index}`);
    const config = migrateLegacyVariableQuickConfig({
      pinnedNames: ["model", "region", "third", "fourth", "fifth", "ignored"],
      candidatesByName: { model: ["gpt-5", "claude", "gpt-5"] },
      historyByName: { model: ["claude", ...history] },
    });
    expect(config.pinnedNames).toEqual(["model", "region", "third", "fourth", "fifth"]);
    expect(config.candidatesByName.model).toEqual(["gpt-5", "claude", ...history]);
    expect(config.candidatesByName.model).toHaveLength(17);
  });

  it("migrates legacy data into only the first workspace", () => {
    const firstMigration = planLegacyVariableQuickMigration({
      workspaceId: "workspace-a",
      migratedWorkspaceId: null,
      hasWorkspaceConfig: false,
      pinnedNames: ["model"],
      candidatesByName: { model: ["gpt-5"] },
      historyByName: {},
    });
    expect(firstMigration).toEqual({
      migratedWorkspaceId: "workspace-a",
      configToWrite: {
        version: 1,
        pinnedNames: ["model"],
        candidatesByName: { model: ["gpt-5"] },
      },
    });

    expect(
      planLegacyVariableQuickMigration({
        workspaceId: "workspace-b",
        migratedWorkspaceId: firstMigration?.migratedWorkspaceId ?? null,
        hasWorkspaceConfig: false,
        pinnedNames: ["model"],
        candidatesByName: { model: ["should-not-migrate"] },
        historyByName: {},
      }),
    ).toBeNull();
  });

  it("promotes used candidates and preserves an unlimited list", () => {
    const candidates = Array.from({ length: 20 }, (_, index) => `value-${index}`);
    expect(promoteCandidate(candidates, "value-12")).toEqual([
      "value-12",
      ...candidates.filter((value) => value !== "value-12"),
    ]);
    expect(promoteCandidate(candidates, "new-value")).toHaveLength(21);
    expect(promoteCandidate(candidates, "")).toBe(candidates);
  });

  it("prepends batch values in input order and removes duplicates", () => {
    expect(prependCandidateValues(["b", "old"], ["a", "b", "a", "c", ""])).toEqual([
      "a",
      "b",
      "c",
      "old",
    ]);
    expect(removeCandidate(["a", "b"], "a")).toEqual(["b"]);
  });

  it("updates an existing variable without replacing its id or siblings", () => {
    const variables: EnvironmentVariable[] = [
      { id: "one", enabled: false, name: "model", value: "old" },
      { id: "two", enabled: true, name: "region", value: "cn" },
    ];
    expect(upsertEnvironmentVariable(variables, "model", "new", () => "generated")).toEqual([
      { id: "one", enabled: true, name: "model", value: "new" },
      variables[1],
    ]);
  });

  it("creates a direct variable override when the target has none", () => {
    expect(upsertEnvironmentVariable([], "model", "gpt-5", () => "generated")).toEqual([
      { id: "generated", enabled: true, name: "model", value: "gpt-5" },
    ]);
  });

  it("detects encrypted values but treats an empty value as plain", () => {
    expect(isEncrypted("plain-text")).toBe(false);
    expect(isEncrypted("${[ secure(value='secret') ]}")).toBe(true);
    expect(isEncrypted("")).toBe(false);
  });

  describe("parseValues", () => {
    it("parses mixed CSV, TSV, and newline input", () => {
      expect(parseValues("gpt-4o, claude-3-5-sonnet\ngemini-2.0-flash\tdeepseek-v3", [])).toEqual([
        "gpt-4o",
        "claude-3-5-sonnet",
        "gemini-2.0-flash",
        "deepseek-v3",
      ]);
    });

    it("trims, deduplicates, and excludes existing values", () => {
      expect(parseValues(" a , b\t,\ta \n c ", ["b", "old"])).toEqual(["a", "c"]);
    });
  });
});
