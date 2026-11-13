#!/usr/bin/env node
// Story 25.7 (AD-44, AD-49): generates apps/landing/lib/directory/africaMap.generated.ts, the country shapes of the directory's Africa map.
//
//   node scripts/directory-map/generate.mjs           write the module
//   node scripts/directory-map/generate.mjs --check   exit 1 when the committed module differs from a fresh generation
//
// Source: Natural Earth 110 m "Admin 0 - Countries" (public domain; naturalearthdata.com/about/terms-of-use), as the `world-atlas` npm package
// ships it (countries-110m.json, TopoJSON, ISC-licensed packaging). Shapes are cut to the African countries below, projected ONCE with d3's
// `geoNaturalEarth1` fitted to a 760-unit wide view box, and written as SVG path data. The projection's scale and translate are written into the
// module too, so the request-time dot placement (apps/landing/lib/directory/mapProjection.ts, local code, no d3 at runtime) uses exactly the
// parameters this script fitted. d3-geo, topojson-client and world-atlas are devDependencies of apps/landing, used only here and by the test.
//
// Nothing here runs at request time or in the landing build: the generated module is committed, and a test fails when it differs from a
// fresh generation of this script.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
export const OUTPUT_PATH = join(root, "apps", "landing", "lib", "directory", "africaMap.generated.ts");

/** The view box is 760 units wide (the radius rule of the dots is stated in it); the height follows from the continent's aspect. */
export const VIEW_WIDTH = 760;
/** Room around the continent so a dot and its halo at the coast are not cut off. */
export const PADDING = 20;
/** Decimals kept in path data (0.1 of a unit is far below a pixel at the largest rendering). */
export const PATH_DIGITS = 1;

/**
 * ISO 3166-1 numeric id (as world-atlas writes it, three digits) to alpha-2, for every African country in the `countries` table plus the African
 * territories (Reunion, Mayotte, Saint Helena). A code whose shape is not in the 110 m data (small islands) is written to `absent` instead, so a
 * city there is placed by its coordinates when it lies inside the view box and is otherwise left off the map.
 * Western Sahara (732) is drawn as the dataset draws it; Somaliland (no ISO id in Natural Earth) is drawn as part of Somalia (SO), as the ISO list has it.
 */
export const AFRICAN_IDS = {
  "012": "DZ", "024": "AO", "204": "BJ", "072": "BW", "854": "BF", "108": "BI", "132": "CV", "120": "CM", "140": "CF", "148": "TD",
  "174": "KM", "178": "CG", "180": "CD", "384": "CI", "262": "DJ", "818": "EG", "226": "GQ", "232": "ER", "748": "SZ", "231": "ET",
  "266": "GA", "270": "GM", "288": "GH", "324": "GN", "624": "GW", "404": "KE", "426": "LS", "430": "LR", "434": "LY", "450": "MG",
  "454": "MW", "466": "ML", "478": "MR", "480": "MU", "504": "MA", "508": "MZ", "516": "NA", "562": "NE", "566": "NG", "646": "RW",
  "678": "ST", "686": "SN", "690": "SC", "694": "SL", "706": "SO", "710": "ZA", "728": "SS", "729": "SD", "834": "TZ", "768": "TG",
  "788": "TN", "800": "UG", "894": "ZM", "716": "ZW", "732": "EH", "638": "RE", "175": "YT", "654": "SH",
};
/** Natural Earth features that carry no ISO id, drawn as part of the country that claims them on the ISO list. */
export const UNNUMBERED = { Somaliland: "SO" };

const req = createRequire(join(root, "apps", "landing", "package.json"));

async function load() {
  const d3 = await import(pathToFileURL(req.resolve("d3-geo")).href);
  const topo = req("topojson-client");
  const atlas = JSON.parse(readFileSync(req.resolve("world-atlas/countries-110m.json"), "utf8"));
  const version = JSON.parse(readFileSync(req.resolve("world-atlas/package.json"), "utf8")).version;
  const d3Version = JSON.parse(readFileSync(join(dirname(req.resolve("d3-geo")), "..", "package.json"), "utf8")).version;
  return { d3, topo, atlas, version, d3Version };
}

