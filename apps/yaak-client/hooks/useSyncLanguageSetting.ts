import { setLanguagePreference, type LanguagePreference } from "@yaakapp-internal/i18n";
import { settingsAtom } from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { fireAndForget } from "../lib/fireAndForget";

export function useSyncLanguageSetting() {
  const settings = useAtomValue(settingsAtom);
  const language = (settings?.language ?? "system") as LanguagePreference;

  useEffect(() => {
    fireAndForget(setLanguagePreference(language));
  }, [language]);
}
