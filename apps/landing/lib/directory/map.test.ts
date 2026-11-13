// Story 25.7: the Africa map's data. The runtime projection equals d3's at sample points; the committed generated module is what a fresh generation
// produces (so a change to the generator or to the atlas version cannot pass unnoticed); every African alpha-2 has a shape or is listed as absent;
// buildMapView follows the DESIGN.md rules (radius, edge cases).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { geoNaturalEarth1 } from "d3-geo";
import { describe, expect, it } from "vitest";
import { AFRICA_MAP } from "./africaMap.generated";
import { DIRECTORY_COPY } from "./copy";
import { buildMapView, dotRadius } from "./map";
import { naturalEarth1Raw, projectPoint } from "./mapProjection";
import type { MapCityRow } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");

/** The African alpha-2 codes of the `countries` table (ISO 3166-1): the 54 UN member states, Western Sahara and the three African territories. Typed here, apart from the generator's table. */
const AFRICAN_ALPHA2 = [
  "AO", "BF", "BI", "BJ", "BW", "CD", "CF", "CG", "CI", "CM", "CV", "DJ", "DZ", "EG", "EH", "ER", "ET", "GA", "GH", "GM", "GN", "GQ", "GW", "KE", "KM", "LR", "LS", "LY",
  "MA", "MG", "ML", "MR", "MU", "MW", "MZ", "NA", "NE", "NG", "RE", "RW", "SC", "SD", "SH", "SL", "SN", "SO", "SS", "ST", "SZ", "TD", "TG", "TN", "TZ", "UG", "YT", "ZA", "ZM", "ZW",
];

describe("the local projection equals d3's geoNaturalEarth1", () => {
  const d3 = geoNaturalEarth1().scale(AFRICA_MAP.scale).translate(AFRICA_MAP.translate);
  const samples: [string, number, number][] = [
    ["Douala", 4.0511, 9.7679], ["Cairo", 30.0444, 31.2357], ["Cape Town", -33.9249, 18.4241], ["Dakar", 14.7167, -17.4677], ["Nairobi", -1.2864, 36.8172],
    ["Antananarivo", -18.8792, 47.5079], ["Tunis", 36.8065, 10.1815], ["Mogadishu", 2.0469, 45.3182], ["origin", 0, 0], ["Windhoek", -22.5609, 17.0658],
    ["north pole", 90, 0], ["south pole", -90, 0], ["west edge", 10, -180], ["east edge", -10, 180], ["Reykjavik", 64.1466, -21.9426], ["Sydney", -33.8688, 151.2093],
  ];
  for (const [name, lat, lng] of samples) {
    it(name, () => {
      const [x, y] = projectPoint(AFRICA_MAP, lat, lng);
      const [dx, dy] = d3([lng, lat])!;
      expect(x).toBeCloseTo(dx, 9);
      expect(y).toBeCloseTo(dy, 9);
    });
  }
  it("a grid of points agrees to 1e-9", () => {
    for (let lat = -90; lat <= 90; lat += 7.5) {
      for (let lng = -180; lng <= 180; lng += 9) {
        const [x, y] = projectPoint(AFRICA_MAP, lat, lng);
        const [dx, dy] = d3([lng, lat])!;
        expect(Math.abs(x - dx), `${lat},${lng}`).toBeLessThan(1e-9);
        expect(Math.abs(y - dy), `${lat},${lng}`).toBeLessThan(1e-9);
      }
    }
  });
  it("the raw formula is d3's raw projection", () => {
    expect(naturalEarth1Raw(0, 0)).toEqual([0, 0]);
    const [rx, ry] = naturalEarth1Raw(0.5, 0.3);
    const raw = geoNaturalEarth1().scale(1).translate([0, 0]).rotate([0, 0])([(0.5 * 180) / Math.PI, (0.3 * 180) / Math.PI])!;
    expect(rx).toBeCloseTo(raw[0], 9);
    expect(-ry).toBeCloseTo(raw[1], 9);
  });
});

