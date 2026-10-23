// Epic 23 (GymOS support) local QA seed. LOCAL Supabase only. Idempotent: wipes + recreates the QA world.
//   node scripts/epic23-qa/seed.mjs
// Every state is reached through the REAL functions (create account, invite, password, TOTP, activate, assign, confirm,
// owner switch), not by writing rows, except the time-based ones (idle, recertification due, lock) which need the clock moved.
import { randomBytes, randomUUID } from "node:crypto";
import { admin, psql, signIn, signInPw, must, resetDb, writeState, enrollAndStepUp, adminAal2, PW, SUPPORT_PW, ADMIN_EMAIL } from "./lib.mjs";

resetDb();
const secrets = {};

const tier = must(await admin.from("tiers").select("id").eq("name", "Grind").single(), "tier");
async function user({ phone, email, password = PW }) {
  const r = await admin.auth.admin.createUser({ phone, email, password, phone_confirm: !!phone, email_confirm: !!email });
  if (r.error) throw new Error(`createUser ${phone ?? email}: ${r.error.message}`);
  must(await admin.from("users").update({ must_change_password: false }).eq("id", r.data.user.id), "must_change_password");
  return r.data.user.id;
}

// ---- Super Admin with a verified authenticator, then the aal2 flag ON (support creation refuses while it is off) ----
const adminId = await user({ email: ADMIN_EMAIL });
psql(`update public.users set is_super_admin = true, display_name = 'QA Super Admin' where id = '${adminId}'`);
{
  const c = await signIn(ADMIN_EMAIL);
  secrets[ADMIN_EMAIL] = await enrollAndStepUp(c, "QA authenticator");
}
writeState({ secrets });
psql(`update private.platform_flags set enabled = true where flag = 'super_admin_aal2'`);

// ---- Gyms: A (switch ON), B (switch OFF), Suspended ----
const gyms = {};
async function gym(key, name, status = "active") {
  const g = must(await admin.from("gyms").insert({ name, tier_id: tier.id, status, default_language: "en" }).select("id").single(), name);
  gyms[key] = g.id;
  must(await admin.from("plans").insert({ gym_id: g.id, name: "Monthly Standard", plan_type: "class_only", price: 15000, currency: "XAF", billing_interval: "monthly", duration_days: 30 }), "plan");
  return g.id;
}
const staff = {};
let n = 0;
async function staffFor(key, roles) {
  for (const role of roles) {
    n += 1;
    const phone = `2376730000${String(n).padStart(2, "0")}`, email = `${role}${key}@epic23qa.test`;
    const uid = await user({ phone, email });
    must(await admin.from("members").insert({ gym_id: gyms[key], user_id: uid, role, name: `QA ${role[0].toUpperCase()}${role.slice(1)} ${key}`, phone: `+${phone}` }), `${role} ${key}`);
    staff[email] = uid;
  }
}
await gym("A", "Epic23 QA Gym A");
await gym("B", "Epic23 QA Gym B");
await gym("S", "Epic23 QA Gym Suspended", "suspended");  // inserted suspended: a later UPDATE of gyms.status is silently reverted
await staffFor("A", ["owner", "supervisor", "manager", "receptionist", "coach"]);
await staffFor("B", ["owner"]);
await staffFor("S", ["owner"]);
// A few members in A so the allow-list (members, payments, refunds) has something to act on.
for (let i = 1; i <= 3; i++) {
  const phone = `2376731000${String(i).padStart(2, "0")}`;
  const uid = await user({ phone });
  must(await admin.from("members").insert({ gym_id: gyms.A, user_id: uid, role: "member", name: `QA Member ${i}`, phone: `+${phone}` }), "member");
}

// Owner B turns the switch OFF through the real owner RPC (A stays ON: the default for new gyms).
{
  const ob = await signIn("ownerB@epic23qa.test");
  must(await ob.rpc("set_allow_gymos_support", { p_gym_id: gyms.B, p_on: false }), "switch B off");
}

