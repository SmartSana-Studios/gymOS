import { test, expect, type Page } from "@playwright/test";

import { loadFixtures } from "./helpers/fixtures";
import { loginViaUi, signInForApi, callRpc } from "./helpers/auth";

// Story 29.2: the golden path of per-day class times. A Manager-level user (the Owner) creates a class with three different times, a member
// books the next session through the real book_class_session() RPC (apps/mobile has no UI automation, see class-booking-capacity.spec.ts),
// the Owner moves every time by 30 minutes, the result view lists the booked session as left unchanged, the expanded row carries the
// "Old time" tag, the Owner cancels the class and the list shows it as Cancelled; the member's booking reads class_cancelled.
// Class names are stored upper-case. A plain `tr` locator, not getByRole("row"): the row's ARIA role is "button" for a caller who can mark
// attendance.

const CLASS_NAME = "E2E Weekly Times";
const STORED_NAME = CLASS_NAME.toUpperCase();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fillTimes(page: Page, times: { day?: string; time: string }[]) {
  const dialog = page.locator("dialog[open]");
  for (const [index, entry] of times.entries()) {
    if (entry.day !== undefined) await dialog.locator("select[id^='weeklyDay-']").nth(index).selectOption(entry.day);
    await dialog.locator("input[id^='weeklyTime-']").nth(index).fill(entry.time);
  }
}

test.describe("Story 29.2: weekly times and cancel class", () => {
  // Creates a class and a booking in the shared fixture gym: a retry would collide with the first attempt's class name.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.retry > 0, "non-idempotent against shared global fixtures -- see file header");
  });

  test("create with three times, book, move the times, see it left unchanged with the Old time tag, cancel", async ({ page, request }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.owner.email);
    await page.goto("/classes");

    // Create: Monday 07:00, Wednesday 18:30, Saturday 09:00.
    await page.getByRole("button", { name: "+ Create class" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.locator("#className").fill(CLASS_NAME);
    const coachValue = await dialog
      .locator("#classCoach option", { hasText: new RegExp(fixtures.coach.name, "i") })
      .first()
      .getAttribute("value");
    await dialog.locator("#classCoach").selectOption(coachValue as string);
    await dialog.locator("#classCapacity").fill("10");
    await dialog.getByLabel("Recurring").check();
    await dialog.locator("#recurrenceStartDate").fill(todayIso());
    await dialog.getByRole("button", { name: "+ Add a time" }).click();
    await dialog.getByRole("button", { name: "+ Add a time" }).click();
    await fillTimes(page, [
      { day: "1", time: "07:00" },
      { day: "3", time: "18:30" },
      { day: "6", time: "09:00" },
    ]);
    await expect(dialog.getByText("3 of 14")).toBeVisible();
    await dialog.getByRole("button", { name: "Create class" }).click();

    const row = page.locator("tr", { hasText: STORED_NAME });
    await expect(row).toContainText("Mon 07:00");
    await expect(row).toContainText("Wed 18:30");
    await expect(row).toContainText("Sat 09:00");

    // A member books the soonest session of the class.
    const memberSession = await signInForApi(request, { phone: fixtures.member.phone });
    const listResponse = await callRpc(request, memberSession, "list_bookable_class_sessions", {});
    expect(listResponse.ok()).toBe(true);
    const bookable = (await listResponse.json()) as { class_session_id: string; class_name: string; scheduled_at: string }[];
    const soonest = bookable
      .filter((s) => s.class_name === STORED_NAME)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
    expect(soonest).toBeDefined();
    const bookResponse = await callRpc(request, memberSession, "book_class_session", { p_class_session_id: soonest.class_session_id });
    expect(bookResponse.ok()).toBe(true);

    // Move every time by 30 minutes: the booked session no longer matches and is kept.
    await page.reload();
    await page.locator("tr", { hasText: STORED_NAME }).getByRole("button", { name: "Edit" }).click();
    const editDialog = page.locator("dialog[open]");
    await expect(editDialog.getByText("Changes apply to upcoming sessions that nobody has booked.")).toBeVisible();
    await fillTimes(page, [{ time: "07:30" }, { time: "19:00" }, { time: "09:30" }]);
    await editDialog.getByRole("button", { name: "Save Changes" }).click();

    await expect(editDialog.getByRole("heading", { name: "Class saved" })).toBeFocused();
    await expect(editDialog.getByText(/sessions? with bookings (was|were) left unchanged/)).toBeVisible();
    await expect(editDialog.getByText(/1 \/ 10 booked/)).toBeVisible();
    await editDialog.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);

    // The expanded row's next session is the kept one: it carries the Old time tag.
    const movedRow = page.locator("tr", { hasText: STORED_NAME });
    await expect(movedRow).toContainText("07:30");
    await movedRow.first().click();
    await expect(page.getByText("Old time", { exact: true })).toBeVisible();

    // Cancel the class.
    await movedRow.getByRole("button", { name: "Cancel class" }).click();
    const cancelDialog = page.locator("dialog[open]");
    await expect(cancelDialog.getByText("1 booking is cancelled")).toBeVisible();
    await cancelDialog.getByRole("button", { name: "Cancel class" }).click();
    await expect(page.locator("tr", { hasText: STORED_NAME })).toContainText("Cancelled");
    await expect(page.locator("tr", { hasText: STORED_NAME }).getByRole("button", { name: "Edit" })).toHaveCount(0);

    // The member's booking stays on record and reads as cancelled.
    const bookingsResponse = await callRpc(request, memberSession, "list_my_class_bookings", {});
    expect(bookingsResponse.ok()).toBe(true);
    const bookings = (await bookingsResponse.json()) as { class_name: string; class_cancelled: boolean; can_cancel: boolean }[];
    const mine = bookings.find((b) => b.class_name === STORED_NAME);
    expect(mine?.class_cancelled).toBe(true);
    expect(mine?.can_cancel).toBe(false);
  });
});
