#!/usr/bin/env node
// Story 16.2: generates apps/mobile/src/constants/countryNames.ts, a static
// EN/FR country-name table for every ISO code libphonenumber-js knows about.
//
// This is a one-off, authoring-time script -- run with plain `node` (which
// has full native ICU/Intl support), never on-device and never as part of
// the app build. Hermes' runtime support for Intl.DisplayNames (the API
// Story 16.1 used on web) is unconfirmed for this Expo/RN version and
// historically needed a polyfill on iOS -- generating the table here avoids
// that risk entirely rather than gambling on it at runtime.
//
// Re-run this script (`node apps/mobile/scripts/generate-country-names.mjs`
// from the repo root, or `node scripts/generate-country-names.mjs` from
// apps/mobile) only if libphonenumber-js's own country list changes.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCountries } from "libphonenumber-js";

const mobileRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outFile = join(mobileRoot, "src/constants/countryNames.ts");

const enNames = new Intl.DisplayNames(["en"], { type: "region" });
const frNames = new Intl.DisplayNames(["fr"], { type: "region" });

const entries = getCountries()
  .map((code) => {
    const en = enNames.of(code);
    const fr = frNames.of(code);
    return { code, en, fr };
  })
  // Intl.DisplayNames returns the code itself (or undefined) for a handful of
  // non-standard/reserved region codes libphonenumber-js still carries (e.g.
  // grouping codes) -- skip anything that didn't resolve to a real name.
  .filter(({ en, fr }) => Boolean(en) && Boolean(fr) && en !== undefined && fr !== undefined)
  .sort((a, b) => a.code.localeCompare(b.code));

const lines = entries.map(({ code, en, fr }) => `  ${code}: { en: ${JSON.stringify(en)}, fr: ${JSON.stringify(fr)} },`);

const contents = `// GENERATED FILE -- do not hand-edit. Produced by
// apps/mobile/scripts/generate-country-names.mjs from libphonenumber-js's
// getCountries() + Node's own Intl.DisplayNames (see that script's own
// header comment for why this is pre-generated rather than resolved at
// runtime). Re-run the script to regenerate if libphonenumber-js's country
// list changes.

export interface CountryNames {
  en: string;
  fr: string;
}

export const COUNTRY_NAMES: Record<string, CountryNames> = {
${lines.join("\n")}
};
`;

writeFileSync(outFile, contents, "utf8");
console.log(`Wrote ${entries.length} country names to ${outFile}`);
