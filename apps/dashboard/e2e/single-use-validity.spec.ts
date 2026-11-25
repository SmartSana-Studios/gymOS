import { createRequire } from "node:module";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loginViaUi, signInForApi, callRpc } from "./helpers/auth";
import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from "./helpers/env";
import { createPageGym, removePageGym, type PageGym } from "./helpers/landingGate";
import { FIXTURE_PASSWORD } from "./fixtures/types";

// Story 28.3 (Epic 28 closing gate, PRD 10.3 Step 2 items 2 and 5): Pay-per-session validity, Whole day or Single use, end to end.
// The pattern of class-booking-capacity.spec.ts: the money path is driven through the real RPCs by APIRequestContext (the same server boundary the
// mobile app and the desk use), the Settings section and the Guest sessions tab through the real UI. The spec makes its OWN gym, owner, receptionist,
// coach, guest, plan, class and bookings (createPageGym gives the gym, owner and a plan only) and removes them afterwards, so it never touches the
// shared fixture gym.
//
// Serial and non-idempotent: every step leaves rows the next relies on, so there is no retry (a retry would rerun the group on used rows, and a
// first-pass failure would turn into a skipped, green result).

const DB_URL = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

type Pg = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> };

async function connect(): Promise<Pg> {
  const url = new URL(DB_URL);
  if (!["127.0.0.1", "localhost", "::1", "[::1]", "host.docker.internal"].includes(url.hostname)) {
    throw new Error(`refusing to touch ${url.hostname}`);
  }
  // pg is a dependency of apps/landing, not of the dashboard: resolved from there like teardown.ts does
  const { Client } = createRequire(path.join(__dirname, "..", "..", "landing", "package.json"))("pg");
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client as Pg;
}