/** The African features of the atlas as `{ code, feature }`, in the id table's order for ids and alphabetical for the unnumbered ones. */
function africanFeatures(topo, atlas) {
  const all = topo.feature(atlas, atlas.objects.countries).features;
  const out = [];
  for (const f of all) {
    const code = f.id !== undefined ? AFRICAN_IDS[String(f.id).padStart(3, "0")] : UNNUMBERED[f.properties?.name];
    if (code) out.push({ code, name: String(f.properties?.name ?? ""), feature: f });
  }
  return out.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.name < b.name ? -1 : 1));
}

/** The data of the module as an object (the test reads it too). */
export async function build() {
  const { d3, topo, atlas, version, d3Version } = await load();
  const found = africanFeatures(topo, atlas);
  const collection = { type: "FeatureCollection", features: found.map((f) => f.feature) };
  const projection = d3.geoNaturalEarth1();
  projection.fitWidth(VIEW_WIDTH - 2 * PADDING, collection);
  const [tx, ty] = projection.translate();
  projection.translate([tx + PADDING, ty + PADDING]);
  const bounds = d3.geoPath(projection).bounds(collection);
  const height = Math.ceil(bounds[1][1] + PADDING);
  const path = d3.geoPath(projection).digits(PATH_DIGITS);

  const byCode = new Map();
  for (const f of found) {
    const d = path(f.feature);
    if (!d) continue;
    byCode.set(f.code, (byCode.get(f.code) ?? "") + d);
  }
  const countries = [...byCode.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, d]) => ({ code, d }));
  const present = new Set(byCode.keys());
  const absent = [...new Set(Object.values(AFRICAN_IDS))].filter((c) => !present.has(c)).sort();
  return {
    version,
    d3Version,
    width: VIEW_WIDTH,
    height,
    scale: round6(projection.scale()),
    translate: projection.translate().map(round6),
    countries,
    absent,
  };
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** The text of the generated module. */
export async function generate() {
  const m = await build();
  const lines = [
    "// GENERATED by scripts/directory-map/generate.mjs. Do not edit: a test fails when this file differs from a fresh generation.",
    "//",
    "// Provenance (Story 25.7, AD-44):",
    "//   Source    Natural Earth, 1:110m Cultural Vectors, Admin 0 - Countries (naturalearthdata.com), through the npm package",
    `//             world-atlas ${m.version} (countries-110m.json, TopoJSON; the packaging is ISC-licensed).`,
    "//   License   Natural Earth data is in the public domain (naturalearthdata.com/about/terms-of-use): no attribution is required.",
    `//   Method    African countries only, projected once with d3-geo ${m.d3Version} geoNaturalEarth1 fitted to a ${m.width} unit wide view box`,
    `//             (${PADDING} units of padding), path data at ${PATH_DIGITS} decimal. Somaliland is drawn as part of SO; Western Sahara (EH) as the dataset draws it.`,
    "//   Command   node scripts/directory-map/generate.mjs",
    "//   Runtime   mapProjection.ts places dots with the same scale and translate (local code equal to d3's geoNaturalEarth1, proven by a test).",
    "import type { AfricaMapData } from \"./mapProjection\";",
    "",
    "export const AFRICA_MAP: AfricaMapData = {",
    `  width: ${m.width},`,
    `  height: ${m.height},`,
    `  scale: ${m.scale},`,
    `  translate: [${m.translate.join(", ")}],`,
    `  absent: ${JSON.stringify(m.absent)},`,
    "  countries: [",
    ...m.countries.map((c) => `    { code: ${JSON.stringify(c.code)}, d: ${JSON.stringify(c.d)} },`),
    "  ],",
    "};",
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const text = await generate();
  if (process.argv.includes("--check")) {
    const current = readFileSync(OUTPUT_PATH, "utf8");
    if (current !== text) {
      console.error("apps/landing/lib/directory/africaMap.generated.ts differs from a fresh generation; run: node scripts/directory-map/generate.mjs");
      process.exit(1);
    }
    console.log("africaMap.generated.ts is current");
    return;
  }
  writeFileSync(OUTPUT_PATH, text);
  console.log(`wrote ${OUTPUT_PATH} (${text.length} bytes)`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
