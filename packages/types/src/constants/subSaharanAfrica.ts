import codes from "./subSaharanAfrica.json";

/**
 * The countries GymOS targets for now (owner decision 2026-11-25): Sub-Saharan Africa. They are the only countries offered in a country select or a phone-code
 * picker, and the countries whose main towns are seeded in `cities` (0195). The list is the World Bank grouping: every African country except Algeria, Egypt, Libya,
 * Morocco and Tunisia (and the disputed Western Sahara), so Sudan, South Sudan, Mauritania, Somalia and Djibouti are in. Territories (Reunion, Mayotte, Saint Helena)
 * are not countries and are out. It is JSON so `scripts/directory-seed/generate-cities.mjs` reads the same list.
 *
 * It limits what the interface OFFERS, not what is accepted: a saved number or gym country outside the list stays valid, displays, and can be edited.
 */
export const SUB_SAHARAN_AFRICA_COUNTRY_CODES: readonly string[] = codes;

const SET: ReadonlySet<string> = new Set(SUB_SAHARAN_AFRICA_COUNTRY_CODES);

export function isTargetCountry(code: string): boolean {
  return SET.has(code.toUpperCase());
}
