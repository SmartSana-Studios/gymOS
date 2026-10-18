#!/usr/bin/env node
// Story 22.2: claim-read inventory and CI check. Story 22.4: enforcing by default. Plain Node, zero
// dependencies.
// Lists every RLS policy, function/trigger body and server source file that reads the
// role or gym claim from the token, classified:
//   claim-only   reads the claim (auth.jwt(), request.jwt.claim*, getClaims()) with no live helper call
//   live-checked calls private.current_member_role() / private.gym_id() (delegation). Since 22.3
//                the helpers themselves verify the claim against a live membership / users row and
//                are live-checked by name
//   exempt       allow-listed in claim-inventory.exempt.json with a one-line reason
// plus a null-unsafe list (`<> any(`, `<> all(`, `not in (`, `!= any(` over a role).
// Database entries closed in story 22.3, edge/server entries in 22.4.
//
// ENFORCING (default, since 22.4): fails (exit 1) on ANY non-exempt claim-only or null-unsafe entry;
// the baseline must hold zero entries. A new claim-only source fails on its own.
// REPORT (--report): the 22.2 behaviour, fails only on entries absent from the baseline.
// Never writes the baseline except via --write-baseline. Exit 2: no DB / bad input.
//
//   node scripts/claim-inventory.mjs [--rows file.json] [--sources dir]... [--baseline f]
//        [--exempt f] [--json] [--write-baseline] [--report]

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}
export function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
}

