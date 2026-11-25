// Generates the seed migration for the controlled city list (cities + city_aliases) from Natural Earth "populated places" (public domain, naturalearthdata.com).
//
//   node scripts/directory-seed/generate-cities.mjs <ne_10m_populated_places_simple.geojson> [--report | --rollback] > supabase/migrations/0195_subsaharan_main_towns.sql
//   (--rollback prints scripts/rollback-0195-subsaharan-main-towns.sql, --report prints counts to stderr)
//
// Source file: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson (4.9 MB, downloaded by hand: this
// script reads a local file and never touches the network).
//
// The rule (owner decision 2026-11-25): a MAIN town of a Sub-Saharan country (packages/types/src/constants/subSaharanAfrica.json) is its capital, the capital of one of its
// regions (Natural Earth "Admin-1 capital" / "Admin-1 region capital"), or a town of 100,000 people or more (pop_max). A gym in a neighbourhood or a small town picks the main
// town it belongs to (Biyem-Assi is in Yaoundé); its address and map pin say where exactly. The SQL is idempotent: a town whose slug exists is left alone.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const TARGET = JSON.parse(readFileSync(join(here, "../../packages/types/src/constants/subSaharanAfrica.json"), "utf8"));
const POP_MIN = 100000;
// The twelve Cameroon starter cities of 0169 (slug = place_slug(name)); never re-inserted, and their names block a second spelling.
const STARTERS = new Set(["bafoussam", "bamenda", "bertoua", "buea", "douala", "ebolowa", "garoua", "kribi", "limbe", "maroua", "ngaoundere", "yaounde"]);
const RESERVED = new Set(["en", "fr", "gyms", "gym", "sitemap", "sitemap-index", "sitemaps", "robots", "llms", "index", "page", "pages", "category", "categories", "api", "admin", "static", "assets", "new"]);

