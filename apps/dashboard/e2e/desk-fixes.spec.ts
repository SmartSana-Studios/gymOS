import { test, expect } from "@playwright/test";

import { loadFixtures } from "./helpers/fixtures";
import { loginViaUi, signInForApi, callRpc } from "./helpers/auth";

// Story 27.3 (Epic 27 desk fixes; 27.4 adds its own group to this file). The staff check-in group: a Receptionist checks in an Active
// member (R1) and sees the Entry cell; an Expired member is refused (R4), renews in place and is checked in (R6); a Pay-per-session member
// at a charging gym with no session records the desk payment and is checked in (R5 then R6); a Receptionist sees no [Void], a Manager
// voids the entry, the row is muted, and the member can scan in.
//
// Serial and non-idempotent against the shared global fixtures (each step leaves attendance rows the next relies on), so a CI retry is
// skipped rather than allowed to mask the first failure with a misleading second one.

test.describe.serial("Epic 27 staff check-in and void", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.retry > 0, "non-idempotent against shared global fixtures -- see file header");
  });

  async function checkInFromModal(page: import("@playwright/test").Page, search: string, memberName: string) {
    await page.getByRole("button", { name: "Check in a member" }).click();
    await page.locator("#checkInSearch").fill(search);
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: new RegExp(`^Check in ${memberName}`, "i") }).click();
  }

  test("a Receptionist checks an Active member in (R1) and sees the Entry cell", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.receptionist.email);
    await page.goto("/attendance");

    await checkInFromModal(page, "Desk Active", fixtures.desk.active.name);
    await expect(page.getByText(/is checked in at/i)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    const row = page.getByRole("row", { name: new RegExp(fixtures.desk.active.name, "i") });
    await expect(row).toBeVisible();
    await expect(row.getByText("By staff")).toBeVisible();
  });

  test("an Expired member is refused (R4), renews in place and is checked in (R6)", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.receptionist.email);
    await page.goto("/attendance");

    await checkInFromModal(page, "Desk Expired", fixtures.desk.expired.name);
    await expect(page.getByText(/Not checked in\. .* expired 3 days ago/i)).toBeVisible();
    await page.getByRole("button", { name: "Renew now" }).click();
    // the shared renewal panel opens inside the same modal (one dialog), cash by default
    await expect(page.locator("dialog")).toHaveCount(1);
    await page.getByRole("button", { name: "Confirm Renewal" }).click();
    await expect(page.getByText(/Membership renewed\. .* is checked in at/i)).toBeVisible();
  });

  test("a Pay-per-session member with no session records the desk payment and is checked in (R5 then R6)", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.receptionist.email);
    await page.goto("/attendance");

    await checkInFromModal(page, "Desk Session", fixtures.desk.pps.name);
    await expect(page.getByText(/has no paid session/i)).toBeVisible();
    await page.getByRole("button", { name: "Record payment and check in" }).click();
    await expect(page.locator("dialog")).toHaveCount(1);
    await page.getByRole("button", { name: "Record session payment" }).click();
    await expect(page.getByText(/Session recorded\. .* is checked in at/i)).toBeVisible();
  });

  test("a Receptionist sees no [Void]", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.receptionist.email);
    await page.goto("/attendance");
    await expect(page.getByRole("row", { name: new RegExp(fixtures.desk.active.name, "i") })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Void the check-in of/ })).toHaveCount(0);
  });

  test("a Manager voids the entry, the row is muted, and the member can scan in", async ({ page, request }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.manager.email);
    await page.goto("/attendance");

    const row = page.getByRole("row", { name: new RegExp(fixtures.desk.active.name, "i") });
    await row.getByRole("button", { name: /^Void the check-in of/ }).click();
    const modal = page.locator("dialog[open]");
    await modal.getByLabel(/Reason for voiding/).fill("wrong member selected");
    await modal.getByRole("button", { name: "Void check-in" }).click();
    await expect(page.getByText(/Check-in voided\./)).toBeVisible();

    // gone from Currently Checked In, kept (muted, "Voided") in the Daily Log
    await expect(page.getByRole("row", { name: new RegExp(fixtures.desk.active.name, "i") })).toHaveCount(0);
    await page.getByRole("tab", { name: "Daily log" }).click();
    const logRow = page.getByRole("row", { name: new RegExp(fixtures.desk.active.name, "i") });
    await expect(logRow).toHaveAttribute("data-voided", "true");
    await expect(logRow.getByText("Voided")).toBeVisible();

    // the one-open slot is free at once: the member's own scan is accepted
    const session = await signInForApi(request, { phone: fixtures.desk.active.phone });
    const scan = await callRpc(request, session, "check_in", {});
    expect(scan.ok()).toBe(true);
  });
});
