import { en, zhCN } from "@yaakapp-internal/i18n/src/resources";
import { describe, expect, it } from "vitest";
import {
  SETTING_FOLLOW_REDIRECTS,
  SETTING_REQUEST_MESSAGE_SIZE,
  SETTING_REQUEST_TIMEOUT,
  SETTING_SEND_COOKIES,
  SETTING_STORE_COOKIES,
  SETTING_VALIDATE_CERTIFICATES,
} from "./requestSettings";

const definitions = [
  SETTING_REQUEST_TIMEOUT,
  SETTING_REQUEST_MESSAGE_SIZE,
  SETTING_VALIDATE_CERTIFICATES,
  SETTING_FOLLOW_REDIRECTS,
  SETTING_SEND_COOKIES,
  SETTING_STORE_COOKIES,
];

function getResourceValue(resource: object, key: string) {
  return key.split(".").reduce<unknown>((value, segment) => {
    if (value == null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[segment];
  }, resource);
}

describe("request setting translations", () => {
  it.each(definitions)("provides English and Chinese text for $modelKey", (definition) => {
    for (const resource of [en, zhCN]) {
      expect(getResourceValue(resource, definition.titleKey)).toEqual(expect.any(String));
      expect(getResourceValue(resource, definition.descriptionKey)).toEqual(expect.any(String));
    }
  });
});
