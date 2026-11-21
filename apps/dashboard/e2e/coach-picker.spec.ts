import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "@playwright/test";

import { loadFixtures } from "./helpers/fixtures";
import { loginViaUi } from "./helpers/auth";
import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from "./helpers/env";
import { deleteGymRowsDirect } from "./fixtures/teardown";
import { FIXTURE_PASSWORD } from "./fixtures/types";

// Story 29.4 (FR-247): the coach picker, end to end, with body and progress data SEEDED for the coach's assigned member (a progress entry with
// measurements and a note, a shared progress photo, a plan completion, the member's starting weight and height) next to what the picker MAY show
// (a session note and a workout plan written by the coach). An Owner and a Manager choose the coach and see the classes, a class roster, the assigned
// member, the notes and the plan; no measurement, photo, progress note, completion mark or Overview feed is anywhere in the page or in any network
// response. A Receptionist and a Coach have no picker. A Manager of ANOTHER gym (created here: the shared seed has one gym) opening the coach by URL gets
// "unavailable". Class and member names are stored upper-case; both seeded Coaches are named "E2E Coach", so the select is driven by value.
//
// Seeded rows are removed in afterAll: progress-data-privacy.spec.ts runs later against the same member and counts shared photos.

const MARKERS = ["83.7712", "91.3312", "101.7712", "zq-progress-note-text", "zq-shared-photo", "77.7712", "183.3312"];
const NOTE = "E2E picker session note";
const PLAN = "E2E Picker Plan";
const PLAN_NOTE = "e2e picker plan note";
// Stored upper-case (the uppercase_name trigger, 0159), so cleanup matches on a case-insensitive prefix; a retried worker reloads this module, so the name must not carry a timestamp.
const SECOND_GYM_PREFIX = "E2E Picker Other Gym";

function admin(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = createClient(supabaseUrl(), supabaseAnonKey(), { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: FIXTURE_PASSWORD });
  if (error) throw new Error(`e2e picker: sign-in failed for ${email}: ${error.message}`);
  return client;
}

/** Collects every text-like network response body of a page, to scan for data that must never reach the browser. */
function collectResponses(page: Page): string[] {
  const bodies: string[] = [];
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (!/json|text|x-component|javascript/.test(type)) return;
    try {
      bodies.push(await response.text());
    } catch {
      // a redirect or an aborted request has no body
    }
  });
  return bodies;
}

async function expectNoBodyData(page: Page, bodies: string[]) {
  const html = await page.content();
  for (const marker of MARKERS) {
    expect(html, `the page shows "${marker}"`).not.toContain(marker);
    expect(
      bodies.filter((body) => body.includes(marker)),
      `a network response carries "${marker}"`,
    ).toHaveLength(0);
  }
  await expect(page.getByRole("tab", { name: /progress/i })).toHaveCount(0);
  await expect(page.getByText(/Recent Progress Activity|Needs Follow-Up/i)).toHaveCount(0);
  await expect(page.locator("main img, [role='img']:not(svg)")).toHaveCount(0);
}

