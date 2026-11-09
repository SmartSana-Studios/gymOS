// Story 24.10: the public gym pages read PUBLIC_SITE_* environment variables on the server. Turborepo only passes a variable to a build when
// it is declared in turbo.json, and apps/landing must not be given a Supabase key by the back door. These checks keep the names declared in
// ONE list, the landing no-Supabase gate agreeing with it, and the landing code reading nothing else for the database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanEnvFile } from "../check-landing-no-supabase.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NAMES = [
  "PUBLIC_SITE_ROOT_DOMAIN",
  "PUBLIC_SITE_MEDIA_ORIGIN",
  "PUBLIC_SITE_READER_HOST",
  "PUBLIC_SITE_READER_PORT",
  "PUBLIC_SITE_READER_DATABASE",
  "PUBLIC_SITE_READER_USER",
  "PUBLIC_SITE_READER_PASSWORD",
];

test("turbo.json declares every PUBLIC_SITE_* name for the build", () => {
  const env = JSON.parse(readFileSync(join(root, "turbo.json"), "utf8")).tasks.build.env;
  for (const n of NAMES) assert.ok(env.includes(n), `${n} is not in turbo.json tasks.build.env`);
});

test("the landing code reads exactly these PUBLIC_SITE_* names", () => {
  const found = new Set();
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      if (["node_modules", ".next", "test-stubs"].includes(f)) continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs)$/.test(f) && !/\.test\./.test(f)) for (const m of readFileSync(p, "utf8").matchAll(/(?<![A-Z_])PUBLIC_SITE_[A-Z_]+/g)) found.add(m[0]);
    }
  };
  walk(join(root, "apps", "landing"));
  assert.deepEqual([...found].sort(), [...NAMES].sort());
});

test("the landing no-Supabase gate accepts the reader and media settings and still refuses a key (the known-bad run)", () => {
  const good = NAMES.map((n) => `${n}=x`).join("\n").replace("PUBLIC_SITE_READER_HOST=x", "PUBLIC_SITE_READER_HOST=aws-0-eu-west-1.pooler.supabase.com").replace("PUBLIC_SITE_READER_USER=x", "PUBLIC_SITE_READER_USER=public_site_reader.abcdefgh");
  assert.deepEqual(scanEnvFile(".env.local", good), []);
  assert.ok(scanEnvFile(".env.local", `${good}\nSUPABASE_SERVICE_ROLE_KEY=x`).length > 0);
  // the storage origin is a Supabase URL in production: it is set in the Vercel project, never in a committed .env file (the gate refuses it there)
  assert.ok(scanEnvFile(".env.local", `${good}\nPUBLIC_SITE_MEDIA_ORIGIN=https://abcd.supabase.co`).length > 0);
});

test("no Supabase client, key name or JWT in the new gym-site modules", () => {
  const dir = join(root, "apps", "landing", "lib", "gym-site");
  for (const f of readdirSync(dir).filter((f) => /\.ts$/.test(f) && !/\.test\./.test(f))) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.doesNotMatch(src, /@supabase|supabase-js|createClient|SERVICE_ROLE|ANON_KEY|JWT_SECRET|NEXT_PUBLIC_SUPABASE/i, f);
  }
});
