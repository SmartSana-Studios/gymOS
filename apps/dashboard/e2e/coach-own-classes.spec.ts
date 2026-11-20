import { test, expect, type Page } from "@playwright/test";

import { loadFixtures } from "./helpers/fixtures";
import { loginViaUi } from "./helpers/auth";

// Story 29.3: the golden path of a Coach running their own timetable from My Classes. The Coach creates a class with two different times
// (Coach shown as plain text, never a select), sees it in the list, edits one time (the result view is 29.2's), a second Coach does not see
// it, the first Coach cancels it (the Cancelled badge replaces [Edit] and [Cancel class]) and cannot open the admin Classes page.
// Class names are stored upper-case. progress-data-privacy.spec.ts reassigns a member between the same two Coaches; it touches no class.

const CLASS_NAME = "E2E Coach Own";
const STORED_NAME = CLASS_NAME.toUpperCase();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function classSection(page: Page) {
  return page.locator("section", { has: page.getByRole("heading", { name: new RegExp(STORED_NAME) }) });
}

test.describe("Story 29.3: a Coach creates, edits and cancels their own class", () => {
  // Creates a class in the shared fixture gym: a retry would collide with the first attempt's class name.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.retry > 0, "non-idempotent against shared global fixtures -- see file header");
  });

  test("create with two times, edit one, a second Coach cannot see it, cancel, and /classes stays closed", async ({ page, browser }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.coach.email);
    await page.goto("/coach/classes");

    // Create: Monday 07:00 and Thursday 18:30.
    await page.getByRole("button", { name: "+ Create class" }).first().click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog.locator("select#classCoach")).toHaveCount(0);
    await expect(dialog.getByTestId("class-coach-fixed")).toContainText(new RegExp(fixtures.coach.name, "i"));
    await expect(dialog.getByText("Classes you create are taught by you.")).toBeVisible();
    await dialog.locator("#className").fill(CLASS_NAME);
    await dialog.locator("#classCapacity").fill("10");
    await dialog.getByLabel("Recurring").check();
    await dialog.locator("#recurrenceStartDate").fill(todayIso());
    await dialog.getByRole("button", { name: "+ Add a time" }).click();
    await dialog.locator("select[id^='weeklyDay-']").nth(0).selectOption("1");
    await dialog.locator("input[id^='weeklyTime-']").nth(0).fill("07:00");
    await dialog.locator("select[id^='weeklyDay-']").nth(1).selectOption("4");
    await dialog.locator("input[id^='weeklyTime-']").nth(1).fill("18:30");
    await dialog.getByRole("button", { name: "Create class" }).click();

    // It is in My Classes, with both times; roster and attendance stay read-only (no checkbox anywhere on the page).
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const section = classSection(page);
    await expect(section).toContainText("Mon 07:00");
    await expect(section).toContainText("Thu 18:30");
    await expect(section.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(section.getByRole("button", { name: "Cancel class" })).toBeVisible();
    await expect(page.locator("input[type='checkbox']")).toHaveCount(0);

    // Edit one time: Thursday 18:30 -> 19:00.
    await section.getByRole("button", { name: "Edit" }).click();
    const editDialog = page.locator("dialog[open]");
    await expect(editDialog.locator("select#classCoach")).toHaveCount(0);
    await editDialog.locator("input[id^='weeklyTime-']").nth(1).fill("19:00");
    await editDialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(editDialog.getByRole("heading", { name: "Class saved" })).toBeFocused();
    await editDialog.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(classSection(page)).toContainText("Thu 19:00");
    await expect(classSection(page)).not.toContainText("18:30");

    // A second Coach does not see it.
    const secondContext = await browser.newContext();
    try {
      const secondPage = await secondContext.newPage();
      await loginViaUi(secondPage, fixtures.secondCoach.email);
      await secondPage.goto("/coach/classes");
      await expect(secondPage.getByRole("button", { name: "+ Create class" }).first()).toBeVisible();
      await expect(secondPage.getByText(STORED_NAME)).toHaveCount(0);
    } finally {
      await secondContext.close();
    }

    // Cancel it: the badge replaces the actions.
    await classSection(page).getByRole("button", { name: "Cancel class" }).click();
    const cancelDialog = page.locator("dialog[open]");
    await expect(cancelDialog.getByText("Nobody has booked yet.")).toBeVisible();
    await cancelDialog.getByRole("button", { name: "Cancel class" }).click();
    await expect(classSection(page)).toContainText("Cancelled");
    await expect(classSection(page).getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(classSection(page).getByRole("button", { name: "Cancel class" })).toHaveCount(0);

    // The admin Classes page stays closed to the Coach role, and the sidebar has no Classes item.
    await page.goto("/classes");
    await expect(page.getByText(/You don't have permission to do this\./)).toBeVisible();
    await expect(page.locator("tr", { hasText: STORED_NAME })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Classes", exact: true })).toHaveCount(0);
  });
});
