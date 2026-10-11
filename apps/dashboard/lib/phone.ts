import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

/** Default for a gym that has not chosen one (matches `gyms.country`'s DB
 * default, 0105, and every phone field's default in the product). */
export const DEFAULT_PHONE_COUNTRY: CountryCode = "CM";

const SUPPORTED_COUNTRIES: ReadonlySet<string> = new Set(getCountries());

/** True when `code` is an ISO 3166-1 alpha-2 code libphonenumber can parse
 * numbers for. `gyms.country` is only ever written from this set (Settings
 * validates it server-side), so a stored value is always safe to pass to
 * `normalizePhoneForCountry`. */
export function isSupportedPhoneCountry(code: string): code is CountryCode {
  return SUPPORTED_COUNTRIES.has(code);
}

/** Resolves a stored `gyms.country` to a usable CountryCode, falling back to
 * the default rather than throwing on an unknown value. */
export function resolvePhoneCountry(code: string | null | undefined): CountryCode {
  return code && isSupportedPhoneCountry(code) ? code : DEFAULT_PHONE_COUNTRY;
}

export function phoneCountryCallingCode(country: CountryCode): string {
  return `+${getCountryCallingCode(country)}`;
}

export interface PhoneCountryOption {
  code: CountryCode;
  name: string;
  callingCode: string;
}

/** Every selectable country, sorted by localized name -- same source and
 * ordering as the shared PhoneInput's global picker. */
export function listPhoneCountries(locale: string): PhoneCountryOption[] {
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  return getCountries()
    .map((code) => ({
      code,
      name: displayNames.of(code) ?? code,
      callingCode: phoneCountryCallingCode(code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Turns a phone cell written the way people actually write numbers into E.164,
 * reading it against `country` only when it carries no country code of its own.
 *
 *  - Spaces, dots, dashes and parentheses are ignored ("6 70-12 34 56").
 *  - "+237…" is kept as written (a number that names its own country is never
 *    re-read against the gym's).
 *  - "00237…" is the international-call prefix and is read as "+237…".
 *  - Anything else is read as a national number of `country`; Excel often drops
 *    the "+" from "+237670123456", and "237670123456" is accepted too.
 *
 * A cell that does not resolve to a VALID number is returned unchanged (minus
 * the ignorable punctuation) so the caller's E.164 schema rejects it with its
 * usual message rather than this helper inventing a number. Validity uses the
 * same `isValid()` test as the shared PhoneInput.
 */
export function normalizePhoneForCountry(raw: string, country: CountryCode): string {
  const cleaned = raw.trim().replace(/[\s.\-()]/g, "");
  if (cleaned === "") return cleaned;

  const international = cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned;
  const parsed = international.startsWith("+")
    ? parsePhoneNumberFromString(international)
    : parsePhoneNumberFromString(international, country);

  return parsed?.isValid() ? parsed.number : international;
}
