#!/usr/bin/env node
// Story 29.4 (FR-247, FR-095, NFR-011, NFR-016; AD-58, AD-35, FR-251): the coach picker must never reach body or progress data.
//
// The picker is seven SECURITY DEFINER functions (0183) that read a coach's classes, class lists, assigned members, the coach's own session notes and
// the workout plans for an Owner, Supervisor or Manager. A definer bypasses RLS, so the only thing keeping progress data out of those functions is
// what their bodies reach. This check proves, against the migrated schema, that no picker function reaches a deny-listed object. pg_depend does not
// record table references inside a plpgsql body, so the walk uses two edge sources, transitively:
//   1. pg_depend edges from a function or a view (rewrite rule) to another function or relation (views, SQL-bodied functions, helper views);
//   2. every public or private function or relation whose name appears in the text (function body or view definition) of the object being walked:
//      a function name followed by "(", a relation name as a whole word.
// It fails, naming the path (picker -> ... -> object), on reaching a deny-listed relation or on a deny-listed column or literal in the text of any
// object on the walk. It also fails when
//   * a function matches the picker name pattern but is not in scripts/coach-picker-functions.json, or a name in that list matches no function
//     (a stale list): the list is how a function renamed out of the pattern still gets checked;
//   * a picker function is registered in private.support_capabilities (FR-251: the picker is not a support capability);
//   * a name in the list is not called in supabase/tests/coach_picker_no_body_data.test.sql (the seeded scan of every function's returned rows).
// The pgTAP twin is supabase/tests/coach_picker_isolation.test.sql.
//
// THE DENY LIST (names verified in supabase/migrations at story time, 2026-11-20). A NEW BODY-DATA TABLE OR COLUMN MUST BE ADDED HERE (and to the
// twin test): the check only knows what it is told.
//   progress_entries (0066)          measurements, weight, progress note, logged_at: the Coach Overview's "Recent Progress Activity" and its
//   progress_photos (0067)           "Needs Follow-Up" lists are PostgREST embeds of progress_entries and session_notes (services/coaches.ts), so no
//   workout_plan_completions (0081)  database function or view stands behind that feed: the feed is excluded by the first and last rows of this list.
//   the progress-photos storage bucket (a literal, not a relation)
//   members.starting_weight_kg, height_cm, birth_year, dob, emergency_contact, email, neighborhood, profession
// There is no separate progress-notes table: the FR-098 note is session_notes, which is a picker OUTPUT (the chosen coach's own notes), so it is not
// on the list. A new progress or body table must be added here before it can ship.
//
//   node scripts/check-coach-picker-isolation.mjs [--catalog file.json] [--allow-list file.json] [--no-body-test file.sql]
//   exit 0 clean, 1 violations, 2 no database / bad input. With no --catalog it queries the local database (DB_CONTAINER, default supabase_db_gym_os).
//
// Catalog JSON: { objects: [{ id, kind: "function"|"relation", schema, name, text }], edges: [{ from, to }], supportCapabilities: [name, ...] }.
// Plain Node, zero dependencies.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export const PICKER_NAME_PATTERN = /^(?:list_coach_|get_coach_|list_picker_)/;
export const DENY_RELATIONS = ["progress_entries", "progress_photos", "workout_plan_completions"];
export const DENY_COLUMNS = ["starting_weight_kg", "height_cm", "birth_year", "dob", "emergency_contact", "email", "neighborhood", "profession"];
export const DENY_LITERALS = ["progress-photos"];
// How a picker function may NOT build its output: a row or a star (a column added to a table later would reach the browser with no name in any text to
// deny-list) and a JSON of a row. The migration's own verify block bans the same shapes at apply time; this is the second guard, on every later edit.
export const OUTPUT_SHAPE_BANS = [
  { re: /select\s+\*/i, what: "select *" },
  { re: /\b\w+\.\*/, what: "an alias star (m.*)" },
  { re: /\b(?:to_jsonb?|row_to_json)\s*\(/i, what: "to_json, to_jsonb or row_to_json" },
];
const SCHEMAS = new Set(["public", "private"]);

export function stripSqlComments(sql) {
  return String(sql ?? "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Identifier tokens of a text with the first non-space character after each (so "name (" is a call). */
function tokens(text) {
  const out = [];
  for (const m of stripSqlComments(text).matchAll(/[A-Za-z_][A-Za-z0-9_$]*/g)) {
    let i = m.index + m[0].length;
    const src = m.input;
    while (i < src.length && /\s/.test(src[i])) i++;
    out.push({ word: m[0].toLowerCase(), next: src[i] ?? "" });
  }
  return out;
}

/**
 * catalog: { objects, edges, supportCapabilities }; config: { allowList: string[], noBodyTestText?: string }.
 * returns { failures: string[], pickers: string[] } (ids).
 */
export function checkIsolation(catalog, config) {
  const failures = [];
  const objects = catalog.objects ?? [];
  const byId = new Map(objects.map((o) => [o.id, o]));
  const label = (o) => `${o.schema}.${o.name}${o.kind === "function" && o.args !== undefined ? `(${o.args})` : ""}`;

  const functionsByName = new Map();
  const relationsByName = new Map();
  for (const o of objects) {
    if (!SCHEMAS.has(o.schema)) continue;
    const map = o.kind === "function" ? functionsByName : relationsByName;
    const key = o.name.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(o);
  }

  const edgesFrom = new Map();
  for (const e of catalog.edges ?? []) {
    if (!edgesFrom.has(e.from)) edgesFrom.set(e.from, []);
    edgesFrom.get(e.from).push(e.to);
  }

  const allowList = config.allowList ?? [];
  const publicFunctions = objects.filter((o) => o.kind === "function" && o.schema === "public");
  const byPattern = publicFunctions.filter((o) => PICKER_NAME_PATTERN.test(o.name));
  const byList = publicFunctions.filter((o) => allowList.includes(o.name));
  const pickers = [...new Map([...byPattern, ...byList].map((o) => [o.id, o])).values()];

  for (const name of allowList) {
    if (!publicFunctions.some((o) => o.name === name)) {
      failures.push(`stale allow-list entry: no function public.${name} exists (remove it from scripts/coach-picker-functions.json or restore the function)`);
    }
  }
  for (const o of byPattern) {
    if (!allowList.includes(o.name)) {
      failures.push(`public.${o.name} matches the picker name pattern but is not in scripts/coach-picker-functions.json: add it (it is then checked and must be scanned in coach_picker_no_body_data.test.sql)`);
    }
  }

  const caps = new Set((catalog.supportCapabilities ?? []).map((n) => String(n).toLowerCase()));
  for (const o of pickers) {
    if (caps.has(o.name.toLowerCase())) failures.push(`public.${o.name} is registered in private.support_capabilities: a picker function is not a support capability (FR-251)`);
  }

  if (config.noBodyTestText !== undefined) {
    const testText = stripSqlComments(config.noBodyTestText);
    for (const name of allowList) {
      if (!new RegExp(`\\b${name}\\s*\\(`).test(testText)) {
        failures.push(`public.${name} is in the allow-list but coach_picker_no_body_data.test.sql does not call it: its rows are not scanned for seeded body data`);
      }
    }
  }

  const denyRelations = new Set(DENY_RELATIONS);
  const denyColumns = new Set(DENY_COLUMNS);

  /** Neighbours of an object, in a stable order: pg_depend edges, then names found in its text. */
  function neighbours(o) {
    const out = [];
    const seen = new Set();
    const add = (n) => {
      if (n && n.id !== o.id && !seen.has(n.id)) {
        seen.add(n.id);
        out.push(n);
      }
    };
    for (const to of edgesFrom.get(o.id) ?? []) add(byId.get(to));
    for (const { word, next } of tokens(o.text)) {
      if (next === "(") for (const f of functionsByName.get(word) ?? []) add(f);
      for (const r of relationsByName.get(word) ?? []) add(r);
    }
    return out;
  }

  for (const o of pickers) {
    const body = stripSqlComments(o.text);
    for (const { re, what } of OUTPUT_SHAPE_BANS) {
      if (re.test(body)) failures.push(`public.${o.name}: builds its output with ${what}; name the columns instead (a column added later must not reach the picker unseen)`);
    }
  }

  for (const start of pickers) {
    const parent = new Map([[start.id, null]]);
    const queue = [start];
    const pathTo = (o) => {
      const names = [];
      for (let cur = o; cur; cur = parent.get(cur.id) ? byId.get(parent.get(cur.id)) : null) names.unshift(label(cur));
      return names.join(" -> ");
    };
    const reported = new Set();
    while (queue.length) {
      const cur = queue.shift();
      if (cur.kind === "relation" && denyRelations.has(cur.name.toLowerCase()) && cur.id !== start.id) {
        failures.push(`${pathTo(cur)}: reaches ${cur.schema}.${cur.name}, a body or progress table`);
        continue;
      }
      const text = stripSqlComments(cur.text);
      for (const { word } of tokens(cur.text)) {
        if (denyColumns.has(word) && !reported.has(`c:${word}`)) {
          reported.add(`c:${word}`);
          failures.push(`${pathTo(cur)}: names the body or contact column "${word}"`);
        }
      }
      for (const lit of DENY_LITERALS) {
        if (text.toLowerCase().includes(lit) && !reported.has(`l:${lit}`)) {
          reported.add(`l:${lit}`);
          failures.push(`${pathTo(cur)}: names the "${lit}" storage bucket`);
        }
      }
      for (const n of neighbours(cur)) {
        if (!parent.has(n.id)) {
          parent.set(n.id, cur.id);
          queue.push(n);
        }
      }
    }
  }

  return { failures, pickers: pickers.map((o) => o.id) };
}

const CATALOG_SQL = String.raw`
select json_build_object(
  'objects', (
    select coalesce(json_agg(x), '[]'::json) from (
      select 'f:' || p.oid as id, 'function' as kind, n.nspname as schema, p.proname as name,
             pg_get_function_identity_arguments(p.oid) as args, p.prosrc as text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
      union all
      select 'r:' || c.oid, 'relation', n.nspname, c.relname, null,
             case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid) end
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm')
    ) x
  ),
  'edges', (
    select coalesce(json_agg(e), '[]'::json) from (
      select distinct src as "from", dst as "to" from (
        select case when d.classid = 'pg_proc'::regclass then 'f:' || d.objid
                    when d.classid = 'pg_rewrite'::regclass then 'r:' || rw.ev_class end as src,
               case when d.refclassid = 'pg_proc'::regclass then 'f:' || d.refobjid
                    when d.refclassid = 'pg_class'::regclass then 'r:' || d.refobjid end as dst
          from pg_depend d
          left join pg_rewrite rw on d.classid = 'pg_rewrite'::regclass and rw.oid = d.objid
         where d.deptype = 'n'
      ) y where src is not null and dst is not null and src <> dst
    ) e
  ),
  'supportCapabilities', (select coalesce(json_agg(object_name), '[]'::json) from private.support_capabilities)
)::text`;

function fetchCatalog() {
  const container = process.env.DB_CONTAINER || "supabase_db_gym_os";
  const r = spawnSync(
    "docker",
    ["exec", "-e", "PGPASSWORD=postgres", container, "psql", "-U", "postgres", "-h", "127.0.0.1", "-At", "-c", CATALOG_SQL],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 120000 },
  );
  if (r.error || r.status !== 0) {
    console.error(
      `Cannot query the local database (container ${container}): ${(r.error?.message || r.stderr || "").trim()}\n` +
        "Start the local stack (supabase start) and apply migrations, then re-run.",
    );
    process.exit(2);
  }
  try {
    const catalog = JSON.parse(r.stdout.trim());
    if (!catalog.objects?.length) throw new Error("no objects");
    return catalog;
  } catch (e) {
    console.error(`Database output is not a usable catalog (${e.message}); first bytes: ${r.stdout.slice(0, 120)}`);
    process.exit(2);
  }
}

function parseArgs(argv) {
  const opts = {
    catalog: null,
    allowList: join(repoRoot, "scripts/coach-picker-functions.json"),
    noBodyTest: join(repoRoot, "supabase/tests/coach_picker_no_body_data.test.sql"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (["--catalog", "--allow-list", "--no-body-test"].includes(a)) {
      if (v === undefined || v.startsWith("--")) {
        console.error(`Missing value for ${a}`);
        process.exit(2);
      }
      i++;
      if (a === "--catalog") opts.catalog = resolve(v);
      else if (a === "--allow-list") opts.allowList = resolve(v);
      else opts.noBodyTest = resolve(v);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  for (const f of [opts.allowList, opts.noBodyTest]) {
    if (!existsSync(f)) {
      console.error(`Missing file: ${f}`);
      process.exit(2);
    }
  }
  let allowList;
  try {
    allowList = JSON.parse(readFileSync(opts.allowList, "utf8")).functions;
    if (!Array.isArray(allowList) || !allowList.every((n) => typeof n === "string")) throw new Error('expected { "functions": [names] }');
  } catch (e) {
    console.error(`Bad allow-list ${opts.allowList}: ${e.message}`);
    process.exit(2);
  }
  let catalog;
  if (opts.catalog) {
    try {
      catalog = JSON.parse(readFileSync(opts.catalog, "utf8"));
    } catch (e) {
      console.error(`Bad catalog ${opts.catalog}: ${e.message}`);
      process.exit(2);
    }
  } else {
    catalog = fetchCatalog();
  }
  const { failures, pickers } = checkIsolation(catalog, { allowList, noBodyTestText: readFileSync(opts.noBodyTest, "utf8") });
  if (failures.length) {
    console.error(`Coach picker isolation FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`Coach picker isolation OK: ${pickers.length} picker functions reach no body or progress object.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
