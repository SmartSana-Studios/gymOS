"use client";

import { useMemo } from "react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { RESOURCES } from "./get-server-translation";
import type { Locale } from "./config";

/**
 * Both locales' resources are preloaded (see get-server-translation.ts) so
 * the Sidebar's EN|FR toggle can call `i18n.changeLanguage()` and get an
 * instant, synchronous re-render with no missing-string flash -- no async
 * fetch, no server round trip needed for the language switch itself.
 */
export function I18nClientProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  // Created once per mount from the server-resolved `locale` prop; later
  // language changes go through `i18n.changeLanguage()` (Sidebar toggle),
  // not by recreating the instance on every re-render.
  const i18n = useMemo(() => {
    const instance = createInstance();
    instance.use(initReactI18next).init({
      lng: locale,
      fallbackLng: "en",
      resources: RESOURCES,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
    return instance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