// Only reads of the role or gym claim count; session_id / aal / sub reads (22.1 onward) do not.
// Covers auth.jwt() ->> 'app_role', (select auth.jwt()) -> 'app_metadata' ->> 'app_role',
// current_setting('request.jwt.claims')::jsonb ->> 'gym_id' and request.jwt.claim.app_role.
const CLAIM_KEY = "(?:app_role|gym_id|role)";
const SQL_CLAIM_RE = new RegExp(
  [
    String.raw`auth\s*\.\s*jwt\s*\(\s*\)[^;,]{0,60}?['"]${CLAIM_KEY}['"]`,
    String.raw`auth\s*\.\s*jwt\s*\(\s*\)\s*#>>?\s*(?:'\{(?:[\w]+\s*,\s*)*${CLAIM_KEY}\}'|array\s*\[(?:\s*'[\w]+'\s*,)*\s*'${CLAIM_KEY}'\s*\])`,
    String.raw`request\s*\.\s*jwt\s*\.\s*claims?[^;]{0,80}?['".{]${CLAIM_KEY}\b`,
    String.raw`\bevent\s*->>?\s*'claims'`,
  ].join("|"),
  "i",
);
const SQL_LIVE_RE = /\bcurrent_member_role\s*\(|\bprivate\s*\.\s*gym_id\s*\(/i;
const SRC_CLAIM_RES = [
  /\bclaims\s*\??\.\s*(?:app_role|gym_id|role)\b/,
  /\bclaims\s*\??\.?\s*\[\s*['"](?:app_role|gym_id|role)['"]\s*\]/,
  /\bapp_metadata\s*\??\.\s*(?:app_role|gym_id|role)\b/,
  /\bapp_metadata\s*\??\.?\s*\[\s*['"](?:app_role|gym_id|role)['"]\s*\]/,
  /\.\s*app_role\b/,
  /\{[^{}]*\b(?:app_role|gym_id)\b[^{}]*\}\s*=\s*[^;]*\bclaims\b/,
];
const SRC_LIVE_RE = /current_member_role/;
// The helpers read the claim and then verify it against a live row (22.3): gym_id() against an
// active members row, is_super_admin() against users.is_super_admin, the other two through gym_id().
const LIVE_HELPERS = new Set([
  "private.gym_id",
  "private.is_super_admin",
  "private.current_member_role",
  "private.current_gym_status",
]);
const NULL_UNSAFE_RE = /(?:<>|!=)\s*(?:any|all)\s*\(|\bnot\s+in\s*\(/i;
const ROLE_RE = /role/i;
/** A null-unsafe operator counts only when "role" appears within 120 chars of it. */
function nullUnsafeOverRole(t) {
  const re = new RegExp(NULL_UNSAFE_RE.source, "gi");
  for (const m of t.matchAll(re)) {
    const win = t.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120);
    if (ROLE_RE.test(win)) return true;
  }
  return false;
}

/** classification of one piece of SQL text; null when it does not read a claim or call a helper. */
export function classifySql(text, name = "") {
  const t = stripSqlComments(text);
  const claim = SQL_CLAIM_RE.test(t);
  // String literals (e.g. a RAISE message naming the helper) are not calls.
  const live = SQL_LIVE_RE.test(t.replace(/'(?:[^']|'')*'/g, "''"));
  // The helper definitions read the claim but verify it live (22.3); callers delegate to them.
  if (LIVE_HELPERS.has(name.replace(/\(.*$/s, "")))
    return { classification: "live-checked", nullUnsafe: false };
  const nullUnsafe = nullUnsafeOverRole(t) && (claim || live);
  if (!claim && !live && !nullUnsafe) return null;
  let classification = null;
  if (claim && !live) classification = "claim-only";
  else if (live) classification = "live-checked";
  // Reads the claim directly AND calls a live helper: kept live-checked (AC), surfaced as mixed.
  return { classification, nullUnsafe, mixed: claim && live };
}

export function classifySource(text) {
  const t = stripJsComments(text);
  if (!SRC_CLAIM_RES.some((re) => re.test(t))) return null;
  const live = SRC_LIVE_RE.test(t);
  return { classification: live ? "live-checked" : "claim-only", nullUnsafe: false, mixed: live };
}

/**
 * rows: [{kind: policy|function|trigger|edge|server, name, text, file?}]
 * returns sorted [{kind,name,classification,story,file,reason?}] and nullUnsafe list.
 */
export function buildInventory(rows, exempt = []) {
  const ex = new Map(exempt.map((e) => [`${e.kind}:${e.name}`, e]));
  const entries = [];
  const nullUnsafe = [];
  const mixed = [];
  for (const r of rows) {
    const c = ["edge", "server"].includes(r.kind) ? classifySource(r.text) : classifySql(r.text, r.name);
    if (!c) continue;
    const story = ["edge", "server"].includes(r.kind) ? "22.4" : "22.3";
    const key = `${r.kind}:${r.name}`;
    const e = ex.get(key);
    if (c.classification) {
      entries.push({
        kind: r.kind,
        name: r.name,
        classification: e ? "exempt" : c.classification,
        story,
        file: r.file ?? null,
        ...(e ? { reason: e.reason } : {}),
      });
    }
    if (c.mixed && c.classification !== "exempt")
      mixed.push({ kind: r.kind, name: r.name, story, file: r.file ?? null });
    if (c.nullUnsafe) nullUnsafe.push({ kind: r.kind, name: r.name, story: "22.3", file: r.file ?? null });
  }
  const cmp = (a, b) => (a.kind + a.name < b.kind + b.name ? -1 : a.kind + a.name > b.kind + b.name ? 1 : 0);
  entries.sort(cmp);
  nullUnsafe.sort(cmp);
  mixed.sort(cmp);
  return { entries, nullUnsafe, mixed };
}

export function validateExempt(list) {
  const errors = [];
  for (const e of list) {
    if (!e || typeof e.kind !== "string" || typeof e.name !== "string")
      errors.push(`exempt entry needs kind and name: ${JSON.stringify(e)}`);
    else if (typeof e.reason !== "string" || e.reason.trim() === "")
      errors.push(`exempt entry ${e.kind}:${e.name} has no reason`);
  }
  return errors;
}

/** Compare against baseline: new offenders fail, vanished baseline entries are stale notes. */
export function compare(inv, baseline) {
  const baseClaim = new Set(
    (baseline.entries ?? []).filter((e) => e.classification === "claim-only").map((e) => `${e.kind}:${e.name}`),
  );
  const baseNull = new Set((baseline.nullUnsafe ?? []).map((e) => `${e.kind}:${e.name}`));
  const failures = [];
  for (const e of inv.entries)
    if (e.classification === "claim-only" && !baseClaim.has(`${e.kind}:${e.name}`))
      failures.push({ list: "claim-only", ...e });
  for (const e of inv.nullUnsafe)
    if (!baseNull.has(`${e.kind}:${e.name}`)) failures.push({ list: "null-unsafe", ...e });
  const nowClaim = new Set(inv.entries.filter((e) => e.classification === "claim-only").map((e) => `${e.kind}:${e.name}`));
  const nowNull = new Set(inv.nullUnsafe.map((e) => `${e.kind}:${e.name}`));
  const stale = [];
  for (const k of baseClaim) if (!nowClaim.has(k)) stale.push(`claim-only ${k}`);
  for (const k of baseNull) if (!nowNull.has(k)) stale.push(`null-unsafe ${k}`);
  return { failures, stale: stale.sort() };
}

/** Enforcing mode: every non-exempt claim-only / null-unsafe entry fails, baseline or not. */
export function enforce(inv, baseline = {}) {
  const failures = [];
  for (const e of inv.entries) if (e.classification === "claim-only") failures.push({ list: "claim-only", ...e });
  for (const e of inv.nullUnsafe) failures.push({ list: "null-unsafe", ...e });
  const baselineEntries = [...(baseline.entries ?? []), ...(baseline.nullUnsafe ?? [])];
  return { failures, baselineEntries };
}

// ---------- fetching ----------

const SQL = String.raw`
select json_agg(r order by r.kind, r.name) from (
  select 'policy' as kind, schemaname||'.'||tablename||'.'||policyname as name,
         coalesce(qual,'')||' '||coalesce(with_check,'') as text
    from pg_policies where schemaname not in ('pg_catalog','information_schema')
  union all
  select case when exists (select 1 from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal)
              or p.prorettype = 'pg_catalog.trigger'::regtype then 'trigger' else 'function' end,
         n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
         p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','private') and p.prokind in ('f','p')
) r`;

function fetchDbRows() {
  const container = process.env.DB_CONTAINER || "supabase_db_gym_os";
  const r = spawnSync(
    "docker",
    ["exec", "-e", "PGPASSWORD=postgres", container, "psql", "-U", "postgres", "-h", "127.0.0.1", "-At", "-c", SQL],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 60000 },
  );
  if (r.error || r.status !== 0) {
    console.error(
      `Cannot query the local database (container ${container}): ${(r.error?.message || r.stderr || "").trim()}\n` +
        "Start the local stack (supabase start) and apply migrations, then re-run.",
    );
    process.exit(2);
  }
  let rows;
  try {
    rows = JSON.parse(r.stdout.trim());
  } catch (e) {
    console.error(`Database output is not valid JSON (${e.message}); first bytes: ${r.stdout.slice(0, 120)}`);
    process.exit(2);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("Database returned no rows; refusing to pass on an empty inventory.");
    process.exit(2);
  }
  return rows;
}

/** Best-effort: last migration file that defines the policy or function. */
function migrationIndex(dir) {
  if (!existsSync(dir)) return () => null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const texts = files.map((f) => [f, stripSqlComments(readFileSync(join(dir, f), "utf8")).toLowerCase()]);
  return (kind, name) => {
    let needle;
    if (kind === "policy") needle = name.split(".").slice(2).join(".").toLowerCase();
    else needle = name.slice(0, name.indexOf("(")).toLowerCase();
    const bare = needle.includes(".") ? needle.split(".").pop() : needle;
    let hit = null;
    for (const [f, t] of texts) {
      const found =
        kind === "policy"
          ? t.includes(`"${needle}"`) || t.includes(`policy ${needle} `)
          : new RegExp(String.raw`create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(?:\w+\.)?"?${bare}"?\s*\(`).test(t);
      if (found) hit = f;
    }
    return hit ? `supabase/migrations/${hit}` : null;
  };
}

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "__tests__", "tests", ".turbo"]);
function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(f)) walk(p, out);
    } else if (SRC_FILE_RE.test(f) && !TEST_FILE_RE.test(f)) out.push(p);
  }
}

const SRC_FILE_RE = /\.(ts|tsx|mjs|js)$/;
const TEST_FILE_RE = /\.(test|spec|d)\.[tj]sx?$/;
/** Non-recursive: source files directly in dir (apps/*\/proxy.ts and friends). */
function topLevelFiles(dir, out) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isFile() && SRC_FILE_RE.test(f) && !TEST_FILE_RE.test(f) && !/\.config\.|^next-env/.test(f))
      out.push(p);
  }
}
function defaultSources() {
  const dirs = [join(repoRoot, "supabase/functions"), join(repoRoot, "lib")];
  const appsDir = join(repoRoot, "apps");
  const apps = existsSync(appsDir)
    ? readdirSync(appsDir).sort().filter((d) => statSync(join(appsDir, d)).isDirectory())
    : [];
  for (const a of apps)
    for (const sub of ["app", "lib", "components", "src"]) dirs.push(join(appsDir, a, sub));
  // services/ holds session-client (RLS) reads that legitimately take the gym_id claim as a hint, so
  // only files that reach for the service-role client are service paths (22.4).
  for (const a of apps) dirs.push({ onlyServiceRole: join(appsDir, a, "services") });
  const pkgDir = join(repoRoot, "packages");
  if (existsSync(pkgDir))
    for (const p of readdirSync(pkgDir).sort()) dirs.push(join(pkgDir, p));
  const files = apps.map((a) => join(appsDir, a));
  return [...dirs, ...files.map((d) => ({ topLevel: d }))];
}

