// Shared helpers + the world builder for the Epic 19 QA scripts. LOCAL Supabase only.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SUPABASE_URL, PW, SESSION_PRICE, TARA, OTHER_TARA, PHONE_A, PHONE_B } from "./constants.mjs";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "apps/dashboard/package.json"));
const { createClient } = require("@supabase/supabase-js");

const env = Object.fromEntries(
  readFileSync(path.join(root, "apps/dashboard/.env.local"), "utf8").split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1")) throw new Error("dashboard .env.local is not pointed at local Supabase");
export const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
export { PW };

export const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

/** Run SQL as the postgres superuser in the local DB container; returns trimmed stdout (-At). */
export function psql(sql) {
  return execFileSync("docker", ["exec", "-i", "supabase_db_gym_os", "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql }).toString().trim();
}

export async function signIn(id) {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const creds = id.includes("@") ? { email: id, password: PW } : { phone: id, password: PW };
  must(await c.auth.signInWithPassword(creds), `signIn ${id}`);
  return c;
}

async function createUser({ phone, email }) {
  const r = await admin.auth.admin.createUser({ phone, email, password: PW, phone_confirm: !!phone, email_confirm: !!email });
  if (r.error) throw new Error(`createUser ${phone ?? email}: ${r.error.message}`);
  must(await admin.from("users").update({ must_change_password: false }).eq("id", r.data.user.id), "must_change_password");
  return r.data.user.id;
}

const iso = (d) => d.toISOString().slice(0, 10);
export const daysFromNow = (n) => iso(new Date(Date.now() + n * 86400000));

/**
 * Wipes and recreates "Epic19 QA Gym": every role, the plans, a connected (fake) Tara account, a coach
 * class, and a second tenant for the cross-gym checks. Returns the ids and signed-in staff clients.
 * Charging is on because 0115 turns it on for gyms created after it; callers assert that.
 */
export async function buildWorld() {
  execFileSync("docker", ["exec", "-i", "supabase_db_gym_os", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
    { input: readFileSync(path.join(here, "reset.sql")), stdio: ["pipe", "inherit", "inherit"] });

  const tier = must(await admin.from("tiers").select("id").eq("name", "Grind").single(), "tier");
  const gym = must(await admin.from("gyms").insert({ name: "Epic19 QA Gym", tier_id: tier.id, status: "active", default_language: "en" }).select("id, gym_token, charge_guests_per_session").single(), "gym");
  const otherGym = must(await admin.from("gyms").insert({ name: "Epic19 QA Other Gym", tier_id: tier.id, status: "active", default_language: "en" }).select("id").single(), "other gym");

  const plan = async (gymId, row) => must(await admin.from("plans").insert({ gym_id: gymId, currency: "XAF", ...row }).select("id").single(), `plan ${row.name}`).id;
  const plans = {
    session: await plan(gym.id, { name: "Pay per session", plan_type: "pay_per_session", price: SESSION_PRICE, billing_interval: "monthly" }),
    exempt: await plan(gym.id, { name: "Free-entry session plan", plan_type: "pay_per_session", price: 0, billing_interval: "monthly" }),
    monthly: await plan(gym.id, { name: "Monthly Standard", plan_type: "class_only", price: 15000, billing_interval: "monthly", duration_days: 30 }),
  };
  const otherPlan = await plan(otherGym.id, { name: "Other gym session", plan_type: "pay_per_session", price: 3000, billing_interval: "monthly" });

  const staff = {};
  let n = 0;
  for (const role of ["owner", "supervisor", "manager", "receptionist", "coach"]) {
    n += 1;
    const email = `${role}@epic19qa.test`, phone = `23767190000${n}`;
    const uid = await createUser({ phone, email });
    const m = must(await admin.from("members").insert({ gym_id: gym.id, user_id: uid, role, name: `QA ${role[0].toUpperCase()}${role.slice(1)}`, phone: `+${phone}` }).select("id").single(), role);
    staff[role] = { email, memberId: m.id, userId: uid };
  }
  const otherOwnerUid = await createUser({ phone: "237671900099", email: "other-owner@epic19qa.test" });
  must(await admin.from("members").insert({ gym_id: otherGym.id, user_id: otherOwnerUid, role: "owner", name: "Other Owner", phone: "+237671900099" }), "other owner");

  const clients = {};
  for (const role of Object.keys(staff)) clients[role] = await signIn(staff[role].email);
  const otherOwner = await signIn("other-owner@epic19qa.test");

  // Connect the fake Tara account through the real owner RPC (Vault-encrypted, like prod).
  must(await clients.owner.rpc("connect_gym_payment_credentials", { p_provider_key: "taramoney", p_api_key: TARA.apiKey, p_business_id: TARA.businessId, p_webhook_secret: TARA.webhookSecret }), "connect tara");
  must(await otherOwner.rpc("connect_gym_payment_credentials", { p_provider_key: "taramoney", p_api_key: OTHER_TARA.apiKey, p_business_id: OTHER_TARA.businessId, p_webhook_secret: OTHER_TARA.webhookSecret }), "connect other tara");

  let memberSeq = 100;
  /** A member with a password (phone sign-in) and, optionally, a subscription. */
  async function member(name, { plan: planKey = "session", phone, sub = "active", gymId = gym.id, planId } = {}) {
    memberSeq += 1;
    const ph = phone ?? `23767190${String(memberSeq).padStart(4, "0")}`;
    const uid = await createUser({ phone: ph });
    const m = must(await admin.from("members").insert({ gym_id: gymId, user_id: uid, role: "member", name, phone: `+${ph}` }).select("id").single(), name);
    if (sub) {
      must(await admin.from("subscriptions").insert({
        gym_id: gymId, member_id: m.id, plan_id: planId ?? plans[planKey], status: sub,
        start_date: daysFromNow(sub === "expired" ? -60 : 0),
        expiry_date: planKey === "monthly" ? daysFromNow(sub === "expired" ? -30 : 30) : null,
      }), `sub ${name}`);
    }
    return { id: m.id, userId: uid, phone: ph, name };
  }

  // A one-off class today (coach = QA Coach) for the class-attendance path.
  const klass = must(await admin.from("classes").insert({
    gym_id: gym.id, name: "QA Boxing", coach_id: staff.coach.memberId, capacity: 20,
    schedule_type: "one_off", one_off_session_at: new Date(Date.now() + 3600e3).toISOString(),
  }).select("id").single(), "class");
  const classSession = must(await admin.from("class_sessions").insert({ gym_id: gym.id, class_id: klass.id, scheduled_at: new Date(Date.now() + 3600e3).toISOString() }).select("id").single(), "class session");

  return { gym, otherGym, plans, otherPlan, staff, clients, otherOwner, member, classSessionId: classSession.id, memberPhones: { PHONE_A, PHONE_B } };
}
