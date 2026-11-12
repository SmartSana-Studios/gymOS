"use server";

import { CITY_ERROR_CODES, cityFormSchema, type AppError, type CityErrorCode } from "@gymos/types";

import { authorizeOrRedirect } from "@/lib/authz-action";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { createClient } from "@/lib/supabase/server";
import { mapAndLog } from "@/services/gyms";

// Story 25.1 (AD-49): the Super Admin's city list. Every city write is a database function (add_city, update_city) that gates on a live Super
// Admin, audits inside itself and returns a typed error `<function>: <code>`. The gate here is the first layer; the database is the judge.

export interface CountryRow {
  code: string;
  nameEn: string;
  nameFr: string;
}

export interface CityRow {
  id: string;
  countryCode: string;
  name: string;
  slug: string;
  lat: number | null;
  lng: number | null;
  /** The extra spellings that reach this city (its own name is not listed). */
  aliases: string[];
  gymCount: number;
}

export interface UnmappedGymRow {
  gymId: string;
  gymName: string;
  country: string;
  /** The legacy free text the gym carried before the lists existed (gyms.page_city). */
  legacyCity: string;
}

export interface CitiesPageData {
  countries: CountryRow[];
  cities: CityRow[];
  unmapped: UnmappedGymRow[];
}

/** The list, the countries and the gyms that still carry only legacy text. A failure of the unmapped list does not hide the cities. */
export async function listCitiesPage(): Promise<{ data: CitiesPageData | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const supabase = await createClient();
  const [countriesRes, citiesRes, unmappedRes] = await Promise.all([
    supabase.from("countries").select("code, name_en, name_fr").order("code", { ascending: true }),
    supabase
      .from("cities")
      .select("id, country_code, name, slug, lat, lng, city_aliases(alias, is_name), gyms(count)")
      .order("country_code", { ascending: true })
      .order("name", { ascending: true }),
    supabase.rpc("list_gyms_without_city"),
  ]);
  if (countriesRes.error) return { data: null, error: await mapAndLog(countriesRes.error) };
  if (citiesRes.error) return { data: null, error: await mapAndLog(citiesRes.error) };
  // A failure of the unmapped list is logged and shown as an empty panel; the cities themselves still load.
  if (unmappedRes.error) await mapAndLog(unmappedRes.error);
  return {
    data: {
      countries: (countriesRes.data ?? []).map((c) => ({ code: c.code, nameEn: c.name_en, nameFr: c.name_fr })),
      cities: (citiesRes.data ?? []).map((c) => ({
        id: c.id,
        countryCode: c.country_code,
        name: c.name,
        slug: c.slug,
        lat: c.lat,
        lng: c.lng,
        aliases: (c.city_aliases ?? []).filter((a) => !a.is_name).map((a) => a.alias).sort((a, b) => a.localeCompare(b)),
        gymCount: Number((c.gyms as unknown as { count: number }[] | null)?.[0]?.count ?? 0),
      })),
      unmapped: unmappedRes.error ? [] : ((unmappedRes.data ?? []) as { gym_id: string; gym_name: string; country: string; page_city: string }[]).map((g) => ({ gymId: g.gym_id, gymName: g.gym_name, country: g.country, legacyCity: g.page_city })),
    },
    error: null,
  };
}

function cityErrorFrom(message: string, fn: "add_city" | "update_city"): CityErrorCode | null {
  return CITY_ERROR_CODES.find((c) => message === `${fn}: ${c}`) ?? null;
}

async function validationError(error: { issues: { message: string }[] }): Promise<AppError> {
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "validation_error", message: error.issues[0]?.message ?? t("common.invalidInput") };
}

/**
 * Adds a city. `input` is the form after parsing: { country_code, name, slug ("" derives it), aliases[], lat, lng } (coordinates both or neither).
 * Typed refusals get their own copy (`cities.errors.<code>`); the code is returned so the form can put the message on the right field.
 */
export async function addCity(input: unknown): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = cityFormSchema.safeParse(input);
  if (!parsed.success) return { data: null, error: await validationError(parsed.error) };
  const f = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_city", {
    p_country_code: f.country_code,
    p_name: f.name,
    p_slug: f.slug ? f.slug : undefined,
    p_aliases: f.aliases,
    p_lat: f.lat ?? undefined,
    p_lng: f.lng ?? undefined,
  });
  if (error) {
    const code = cityErrorFrom(String(error.message ?? ""), "add_city");
    if (code) return { data: null, error: { code, message: t(`cities.errors.${code}`) } };
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { id: String(data) }, error: null };
}

/**
 * Edits a city: name, slug, aliases, position. The whole form is sent (blank coordinates clear the position). The country never changes and
 * no gym's city moves; a rename or a new slug re-snapshots the pages of its gyms, and the old slug is kept 12 months.
 */
export async function updateCity(cityId: string, input: unknown): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = cityFormSchema.safeParse(input);
  if (!parsed.success || typeof cityId !== "string") {
    return { data: null, error: parsed.success ? { code: "validation_error", message: t("common.invalidInput") } : await validationError(parsed.error) };
  }
  const f = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_city", {
    p_city_id: cityId,
    p_name: f.name,
    p_slug: f.slug ? f.slug : undefined,
    p_aliases: f.aliases,
    p_lat: f.lat ?? undefined,
    p_lng: f.lng ?? undefined,
  });
  if (error) {
    const code = cityErrorFrom(String(error.message ?? ""), "update_city");
    if (code) return { data: null, error: { code, message: t(`cities.errors.${code}`) } };
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { id: cityId }, error: null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hand-maps a gym that carries only legacy text to a city of ITS OWN country (set_gym_location, which a Super Admin may call for any gym).
 * Only ids are sent; the database checks that the city belongs to the country.
 */
export async function mapGymToCity(input: { gymId: string; country: string; cityId: string }): Promise<{ error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  if (!input || !UUID.test(input.gymId ?? "") || !UUID.test(input.cityId ?? "") || !/^[A-Z]{2}$/.test(input.country ?? "")) {
    return { error: { code: "validation_error", message: t("common.invalidInput") } };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_gym_location", { p_gym_id: input.gymId, p_country: input.country, p_city_id: input.cityId });
  if (error) {
    const message = String(error.message ?? "");
    for (const code of ["invalid_city", "unknown_country"] as const) {
      if (message === `set_gym_location: ${code}`) return { error: { code, message: t(`cities.errors.map_${code}`) } };
    }
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
