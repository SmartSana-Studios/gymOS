#!/usr/bin/env node
// Story 25.3: the published gym also has a city (Garoua, Cameroon: a seeded city, cities cannot be deleted), so the directory pages list it.
// Local-only fixtures for the gate: five gyms whose pages are published, unpublished, taken down, suspended and a published page with an old
// name that redirects. Inserted straight into the LOCAL database (the same shape supabase/tests/public_site_reader_privileges.test.sql uses) and
// removed again by `down`. It also sets the local password of `public_site_reader` (the role has none by default).
//
//   node scripts/landing-gate/seed.mjs up|down     (GATE_ADMIN_DB_URL, GATE_READER_PASSWORD)
//   node scripts/landing-gate/seed.mjs up --directory   (Story 25.6) also a realistic directory: GATE_DIRECTORY_GYMS (default 45) more published gyms in Garoua
//                                                       (so the city has 46 and three pages of 20), 3 in Maroua and 2 in Bertoua. Opt-in: the default seed is unchanged.
//
// Refuses to run against anything but a local database: staging gets its pages from the owner (README.md), never from this script.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadPg } from "./lib/resolve.mjs";
import { config } from "./lib/config.mjs";

const IDS = {
  tier: "00000000-0000-0000-0000-0000000024c0",
  gyms: {
    published: "00000000-0000-0000-0000-0000000024c1",
    unpublished: "00000000-0000-0000-0000-0000000024c2",
    takenDown: "00000000-0000-0000-0000-0000000024c3",
    suspended: "00000000-0000-0000-0000-0000000024c4",
  },
};
const nameId = (n) => `00000000-0000-0000-0000-0000000024d${n}`;

/** Story 25.6: the realistic directory seed. Ids in their own ranges, so `down` removes exactly these. */
const DIRECTORY_GYM_PREFIX = "00000000-0000-0000-0025-";
const DIRECTORY_NAME_PREFIX = "00000000-0000-0000-0026-";
const DIRECTORY_CITIES = [
  // [slug, display name, gym count; null = GATE_DIRECTORY_GYMS]
  ["garoua", "Garoua", null],
  ["maroua", "Maroua", 3], // exactly the indexable line
  ["bertoua", "Bertoua", 2], // thin
];
// The names sort AFTER "GATE FIT" (the listing is alphabetical), so the published fixture gym stays on page 1 of its city and check-http finds it with or without this seed.
export const DEFAULT_DIRECTORY_GYMS = 45;

export function assertLocal(url) {
  const u = new URL(url);
  if (!["127.0.0.1", "localhost", "::1", "[::1]", "host.docker.internal"].includes(u.hostname)) {
    throw new Error(`seed: refusing to touch a database that is not local (${u.hostname})`);
  }
}

export async function down(client) {
  await client.query("delete from gyms where id = any($1::uuid[]) or id::text like $2", [Object.values(IDS.gyms), `${DIRECTORY_GYM_PREFIX}%`]);
  await client.query("delete from tiers where id = $1", [IDS.tier]);
}

/** 45 gyms in Garoua and a few in two more cities, published, with a name, a category and a city each. Run after the tier exists. */
export async function seedDirectory(client, content, garoua = DEFAULT_DIRECTORY_GYMS) {
  if (!Number.isInteger(garoua) || garoua < 0 || garoua > 5000) throw new Error(`seed: GATE_DIRECTORY_GYMS must be an integer from 0 to 5000, got ${garoua}`);
  let n = 0;
  for (const [slug, display, count] of DIRECTORY_CITIES) {
    const k = count ?? garoua;
    if (k === 0) continue;
    const first = n + 1;
    n += k;
    // one set-based statement per table: 50 gyms or 5000 take the same three round trips
    const gym = `format('${DIRECTORY_GYM_PREFIX}%s', lpad(to_hex(g), 12, '0'))::uuid`;
    await client.query(
      `insert into gyms (id, name, tier_id, capacity, status, city_id)
       select ${gym}, 'Gate Test Gym ' || g, $1::uuid, 30, 'active', (select id from public.cities where country_code = 'CM' and slug = $2)
         from generate_series($3::int, $4::int) g`,
      [IDS.tier, slug, first, n],
    );
    await client.query(
      `insert into public.page_names (id, gym_id, name, state, origin)
       select format('${DIRECTORY_NAME_PREFIX}%s', lpad(to_hex(g), 12, '0'))::uuid, ${gym}, 'gate-dir-' || g, 'active', 'claim'
         from generate_series($1::int, $2::int) g`,
      [first, n],
    );
    await client.query(
      `insert into public.gym_pages (gym_id, page_name_id, template, published_at, content)
       select ${gym}, format('${DIRECTORY_NAME_PREFIX}%s', lpad(to_hex(g), 12, '0'))::uuid, 'classic', now(),
              $1::jsonb || jsonb_build_object('name', 'Gate Test Gym ' || g, 'city', $2::text,
                'category', (array['gym', 'yoga_studio', 'pilates_studio', 'fitness_center'])[1 + g % 4])
         from generate_series($3::int, $4::int) g`,
      [content, display, first, n],
    );
  }
}