test.describe.serial("Epic 28: Single-use session validity, end to end", () => {
  test.describe.configure({ retries: 0 });

  let admin: SupabaseClient;
  let pg: PageGym;
  let db: Pg;
  const extraUserIds: string[] = [];
  let guestMemberId = "";
  let guestPhone = "";
  let receptionistEmail = "";
  let coachEmail = "";
  let classId = "";
  const classSessionIds: string[] = [];
  const bookingIds: string[] = [];
  let coverBeforeFlip: unknown[] = [];

  async function createStaff(role: "receptionist" | "coach", seq: number) {
    const tag = `${Date.now().toString(36)}${seq}`;
    const email = `e2e-su-${role}-${tag}@fixture.gymos.test`;
    const phone = `+23769${Math.floor(Math.random() * 10 ** 7).toString().padStart(7, "0")}`;
    const { data, error } = await admin.auth.admin.createUser({ email, phone, password: FIXTURE_PASSWORD, email_confirm: true, phone_confirm: true });
    if (error || !data.user) throw new Error(`single-use e2e: createUser(${role}) -- ${error?.message}`);
    extraUserIds.push(data.user.id);
    const { data: member, error: memberError } = await admin
      .from("members")
      .insert({ gym_id: pg.gymId, user_id: data.user.id, role, name: `E2E SU ${role}`, phone })
      .select("id")
      .single();
    if (memberError || !member) throw new Error(`single-use e2e: members insert (${role}) -- ${memberError?.message}`);
    await admin.from("users").update({ must_change_password: false }).eq("id", data.user.id);
    return { email, memberId: member.id as string };
  }

  test.beforeAll(async () => {
    admin = createClient(supabaseUrl(), supabaseServiceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } });
    db = await connect();
    pg = await createPageGym("en");

    const receptionist = await createStaff("receptionist", 1);
    const coach = await createStaff("coach", 2);
    receptionistEmail = receptionist.email;
    coachEmail = coach.email;

    const { data: plan, error: planError } = await admin
      .from("plans")
      .insert({ gym_id: pg.gymId, name: "E2E SU Per Session", plan_type: "pay_per_session", price: 2000, currency: "XAF", billing_interval: "monthly" })
      .select("id")
      .single();
    if (planError || !plan) throw new Error(`single-use e2e: plan -- ${planError?.message}`);

    // the Pay-per-session guest, who signs in by phone like a member of the app
    guestPhone = `+23768${Math.floor(Math.random() * 10 ** 7).toString().padStart(7, "0")}`;
    const { data: guest, error: guestError } = await admin.auth.admin.createUser({ phone: guestPhone, password: FIXTURE_PASSWORD, phone_confirm: true });
    if (guestError || !guest.user) throw new Error(`single-use e2e: guest user -- ${guestError?.message}`);
    extraUserIds.push(guest.user.id);
    const { data: guestMember, error: guestMemberError } = await admin
      .from("members")
      .insert({ gym_id: pg.gymId, user_id: guest.user.id, role: "member", name: "E2E SU Guest", phone: guestPhone })
      .select("id")
      .single();
    if (guestMemberError || !guestMember) throw new Error(`single-use e2e: guest member -- ${guestMemberError?.message}`);
    guestMemberId = guestMember.id as string;
    const today = new Date().toISOString().slice(0, 10);
    const { error: subError } = await admin
      .from("subscriptions")
      .insert({ gym_id: pg.gymId, member_id: guestMemberId, plan_id: plan.id, status: "active", start_date: today, expiry_date: null });
    if (subError) throw new Error(`single-use e2e: guest subscription -- ${subError.message}`);

    // one class, two sessions (two bookings: one for a class inside a visit, one with no open visit)
    const { data: cls, error: classError } = await admin
      .from("classes")
      .insert({ gym_id: pg.gymId, name: "E2E Single Class", coach_id: coach.memberId, capacity: 20, schedule_type: "one_off", one_off_session_at: new Date(Date.now() + 86_400_000).toISOString() })
      .select("id")
      .single();
    if (classError || !cls) throw new Error(`single-use e2e: class -- ${classError?.message}`);
    classId = cls.id as string;
    for (const hours of [24, 48]) {
      const { data: session, error: sessionError } = await admin
        .from("class_sessions")
        .insert({ gym_id: pg.gymId, class_id: classId, scheduled_at: new Date(Date.now() + hours * 3_600_000).toISOString() })
        .select("id")
        .single();
      if (sessionError || !session) throw new Error(`single-use e2e: class session -- ${sessionError?.message}`);
      classSessionIds.push(session.id as string);
      const { data: booking, error: bookingError } = await admin
        .from("class_bookings")
        .insert({ gym_id: pg.gymId, class_session_id: session.id, member_id: guestMemberId })
        .select("id")
        .single();
      if (bookingError || !booking) throw new Error(`single-use e2e: booking -- ${bookingError?.message}`);
      bookingIds.push(booking.id as string);
    }
  });

  test.afterAll(async () => {
    // Rows no API role may delete (attendance_events has no service-role DELETE grant; guest_sessions reference the attendance row, the booking,
    // the payment and the loyalty grant; audit rows would be orphaned by the gym delete) go first through the local direct connection, this gym only, then the API deletes in FK-safe order.
    try {
      if (db && pg) {
        await db.query("begin");
        for (const table of ["guest_sessions", "session_attempts", "front_desk_alerts", "loyalty_events", "loyalty_progress", "attendance_events", "audit_log"]) {
          await db.query(`delete from ${table} where gym_id = $1`, [pg.gymId]);
        }
        await db.query("commit");
      }
    } catch (e) {
      await db?.query("rollback").catch(() => undefined);
      console.error("single-use e2e cleanup: direct row delete failed --", e);
    }
    const tryDelete = async (label: string, op: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await op;
      if (error) console.error(`single-use e2e cleanup: ${label} failed -- ${error.message}`);
    };
    if (pg) {
      await tryDelete("payments", admin.from("payments").delete().eq("gym_id", pg.gymId));
      await tryDelete("class_bookings", admin.from("class_bookings").delete().eq("gym_id", pg.gymId));
      await tryDelete("class_sessions", admin.from("class_sessions").delete().eq("gym_id", pg.gymId));
      await tryDelete("classes", admin.from("classes").delete().eq("gym_id", pg.gymId));
      await tryDelete("subscriptions", admin.from("subscriptions").delete().eq("gym_id", pg.gymId));
      await removePageGym(pg);
    }
    for (const userId of extraUserIds) {
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch (e) {
        console.error(`single-use e2e cleanup: deleteUser(${userId}) failed --`, e);
      }
    }
    await db?.end().catch(() => undefined);
  });

  async function validityOf(): Promise<string> {
    const { rows } = await db.query("select session_validity from gyms where id = $1", [pg.gymId]);
    return rows[0]?.session_validity as string;
  }
  async function consumedKinds(): Promise<string[]> {
    const { rows } = await db.query(
      "select covered_kind from guest_sessions where member_id = $1 and consumed_at is not null order by consumed_at, id",
      [guestMemberId],
    );
    return rows.map((r) => r.covered_kind as string);
  }
  async function consumedCount(): Promise<number> {
    return (await consumedKinds()).length;
  }
  async function checkOut(): Promise<void> {
    await db.query("update attendance_events set checked_out_at = now(), checkout_type = 'manual' where member_id = $1 and checked_out_at is null", [guestMemberId]);
  }

  test("an Owner switches the gym to Single use through Settings, and the audit row appears", async ({ page }) => {
    await loginViaUi(page, pg.ownerEmail);
    await page.goto("/settings");
    expect(await validityOf()).toBe("whole_day");

    await expect(page.getByText("Session validity", { exact: true }).first()).toBeVisible();
    await page.getByRole("radio", { name: /^Single use/ }).check();
    await page.getByRole("button", { name: "Save session validity" }).click();
    await expect(page.getByText("Session validity saved.")).toBeVisible();

    expect(await validityOf()).toBe("single_use");
    const { rows } = await db.query(
      "select metadata from audit_log where gym_id = $1 and action_type = 'session_validity_changed' order by created_at desc limit 1",
      [pg.gymId],
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.metadata)).toContain("single_use");
  });

  test("a guest with a recorded session payment checks in and one session is consumed; a second scan is rejected at no cost", async ({ request }) => {
    const owner = await signInForApi(request, { email: pg.ownerEmail });
    const paid = await callRpc(request, owner, "record_session_payment", { p_member_id: guestMemberId, p_method: "cash" });
    expect(paid.ok(), await paid.text()).toBe(true);

    const guest = await signInForApi(request, { phone: guestPhone });
    const first = await callRpc(request, guest, "check_in", {});
    expect(first.ok(), await first.text()).toBe(true);
    expect(((await first.json()) as { id?: string } | null)?.id).toBeTruthy();
    expect(await consumedKinds()).toEqual(["visit"]);

    // the RPC raises "already has an open check-in"; the app shows it as "You're already checked in"
    const second = await callRpc(request, guest, "check_in", {});
    expect(second.ok()).toBe(false);
    expect(await second.text()).toContain("already has an open check-in");
    expect(await consumedKinds()).toEqual(["visit"]);
    const { rows } = await db.query("select count(*)::int as n from session_attempts where member_id = $1", [guestMemberId]);
    expect(rows[0]?.n).toBe(0);
  });

  test("after check-out and a second payment the same guest's second visit the same day is admitted and a second session is consumed", async ({ request }) => {
    await checkOut();
    const owner = await signInForApi(request, { email: pg.ownerEmail });
    const paid = await callRpc(request, owner, "record_session_payment", { p_member_id: guestMemberId, p_method: "cash" });
    expect(paid.ok(), await paid.text()).toBe(true);

    const guest = await signInForApi(request, { phone: guestPhone });
    const again = await callRpc(request, guest, "check_in", {});
    expect(again.ok(), await again.text()).toBe(true);
    expect(await consumedKinds()).toEqual(["visit", "visit"]);
    const { rows } = await db.query("select count(*)::int as n from attendance_events where member_id = $1", [guestMemberId]);
    expect(rows[0]?.n).toBe(2);
  });

  test("a class marked inside that visit costs nothing; a class marked with no open visit consumes its own session", async ({ request }) => {
    const owner = await signInForApi(request, { email: pg.ownerEmail });

    const inside = await callRpc(request, owner, "mark_class_attendance", { p_booking_id: bookingIds[0] });
    expect(inside.ok(), await inside.text()).toBe(true);
    expect(((await inside.json()) as { attended_at?: string | null }).attended_at).toBeTruthy();
    expect(await consumedKinds()).toEqual(["visit", "visit"]);

    await checkOut();
    const paid = await callRpc(request, owner, "record_session_payment", { p_member_id: guestMemberId, p_method: "cash" });
    expect(paid.ok(), await paid.text()).toBe(true);
    const outside = await callRpc(request, owner, "mark_class_attendance", { p_booking_id: bookingIds[1] });
    expect(outside.ok(), await outside.text()).toBe(true);
    expect(((await outside.json()) as { attended_at?: string | null }).attended_at).toBeTruthy();
    expect(await consumedKinds()).toEqual(["visit", "visit", "class"]);

    const { rows } = await db.query(
      "select covered_booking_id, covered_day, covered_attendance_id from guest_sessions where member_id = $1 and covered_kind = 'class'",
      [guestMemberId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ covered_booking_id: bookingIds[1], covered_day: null, covered_attendance_id: null });
    // a class mark writes no attendance row
    const attendance = await db.query("select count(*)::int as n from attendance_events where member_id = $1", [guestMemberId]);
    expect(attendance.rows[0]?.n).toBe(2);
  });

  // The member modal's select, copied from services/guestSessions.ts listMemberGuestSessions (keep the two in step). Unit tests only match the
  // string against a mock; this performs the real PostgREST GET as the signed-in Owner, so an RLS denial or an ambiguous relationship fails here.
  test("the member modal's guest_sessions select (with the class and gym embeds) works for the Owner and returns the class name and the gym timezone", async ({ request }) => {
    const select =
      "id, payment_id, loyalty_grant_id, created_at, usable_until, consumed_at, covered_day, validity_mode, covered_kind, covered_attendance_id, covered_booking_id, voided_at, payments(method, actor_id), class_bookings(class_sessions(scheduled_at, classes(name))), gyms(timezone)";
    const owner = await signInForApi(request, { email: pg.ownerEmail });
    const response = await request.get(`${supabaseUrl()}/rest/v1/guest_sessions`, {
      headers: { apikey: supabaseAnonKey(), Authorization: `Bearer ${owner.accessToken}` },
      params: { select, gym_id: `eq.${pg.gymId}`, member_id: `eq.${guestMemberId}`, order: "created_at.desc", limit: "200" },
    });
    expect(response.status(), await response.text()).toBe(200);
    const rows = (await response.json()) as {
      covered_kind: string | null;
      class_bookings: { class_sessions: { scheduled_at: string; classes: { name: string } } } | null;
      gyms: { timezone: string } | null;
    }[];
    const classRow = rows.find((r) => r.covered_kind === "class");
    expect(classRow).toBeDefined();
    expect(classRow?.class_bookings?.class_sessions.classes.name.toLowerCase()).toBe("e2e single class"); // class names are stored upper-cased
    expect(classRow?.class_bookings?.class_sessions.scheduled_at).toBeTruthy();
    expect(classRow?.gyms?.timezone).toBeTruthy();
  });

  test("the Guest sessions card counts consumed sessions per visit and the Paid tab says what each covered", async ({ page, request }) => {
    const owner = await signInForApi(request, { email: pg.ownerEmail });
    const summary = await callRpc(request, owner, "guest_sessions_summary", { p_period: "today" });
    expect(summary.ok(), await summary.text()).toBe(true);
    const [row] = (await summary.json()) as { paid_count: number; blocked_count: number }[];
    expect(Number(row?.paid_count)).toBe(3);
    expect(Number(row?.blocked_count)).toBe(0);

    await loginViaUi(page, pg.ownerEmail);
    await page.goto("/guest-sessions?tab=paid&period=today");
    await expect(page.getByRole("columnheader", { name: "Used" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /^visit / })).toHaveCount(2);
    await expect(page.getByRole("cell", { name: /^class E2E SINGLE CLASS, /i })).toHaveCount(1);
  });

  test("flipping back to Whole day leaves every consumed session's coverage untouched", async ({ page }) => {
    const snapshot = async () =>
      (
        await db.query(
          "select id, validity_mode, covered_kind, covered_day, covered_attendance_id, covered_booking_id, consumed_at from guest_sessions where gym_id = $1 order by id",
          [pg.gymId],
        )
      ).rows;
    coverBeforeFlip = await snapshot();
    expect(coverBeforeFlip.length).toBeGreaterThanOrEqual(3);

    await loginViaUi(page, pg.ownerEmail);
    await page.goto("/settings");
    await page.getByRole("radio", { name: /^Whole day/ }).check();
    await page.getByRole("button", { name: "Save session validity" }).click();
    await expect(page.getByText("Session validity saved.")).toBeVisible();

    expect(await validityOf()).toBe("whole_day");
    expect(await snapshot()).toEqual(coverBeforeFlip);
    expect((await consumedCount())).toBe(3);
  });

  test("a Receptionist and a Coach get no Session validity section and a refused setter", async ({ page, request }) => {
    for (const email of [receptionistEmail, coachEmail]) {
      await page.context().clearCookies();
      await loginViaUi(page, email);
      await page.goto("/settings");
      await expect(page.getByRole("radio", { name: /^Single use/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save session validity" })).toHaveCount(0);

      const session = await signInForApi(request, { email });
      const refused = await callRpc(request, session, "set_session_validity", { p_gym_id: pg.gymId, p_validity: "single_use" });
      expect(refused.ok()).toBe(false);
    }
    // the refused setter changed nothing
    expect(await validityOf()).toBe("whole_day");
  });
});
