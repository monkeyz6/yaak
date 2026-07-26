import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en, zhCN } from "./resources";

export type LanguagePreference = "system" | "en" | "zh-CN";

export function resolveLanguage(
  preference: LanguagePreference | string,
  systemLanguages: readonly string[] = getSystemLanguages(),
): "en" | "zh-CN" {
  if (preference === "en" || preference === "zh-CN") return preference;
  return systemLanguages.some((language) => /^(zh-CN|zh-Hans|zh-SG)(-|$)/i.test(language))
    ? "zh-CN"
    : "en";
}

export async function initializeI18n(preference: LanguagePreference = "system") {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: resolveLanguage(preference),
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      resources: {
        en: { translation: en },
        "zh-CN": { translation: zhCN },
      },
    });
  }
  syncDocumentLanguage();
  return i18n;
}

export async function setLanguagePreference(preference: LanguagePreference) {
  await i18n.changeLanguage(resolveLanguage(preference));
  syncDocumentLanguage();
}

function syncDocumentLanguage() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
}

function getSystemLanguages(): readonly string[] {
  return typeof navigator === "undefined" ? [] : navigator.languages;
}

export { i18n };
export { Trans, useTranslation } from "react-i18next";