/** One pass of the picker as a staff role that has it: choose the coach, Classes with a roster, Members, a member's notes and plan, the excluded addresses. */
async function walkThePicker(page: Page, email: string, coachMemberId: string, memberName: string, memberId: string, className: string) {
  const bodies = collectResponses(page);
  await loginViaUi(page, email);

  // The sidebar has the item; with several coaches nothing is chosen and no coach data is on the page.
  await expect(page.getByRole("link", { name: "Coach Portal" })).toBeVisible();
  await page.goto("/coach");
  await expect(page.getByText("Choose a coach to see their classes and members.")).toBeVisible();
  const select = page.getByLabel("Choose a coach");
  await expect(select).toBeFocused();
  await expect(page.getByText(new RegExp(className, "i"))).toHaveCount(0);
  await expect(page.getByText(new RegExp(memberName, "i"))).toHaveCount(0);

  // Choosing from /coach goes to Classes, with the read-only banner and the two tabs only.
  await select.selectOption(coachMemberId);
  await expect(page).toHaveURL(new RegExp(`/coach/classes\\?coach=${coachMemberId}`));
  await expect(page.getByRole("status").filter({ hasText: /Read-only/ })).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: /Read-only/ })).toContainText(/You're viewing .*'s Coach Portal\. Read-only\./);
  const nav = page.getByRole("navigation", { name: "Coach Portal" });
  await expect(nav.getByRole("link")).toHaveText(["Classes", "Members"]);

  // Classes, read-only: the class, its roster; no create, edit or cancel; a link to the admin Classes page.
  const section = page.locator("section", { has: page.getByRole("heading", { name: new RegExp(className, "i") }) });
  await expect(section).toBeVisible();
  await expect(page.getByRole("button", { name: /Create class|^Edit$|Cancel class/ })).toHaveCount(0);
  await expect(section.getByRole("link", { name: /Open in Classes/ })).toHaveAttribute("href", "/classes");
  await section.getByRole("button", { name: new RegExp(className, "i") }).click();
  await section.locator("ul button").first().click();
  await expect(section.getByText(/E2E MEMBER/i).first()).toBeVisible();
  await expect(page.locator("input[type='checkbox']")).toHaveCount(0);

  // Members: the coach's assigned member, a row opens the member page, ?coach= kept.
  await nav.getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(new RegExp(`/coach\\?coach=${coachMemberId}`));
  const row = page.getByRole("link").filter({ hasText: new RegExp(memberName, "i") }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/coach/${memberId}\\?coach=${coachMemberId}`));

  // The member page: Session Notes and Workout Plan only, the persistent line, the note and the plan as authored, nothing of the body.
  await expect(page.getByRole("tab")).toHaveText(["Session Notes", "Workout Plan"]);
  await expect(page.getByText("Body measurements, photos and progress notes aren't shown in this view.")).toBeVisible();
  // Next keeps the Members page mounted but hidden behind this one, and its table shows the same note as a snippet: scope to the Session Notes panel.
  await expect(page.getByLabel("Session Notes").getByText(NOTE)).toBeVisible();
  await expect(page.getByRole("button", { name: /Add note|Edit/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "Workout Plan" }).click();
  await expect(page.getByText(PLAN.toUpperCase(), { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp("Squat"))).toBeVisible();
  await expect(page.getByText(new RegExp(PLAN_NOTE, "i"))).toBeVisible();
  await expect(page.getByRole("button", { name: /New plan|Edit|Take ownership/ })).toHaveCount(0);
  await expectNoBodyData(page, bodies);

  // The excluded parts, by address: one message, links to Classes and Members, never content.
  await page.goto(`/coach/${memberId}?coach=${coachMemberId}&tab=progress`);
  await expect(page.getByRole("status")).toContainText("This part isn't available in this view.");
  await expect(page.getByRole("status").getByRole("link", { name: "Classes" })).toBeVisible();
  await expect(page.getByRole("status").getByRole("link", { name: "Members" })).toBeVisible();
  await page.goto(`/coach/overview?coach=${coachMemberId}`);
  await expect(page.getByRole("status").last()).toContainText("This part isn't available in this view.");
  await expectNoBodyData(page, bodies);
}

/** Removes every second gym this spec created (any earlier, retried or interrupted run too): its members, the gym and the auth users. */
async function removeOtherGyms(service: SupabaseClient): Promise<void> {
  const { data: gyms } = await service.from("gyms").select("id").ilike("name", `${SECOND_GYM_PREFIX}%`);
  for (const gym of gyms ?? []) {
    const { data: members } = await service.from("members").select("user_id").eq("gym_id", gym.id);
    await service.from("members").delete().eq("gym_id", gym.id);
    await service.from("gyms").delete().eq("id", gym.id);
    for (const row of members ?? []) await service.auth.admin.deleteUser(row.user_id as string);
  }
}

test.describe("Story 29.4: the coach picker for Owner, Supervisor and Manager", () => {
  // Seeds body data and a second gym, and removes them again: a retry would seed twice.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.retry > 0, "non-idempotent against shared global fixtures -- see file header");
  });

  test.beforeAll(async () => {
    const fixtures = loadFixtures();
    const service = admin();
    await removeOtherGyms(service);

    // Body data of the coach's assigned member: starting weight and height on the member row, a progress entry with measurements and a note, a shared photo.
    const { error: bodyError } = await service.from("members").update({ starting_weight_kg: 77.7712, height_cm: 183.3312 }).eq("id", fixtures.member.memberId);
    if (bodyError) throw new Error(`e2e picker: body update failed: ${bodyError.message}`);
    const { data: entry, error: entryError } = await service
      .from("progress_entries")
      .insert({ gym_id: fixtures.gymId, member_id: fixtures.member.memberId, weight_kg: 83.7712, waist_cm: 91.3312, chest_cm: 101.7712, note: "zq-progress-note-text" })
      .select("id")
      .single();
    if (entryError || !entry) throw new Error(`e2e picker: progress entry failed: ${entryError?.message}`);
    const { error: photoError } = await service
      .from("progress_photos")
      .insert({ gym_id: fixtures.gymId, member_id: fixtures.member.memberId, progress_entry_id: entry.id, photo_path: "zq/zq-shared-photo.jpg", shared_with_coach: true });
    if (photoError) throw new Error(`e2e picker: progress photo failed: ${photoError.message}`);

    // What the picker may show: the coach's session note and workout plan, written by the coach through the real RPCs; then a completion mark.
    const coach = await signedIn(fixtures.coach.email);
    const { error: noteError } = await coach.rpc("add_session_note", { p_member_id: fixtures.member.memberId, p_note_text: NOTE });
    if (noteError) throw new Error(`e2e picker: add_session_note failed: ${noteError.message}`);
    const { data: squat, error: squatError } = await service.from("exercise_library").select("id").is("gym_id", null).eq("name", "Squat").single();
    if (squatError || !squat) throw new Error(`e2e picker: Squat not found: ${squatError?.message}`);
    const { data: planId, error: planError } = await coach.rpc("create_workout_plan", {
      p_member_id: fixtures.member.memberId,
      p_name: PLAN,
      p_exercises: [{ exercise_id: squat.id, sets: 3, reps: 10, note: PLAN_NOTE }],
    });
    if (planError || !planId) throw new Error(`e2e picker: create_workout_plan failed: ${planError?.message}`);
    const { error: completionError } = await service
      .from("workout_plan_completions")
      .insert({ gym_id: fixtures.gymId, member_id: fixtures.member.memberId, plan_id: planId, exercise_id: squat.id });
    if (completionError) throw new Error(`e2e picker: completion failed: ${completionError.message}`);
  });

  test.afterAll(async () => {
    const fixtures = loadFixtures();
    const service = admin();
    // The service role may not delete plans, plan exercises or completions: removed through the local direct connection the global teardown uses.
    await deleteGymRowsDirect(fixtures.gymId, ["workout_plan_completions", "workout_plan_exercises", "workout_plans", "session_notes"]);
    await service.from("progress_photos").delete().eq("member_id", fixtures.member.memberId);
    await service.from("progress_entries").delete().eq("member_id", fixtures.member.memberId);
    await service.from("members").update({ starting_weight_kg: null, height_cm: null }).eq("id", fixtures.member.memberId);

    await removeOtherGyms(service);
  });

  test("an Owner chooses the coach and sees classes, a roster, the member, notes and plan, and no body or progress data", async ({ page }) => {
    const fixtures = loadFixtures();
    await walkThePicker(page, fixtures.owner.email, fixtures.coach.memberId, fixtures.member.name, fixtures.member.memberId, "E2E Fixture Class");
  });

  test("a Manager sees the same", async ({ page }) => {
    const fixtures = loadFixtures();
    await walkThePicker(page, fixtures.manager.email, fixtures.coach.memberId, fixtures.member.name, fixtures.member.memberId, "E2E Fixture Class");
  });

  test("a member of the other coach is not assigned: the page says so and never shows the profile", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.owner.email);

    await page.goto(`/coach/${fixtures.member.memberId}?coach=${fixtures.secondCoach.memberId}`);

    await expect(page.getByText(/isn't assigned to/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to members" })).toBeVisible();
    await expect(page.getByText(new RegExp(fixtures.member.name, "i"))).toHaveCount(0);
    await expect(page.getByText(NOTE)).toHaveCount(0);
  });

  test("a Receptionist has no picker: no sidebar item, and the permission message on every Coach Portal address", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.receptionist.email);

    await expect(page.getByRole("link", { name: "Coach Portal" })).toHaveCount(0);
    for (const path of ["/coach", "/coach/classes", "/coach/overview", `/coach/${fixtures.member.memberId}`, `/coach/classes?coach=${fixtures.coach.memberId}`]) {
      await page.goto(path);
      // The shared package copy of errors.permissionDenied ("do this.") is the one that renders, as in coach-own-classes.spec.ts.
      await expect(page.getByText(/You don't have permission to do this\./)).toBeVisible();
      await expect(page.getByLabel("Choose a coach")).toHaveCount(0);
      await expect(page.getByText(new RegExp(NOTE))).toHaveCount(0);
    }
  });

  test("a Coach has their own portal: no picker, no banner, and a typed ?coach= is ignored", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.coach.email);

    await page.goto(`/coach/classes?coach=${fixtures.secondCoach.memberId}`);

    await expect(page.getByLabel("Choose a coach")).toHaveCount(0);
    await expect(page.getByText(/Read-only/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /E2E Fixture Class/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Create class" }).first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Coach Portal" }).getByRole("link")).toHaveCount(3);

    await page.goto(`/coach/${fixtures.member.memberId}?coach=${fixtures.secondCoach.memberId}`);
    await expect(page.getByRole("tab", { name: "Progress" })).toBeVisible();
  });

  test("a Manager of another gym opening the coach by URL gets 'unavailable' and nothing of this gym", async ({ page }) => {
    const fixtures = loadFixtures();
    const service = admin();

    const { data: tier } = await service.from("tiers").select("id").order("created_at").limit(1).single();
    const { data: gym, error: gymError } = await service.from("gyms").insert({ name: SECOND_GYM_PREFIX, tier_id: tier!.id, status: "active" }).select("id").single();
    if (gymError || !gym) throw new Error(`e2e picker: second gym failed: ${gymError?.message}`);
    const email = `e2e-picker-other-${Date.now()}@fixture.gymos.test`;
    const phone = "+237680000991";
    const { data: created, error: userError } = await service.auth.admin.createUser({ email, phone, password: FIXTURE_PASSWORD, email_confirm: true, phone_confirm: true });
    if (userError || !created.user) throw new Error(`e2e picker: second gym manager failed: ${userError?.message}`);
    const { error: memberError } = await service.from("members").insert({ gym_id: gym.id, user_id: created.user.id, role: "manager", name: "E2E Other Manager", phone });
    if (memberError) throw new Error(`e2e picker: second gym member failed: ${memberError.message}`);
    await service.from("users").update({ must_change_password: false }).eq("id", created.user.id);

    const bodies = collectResponses(page);
    await loginViaUi(page, email);
    await page.goto(`/coach/classes?coach=${fixtures.coach.memberId}`);

    await expect(page.getByText("That coach isn't available. Choose another.")).toBeVisible();
    await expect(page.getByText(/E2E Fixture Class/i)).toHaveCount(0);
    await expect(page.getByText(/Read-only/)).toHaveCount(0);
    for (const path of [`/coach?coach=${fixtures.coach.memberId}`, `/coach/${fixtures.member.memberId}?coach=${fixtures.coach.memberId}`]) {
      await page.goto(path);
      await expect(page.getByText("That coach isn't available. Choose another.")).toBeVisible();
    }
    const html = await page.content();
    for (const text of [fixtures.member.name, NOTE, PLAN, "E2E Fixture Class"]) {
      expect(html.toLowerCase()).not.toContain(text.toLowerCase());
      expect(bodies.filter((body) => body.toLowerCase().includes(text.toLowerCase()))).toHaveLength(0);
    }
  });
});
