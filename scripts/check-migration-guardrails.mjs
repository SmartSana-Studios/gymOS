#!/usr/bin/env node
// Story 19.1: migration guardrails. Plain Node, zero dependencies.
//   1. AD-3: no new `auth.jwt() ->> 'app_role'` reads in supabase/migrations
//      (use private.current_member_role()).
//   2. Every function created in a migration must be revoked from `public`
//      AND `anon` in the same file (hosted defaults grant anon EXECUTE).
// Existing offenders are grandfathered in a hand-edited JSON file; this
// script never writes it (--print-baseline prints to stdout only).
// Static limitation: matching is by function name, not argument list.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const opts = {
    migrations: join(repoRoot, "supabase/migrations"),
    grandfather: join(repoRoot, "scripts/migration-guardrails.grandfather.json"),
    printBaseline: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--migrations" || a === "--grandfather") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) {
        console.error(`Missing value for ${a}`);
        process.exit(2);
      }
      if (a === "--migrations") opts.migrations = resolve(v);
      else opts.grandfather = resolve(v);
    }
    else if (a === "--print-baseline") opts.printBaseline = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

const JWT_RE = /auth\s*\.\s*jwt\s*\(\s*\)\s*->>?\s*'app_role'/i;

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function normName(raw) {
  let n = raw.replace(/"/g, "").replace(/\s+/g, "").toLowerCase();
  if (n.startsWith("public.")) n = n.slice("public.".length);
  return n;
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const CREATE_RE = new RegExp(
  String.raw`create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(${IDENT}(?:\s*\.\s*${IDENT})?)\s*\(`,
  "gi",
);
/** Split a revoke target list on commas outside parentheses, then drop arg lists. */
function revokeTargets(list) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out
    .map((t) => t.replace(/\(.*$/s, "").trim())
    .filter(Boolean);
}
const REVOKE_RE =
  /^\s*revoke\s+(?:execute|all)(?:\s+privileges)?\s+on\s+(?:function|routine|procedure)\s+([\s\S]+?)\s+from\s+([\s\S]+)$/i;

/** Returns [{name, missing: [roles]}] for functions lacking public+anon revokes. */
function functionViolations(text) {
  const sql = stripComments(text);
  const created = new Set();
  for (const m of sql.matchAll(CREATE_RE)) created.add(normName(m[1]));
  if (created.size === 0) return [];
  const revoked = new Map(); // name -> Set(roles)
  for (const stmt of sql.split(";")) {
    const m = REVOKE_RE.exec(stmt);
    if (!m) continue;
    const roles = m[2]
      .replace(/\s+(?:cascade|restrict)\s*$/i, "")
      .split(",")
      .map((r) => r.replace(/"/g, "").trim().toLowerCase())
      .filter(Boolean);
    for (const t of revokeTargets(m[1])) {
      const name = normName(t);
      if (!revoked.has(name)) revoked.set(name, new Set());
      for (const r of roles) revoked.get(name).add(r);
    }
  }
  const out = [];
  for (const name of [...created].sort()) {
    const have = revoked.get(name) ?? new Set();
    const missing = ["public", "anon"].filter((r) => !have.has(r));
    if (missing.length) out.push({ name, missing });
  }
  return out;
}

function scan(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const appRoleReads = [];
  const fnViolations = new Map();
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    if (JWT_RE.test(text)) appRoleReads.push(f);
    const v = functionViolations(text);
    if (v.length) fnViolations.set(f, v);
  }
  return { files, appRoleReads, fnViolations };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.migrations)) {
    console.error(`Migrations directory not found: ${opts.migrations}`);
    process.exit(2);
  }
  if (!readdirSync(opts.migrations).some((f) => f.endsWith(".sql"))) {
    console.error(`No .sql files in ${opts.migrations}; refusing to pass on an empty check.`);
    process.exit(2);
  }
  const { appRoleReads, fnViolations } = scan(opts.migrations);

  if (opts.printBaseline) {
    const baseline = {
      app_role_reads: appRoleReads,
      function_privileges: [...fnViolations.keys()],
    };
    process.stdout.write(JSON.stringify(baseline, null, 2) + "\n");
    return;
  }

  let gf;
  try {
    gf = JSON.parse(readFileSync(opts.grandfather, "utf8"));
  } catch (e) {
    console.error(`Cannot read grandfather file ${opts.grandfather}: ${e.message}`);
    process.exit(2);
  }
  if (
    gf === null ||
    typeof gf !== "object" ||
    !Array.isArray(gf.app_role_reads ?? []) ||
    !Array.isArray(gf.function_privileges ?? [])
  ) {
    console.error(
      `Grandfather file ${opts.grandfather}: must be an object whose app_role_reads and function_privileges are arrays.`,
    );
    process.exit(2);
  }
  const gfJwt = new Set(gf.app_role_reads ?? []);
  const gfFn = new Set(gf.function_privileges ?? []);
  const errors = [];

  for (const f of appRoleReads) {
    if (!gfJwt.has(f))
      errors.push(
        `${f}: new auth.jwt() ->> 'app_role' read (AD-3). Use private.current_member_role() instead.`,
      );
  }
  for (const [f, vs] of fnViolations) {
    if (gfFn.has(f)) continue;
    for (const v of vs)
      errors.push(
        `${f}: function ${v.name} is missing REVOKE EXECUTE from ${v.missing.join(" and ")} (revoke from both public and anon in the same file).`,
      );
  }
  const jwtSet = new Set(appRoleReads);
  for (const f of gfJwt)
    if (!jwtSet.has(f))
      errors.push(
        `Stale grandfather entry app_role_reads: ${f} no longer exists or no longer reads app_role; remove it from the list.`,
      );
  for (const f of gfFn)
    if (!fnViolations.has(f))
      errors.push(
        `Stale grandfather entry function_privileges: ${f} no longer exists or no longer offends; remove it from the list.`,
      );

  if (errors.length) {
    console.error("Migration guardrail check FAILED:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `Migration guardrails OK: ${appRoleReads.length} grandfathered app_role reads, ${fnViolations.size} grandfathered function-privilege files, no new offenders.`,
  );
}

main();
