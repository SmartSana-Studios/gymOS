// Epic 18 local QA seed. LOCAL Supabase only (127.0.0.1:54321). Idempotent: wipes + recreates the QA gym.
// Usage: node scripts/epic18-qa/seed.mjs
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "apps/dashboard/package.json"));
const { createClient } = require("@supabase/supabase-js");

const env = Object.fromEntries(
  readFileSync(path.join(root, "apps/dashboard/.env.local"), "utf8").split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const URL = "http://127.0.0.1:54321";
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1")) throw new Error("dashboard .env.local is not pointed at local Supabase");
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PW = "Epic18Pass!";
const FEE = 5000;
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

execSync(`docker exec -i supabase_db_gym_os psql -U postgres -v ON_ERROR_STOP=1 -q < ${path.join(here, "reset.sql")}`, { stdio: "inherit", shell: "/bin/bash" });

const tier = must(await admin.from("tiers").select("id").eq("name", "Grind").single(), "tier");
const gym = must(await admin.from("gyms").insert({ name: "Epic18 QA Gym", tier_id: tier.id, status: "active", default_language: "en" }).select("id").single(), "gym");
const monthly = must(await admin.from("plans").insert({ gym_id: gym.id, name: "Monthly Standard", plan_type: "class_only", price: 15000, billing_interval: "monthly", duration_days: 30 }).select("id").single(), "plan");

async function user(phone, email) {
  const r = await admin.auth.admin.createUser({ phone, email, password: PW, phone_confirm: true, email_confirm: !!email });
  if (r.error) throw new Error(`createUser ${phone}: ${r.error.message}`);
  must(await admin.from("users").update({ must_change_password: false }).eq("id", r.data.user.id), "mcp");
  return r.data.user.id;
}
async function staff(role, n) {
  const email = `${role}@epic18qa.test`, phone = `23767180000${n}`;
  const uid = await user(phone, email);
  const m = must(await admin.from("members").insert({ gym_id: gym.id, user_id: uid, role, name: `QA ${role[0].toUpperCase()}${role.slice(1)}`, phone }).select("id").single(), role);
  return { email, memberId: m.id };
}
const owner = await staff("owner", 1);
const sup = await staff("supervisor", 2);
const mgr = await staff("manager", 3);
const rec = await staff("receptionist", 4);
const coach = await staff("coach", 5);

async function signIn(email) {
  const c = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await c.auth.signInWithPassword({ email, password: PW }), `signIn ${email}`);
  return c;
}
const ownerC = await signIn(owner.email), mgrC = await signIn(mgr.email), recC = await signIn(rec.email);

async function member(name, phone) {
  const uid = await user(phone);
  return must(await admin.from("members").insert({ gym_id: gym.id, user_id: uid, role: "member", name, phone }).select("id").single(), name).id;
}
const today = new Date(), iso = (d) => d.toISOString().slice(0, 10);
const plus = (n) => iso(new Date(today.getTime() + n * 86400000));
async function sub(memberId) {
  must(await admin.from("subscriptions").insert({ gym_id: gym.id, member_id: memberId, plan_id: monthly.id, status: "active", start_date: iso(today), expiry_date: plus(30) }), "sub");
}

// 1. LEGACY member: created while fee is 0 -> settled from creation, never charged.
const legacy = await member("Legacy Lou", "237671800101");
await sub(legacy);

// 2. Turn the fee on (owner, real audited RPC).
must(await ownerC.rpc("set_registration_fee", { p_amount: FEE }), "set_registration_fee");

// 3. Members created AFTER the fee is on start as "awaiting".
const alice = await member("Awaiting Alice", "237671800201");   // test: collect cash
const bruno = await member("Awaiting Bruno", "237671800202");   // test: waive (manager)
const chloe = await member("Awaiting Chloe", "237671800203");   // test: receptionist cannot waive; assign-plan blocked
const dan = await member("Awaiting Dan", "237671800204");       // test: Tara collection (needs sandbox creds)
const mobile = await member("Awaiting Mobile", "237699000001"); // test: member app (OTP 123456)
const pierre = await member("Paid Pierre", "237671800301");     // fee paid, no plan -> void test
const paula = await member("Paid Paula", "237671800302");       // fee paid, no plan -> assign first plan test
const walter = await member("Waived Walter", "237671800303");   // waived
const sam = await member("Active Sam", "237671800304");         // fee paid + active plan -> void blocked, refund blocked

const rpc = async (c, fn, args) => must(await c.rpc(fn, args), fn);
await rpc(recC, "record_registration_fee", { p_member_id: pierre, p_method: "cash", p_reason: "QA seed receipt" });
await rpc(mgrC, "record_registration_fee", { p_member_id: paula, p_method: "bank_transfer", p_reason: "QA seed transfer" });
await rpc(mgrC, "waive_registration_fee", { p_member_id: walter, p_reason: "Founding member - QA seed" });
await rpc(ownerC, "record_registration_fee", { p_member_id: sam, p_method: "cash", p_reason: "QA seed receipt" });
await sub(sam);

console.log(`\nEpic18 QA Gym ready (id ${gym.id}), fee ${FEE} XAF, password for every account: ${PW}`);
