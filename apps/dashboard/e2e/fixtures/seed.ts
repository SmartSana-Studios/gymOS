import { writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from "../helpers/env";
import { FIXTURE_PASSWORD, FIXTURES_FILE_PATH, type FixtureData, type MemberFixture, type RoleFixture } from "./types";

// Story 13.5: this repo's first E2E fixture infrastructure -- no
// `supabase/seed.sql` exists today. Runs once as Playwright's `globalSetup`
// (chosen over a standalone pre-`playwright test` script: globalSetup gets
// the same `.env.local` `process.loadEnvFile()` playwright.config.ts
// already does at module-load time, one fewer moving piece than wiring a
// separate npm script + its own env loading). Every fixture row is created
// through the real code path it mirrors (assign_coach(), book_class_session(),
// createGym()'s own insertGym/insertOwnerMember shape) per this project's
// established fixture-discipline convention (docs/decisions.md, every
// pgTAP suite) -- the two deliberate exceptions are staff/member auth-user
// provisioning (Subtask 3.1 explicitly bypasses the real WhatsApp
// send/`createStaffMember()` service call) and this suite's own fixture-only
// addition of a synthetic `email` on every staff account (see the
// "why every fixture account gets an email" comment below).

const GYM_NAME = `E2E Fixture Gym ${Date.now()}`;
const CLASS_CAPACITY = 3;

function serviceRoleClient(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * A plain anon-key client, signed in as one fixture account. Every
 * `SECURITY DEFINER` RPC this suite calls (assign_coach, book_class_session,
 * connect_gym_payment_credentials) reads `auth.jwt() ->> 'app_role'` --
 * service-role bypass has no such claim, so these calls must run under a
 * real, signed-in session, exactly like the production callers they mirror.
 */
async function signInAs(email: string): Promise<SupabaseClient> {
  const client = createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: FIXTURE_PASSWORD });
  if (error) {
    throw new Error(`e2e seed: signInAs(${email}) failed -- ${error.message}`);
  }
  return client;
}

/**
 * Creates one staff/owner auth user + members row. Real staff accounts
 * (Story 9.1+) are phone-only, no `email` -- confirmed against
 * deferred-work.md's own HIGH SEVERITY entry, "no gym-staff role other than
 * Owner can log into the dashboard at all," since the dashboard's one login
 * form (`login-form.tsx`) is `signInWithPassword({ email, password })`
 * only. That gap is real, pre-existing, already flagged for the
 * user/product, and explicitly out of this story's own scope to fix
 * (Project Structure Notes: no `apps/dashboard` component-code changes
 * beyond the listed new e2e files). This fixture script gives every seeded
 * staff account a synthetic, fixture-only email purely so Playwright's real
 * browser can obtain a session through the existing, unmodified login form
 * -- it does not touch or bypass any of the actual code under test
 * (AddStaffModal/StaffPageClient's role-gating, create_staff_member()'s own
 * RPC ceiling). Every seeded staff account, Owner included, gets this
 * synthetic email -- createStaffFixture() applies it uniformly regardless
 * of role.
 */
async function createStaffFixture(
  admin: SupabaseClient,
  gymId: string,
  role: "owner" | "supervisor" | "manager" | "coach",
  seq: number,
): Promise<RoleFixture> {
  const email = `e2e-${role}-${Date.now()}-${seq}@fixture.gymos.test`;
  const phone = `+2376800000${seq}`;
  const name = `E2E ${role[0]!.toUpperCase()}${role.slice(1)}`;

  // Reuse an existing auth user for this fixture phone if one is already
  // present (matches createMemberFixture()'s own resilience below) -- a
  // prior run whose globalTeardown failed or was interrupted can leave this
  // exact phone number registered, and a plain createUser() call would
  // otherwise fail outright and abort the entire suite on every subsequent
  // run until someone manually cleans up the stale auth user.
  const { data: existing } = await admin.from("users").select("id").eq("phone", phone.replace(/^\+/, "")).maybeSingle();
  let userId: string;
  if (existing) {
    userId = existing.id as string;
    await admin.auth.admin.updateUserById(userId, { email, password: FIXTURE_PASSWORD, email_confirm: true });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      phone,
      password: FIXTURE_PASSWORD,
      email_confirm: true,
      phone_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`e2e seed: createUser(${role}) failed -- ${error?.message}`);
    }
    userId = data.user.id;
  }

  const { data: memberRow, error: memberError } = await admin
    .from("members")
    .insert({ gym_id: gymId, user_id: userId, role, name, phone })
    .select("id")
    .single();
  if (memberError || !memberRow) {
    throw new Error(`e2e seed: members insert (${role}) failed -- ${memberError?.message}`);
  }

  // Subtask 3.2: users.must_change_password defaults true
  // (0016_owner_must_change_password.sql) -- every login spec would
  // otherwise get redirected to /auth/update-password on first sign-in.
  const { error: mcpError } = await admin
    .from("users")
    .update({ must_change_password: false })
    .eq("id", userId);
  if (mcpError) {
    throw new Error(`e2e seed: clearing must_change_password (${role}) failed -- ${mcpError.message}`);
  }

  return { memberId: memberRow.id as string, userId, email, phone, name };
}

