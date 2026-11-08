#!/usr/bin/env node
// Story 24.4 (AD-42, NFR-024): apps/landing reads page data only through a server-side connection as the public_site_reader role.
// It must hold no Supabase client library and no Supabase key, so a defect there cannot reach a tenant table through PostgREST,
// Auth or Storage. This gate fails when apps/landing's manifests name any of:
//   - a dependency on @supabase/* or supabase-js (every dependency map in package.json, including overrides);
//   - an environment variable for the anon key, the service-role key, the JWT secret or a Supabase URL/key
//     (every .env* file, and the env blocks of vercel.json).
// Plain Node, zero dependencies. Exit 1 with one line per violation naming the file and the match.

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const LANDING_DIR = "apps/landing";

const DEP_MAPS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"];
const BANNED_PACKAGE = /^@supabase\/|supabase-js|^supabase$|^(postgrest|gotrue|realtime|storage)-js$/i;
const BANNED_VALUE = /supabase\.(co|com)|eyJ[\w-]+\.[\w-]+/i;
/** Override keys may carry a selector such as `parent>@supabase/ssr`; test the last segment too. */
const bannedKey = (name) =>
  name.split(">").some((seg) => BANNED_PACKAGE.test(seg) || BANNED_PACKAGE.test(seg.replace(/(?<=.)@[^@/]*$/, "")));
const BANNED_ENV = /supabase|anon[_-]?key|service[_-]?role|jwt[_-]?secret/i;

/** Names of packages (keys, recursively for nested override maps) that match the banned pattern. */
function bannedPackages(map, found = []) {
  if (!map || typeof map !== "object") return found;
  for (const [name, value] of Object.entries(map)) {
    if (bannedKey(name)) found.push(name);
    if (typeof value === "string" && BANNED_PACKAGE.test(value)) found.push(`${name} -> ${value}`);
    else bannedPackages(value, found);
  }
  return found;
}

/** Violations in one package.json text. */
export function scanPackageJson(file, text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return [`${file}: not valid JSON (${e.message})`];
  }
  const out = [];
  for (const key of DEP_MAPS) for (const m of bannedPackages(json[key])) out.push(`${file}: banned dependency "${m}" in ${key}`);
  const pnpm = json.pnpm;
  if (pnpm) for (const m of bannedPackages(pnpm.overrides)) out.push(`${file}: banned dependency "${m}" in pnpm.overrides`);
  return out;
}

/** Violations in one .env-style file text (comments are ignored; names are the part before `=`). */
export function scanEnvFile(file, text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.replace(/^export\s+/, "").indexOf("=");
    const body = line.replace(/^export\s+/, "");
    const name = (eq === -1 ? body : body.slice(0, eq)).trim();
    const value = eq === -1 ? "" : body.slice(eq + 1);
    if (BANNED_ENV.test(name)) out.push(`${file}: banned environment variable name "${name}"`);
    else if (BANNED_VALUE.test(value)) out.push(`${file}: banned value (Supabase URL or JWT) under "${name}": ${value.match(BANNED_VALUE)[0]}`);
  }
  return out;
}

/** Violations in one vercel.json text: any key under an "env" or "build.env" object. */
export function scanVercelJson(file, text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return [`${file}: not valid JSON (${e.message})`];
  }
  const out = [];
  for (const [where, obj] of [["env", json.env], ["build.env", json.build?.env]]) {
    if (!obj || typeof obj !== "object") continue;
    for (const name of Object.keys(obj)) if (BANNED_ENV.test(name)) out.push(`${file}: banned environment variable name "${name}" in ${where}`);
  }
  return out;
}

/** Scan a landing directory; returns the list of violation lines. */
export function scanLanding(dir = join(repoRoot, LANDING_DIR), label = LANDING_DIR) {
  if (!existsSync(dir)) return [`${label}: directory not found`];
  const out = [];
  const read = (path, shown, scan) => {
    try {
      if (!statSync(path).isFile()) return [];
      return scan(shown, readFileSync(path, "utf8"));
    } catch (e) {
      return [`${shown}: cannot be read (${e.code ?? e.message})`];
    }
  };
  const pkg = join(dir, "package.json");
  if (!existsSync(pkg)) out.push(`${label}/package.json: missing`);
  else out.push(...read(pkg, `${label}/package.json`, scanPackageJson));
  for (const name of readdirSync(dir)) {
    if (name === ".env" || name.startsWith(".env.")) out.push(...read(join(dir, name), `${label}/${name}`, scanEnvFile));
  }
  const vercel = join(dir, "vercel.json");
  if (existsSync(vercel)) out.push(...read(vercel, `${label}/vercel.json`, scanVercelJson));
  return out;
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const dirArg = process.argv[2];
  const violations = dirArg ? scanLanding(dirArg, dirArg) : scanLanding();
  if (violations.length) {
    console.error("apps/landing must hold no Supabase library or key (AD-42):");
    for (const v of violations) console.error("  " + v);
    process.exit(1);
  }
  console.log("check-landing-no-supabase: OK (no Supabase dependency or key name in apps/landing manifests)");
}