const file = process.argv[2];
if (!file) {
  console.error("usage: generate-cities.mjs <populated_places.geojson> [--report]");
  process.exit(2);
}
const report = process.argv.includes("--report");

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/æ/g, "ae").replace(/œ/g, "oe").replace(/ß/g, "ss").toLowerCase();
const norm = (s) => fold(s).replace(/[\s\-_'’‘`´]+/g, " ").trim();
const slugOf = (s) => norm(s).replace(/ /g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
const sql = (s) => `'${s.replace(/'/g, "''")}'`;

const features = JSON.parse(readFileSync(file, "utf8")).features.map((f) => f.properties);
const isMain = (p) => /Admin-1/.test(p.featurecla ?? "") || p.adm0cap === 1 || Number(p.pop_max) >= POP_MIN;

const byCountry = new Map();
const dropped = [];
for (const p of features.filter((x) => TARGET.includes(x.iso_a2) && isMain(x))) {
  const name = String(p.name ?? "").trim();
  if (!name || /[<>]/.test(name) || name.length > 100) continue;
  const slug = slugOf(name);
  if (!slug || slug.length > 60 || RESERVED.has(slug)) {
    dropped.push(`${p.iso_a2} ${name}: slug "${slug}" unusable`);
    continue;
  }
  const lat = Number(p.latitude), lng = Number(p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  (byCountry.get(p.iso_a2) ?? byCountry.set(p.iso_a2, []).get(p.iso_a2)).push({ cc: p.iso_a2, name, slug, norm: norm(name), lat, lng, pop: Number(p.pop_max) || 0 });
}

const rows = [];
for (const cc of [...byCountry.keys()].sort()) {
  // One town per normalized spelling and per slug inside a country, the larger one first (the database refuses a second alias_norm or slug).
  const seenNorm = new Set(), seenSlug = new Set(STARTERS.size && cc === "CM" ? STARTERS : []);
  for (const t of byCountry.get(cc).sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name))) {
    if (seenNorm.has(t.norm) || seenSlug.has(t.slug)) {
      if (!STARTERS.has(t.slug) || cc !== "CM") dropped.push(`${cc} ${t.name}: same spelling or slug as another town`);
      continue;
    }
    seenNorm.add(t.norm);
    seenSlug.add(t.slug);
    if (!(cc === "CM" && STARTERS.has(t.slug))) rows.push(t);
  }
}
rows.sort((a, b) => a.cc.localeCompare(b.cc) || a.name.localeCompare(b.name, "en"));

if (report) {
  const per = {};
  for (const r of rows) per[r.cc] = (per[r.cc] ?? 0) + 1;
  console.error(`new towns: ${rows.length} in ${Object.keys(per).length} countries; dropped: ${dropped.length}`);
  console.error(Object.entries(per).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "));
  for (const d of dropped) console.error("  dropped:", d);
  console.error("CM new:", rows.filter((r) => r.cc === "CM").map((r) => r.name).join(", "));
  process.exit(0);
}

if (process.argv.includes("--rollback")) {
  const pairs = rows.map((r) => `  (${sql(r.cc)}, ${sql(r.slug)})`).join(",\n");
  process.stdout.write(`-- Rollback for migration 0195: removes the seeded main towns that no gym uses.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0195-subsaharan-main-towns.sql
--
-- Generated by scripts/directory-seed/generate-cities.mjs --rollback. Deletes (country, slug) pairs of the ${rows.length} seeded towns, with their aliases, ONLY where no gym has chosen the
-- town (gyms.city_id): a town a gym uses is kept, because directory pages and the 301 history depend on it, and the script reports how many it kept. The trigger that refuses a city
-- delete is bypassed for this one transaction with session_replication_role = replica, which also stops the page refresh trigger, so nothing is re-snapshotted.
set local lock_timeout = '5s';
set local session_replication_role = replica;

with seeded (country_code, slug) as (
values
${pairs}
),
gone as (
  select c.id from public.cities c
  join seeded s on s.country_code = c.country_code and s.slug = c.slug
  where not exists (select 1 from public.gyms g where g.city_id = c.id)
),
del_aliases as (
  delete from public.city_aliases a where a.city_id in (select id from gone) returning 1
)
delete from public.cities c where c.id in (select id from gone);

select count(*) as seeded_towns_still_present
from public.cities c
where (c.country_code, c.slug) in (select country_code, slug from (values
${pairs}
) v (country_code, slug));
`);
  process.exit(0);
}

const values = rows.map((r) => `  (${sql(r.cc)}, ${sql(r.slug)}, ${sql(r.name)}, ${r.lat.toFixed(6)}, ${r.lng.toFixed(6)})`).join(",\n");
process.stdout.write(`-- 0195: main towns of Sub-Saharan Africa for the controlled city list (owner decision 2026-11-25).
--
-- The Super Admin used to add every town by hand (twelve Cameroon towns in production). A gym's town is now chosen from a list that already holds the MAIN towns of the 49 target
-- countries (packages/types subSaharanAfrica): each country's capital, the capital of each of its regions, and every town of ${POP_MIN.toLocaleString("en")} people or more.
-- ${rows.length} towns are inserted (the twelve Cameroon starters of 0169 are untouched). A gym in a neighbourhood or a small town picks the main town it belongs to
-- (Biyem-Assi is in Yaounde); its address and map pin, which stay in the page form, say where exactly. Anything missing is still added by hand from the Super Admin Cities page.
--
-- Source: Natural Earth populated places, public domain (naturalearthdata.com). Generated by scripts/directory-seed/generate-cities.mjs from
-- ne_10m_populated_places_simple.geojson; coordinates are the town's, six decimals, for map dots only. Not hand-edited.
--
-- Idempotent: a town whose (country, slug) exists is skipped. Each town also gets its own name as an alias (is_name), which is what the owner's search matches; the final check refuses
-- the migration if any town ended up without one. No data of a gym is touched.
-- Rollback: scripts/rollback-0195-subsaharan-main-towns.sql (deletes the seeded towns that no gym uses; refuses to touch a town a gym chose).
set local lock_timeout = '5s';

with seed (country_code, slug, name, lat, lng) as (
values
${values}
),
ins as (
  insert into public.cities (country_code, slug, name, lat, lng)
  select s.country_code, s.slug, s.name, s.lat, s.lng from seed s
  on conflict (country_code, slug) do nothing
  returning id, country_code, name
)
insert into public.city_aliases (country_code, alias_norm, alias, city_id, is_name)
select i.country_code, private.place_norm(i.name), i.name, i.id, true from ins i
on conflict do nothing;

do $check$
declare
  v_missing integer;
begin
  select count(*) into v_missing from public.cities c
  where not exists (select 1 from public.city_aliases a where a.city_id = c.id and a.is_name);
  if v_missing > 0 then
    raise exception '0195: % town(s) have no name alias', v_missing;
  end if;
end;
$check$;
`);
