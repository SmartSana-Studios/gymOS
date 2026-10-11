import { getCountries, getCountryCallingCode } from "libphonenumber-js";

// Per-app copy of the dashboard's lib/phone.ts country helpers (same
// convention as each app's own phone-input.tsx). `gyms.country` (0105) is only
// ever written from this set.
const SUPPORTED: ReadonlySet<string> = new Set(getCountries());

export const DEFAULT_GYM_COUNTRY = "CM";

export function isSupportedCountry(code: string): boolean {
  return SUPPORTED.has(code);
}

export interface CountryOption {
  code: string;
  name: string;
  callingCode: string;
}

/** Every selectable country, sorted by localized name. */
export function listCountries(locale: string): CountryOption[] {
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  return getCountries()
    .map((code) => ({
      code,
      name: displayNames.of(code) ?? code,
      callingCode: `+${getCountryCallingCode(code)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
