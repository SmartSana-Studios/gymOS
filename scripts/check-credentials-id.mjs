#!/usr/bin/env node
// Story 23.9: payments are verified under the credential row they were started with (payments.credentials_id), never under "whatever
// is active now". This scan fails when a payment initiator or a credential lookup skips credentials_id.
//
//   1. SQL (latest definition of each, across supabase/migrations in order): the payment initiators record credentials_id when they
//      insert into payments, and the reconciliation job joins gym_payment_credentials on payments.credentials_id.
//   2. Edge function (supabase/functions, non-test): every call of the credential lookups passes the credential identity
//      (p_credentials_id; the business-id lookup also the payment it is for, p_provider_ref), and the payments reads that feed them
//      select credentials_id.
//   3. No client app calls the service-only lookups at all.
// Plain Node, zero dependencies. Exit 1 with one line per violation.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export const INITIATORS = ["initiate_registration_fee_payment", "initiate_session_payment", "initiate_member_payment"];
const LOOKUPS = [
  { rpc: "get_gym_payment_credentials_for_service", needs: ["p_credentials_id"] },
  { rpc: "mark_gym_payment_credentials_needs_attention", needs: ["p_credentials_id"] },
  { rpc: "get_gym_payment_credentials_by_business_id", needs: ["p_provider_ref"] },
];

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** name -> {file, body} of the last definition across the migrations (given in order). */
export function latestDefinitions(migrations) {
  const latest = new Map();
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;
  for (const { file, text } of migrations) {
    const sql = stripSqlComments(text);
    const starts = [...sql.matchAll(re)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index : sql.length;
      latest.set(m[1].toLowerCase(), { file, body: sql.slice(m.index, end) });
    });
  }
  return latest;
}

export function scanSql(migrations) {
  const problems = [];
  const latest = latestDefinitions(migrations);
  for (const name of INITIATORS) {
    const def = latest.get(name);
    if (!def) continue;
    if (/insert\s+into\s+payments/i.test(def.body) && !/credentials_id/i.test(def.body)) {
      problems.push(`${def.file}: ${name} inserts into payments without recording credentials_id`);
    }
  }
  const rec = latest.get("run_payment_reconciliation_job");
  if (rec && /gym_payment_credentials/i.test(rec.body) && !/\.id\s*=\s*p\.credentials_id/i.test(rec.body)) {
    problems.push(`${rec.file}: run_payment_reconciliation_job does not join gym_payment_credentials on payments.credentials_id`);
  }
  return problems;
}

/** The text of the `.rpc("name", { ... })` call that starts at index i (balanced parentheses). */
function callAt(text, i) {
  let depth = 0;
  for (let j = text.indexOf("(", i); j < text.length; j++) {
    if (text[j] === "(") depth++;
    else if (text[j] === ")" && --depth === 0) return text.slice(i, j + 1);
  }
  return text.slice(i);
}

export function scanSources(files) {
  const problems = [];
  for (const { path, text } of files) {
    const inFunctions = path.startsWith("supabase/functions/") && !/\.test\.ts$/.test(path);
    for (const { rpc, needs } of LOOKUPS) {
      const re = new RegExp(`\\.rpc\\(\\s*["'\`]${rpc}["'\`]`, "g");
      for (const m of text.matchAll(re)) {
        if (!inFunctions) {
          if (!/\.test\.tsx?$/.test(path)) problems.push(`${path}: calls the service-only lookup ${rpc}`);
          continue;
        }
        const call = callAt(text, m.index);
        for (const arg of needs) {
          if (!call.includes(arg)) problems.push(`${path}: ${rpc} is called without ${arg}`);
        }
      }
    }
    if (path === "supabase/functions/payment-webhook/index.ts") {
      const reads = [...text.matchAll(/\.from\("payments"\)\s*\.select\("([^"]*)"\)/g)].map((m) => m[1]);
      for (const cols of reads) {
        if (/provider_transaction_ref|member_id/.test(cols) && !cols.includes("credentials_id")) {
          problems.push(`${path}: a payments read that feeds verification does not select credentials_id (${cols})`);
        }
      }
      if (!/credentialsId/.test(text)) problems.push(`${path}: never passes credentialsId in the routing context`);
    }
  }
  return problems;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

export function scanRepo(root = repoRoot) {
  const migDir = join(root, "supabase/migrations");
  const migrations = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(migDir, f), "utf8") }));
  const files = [...walk(join(root, "supabase/functions")), ...walk(join(root, "apps")), ...walk(join(root, "packages"))].map((p) => ({
    path: relative(root, p).split("\\").join("/"),
    text: readFileSync(p, "utf8"),
  }));
  return [...scanSql(migrations), ...scanSources(files)];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = scanRepo();
  if (problems.length > 0) {
    console.error("credentials_id scan FAILED:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("credentials_id scan OK: initiators, reconciliation and credential lookups all go through credentials_id.");
}
