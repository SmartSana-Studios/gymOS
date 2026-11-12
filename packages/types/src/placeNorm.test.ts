import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CITY_SLUG_PATTERN, cityFormSchema, parseCityCoordinate, placeNorm, placeSlug, setGymLocationSchema } from "./index";

// Story 25.1. ONE fixture for the place normalizer, also run by supabase/tests/countries_cities.test.sql against private.place_norm() and
// private.place_slug() (the SQL side embeds the file between two $fx$ markers; this test fails when the embedded copy drifts).
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureText = readFileSync(join(root, "packages", "types", "src", "fixtures", "placeNormCases.json"), "utf8");
const fixture = JSON.parse(fixtureText) as { cases: { id: string; input: string; norm: string; slug: string }[] };

describe("placeNorm / placeSlug (the twin of private.place_norm / place_slug)", () => {
  it.each(fixture.cases.map((c) => [c.id, c] as const))("%s: normalized form", (_id, c) => {
    expect(placeNorm(c.input)).toBe(c.norm);
  });

  it.each(fixture.cases.map((c) => [c.id, c] as const))("%s: slug", (_id, c) => {
    expect(placeSlug(c.input)).toBe(c.slug);
  });

  it("ids are unique and a null or undefined input is the empty form", () => {
    const ids = fixture.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(placeNorm(null)).toBe("");
    expect(placeNorm(undefined)).toBe("");
    expect(placeSlug(null)).toBe("");
  });

  it("every non-empty slug of the fixture has the database's shape", () => {
    for (const c of fixture.cases) if (c.slug !== "") expect(CITY_SLUG_PATTERN.test(c.slug), c.id).toBe(true);
  });

  it("the pgTAP test embeds exactly this fixture", () => {
    const sql = readFileSync(join(root, "supabase", "tests", "countries_cities.test.sql"), "utf8");
    const m = sql.match(/-- FIXTURE:BEGIN\ncreate temp table fxdoc as select \$fx\$([\s\S]*?)\$fx\$::jsonb as doc;\n-- FIXTURE:END/);
    expect(m, "FIXTURE markers in countries_cities.test.sql").toBeTruthy();
    expect(JSON.parse(m![1])).toEqual(JSON.parse(fixtureText));
  });
});

describe("place schemas", () => {
  const id = "5d1c6a0e-8f3b-4c0e-9a0e-1f2b3c4d5e6f";

  it("the location save needs an upper-case country and a city id", () => {
    expect(setGymLocationSchema.safeParse({ country: "CM", city_id: id }).success).toBe(true);
    expect(setGymLocationSchema.safeParse({ country: "cm", city_id: id }).success).toBe(false);
    expect(setGymLocationSchema.safeParse({ country: "CM", city_id: "douala" }).success).toBe(false);
    expect(setGymLocationSchema.safeParse({ country: "CM", city_id: id, city: "Douala" }).success).toBe(false);
  });

  it("the city form: coordinates are both or neither, within range", () => {
    const ok = { country_code: "CM", name: "Mbouda", aliases: [], lat: null, lng: null };
    expect(cityFormSchema.safeParse(ok).success).toBe(true);
    expect(cityFormSchema.safeParse({ ...ok, lat: 5.6, lng: 10.2 }).success).toBe(true);
    expect(cityFormSchema.safeParse({ ...ok, lat: 5.6, lng: null }).success).toBe(false);
    expect(cityFormSchema.safeParse({ ...ok, lat: 91, lng: 10 }).success).toBe(false);
    expect(cityFormSchema.safeParse({ ...ok, lat: 10, lng: 181 }).success).toBe(false);
  });

  it("the city form: name and slug rules", () => {
    const ok = { country_code: "CM", name: "Mbouda", aliases: ["Mboudah"], lat: null, lng: null };
    expect(cityFormSchema.safeParse({ ...ok, name: "   " }).success).toBe(false);
    expect(cityFormSchema.safeParse({ ...ok, name: "<b>x</b>" }).success).toBe(false);
    expect(cityFormSchema.safeParse({ ...ok, slug: "Bad_Slug" }).success).toBe(false);
    expect(cityFormSchema.safeParse({ ...ok, slug: "mbouda-ville" }).success).toBe(true);
    expect(cityFormSchema.safeParse({ ...ok, slug: "" }).success).toBe(true);
    expect(cityFormSchema.safeParse({ ...ok, aliases: ["x".repeat(101)] }).success).toBe(false);
  });

  it("parseCityCoordinate", () => {
    expect(parseCityCoordinate("")).toBeNull();
    expect(parseCityCoordinate(" 5,6 ")).toBe(5.6);
    expect(parseCityCoordinate("-4.05")).toBe(-4.05);
    expect(parseCityCoordinate("1e1")).toBe("invalid");
    expect(parseCityCoordinate("+4")).toBe("invalid");
  });
});