export function sourceKind(rel) {
  return rel.startsWith("supabase/functions/") ? "edge" : "server";
}

function sourceRows(dirs) {
  const files = [];
  for (const d of dirs) {
    if (typeof d === "object" && d.onlyServiceRole) {
      const found = [];
      walk(d.onlyServiceRole, found);
      for (const p of found) if (/createAdminClient|SERVICE_ROLE_KEY/.test(readFileSync(p, "utf8"))) files.push(p);
    } else if (typeof d === "object") topLevelFiles(d.topLevel, files);
    else walk(d, files);
  }
  return files.map((p) => {
    const rel = relative(repoRoot, p).split("\\").join("/");
    return {
      kind: sourceKind(rel),
      name: rel,
      file: rel,
      text: readFileSync(p, "utf8"),
    };
  });
}

function parseArgs(argv) {
  const o = {
    rows: null,
    sources: [],
    baseline: join(repoRoot, "scripts/claim-inventory.baseline.json"),
    exempt: join(repoRoot, "scripts/claim-inventory.exempt.json"),
    json: false,
    writeBaseline: false,
    report: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) {
        console.error(`Missing value for ${a}`);
        process.exit(2);
      }
      return resolve(v);
    };
    if (a === "--rows") o.rows = val();
    else if (a === "--sources") o.sources.push(val());
    else if (a === "--baseline") o.baseline = val();
    else if (a === "--exempt") o.exempt = val();
    else if (a === "--json") o.json = true;
    else if (a === "--write-baseline") o.writeBaseline = true;
    else if (a === "--report") o.report = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return o;
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`Cannot read ${what} ${path}: ${e.message}`);
    process.exit(2);
  }
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const exemptDoc = existsSync(o.exempt) ? readJson(o.exempt, "exempt list") : { entries: [] };
  const exempt = exemptDoc.entries ?? [];
  if (!Array.isArray(exempt)) {
    console.error(`Exempt list ${o.exempt}: entries must be an array.`);
    process.exit(2);
  }
  const exErrors = validateExempt(exempt);
  if (exErrors.length) {
    console.error("Claim inventory check FAILED:");
    for (const e of exErrors) console.error(`  - ${e}`);
    process.exit(1);
  }

  let rows;
  if (o.rows) rows = readJson(o.rows, "rows file");
  else {
    rows = fetchDbRows();
    const find = migrationIndex(join(repoRoot, "supabase/migrations"));
    for (const r of rows) r.file = find(r.kind, r.name);
  }
  const defaulted = o.sources.length === 0;
  const srcDirs = defaulted ? defaultSources() : o.sources;
  const srcRows = sourceRows(srcDirs);
  if (defaulted && srcRows.length === 0) {
    console.error("Default source scan found no files (renamed directories?); refusing to pass on an empty scan.");
    process.exit(2);
  }
  rows = rows.concat(srcRows);

  const inv = buildInventory(rows, exempt);

  if (o.writeBaseline) {
    const base = {
      entries: inv.entries
        .filter((e) => e.classification === "claim-only")
        .map(({ kind, name, classification, story }) => ({ kind, name, classification, story })),
      nullUnsafe: inv.nullUnsafe.map(({ kind, name, story }) => ({ kind, name, story })),
    };
    writeFileSync(o.baseline, JSON.stringify(base, null, 2) + "\n");
    console.log(`Wrote ${o.baseline}: ${base.entries.length} claim-only, ${base.nullUnsafe.length} null-unsafe.`);
    return;
  }

  const baseline = readJson(o.baseline, "baseline");
  let failures;
  let stale = [];
  let baselineEntries = [];
  if (o.report) ({ failures, stale } = compare(inv, baseline));
  else ({ failures, baselineEntries } = enforce(inv, baseline));

  if (o.json) process.stdout.write(JSON.stringify({ ...inv, failures, stale }, null, 2) + "\n");
  else {
    for (const e of inv.entries)
      console.log(
        `${e.kind.padEnd(8)} ${e.classification.padEnd(12)} ${e.story}  ${e.name}${e.reason ? `  [exempt: ${e.reason}]` : ""}`,
      );
    for (const e of inv.nullUnsafe) console.log(`${e.kind.padEnd(8)} null-unsafe  ${e.story}  ${e.name}`);
    for (const e of inv.mixed) console.log(`${e.kind.padEnd(8)} mixed        ${e.story}  ${e.name}  (claim read + live helper, informational)`);
  }
  const count = (c) => inv.entries.filter((e) => e.classification === c).length;
  const co = inv.entries.filter((e) => e.classification === "claim-only");
  const split = (s) => co.filter((e) => e.story === s).length;
  const summary =
    `claim-only ${count("claim-only")} (22.3: ${split("22.3")}, 22.4: ${split("22.4")}), ` +
    `live-checked ${count("live-checked")}, exempt ${count("exempt")}, null-unsafe ${inv.nullUnsafe.length}, mixed ${inv.mixed.length}`;
  const log = o.json ? console.error : console.log;
  log(`Claim inventory: ${summary}`);
  const seen = new Set(inv.entries.map((e) => `${e.kind}:${e.name}`));
  for (const e of exempt)
    if (!seen.has(`${e.kind}:${e.name}`)) log(`stale exempt: ${e.kind} ${e.name} matches no inventory entry`);
  for (const s of stale) log(`stale baseline: ${s} no longer present (remove it with --write-baseline)`);
  if (baselineEntries.length) {
    console.error(
      `Claim inventory check FAILED: the baseline must be empty in enforcing mode (${baselineEntries.length} entries). Fix the sources or add an exempt entry with a reason.`,
    );
    process.exit(1);
  }
  if (failures.length) {
    console.error(
      o.report
        ? "Claim inventory check FAILED: new entries absent from the baseline:"
        : "Claim inventory check FAILED (enforcing): non-exempt claim reads:",
    );
    for (const f of failures)
      console.error(`  - ${f.list} ${f.kind} ${f.name}${f.file ? ` (${f.file})` : " (file unknown)"} [${f.story}]`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
