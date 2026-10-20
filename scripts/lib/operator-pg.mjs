// Shared connection + prompt helpers for the operator-run Super Admin scripts (Story 22.6).
// Same connection pattern as scripts/prod-apply.mjs: host/port/user/db from env, password from a
// file, never printed. Set PROD_SSL=0 to point it at the local Supabase DB (scripts/super-admin-aal2.test.sh).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const req = createRequire(import.meta.url);

function loadPg() {
  // PG_MODULE_DIR (explicit) -> scripts/operator/node_modules (one-time: npm ci --prefix scripts/operator) -> any resolvable "pg".
  const here = dirname(fileURLToPath(import.meta.url));
  const tries = [process.env.PG_MODULE_DIR && join(process.env.PG_MODULE_DIR, "pg"), join(here, "..", "operator", "node_modules", "pg"), "pg"].filter(Boolean);
  for (const t of tries) { try { return req(t); } catch { /* next */ } }
  console.error("pg module not found. run `npm ci --prefix scripts/operator` once (or set PG_MODULE_DIR=<dir>/node_modules).");
  process.exit(2);
}

export function makeClient() {
  const { Client } = loadPg();
  const password = readFileSync(process.env.PROD_PASSWORD_FILE ?? join(homedir(), ".supabase-db-password"), "utf8").trim();
  return new Client({
    host: process.env.PROD_HOST ?? "aws-0-eu-west-1.pooler.supabase.com",
    port: Number(process.env.PROD_PORT ?? 5432),
    user: process.env.PROD_USER ?? "postgres.vfxezibagiznrirdwkwh",
    database: process.env.PROD_DB ?? "postgres",
    password,
    ssl: process.env.PROD_SSL === "0" ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
}

/** Parses `--flag`, `--key value` and positionals. */
export function parseArgs(argv, valueFlags) {
  const out = { flags: new Set(), values: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valueFlags.includes(a)) out.values[a] = argv[++i];
    else if (a.startsWith("--")) out.flags.add(a);
    else out.positional.push(a);
  }
  return out;
}

/** Asks the operator to type `phrase` exactly; resolves true only on an exact match of the first line. */
export async function confirmTyped(phrase) {
  process.stdout.write(`Type "${phrase}" to continue: `);
  let buf = "";
  for await (const chunk of process.stdin) {
    buf += chunk;
    if (buf.includes("\n")) break;
  }
  process.stdin.pause();
  const answer = buf.split("\n")[0].trim();
  console.log("");
  return answer === phrase;
}

export function operatorName(values) {
  const name = (values["--operator"] ?? "").trim();
  return /^[A-Za-z0-9._][A-Za-z0-9._ -]{0,63}$/.test(name) ? name : null;
}
