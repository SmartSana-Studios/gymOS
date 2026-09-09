#!/usr/bin/env node
/**
 * Local DEV seed -- a realistic, hand-testable environment.
 *
 * Distinct from `e2e/fixtures/seed.ts` (Playwright globalSetup, torn down
 * after every run). This one persists so a human can click through the app.
 *
 * THE IMPORTANT DIFFERENCE FROM THE E2E FIXTURE: that script gives every
 * seeded staff account a *synthetic email* purely so Playwright could reach a
 * session through the old email-only login form -- a deliberate workaround for
 * the "no gym-staff role other than Owner can log in" gap. This script does
 * NOT do that. Staff here are provisioned exactly the way
 * `createStaffMember()` provisions them in production --
 * `createUser({ phone, password, phone_confirm: true })`, no email at all --
 * so signing in as a Coach or Receptionist genuinely exercises the phone-login
 * path rather than a fixture shortcut. If staff login works here, it works.
 *
 * Owners are created the way `createGym()` creates them (email AND phone), so
 * the email path stays testable side by side.
 *
 * Idempotent: re-running reuses accounts by phone rather than failing on
 * GoTrue's phone-uniqueness check. Safe to run repeatedly.
 *
 * Lives under apps/dashboard/scripts (not repo-root scripts/) because it needs
 * this workspace's own @supabase/supabase-js -- a root-level script cannot
 * resolve a workspace-only dependency under pnpm's isolated node_modules
 * layout (docs/decisions.md 2026-07-10 Decision 8, same reason
 * provision-super-admin.mjs lives under apps/super-admin/scripts).
 *
 * Usage:  node apps/dashboard/scripts/dev-seed.mjs
 */
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(new URL("../.env.local", import.meta.url).pathname);

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SRK) {
  throw new Error("dev-seed: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from apps/dashboard/.env.local");
}
if (!URL_.includes("127.0.0.1") && !URL_.includes("localhost")) {
  throw new Error(`dev-seed: refusing to run against a non-local Supabase (${URL_}). This script creates accounts with a shared, published password.`);
}

const PASSWORD = "DevPass!2026";
const admin = createClient(URL_, SRK, { auth: { autoRefreshToken: false, persistSession: false } });

const created = { gyms: [], staff: [], members: [] };

function die(context, error) {
  throw new Error(`dev-seed: ${context} -- ${error?.message ?? JSON.stringify(error)}`);
}

/** GoTrue stores phones without the leading "+" -- the same normalization the
 * app itself needs (services/members.ts, services/staff.ts). */
const stored = (phone) => phone.replace(/^\+/, "");

async function upsertAuthUser({ phone, email }) {
  const { data: existing } = await admin.from("users").select("id").eq("phone", stored(phone)).maybeSingle();
  if (existing) {
    const patch = { password: PASSWORD, phone_confirm: true };
    if (email) {
      patch.email = email;
      patch.email_confirm = true;
    }
    const { error } = await admin.auth.admin.updateUserById(existing.id, patch);
    if (error) die(`updateUserById(${phone})`, error);
    return existing.id;
  }
  // Staff shape when `email` is absent: exactly createStaffMember()'s call.
  const payload = email
    ? { email, phone, password: PASSWORD, email_confirm: true, phone_confirm: true }
    : { phone, password: PASSWORD, phone_confirm: true };
  const { data, error } = await admin.auth.admin.createUser(payload);
  if (error || !data?.user) die(`createUser(${phone})`, error);
  return data.user.id;
}