export async function up(client, { readerPassword, directory = null }) {
  const content = JSON.stringify(JSON.parse(readFileSync(new URL("./fixtures/full-page.json", import.meta.url), "utf8")));
  await down(client);
  const L = config.labels;
  await client.query("insert into tiers (id, name, monthly_price, annual_price, member_cap) values ($1, 'Gate Tier', 5000, 50000, 30)", [IDS.tier]);
  const gyms = [
    [IDS.gyms.published, "Gate Fit Published", "active"],
    [IDS.gyms.unpublished, "Gate Fit Draft", "active"],
    [IDS.gyms.takenDown, "Gate Fit Down", "active"],
    [IDS.gyms.suspended, "Gate Fit Paused", "suspended"], // suspended is seeded at insert: a later UPDATE of gyms.status silently reverts
  ];
  for (const [id, name, status] of gyms) {
    // only the published gym has a city (Story 25.3): the directory views list a visible gym that has one
    const city = id === IDS.gyms.published ? "(select id from public.cities where country_code = 'CM' and slug = 'garoua')" : "null";
    await client.query(`insert into gyms (id, name, tier_id, capacity, status, city_id) values ($1, $2, $3, 30, $4, ${city})`, [id, name, IDS.tier, status]);
  }
  const names = [
    [nameId(1), IDS.gyms.published, L.published],
    [nameId(2), IDS.gyms.unpublished, L.unpublished],
    [nameId(3), IDS.gyms.takenDown, L.takenDown],
    [nameId(4), IDS.gyms.suspended, L.suspended],
  ];
  for (const [id, gym, name] of names) await client.query("insert into public.page_names (id, gym_id, name, state, origin) values ($1, $2, $3, 'active', 'claim')", [id, gym, name]);
  if (L.redirectOld) {
    await client.query(
      "insert into public.page_names (id, gym_id, name, state, origin, reserved_until) values ($1, $2, $3, 'redirect', 'rename', now() + interval '6 months')",
      [nameId(5), IDS.gyms.published, L.redirectOld],
    );
  }
  const pages = [
    [IDS.gyms.published, nameId(1), "now()", "null"],
    [IDS.gyms.unpublished, nameId(2), "null", "null"],
    [IDS.gyms.takenDown, nameId(3), "now()", "now()"],
    [IDS.gyms.suspended, nameId(4), "now()", "null"],
  ];
  for (const [gym, nid, published, down_] of pages) {
    await client.query(
      `insert into public.gym_pages (gym_id, page_name_id, template, published_at, taken_down_at, content) values ($1, $2, 'classic', ${published}, ${down_}, $3::jsonb)`,
      [gym, nid, content],
    );
  }
  await client.query("update public.page_names set taken_down_at = now() where id = $1", [nameId(3)]);
  if (directory) await seedDirectory(client, content, directory.garoua);
  if (readerPassword) await client.query(`alter role ${config.readerRole} password '${readerPassword.replace(/'/g, "''")}'`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const cmd = process.argv[2];
  assertLocal(config.adminDbUrl);
  const { Client } = loadPg();
  const client = new Client({ connectionString: config.adminDbUrl });
  await client.connect();
  try {
    const wantsDirectory = process.argv.includes("--directory");
    if (cmd === "up") {
      const garoua = process.env.GATE_DIRECTORY_GYMS === undefined ? DEFAULT_DIRECTORY_GYMS : Number(process.env.GATE_DIRECTORY_GYMS);
      await up(client, { readerPassword: process.env.GATE_READER_PASSWORD, directory: wantsDirectory ? { garoua } : null });
    }
    else if (cmd === "down") await down(client);
    else throw new Error("usage: seed.mjs up|down");
    console.log(`seed ${cmd}${cmd === "up" && wantsDirectory ? " --directory" : ""}: ok`);
  } finally {
    await client.end();
  }
}
