import { z } from "zod";

// Story 25.1 (AD-49): controlled country and city lists. Mirrors migration 0169. A gym's city is chosen from the list (set_gym_location);
// only the Super Admin adds or edits a city (add_city / update_city). No free-text city is ever saved.

/** The slug shape the database enforces (cities_slug_shape): lowercase ASCII words joined by single hyphens, 1 to 60 characters. */
export const CITY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const CITY_SLUG_MAX = 60;
export const CITY_NAME_MAX = 100;
export const CITY_ALIAS_MAX = 100;
export const CITY_ALIASES_MAX = 50;

/** Typed refusals of add_city / update_city (message suffix `<function>: <code>`). `invalid_alias` is an alias too long or carrying markup. Copy: super-admin `cities.errors.<code>`. */
export const CITY_ERROR_CODES = [
  "slug_taken",
  "slug_reserved",
  "invalid_slug",
  "alias_taken",
  "invalid_alias",
  "invalid_coordinates",
  "unknown_country",
  "name_required",
  "not_found",
] as const;
export type CityErrorCode = (typeof CITY_ERROR_CODES)[number];

/** Typed refusals of the editor's location save. Copy: dashboard `pageEditor.errors.<code>`. */
export const GYM_LOCATION_ERROR_CODES = ["invalid_city", "unknown_country", "not_admitted", "gym_not_active"] as const;
export type GymLocationErrorCode = (typeof GYM_LOCATION_ERROR_CODES)[number];

/** The editor's Location save: a country of the list and a city of that country. The database re-checks both. */
export const setGymLocationSchema = z.strictObject({
  country: z.string().regex(/^[A-Z]{2}$/, "Select a country"),
  city_id: z.uuid("Select a city"),
});
export type SetGymLocationInput = z.infer<typeof setGymLocationSchema>;

/** A country of the list, as the editor shows it. */
export interface CountryOption {
  code: string;
  nameEn: string;
  nameFr: string;
}

/** A city of the list with the normalized spellings that resolve to it (its name included), for the alias-aware picker. */
export interface CityOption {
  id: string;
  name: string;
  slug: string;
  aliasNorms: string[];
}

/**
 * The Super Admin's add/edit city form, after trimming and parsing the coordinates. The slug is optional (blank: derived from the name); coordinates are both or neither.
 * Lists the same rules as the database so the form says what is wrong before the call; the database re-judges every one.
 */
export const cityFormSchema = z
  .strictObject({
    country_code: z.string().regex(/^[A-Z]{2}$/, "Select a country"),
    name: z.string().trim().min(1).max(CITY_NAME_MAX).regex(/^[^<>\u0000-\u0008\u000b-\u001f\u007f-\u009f]*$/),
    slug: z.string().trim().max(CITY_SLUG_MAX).optional(),
    aliases: z.array(z.string().trim().min(1).max(CITY_ALIAS_MAX)).max(CITY_ALIASES_MAX),
    lat: z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90").nullable(),
    lng: z.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180").nullable(),
  })
  .superRefine((v, ctx) => {
    if ((v.lat === null) !== (v.lng === null)) ctx.addIssue({ code: "custom", message: "Enter both coordinates or neither", path: ["lat"] });
    if (v.slug && !CITY_SLUG_PATTERN.test(v.slug)) ctx.addIssue({ code: "custom", message: "Use lowercase letters, digits and single hyphens", path: ["slug"] });
  });
export type CityFormInput = z.infer<typeof cityFormSchema>;

const COORDINATE_RE = /^-?\d+(\.\d+)?$/;

/** A typed coordinate: blank is null (no position), a decimal comma is accepted, anything but plain decimal digits is refused ("invalid"). */
export function parseCityCoordinate(value: string): number | null | "invalid" {
  const v = value.trim().replace(",", ".");
  if (v === "") return null;
  return COORDINATE_RE.test(v) ? Number(v) : "invalid";
}
