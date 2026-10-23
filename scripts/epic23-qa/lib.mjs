// Shared helpers for the Epic 23 QA scripts. LOCAL Supabase only (the Epic 19 lib refuses anything else).
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admin, psql, signIn, must, PW } from "../epic19-qa/lib.mjs";

export { admin, psql, signIn, must, PW };
export const here = path.dirname(fileURLToPath(import.meta.url));
export const SUPPORT_PW = "Epic23Support!";           // support passwords need 12+ characters
export const ADMIN_EMAIL = "admin@epic23qa.test";
const STATE = path.join(here, ".state.json");

export function resetDb() {
  execFileSync("docker", ["exec", "-i", "supabase_db_gym_os", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
    { input: readFileSync(path.join(here, "reset.sql")), stdio: ["pipe", "inherit", "inherit"] });
}

export const readState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { secrets: {} });
export const writeState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret, like any authenticator app. */
export function totp(secret, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, "0");
}

/** Waits for the next 30 s window when the current code is about to roll (a code just used cannot be reused either). */
export async function freshTotp(secret) {
  const left = 30000 - (Date.now() % 30000);
  if (left < 3000) await new Promise((r) => setTimeout(r, left + 200));
  return totp(secret);
}

/** Password sign-in, TOTP enrolment, verification: returns an aal2 client and the secret. */
export async function enrollAndStepUp(client, friendlyName) {
  const enr = must(await client.auth.mfa.enroll({ factorType: "totp", friendlyName }), "mfa enroll");
  must(await client.auth.mfa.challengeAndVerify({ factorId: enr.id, code: await freshTotp(enr.totp.secret) }), "mfa verify");
  return enr.totp.secret;
}

/** Signs in as the QA Super Admin and passes the second factor with the stored secret. */
export async function adminAal2() {
  const st = readState();
  const secret = st.secrets?.[ADMIN_EMAIL];
  if (!secret) throw new Error("run seed.mjs first");
  const c = await signIn(ADMIN_EMAIL);
  const { data: f } = await c.auth.mfa.listFactors();
  must(await c.auth.mfa.challengeAndVerify({ factorId: f.totp[0].id, code: await freshTotp(secret) }), "admin aal2");
  return c;
}

/** Password sign-in with an explicit password (support accounts use SUPPORT_PW, not the shared QA password). */
export async function signInPw(email, password) {
  const { createRequire } = await import("node:module");
  const { root, ANON_KEY } = await import("../epic19-qa/lib.mjs");
  const require = createRequire(path.join(root, "apps/dashboard/package.json"));
  const { createClient } = require("@supabase/supabase-js");
  const c = createClient("http://127.0.0.1:54321", ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await c.auth.signInWithPassword({ email, password }), `signIn ${email}`);
  return c;
}
