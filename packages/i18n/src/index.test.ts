import { describe, expect, it } from "vitest";
import { resolveLanguage } from "./index";
import { en, zhCN } from "./resources";

function resourceKeys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    return child != null && typeof child === "object" ? resourceKeys(child, path) : [path];
  });
}

describe("resolveLanguage", () => {
  it.each(["zh-CN", "zh-CN-x-private", "zh-Hans", "zh-Hans-CN", "zh-SG"])(
    "maps the supported system locale %s to Simplified Chinese",
    (locale) => expect(resolveLanguage("system", [locale])).toBe("zh-CN"),
  );

  it.each(["zh-TW", "zh-Hant", "en-US", "ja-JP"])(
    "falls back to English for system locale %s",
    (locale) => expect(resolveLanguage("system", [locale])).toBe("en"),
  );

  it("honors an explicit language regardless of the system locale", () => {
    expect(resolveLanguage("en", ["zh-CN"])).toBe("en");
    expect(resolveLanguage("zh-CN", ["en-US"])).toBe("zh-CN");
  });

  it("treats an unknown persisted preference as system", () => {
    expect(resolveLanguage("unsupported", ["en-US"])).toBe("en");
    expect(resolveLanguage("unsupported", ["zh-Hans"])).toBe("zh-CN");
  });
});

describe("translation resources", () => {
  it("keeps English and Simplified Chinese keys in sync", () => {
    expect(resourceKeys(zhCN).sort()).toEqual(resourceKeys(en).sort());
  });
});