describe("the committed module", () => {
  it("equals a fresh generation (node scripts/directory-map/generate.mjs rewrites it)", async () => {
    const gen = (await import(/* @vite-ignore */ pathToFileURL(join(root, "scripts", "directory-map", "generate.mjs")).href)) as { generate(): Promise<string> };
    expect(readFileSync(join(here, "africaMap.generated.ts"), "utf8")).toBe(await gen.generate());
  }, 30_000);
  it("records its provenance in the header: source, version, license note, generator command", () => {
    const head = readFileSync(join(here, "africaMap.generated.ts"), "utf8").split("\n").slice(0, 12).join("\n");
    expect(head).toContain("Natural Earth");
    expect(head).toContain("world-atlas 2.0.2");
    expect(head).toMatch(/public domain/i);
    expect(head).toContain("node scripts/directory-map/generate.mjs");
  });
  it("is about 26 KB of path data in a 760 unit wide view box", () => {
    expect(AFRICA_MAP.width).toBe(760);
    const bytes = AFRICA_MAP.countries.reduce((n, c) => n + c.d.length, 0);
    expect(bytes).toBeGreaterThan(15_000);
    expect(bytes).toBeLessThan(40_000);
  });
  it("every African alpha-2 has a shape or is listed as absent, and nothing else is on the map", () => {
    const shaped = AFRICA_MAP.countries.map((c) => c.code);
    expect(new Set(shaped).size).toBe(shaped.length);
    for (const code of AFRICAN_ALPHA2) expect(shaped.includes(code) || AFRICA_MAP.absent.includes(code), code).toBe(true);
    expect([...shaped, ...AFRICA_MAP.absent].sort()).toEqual([...AFRICAN_ALPHA2].sort());
    for (const code of AFRICA_MAP.absent) expect(shaped, code).not.toContain(code);
    for (const c of AFRICA_MAP.countries) expect(c.d, c.code).toMatch(/^M[-0-9.,LMZ]+$/);
  });
  it("every code is a row of the countries seed of migration 0169", () => {
    const sql = readFileSync(join(root, "supabase", "migrations", "0169_countries_cities.sql"), "utf8");
    const seeded = new Set([...sql.matchAll(/^\s*\('([A-Z]{2})', '/gm)].map((m) => m[1]));
    expect(seeded.size).toBe(249);
    for (const code of AFRICAN_ALPHA2) expect(seeded.has(code), code).toBe(true);
  });
  it("draws no style, image or external reference in its path data", () => {
    expect(readFileSync(join(here, "africaMap.generated.ts"), "utf8")).not.toMatch(/<(style|image)|https?:|href=/i);
  });
});

const city = (countryCode: string, citySlug: string, cityName: string, lat: number, lng: number, publishedCount: number): MapCityRow => ({ countryCode, citySlug, cityName, lat, lng, publishedCount });
const view = (cities: MapCityRow[], listed: string[], locale: "en" | "fr" = "en") =>
  buildMapView({ copy: DIRECTORY_COPY[locale], listed: new Set(listed), cities, cityHref: (cc, slug) => `/${locale}/gyms/${cc.toLowerCase()}/${slug}` });

describe("buildMapView", () => {
  it("radius is 5 + 3.2 * sqrt(gyms), capped at 20 so one big city cannot dominate the map", () => {
    expect(dotRadius(22)).toBeCloseTo(20, 0);
    expect(dotRadius(21)).toBeLessThan(20);
    expect(dotRadius(23)).toBe(20);
    expect(dotRadius(46)).toBe(20);
    expect(dotRadius(5000)).toBe(20);
    expect(dotRadius(1)).toBe(8.2);
    expect(dotRadius(4)).toBe(11.4);
    expect(dotRadius(9)).toBe(14.6);
    expect(dotRadius(0)).toBe(5);
  });
  it("one dot per city with coordinates at its own projected position, sized by count, linking root-relative, larger dots first", () => {
    const m = view([city("CM", "douala", "Douala", 4.0511, 9.7679, 4), city("CM", "yaounde", "Yaoundé", 3.848, 11.5021, 1), city("GH", "accra", "Accra", 5.6037, -0.187, 9)], ["CM", "GH"])!;
    expect(m.dots.map((d) => d.href)).toEqual(["/en/gyms/gh/accra", "/en/gyms/cm/douala", "/en/gyms/cm/yaounde"]);
    expect(m.dots.map((d) => d.r)).toEqual([14.6, 11.4, 8.2]);
    const [x, y] = projectPoint(AFRICA_MAP, 4.0511, 9.7679);
    expect(m.dots[1]).toMatchObject({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, label: "Douala · 4 gyms" });
    expect(m.width).toBe(760);
  });
  it("countries with a listed gym are lit, others are not", () => {
    const m = view([], ["CM"])!;
    expect(m.countries.find((c) => c.code === "CM")!.lit).toBe(true);
    expect(m.countries.filter((c) => c.lit).map((c) => c.code)).toEqual(["CM"]);
  });
  it("a country off the map has no dot and no fill, and the page still draws (the cards list it)", () => {
    const m = view([city("FR", "paris", "Paris", 48.8566, 2.3522, 5)], ["FR"])!;
    expect(m.dots).toEqual([]);
    expect(m.countries.some((c) => c.lit)).toBe(false);
  });
  it("a city outside the view box has no dot (an African island group the 110 m data omits)", () => {
    expect(view([city("MU", "port-louis", "Port Louis", -20.1609, 57.5012, 2), city("CV", "praia", "Praia", 14.9331, -23.5133, 1), city("SC", "victoria", "Victoria", -4.6191, 55.4513, 1)], ["MU", "CV", "SC"])!.dots).toEqual([]);
  });
  it("a city whose country is not listed has no dot (its page would be not-found)", () => {
    expect(view([city("CM", "douala", "Douala", 4.0511, 9.7679, 1)], ["GH"])!.dots).toEqual([]);
  });
  it("non-finite or out-of-range coordinates give no dot", () => {
    expect(view([city("CM", "a", "A", Number.NaN, 9, 1), city("CM", "b", "B", 95, 9, 1), city("CM", "c", "C", 4, 200, 1)], ["CM"])!.dots).toEqual([]);
  });
  it("nothing listed: no map", () => {
    expect(view([city("CM", "douala", "Douala", 4.0511, 9.7679, 1)], [])).toBeNull();
  });
  it("labels grow toward the inside of the box; the caption is the dictionary's, in both languages, and does not claim completeness", () => {
    const m = view([city("SN", "dakar", "Dakar", 14.7167, -17.4677, 1), city("SO", "mogadishu", "Mogadishu", 2.0469, 45.3182, 1), city("CD", "kinshasa", "Kinshasa", -4.3, 15.3, 1)], ["SN", "SO", "CD"])!;
    expect(m.dots.map((d) => [d.href, d.anchor])).toEqual([["/en/gyms/cd/kinshasa", "middle"], ["/en/gyms/sn/dakar", "start"], ["/en/gyms/so/mogadishu", "end"]]);
    expect(m.caption).toBe("Each dot is a city with gyms. Larger means more gyms.");
    expect(view([], ["CM"], "fr")!.caption).toBe("Chaque point est une ville qui compte des salles. Plus grand, plus de salles.");
    expect(m.caption).not.toMatch(/all|every|complete|tous|toutes|complet/i);
  });
});
