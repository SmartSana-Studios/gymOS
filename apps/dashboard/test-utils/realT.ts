import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import typesEn from "../../../packages/types/src/locales/en.json";
import typesFr from "../../../packages/types/src/locales/fr.json";

/**
 * A `t` over the REAL locale files, for tests that assert the words a person reads (Story 27.4: the plan summary line, the Correct plan
 * states, the audit Details). Resolves dotted keys, interpolates `{{name}}`, and picks `_one` / `_other` for a `count` (English and French
 * both use one for exactly 1 in these strings). An unknown key returns the key, so a missing translation fails the assertion loudly.
 */
export function realT(locale: "en" | "fr") {
  const bundles = [locale === "en" ? en : fr, locale === "en" ? typesEn : typesFr] as unknown as Record<string, unknown>[];
  // The dashboard's own strings first, then the shared `common.*` and `errors.*` of packages/types (as the app's i18n merges them).
  const lookup = (key: string): unknown => {
    for (const bundle of bundles) {
      const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], bundle);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  return (key: string, options?: Record<string, unknown>): string => {
    let value = lookup(key);
    if (value === undefined && typeof options?.count === "number") {
      value = lookup(`${key}_${options.count === 1 ? "one" : "other"}`);
    }
    if (typeof value !== "string") return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`));
  };
}