// ---- Support accounts through the real flow ----
const sa = await adminAal2();
const accounts = {};
async function createAccount(handle, displayName) {
  const email = `qa23-${handle}@gymosapps.com`;
  const r = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (r.error) throw new Error(`createUser ${email}: ${r.error.message}`);
  must(await sa.rpc("create_support_account", { p_user_id: r.data.user.id, p_display_name: displayName, p_email: email }), `create ${handle}`);
  accounts[handle] = { id: r.data.user.id, email };
  return accounts[handle];
}
async function activate(a) {
  const token = `${randomUUID()}.${randomBytes(32).toString("hex")}`;
  must(await admin.rpc("issue_support_invite", { p_user_id: a.id, p_token: token, p_actor: adminId }), "issue invite");
  must(await admin.auth.admin.updateUserById(a.id, { password: SUPPORT_PW }), "set password");
  must(await admin.rpc("support_invite_mark_password_set", { p_token: token }), "password set");
  const c = await signInPw(a.email, SUPPORT_PW);
  secrets[a.email] = await enrollAndStepUp(c, "GymOS support");
  must(await admin.rpc("activate_support_account", { p_token: token }), "activate");
}
const assign = async (a, gymKey, confirm) => {
  const r = must(await sa.rpc("assign_support", { p_user_id: a.id, p_gym_id: gyms[gymKey], p_reason: "QA seed" }), `assign ${a.email}`);
  const row = Array.isArray(r) ? r[0] : r;
  if (confirm) must(await sa.rpc("confirm_support_assignment", { p_assignment_id: row.assignment_id, p_reason: "QA seed" }), "confirm");
  return row;
};

// qa23-active: working support person, active in Gym A (switch on), pending in Gym B (switch off keeps it pending).
const active = await createAccount("active", "Ada Support");
await activate(active);
await assign(active, "A", true);
await assign(active, "B", false);

// qa23-fresh: created, never invited: click through Send invite -> Inbucket mail -> the invite page.
await createAccount("fresh", "Fred Fresh");

// qa23-second: activated, active in A as well, so Gym A has two support people but its owner still sees ONE row.
const second = await createAccount("second", "Sam Second");
await activate(second);
await assign(second, "A", true);

// qa23-idle: activated and active in A; last activity moved back 40 days. `lifecycle.mjs sweep` disables it (30 d).
const idle = await createAccount("idle", "Iris Idle");
await activate(idle);
await assign(idle, "A", true);
psql(`insert into private.support_last_active (user_id, last_active_at) values ('${idle.id}', now() - interval '40 days')
      on conflict (user_id) do update set last_active_at = excluded.last_active_at`);
psql(`begin; set local session_replication_role = replica; update support_assignments set activated_at = now() - interval '40 days' where support_user_id = '${idle.id}' and state = 'active'; commit;`);

// qa23-recert: recertification due yesterday -> denied by the live gate until the Super Admin recertifies.
const recert = await createAccount("recert", "Rae Recert");
await activate(recert);
await assign(recert, "A", true);
psql(`update private.support_accounts set recertify_due_at = now() - interval '1 day' where user_id = '${recert.id}'`);

// qa23-reset: activated, active in A; start the factor reset from the Super Admin UI (README R-section).
const reset = await createAccount("reset", "Remy Reset");
await activate(reset);
await assign(reset, "A", true);

// qa23-locked: velocity-locked account: appears in the Locks panel with a reason.
const locked = await createAccount("locked", "Lou Locked");
await activate(locked);
await assign(locked, "A", true);
psql(`select private.support_lock_account('${locked.id}', 'velocity')`);

writeState({ secrets, gyms, adminId, accounts, seededAt: new Date().toISOString() });

console.log("\nEpic 23 QA world ready.\n");
console.log("Super Admin app  (pnpm dev in apps/super-admin, :3001 or what next prints)");
console.log(`  ${ADMIN_EMAIL} / ${PW}   + authenticator code: node scripts/epic23-qa/totp.mjs admin\n`);
console.log("Dashboard (pnpm dev in apps/dashboard, :3000), password", PW);
console.log("  Gym A (switch ON):  ownerA@ supervisorA@ managerA@ receptionistA@ coachA@ epic23qa.test");
console.log("  Gym B (switch OFF): ownerB@epic23qa.test     Suspended gym: ownerS@epic23qa.test\n");
console.log("Support people (password", SUPPORT_PW + ", @gymosapps.com; code: node scripts/epic23-qa/totp.mjs qa23-)");
for (const [h, s] of [
  ["active", "active in A, PENDING in B"], ["second", "active in A"], ["idle", "active in A, idle 40 d (run lifecycle.mjs sweep)"],
  ["recert", "recertification overdue"], ["reset", "ready for a factor reset"], ["locked", "velocity-locked"], ["fresh", "no invite yet"],
]) console.log(`  qa23-${h}@gymosapps.com`.padEnd(34), s);