async function upsertMember({ gymId, userId, role, name, phone }) {
  const { data: existing } = await admin
    .from("members")
    .select("id")
    .eq("gym_id", gymId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await admin
    .from("members")
    .insert({ gym_id: gymId, user_id: userId, role, name, phone })
    .select("id")
    .single();
  if (error || !data) die(`members insert (${role} ${name})`, error);
  return data.id;
}

/** Real staff accounts default to must_change_password = true
 * (0016_owner_must_change_password.sql), which bounces first sign-in to
 * /auth/update-password. Cleared here so every seeded account signs straight
 * in -- see the note printed at the end for how to test that flow instead. */
async function clearMustChangePassword(userId) {
  const { error } = await admin.from("users").update({ must_change_password: false }).eq("id", userId);
  if (error) die("clearing must_change_password", error);
}

async function upsertGym({ name, status }) {
  const { data: existing } = await admin.from("gyms").select("id").eq("name", name).maybeSingle();
  if (existing) {
    created.gyms.push({ name, id: existing.id, status, reused: true });
    return existing.id;
  }
  const { data: tier, error: tierError } = await admin
    .from("tiers")
    .select("id")
    .order("monthly_price", { ascending: false })
    .limit(1)
    .single();
  if (tierError || !tier) die("no tier available to attach a gym to", tierError);
  const { data, error } = await admin
    .from("gyms")
    .insert({ name, tier_id: tier.id, status })
    .select("id")
    .single();
  if (error || !data) die(`gym insert (${name})`, error);
  created.gyms.push({ name, id: data.id, status, reused: false });
  return data.id;
}

async function seedStaff(gymId, gymLabel, role, name, phone, email) {
  const userId = await upsertAuthUser({ phone, email });
  const memberId = await upsertMember({ gymId, userId, role, name, phone });
  await clearMustChangePassword(userId);
  created.staff.push({ gym: gymLabel, role, name, phone, email: email ?? null, memberId });
  return { userId, memberId };
}

async function seedPlan(gymId, name) {
  const { data: existing } = await admin.from("plans").select("id").eq("gym_id", gymId).eq("name", name).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await admin
    .from("plans")
    .insert({
      gym_id: gymId,
      name,
      plan_type: "monthly",
      price: 15000,
      currency: "XAF",
      billing_interval: "monthly",
      duration_days: 30,
    })
    .select("id")
    .single();
  if (error || !data) die(`plan insert (${name})`, error);
  return data.id;
}

async function seedMember(gymId, gymLabel, planId, name, phone, status = "active") {
  const userId = await upsertAuthUser({ phone });
  const memberId = await upsertMember({ gymId, userId, role: "member", name, phone });
  const { data: existingSub } = await admin.from("subscriptions").select("id").eq("member_id", memberId).maybeSingle();
  if (!existingSub) {
    const today = new Date().toISOString().slice(0, 10);
    const expiry = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const { error } = await admin
      .from("subscriptions")
      .insert({ gym_id: gymId, member_id: memberId, plan_id: planId, status, start_date: today, expiry_date: expiry });
    if (error) die(`subscription insert (${name})`, error);
  }
  created.members.push({ gym: gymLabel, name, phone, memberId });
  return { userId, memberId };
}

async function main() {
  // ---- Gym A: the main test gym -----------------------------------------
  const gymA = await upsertGym({ name: "Iron Temple Gym", status: "active" });
  await seedStaff(gymA, "Iron Temple", "owner", "Awa Owner", "+237670000001", "owner@irontemple.test");
  await seedStaff(gymA, "Iron Temple", "supervisor", "Bruno Supervisor", "+237670000002");
  await seedStaff(gymA, "Iron Temple", "manager", "Chantal Manager", "+237670000003");
  await seedStaff(gymA, "Iron Temple", "receptionist", "Divine Receptionist", "+237670000004");
  const coachA = await seedStaff(gymA, "Iron Temple", "coach", "Eric Coach", "+237670000005");
  await seedStaff(gymA, "Iron Temple", "coach", "Flore Coach", "+237670000006");

  const planA = await seedPlan(gymA, "Monthly Standard");
  const m1 = await seedMember(gymA, "Iron Temple", planA, "Grace Member", "+237670000101");
  await seedMember(gymA, "Iron Temple", planA, "Hervé Member", "+237670000102", "expiring_soon");
  await seedMember(gymA, "Iron Temple", planA, "Ines Member", "+237670000103");

  // Give one member an assigned coach so the Coach Portal is not empty.
  const { data: existingAssignment } = await admin
    .from("coach_assignments")
    .select("id")
    .eq("member_id", m1.memberId)
    .is("ended_at", null)
    .maybeSingle();
  if (!existingAssignment) {
    const { error } = await admin
      .from("coach_assignments")
      .insert({ gym_id: gymA, member_id: m1.memberId, coach_id: coachA.memberId, started_at: new Date().toISOString() });
    if (error) die("coach_assignments insert", error);
  }

  // ---- Gym B: exists to test the cross-gym member-add fix ----------------
  // Ivan already holds a platform account here. Adding him at Iron Temple by
  // this same phone is what findOrCreateUserByPhone()'s normalization fix
  // makes work -- before it, the lookup missed and you got a confusing
  // "phone already registered" rejection instead of the account being reused.
  const gymB = await upsertGym({ name: "Downtown Fitness", status: "active" });
  await seedStaff(gymB, "Downtown", "owner", "Jules Owner", "+237670000201", "owner@downtown.test");
  const planB = await seedPlan(gymB, "Monthly Standard");
  await seedMember(gymB, "Downtown", planB, "Ivan CrossGym", "+237670000900");

  // ---- Gym C: suspended, for the Story 11.4/11.8/11.9 suspension states ---
  const gymC = await upsertGym({ name: "Paused Athletics", status: "suspended" });
  await seedStaff(gymC, "Paused (SUSPENDED)", "owner", "Koffi Owner", "+237670000301", "owner@paused.test");
  await seedStaff(gymC, "Paused (SUSPENDED)", "coach", "Lea Coach", "+237670000302");

  // ---- Report ------------------------------------------------------------
  console.log("\n=== Gyms ===");
  for (const g of created.gyms) console.log(`  ${g.name.padEnd(20)} ${g.status.padEnd(10)} ${g.reused ? "(reused)" : "(created)"}`);

  console.log("\n=== Dashboard sign-in (http://localhost:3000)  password: " + PASSWORD + " ===");
  console.log("  " + "GYM".padEnd(22) + "ROLE".padEnd(14) + "SIGN IN WITH".padEnd(24) + "HAS EMAIL?");
  for (const s of created.staff) {
    const identifier = s.email ?? s.phone;
    console.log("  " + s.gym.padEnd(22) + s.role.padEnd(14) + identifier.padEnd(24) + (s.email ? "yes" : "NO -- phone only"));
  }

  console.log("\n=== Members (mobile app / member records) ===");
  for (const m of created.members) console.log(`  ${m.gym.padEnd(22)} ${m.name.padEnd(18)} ${m.phone}`);

  console.log(`
=== What to try ===
1. STAFF LOGIN FIX -- sign in at localhost:3000 as +237670000005 (Eric Coach).
   That account has NO email at all. Before the fix there was nothing you could
   type that worked. Try +237 670 000 005 with spaces too; and the Owner's
   owner@irontemple.test still works, so both paths are live.
2. CROSS-GYM MEMBER ADD -- sign in as Iron Temple's Manager (+237670000003),
   add a member with phone +237670000900 (Ivan, already registered at Downtown
   Fitness). It should reuse his account instead of rejecting it as already
   registered.
3. SUSPENDED GYM -- sign in as owner@paused.test or coach +237670000302 to see
   the neutral suspension state (Stories 11.4 / 11.8 / 11.9).

Forced password change: every seeded account has must_change_password cleared.
To exercise that flow, flip one back:
  psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \\
    -c "update users set must_change_password = true where phone = '237670000005';"
`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
