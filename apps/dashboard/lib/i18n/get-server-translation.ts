import { createInstance } from "i18next";
import commonEn from "@gymos/types/src/locales/en.json";
import commonFr from "@gymos/types/src/locales/fr.json";
import appEn from "../../locales/en.json";
import appFr from "../../locales/fr.json";
import type { Locale } from "./config";

// Only two locales exist (en/fr, config.ts) and both JSON files are tiny --
// static imports merged once at module load, no dynamic per-request backend
// needed. Shared keys (packages/types/src/locales) and app-local keys
// (apps/dashboard/locales) merge into one flat "translation" namespace per
// locale; the two files use disjoint top-level keys by convention (common/
// errors vs nav/role/sidebar/topbar/overview/settings/auth), so a shallow
// spread is sufficient.
const RESOURCES = {
  en: { translation: { ...commonEn, ...appEn } },
  fr: { translation: { ...commonFr, ...appFr } },
} as const;

/** Server Components call this directly (await, no hook) -- a fresh
 * instance per call is cheap (no I/O, resources are static imports). */
export async function getServerTranslation(locale: Locale) {
  const instance = createInstance();
  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: RESOURCES,
    interpolation: { escapeValue: false },
  });
  return { t: instance.getFixedT(locale) };
}

export { RESOURCES };
