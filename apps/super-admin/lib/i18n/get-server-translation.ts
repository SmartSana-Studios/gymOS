import { createInstance } from "i18next";
import commonEn from "@gymos/types/src/locales/en.json";
import commonFr from "@gymos/types/src/locales/fr.json";
import appEn from "../../locales/en.json";
import appFr from "../../locales/fr.json";
import type { Locale } from "./config";

// Recursive, not a shallow `{...a, ...b}` spread -- shared (packages/types)
// and app-local locale files can both define keys under the *same*
// top-level namespace (e.g. both define "auth", shared owning the common
// fields and this app owning a few app-only ones like "auth.description").
// A shallow spread would let app-local's smaller "auth" object silently
// clobber the entire shared "auth" object instead of merging into it.
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const baseValue = base[key];
    const overrideValue = override[key];
    if (
      baseValue &&
      overrideValue &&
      typeof baseValue === "object" &&
      typeof overrideValue === "object" &&
      !Array.isArray(baseValue) &&
      !Array.isArray(overrideValue)
    ) {
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        overrideValue as Record<string, unknown>,
      );
    } else {
      result[key] = overrideValue;
    }
  }
  return result;
}

// Only two locales exist (en/fr, config.ts) and both JSON files are tiny --
// static imports merged once at module load, no dynamic per-request backend
// needed.
const RESOURCES = {
  en: { translation: deepMerge(commonEn, appEn) },
  fr: { translation: deepMerge(commonFr, appFr) },
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