async function createMemberFixture(
  admin: SupabaseClient,
  gymId: string,
  planId: string,
  phone: string,
  seq: number,
  subscriptionStatus: "active" | "expiring_soon" = "active",
): Promise<MemberFixture> {
  const name = `E2E Member ${seq}`;
  let userId: string;

  const { data: existing } = await admin.from("users").select("id").eq("phone", phone.replace(/^\+/, "")).maybeSingle();
  if (existing) {
    userId = existing.id as string;
    // Ensure a known password is set even if a prior partial run left this
    // phone's auth user behind (test_otp members reuse a fixed phone).
    await admin.auth.admin.updateUserById(userId, { password: FIXTURE_PASSWORD });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      phone,
      password: FIXTURE_PASSWORD,
      phone_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`e2e seed: createUser(member ${seq}) failed -- ${error?.message}`);
    }
    userId = data.user.id;
  }

  const { data: memberRow, error: memberError } = await admin
    .from("members")
    .insert({ gym_id: gymId, user_id: userId, role: "member", name, phone })
    .select("id")
    .single();
  if (memberError || !memberRow) {
    throw new Error(`e2e seed: members insert (member ${seq}) failed -- ${memberError?.message}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { error: subError } = await admin
    .from("subscriptions")
    .insert({ gym_id: gymId, member_id: memberRow.id, plan_id: planId, status: subscriptionStatus, start_date: today, expiry_date: expiry });
  if (subError) {
    throw new Error(`e2e seed: subscription insert (member ${seq}) failed -- ${subError.message}`);
  }

  return { memberId: memberRow.id as string, userId, phone, name };
}

export default async function globalSetup(): Promise<void> {
  const admin = serviceRoleClient();

  // 1. Gym (mirrors createGym()'s own insertGym shape -- a real seeded
  // tier, not a hand-picked id, in case seed tier ids ever change).
  const { data: tierRow, error: tierError } = await admin.from("tiers").select("id").order("created_at").limit(1).single();
  if (tierError || !tierRow) {
    throw new Error(`e2e seed: no tier found to seed the fixture gym -- ${tierError?.message}`);
  }
  const { data: gymRow, error: gymError } = await admin
    .from("gyms")
    .insert({ name: GYM_NAME, tier_id: tierRow.id, status: "active" })
    .select("id")
    .single();
  if (gymError || !gymRow) {
    throw new Error(`e2e seed: gym insert failed -- ${gymError?.message}`);
  }
  const gymId = gymRow.id as string;

  // 2. Staff: Owner, Supervisor, Manager, Coach.
  const owner = await createStaffFixture(admin, gymId, "owner", 1);
  const supervisor = await createStaffFixture(admin, gymId, "supervisor", 2);
  const manager = await createStaffFixture(admin, gymId, "manager", 3);
  const coach = await createStaffFixture(admin, gymId, "coach", 4);
  const secondCoach = await createStaffFixture(admin, gymId, "coach", 5);

  // 3. One plan, needed by every member's subscription (Flow 4's booking
  // eligibility check, Flow 2's renewal pricing).
  const { data: planRow, error: planError } = await admin
    .from("plans")
    .insert({
      gym_id: gymId,
      name: "E2E Monthly",
      plan_type: "monthly",
      price: 15000,
      currency: "XAF",
      billing_interval: "monthly",
      duration_days: 30,
    })
    .select("id")
    .single();
  if (planError || !planRow) {
    throw new Error(`e2e seed: plan insert failed -- ${planError?.message}`);
  }
  const planId = planRow.id as string;

  // 4. Primary Member -- the test_otp bypass phone (supabase/config.toml),
  // reused here for a password-based sign-in instead (this suite doesn't
  // exercise the OTP path itself, Flows 3/4 only need an authenticated
  // Member session).
  // "expiring_soon" (not "active"): SubscriptionsPageClient's own Renew
  // button only renders for a row whose status !== "active" -- Flow 2
  // (Task 5) needs it visible; book_class_session()'s eligibility check
  // (Flow 4) only rejects null/"expired", so this status satisfies both.
  const member = await createMemberFixture(admin, gymId, planId, "+237670000001", 0, "expiring_soon");

  // 5. Class capacity fixtures: 2 filler members pre-booked below (leaving
  // exactly one open slot for the payment/progress specs' sibling, Task 7's
  // own Subtask 7.1), 2 more left unbooked for Subtask 7.2's concurrent
  // race against the then-full session.
  const fillerA = await createMemberFixture(admin, gymId, planId, "+237680000101", 101);
  const fillerB = await createMemberFixture(admin, gymId, planId, "+237680000102", 102);
  const fillerC = await createMemberFixture(admin, gymId, planId, "+237680000103", 103);
  const fillerD = await createMemberFixture(admin, gymId, planId, "+237680000104", 104);

  // 6. coach_assignments, via the real assign_coach() RPC under the
  // Owner's own session (Subtask 3.4).
  const ownerClient = await signInAs(owner.email);
  const { error: assignError } = await ownerClient.rpc("assign_coach", { p_member_id: member.memberId, p_coach_id: coach.memberId });
  if (assignError) {
    throw new Error(`e2e seed: assign_coach failed -- ${assignError.message}`);
  }

  // 7. One class + one class_session, 7 days out (book_class_session()
  // rejects scheduled_at <= now()), at CLASS_CAPACITY.
  const scheduledAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: classRow, error: classError } = await admin
    .from("classes")
    .insert({
      gym_id: gymId,
      name: "E2E Fixture Class",
      coach_id: coach.memberId,
      capacity: CLASS_CAPACITY,
      schedule_type: "one_off",
      one_off_session_at: scheduledAt,
    })
    .select("id")
    .single();
  if (classError || !classRow) {
    throw new Error(`e2e seed: class insert failed -- ${classError.message}`);
  }
  const classId = classRow.id as string;

  const { data: sessionRow, error: sessionError } = await admin
    .from("class_sessions")
    .insert({ gym_id: gymId, class_id: classId, scheduled_at: scheduledAt })
    .select("id")
    .single();
  if (sessionError || !sessionRow) {
    throw new Error(`e2e seed: class_session insert failed -- ${sessionError.message}`);
  }
  const classSessionId = sessionRow.id as string;

  // Pre-fill N-1 = 2 bookings via the real book_class_session() RPC (not
  // hand-inserted class_bookings rows), leaving exactly one open slot.
  for (const filler of [fillerA, fillerB]) {
    const client = createClient(supabaseUrl(), supabaseAnonKey(), { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInError } = await client.auth.signInWithPassword({ phone: filler.phone, password: FIXTURE_PASSWORD });
    if (signInError) {
      throw new Error(`e2e seed: filler sign-in failed -- ${signInError.message}`);
    }
    const { error: bookError } = await client.rpc("book_class_session", { p_class_session_id: classSessionId });
    if (bookError) {
      throw new Error(`e2e seed: filler book_class_session failed -- ${bookError.message}`);
    }
  }

  // 8. Flow 2 (Task 5): only connect real TaraMoney gym credentials if the
  // user has supplied them out-of-band (never committed) -- see
  // docs/decisions.md's Story 13.5 entry for why an automated CI run cannot
  // safely exercise a real external payment provider by default.
  let taraMoneyGymCredentialsConnected = false;
  const liveApiKey = process.env.E2E_TARAMONEY_GYM_API_KEY;
  const liveBusinessId = process.env.E2E_TARAMONEY_GYM_BUSINESS_ID;
  const liveWebhookSecret = process.env.E2E_TARAMONEY_GYM_WEBHOOK_SECRET;
  if (liveApiKey && liveBusinessId && liveWebhookSecret) {
    // A failure here must not abort globalSetup -- that would take down
    // Flows 1/3/4 too, not just the optional Flow 2 spec this credential
    // exists for. Log and leave taraMoneyGymCredentialsConnected false
    // (payment-cutover.spec.ts already test.skip()s on that flag), the same
    // outcome as the credentials never having been supplied at all.
    const { error: connectError } = await ownerClient.rpc("connect_gym_payment_credentials", {
      p_provider_key: "taramoney",
      p_api_key: liveApiKey,
      p_business_id: liveBusinessId,
      p_webhook_secret: liveWebhookSecret,
    });
    if (connectError) {
      console.warn(`e2e seed: connect_gym_payment_credentials failed, Flow 2 will skip -- ${connectError.message}`);
    } else {
      taraMoneyGymCredentialsConnected = true;
    }
  }

  const fixtures: FixtureData = {
    gymId,
    planId,
    owner,
    supervisor,
    manager,
    coach,
    secondCoach,
    member,
    classFillerMembers: [fillerA, fillerB, fillerC, fillerD],
    classId,
    classSessionId,
    classCapacity: CLASS_CAPACITY,
    taraMoneyGymCredentialsConnected,
  };
  writeFileSync(FIXTURES_FILE_PATH, JSON.stringify(fixtures, null, 2));
}
