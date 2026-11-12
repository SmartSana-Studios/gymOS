// Story 25.1: the Cities actions. Mocked Supabase; the typed-error mapping is pinned against the REAL messages the migration raises.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CITY_ERROR_CODES } from "@gymos/types";

let allowed = true;
const rpc = vi.fn();
let tables: Record<string, { data: unknown; error: unknown }> = {};

vi.mock("@/lib/authz-action", () => ({
  authorizeOrRedirect: vi.fn(async () =>
    allowed ? { ok: true, actorId: "sa-1" } : { ok: false, error: { code: "permission_denied", message: "denied" }, reason: "x" },
  ),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => {
      const result = tables[table] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.order = () => chain;
      chain.then = (resolve: (v: unknown) => void) => resolve(result);
      return chain;
    },
  })),
}));
const mapAndLog = vi.fn(async () => ({ code: "unknown", message: "mapped" }));
vi.mock("@/services/gyms", () => ({ mapAndLog: (...a: unknown[]) => (mapAndLog as (...x: unknown[]) => Promise<unknown>)(...a) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

import { addCity, listCitiesPage, mapGymToCity, updateCity } from "./actions";

const migration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "supabase", "migrations", "0169_countries_cities.sql"), "utf8");
const CITY = "5d1c6a0e-8f3b-4c0e-9a0e-1f2b3c4d5e6f";
const GYM = "11111111-1111-4111-8111-111111111111";
const form = { country_code: "CM", name: "Mbouda", slug: "", aliases: ["Mboudah"], lat: 5.6, lng: 10.25 };

beforeEach(() => {
  allowed = true;
  rpc.mockReset();
  mapAndLog.mockClear();
  rpc.mockResolvedValue({ data: CITY, error: null });
  tables = {};
});

describe("every action is behind the gate", () => {
  it("a denied caller reaches no database call", async () => {
    allowed = false;
    const results = await Promise.all([listCitiesPage(), addCity(form), updateCity(CITY, form), mapGymToCity({ gymId: GYM, country: "CM", cityId: CITY })]);
    for (const r of results) expect(r.error?.code).toBe("permission_denied");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("addCity", () => {
  it("sends the parsed form to add_city; a blank slug is left to the database to derive", async () => {
    const r = await addCity(form);
    expect(r).toEqual({ data: { id: CITY }, error: null });
    expect(rpc).toHaveBeenCalledWith("add_city", { p_country_code: "CM", p_name: "Mbouda", p_slug: undefined, p_aliases: ["Mboudah"], p_lat: 5.6, p_lng: 10.25 });
  });

  it("sends an explicit slug as typed and no coordinates when there are none", async () => {
    await addCity({ ...form, slug: "mbouda-ville", lat: null, lng: null });
    expect(rpc).toHaveBeenCalledWith("add_city", expect.objectContaining({ p_slug: "mbouda-ville", p_lat: undefined, p_lng: undefined }));
  });

  it.each([
    ["no country", { ...form, country_code: "" }],
    ["a lower-case country", { ...form, country_code: "cm" }],
    ["a blank name", { ...form, name: "   " }],
    ["markup in the name", { ...form, name: "<b>x</b>" }],
    ["a bad slug", { ...form, slug: "Bad_Slug" }],
    ["one coordinate", { ...form, lng: null }],
    ["a latitude out of range", { ...form, lat: 91 }],
    ["an over-long alias", { ...form, aliases: ["a".repeat(101)] }],
    ["an unknown key", { ...form, id: CITY }],
  ])("%s is refused before any call", async (_label, input) => {
    const r = await addCity(input);
    expect(r.error?.code).toBe("validation_error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(CITY_ERROR_CODES.filter((c) => c !== "not_found"))("the database refusal add_city: %s becomes the typed error with its own copy", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { message: `add_city: ${code}` } });
    const r = await addCity(form);
    expect(r.error).toEqual({ code, message: `cities.errors.${code}` });
  });

  it("any other database error is mapped, not shown raw", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect((await addCity(form)).error).toEqual({ code: "unknown", message: "mapped" });
  });
});

describe("updateCity", () => {
  it("sends the whole form with the city id; blank coordinates clear the position", async () => {
    const r = await updateCity(CITY, { ...form, slug: "mbouda-ville", lat: null, lng: null });
    expect(r).toEqual({ data: { id: CITY }, error: null });
    expect(rpc).toHaveBeenCalledWith("update_city", { p_city_id: CITY, p_name: "Mbouda", p_slug: "mbouda-ville", p_aliases: ["Mboudah"], p_lat: undefined, p_lng: undefined });
  });

  it("an invalid form is refused before any call", async () => {
    expect((await updateCity(CITY, { ...form, name: "" })).error?.code).toBe("validation_error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(CITY_ERROR_CODES)("the database refusal update_city: %s becomes the typed error", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { message: `update_city: ${code}` } });
    expect((await updateCity(CITY, form)).error).toEqual({ code, message: `cities.errors.${code}` });
  });

  it("a refusal of add_city is not mistaken for one of update_city", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "add_city: slug_taken" } });
    expect((await updateCity(CITY, form)).error?.code).toBe("unknown");
  });
});

describe("the mapper is pinned against the real messages of 0169", () => {
  it.each(CITY_ERROR_CODES)("%s is raised by the migration in the `<function>: <code>` shape", (code) => {
    expect(migration).toMatch(new RegExp(`raise exception '(%|add_city|update_city): ${code}'`));
  });

  it("the typed errors of both functions use the `<function>: <code>` shape the actions look for", () => {
    expect(migration).toContain("raise exception 'add_city: unknown_country'");
    expect(migration).toContain("raise exception 'add_city: slug_taken'");
    expect(migration).toContain("raise exception 'update_city: slug_taken'");
    expect(migration).toContain("raise exception 'update_city: not_found'");
    expect(migration).toContain("raise exception '%: invalid_alias', p_fn");
  });
});

describe("mapGymToCity", () => {
  it("sets the gym's city with its own country through set_gym_location", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await mapGymToCity({ gymId: GYM, country: "CM", cityId: CITY })).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("set_gym_location", { p_gym_id: GYM, p_country: "CM", p_city_id: CITY });
  });

  it("refuses ids that are not ids before any call", async () => {
    expect((await mapGymToCity({ gymId: "x", country: "CM", cityId: CITY })).error?.code).toBe("validation_error");
    expect((await mapGymToCity({ gymId: GYM, country: "cm", cityId: CITY })).error?.code).toBe("validation_error");
    expect((await mapGymToCity({ gymId: GYM, country: "CM", cityId: "Douala" })).error?.code).toBe("validation_error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a city of another country is the typed refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "set_gym_location: invalid_city" } });
    expect((await mapGymToCity({ gymId: GYM, country: "CM", cityId: CITY })).error).toEqual({ code: "invalid_city", message: "cities.errors.map_invalid_city" });
  });
});

describe("listCitiesPage", () => {
  it("returns the countries, the cities with their extra spellings and gym counts, and the unmapped gyms", async () => {
    tables = {
      countries: { data: [{ code: "CM", name_en: "Cameroon", name_fr: "Cameroun" }], error: null },
      cities: {
        data: [
          {
            id: CITY, country_code: "CM", name: "Douala", slug: "douala", lat: 4.05, lng: 9.77,
            city_aliases: [{ alias: "Douala", is_name: true }, { alias: "Duala", is_name: false }, { alias: "Dla", is_name: false }],
            gyms: [{ count: 3 }],
          },
        ],
        error: null,
      },
    };
    rpc.mockResolvedValue({ data: [{ gym_id: GYM, gym_name: "IRON GYM", country: "CM", page_city: "Dwala" }], error: null });
    const { data, error } = await listCitiesPage();
    expect(error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("list_gyms_without_city");
    expect(data?.countries).toEqual([{ code: "CM", nameEn: "Cameroon", nameFr: "Cameroun" }]);
    expect(data?.cities).toEqual([{ id: CITY, countryCode: "CM", name: "Douala", slug: "douala", lat: 4.05, lng: 9.77, aliases: ["Dla", "Duala"], gymCount: 3 }]);
    expect(data?.unmapped).toEqual([{ gymId: GYM, gymName: "IRON GYM", country: "CM", legacyCity: "Dwala" }]);
  });

  it("a failure of the unmapped list alone is logged and still returns the cities, with an empty panel", async () => {
    tables = {
      countries: { data: [{ code: "CM", name_en: "Cameroon", name_fr: "Cameroun" }], error: null },
      cities: { data: [{ id: CITY, country_code: "CM", name: "Douala", slug: "douala", lat: null, lng: null, city_aliases: [], gyms: [{ count: 0 }] }], error: null },
    };
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await listCitiesPage();
    expect(r.error).toBeNull();
    expect(r.data?.cities).toHaveLength(1);
    expect(r.data?.unmapped).toEqual([]);
    expect(mapAndLog).toHaveBeenCalledTimes(1);
  });

  it("a failed read is a mapped error, never partial data", async () => {
    tables = { cities: { data: null, error: { message: "boom" } } };
    rpc.mockResolvedValue({ data: [], error: null });
    const r = await listCitiesPage();
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe("unknown");
  });
});
