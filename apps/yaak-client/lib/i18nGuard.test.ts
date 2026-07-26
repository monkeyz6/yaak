import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en, zhCN } from "../../../packages/i18n/src/resources";

const SCAN_DIRS = ["commands", "components", "hooks", "init", "lib"];
const KEY_PATTERN = /\bt\(\s*"([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)"/g;
const TRANS_PATTERN = /i18nKey="([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)"/g;

// Multi-word English literals in user-facing JSX attributes are treated as untranslated
// strings. Technical terms that must stay hardcoded go on this allowlist.
const HARDCODED_PATTERN =
  /(?:label|title|placeholder|description|confirmText|cancelText|aria-label)="([A-Z][a-z]+ [a-zA-Z][^"]*)"/g;
const HARDCODED_ALLOWLIST = new Set(["Same Site"]);

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

function lookup(resources: Record<string, unknown>, key: string): unknown {
  let current: unknown = resources;
  for (const part of key.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

describe("i18n key guard", () => {
  const root = path.join(__dirname, "..");
  const files = SCAN_DIRS.flatMap((dir) => {
    const full = path.join(root, dir);
    return fs.existsSync(full) ? collectSourceFiles(full) : [];
  });

  it("scans a meaningful number of source files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("every statically referenced key exists in both languages", () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const keys = [
        ...[...source.matchAll(KEY_PATTERN)].map((m) => m[1]),
        ...[...source.matchAll(TRANS_PATTERN)].map((m) => m[1]),
      ];
      for (const key of keys) {
        if (key == null) continue;
        if (typeof lookup(en, key) !== "string") {
          missing.push(`${path.relative(root, file)}: ${key} (en)`);
        }
        if (typeof lookup(zhCN, key) !== "string") {
          missing.push(`${path.relative(root, file)}: ${key} (zh-CN)`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("no new hardcoded multi-word English strings in user-facing attributes", () => {
    const hardcoded: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(HARDCODED_PATTERN)) {
        const value = match[1];
        if (value == null || HARDCODED_ALLOWLIST.has(value)) continue;
        hardcoded.push(`${path.relative(root, file)}: ${value}`);
      }
    }
    expect(hardcoded).toEqual([]);
  });
});
