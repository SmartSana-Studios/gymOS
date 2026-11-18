import { test, expect } from "@playwright/test";

import { loadFixtures } from "./helpers/fixtures";
import { createClient } from "@supabase/supabase-js";

import { loginViaUi, signInForApi, callRpc } from "./helpers/auth";
import { supabaseServiceRoleKey, supabaseUrl } from "./helpers/env";

// Story 27.3 (Epic 27 desk fixes; 27.4's plan group is at the end of this file). The staff check-in group: a Receptionist checks in an Active
// member (R1) and sees the Entry cell; an Expired member is refused (R4), renews in place and is checked in (R6); a Pay-per-session member
// at a charging gym with no session records the desk payment and is checked in (R5 then R6); a Receptionist sees no [Void], a Manager
// voids the entry, the row is muted, and the member can scan in.
//
// Serial and non-idempotent against the shared global fixtures (each step leaves attendance rows the next relies on), so there is no
// retry: a retry would rerun the group on rows the first pass already used, and skipping the retry (as a single-test spec may) would
// turn a first-pass failure into a skipped, green result.

test.describe.serial("Epic 27 staff check-in and void", () => {
  test.describe.configure({ retries: 0 });

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
    await expect(row.getByText("By staff", { exact: true })).toBeVisible();
  });

  test("an Expired member is refused (R4), renews in place and is checked in (R6)", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.receptionist.email);
    await page.goto("/attendance");

    await checkInFromModal(page, "Desk Expired", fixtures.desk.expired.name);
    await expect(page.getByText(/Not checked in\. .* expired \d+ days ago/i)).toBeVisible();
    await page.getByRole("button", { name: "Renew now" }).click();
    // the shared renewal panel opens inside the same modal (one dialog), cash by default
    await expect(page.locator("dialog[open]")).toHaveCount(1);
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
    await expect(page.locator("dialog[open]")).toHaveCount(1);
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
    await expect(logRow.getByText("Voided", { exact: true })).toBeVisible();

    // the one-open slot is free at once: the member's own scan is accepted
    const session = await signInForApi(request, { phone: fixtures.desk.active.phone });
    const scan = await callRpc(request, session, "check_in", {});
    expect(scan.ok()).toBe(true);
  });
});

// Story 27.4 (Correct plan, annual plan wording). A Manager corrects an unpaid Annual plan to Monthly with a reason and sees the new
// expiry counted from the start date; the same action on a member with a verified payment shows F1 with [Open payments]; an annual plan
// card reads "Paid once" in English and in French. Serial: the first test changes the unpaid member's plan.
test.describe.serial("Epic 27 correct plan and annual plan wording", () => {
  test.describe.configure({ retries: 0 });

  async function openCorrectPlan(page: import("@playwright/test").Page, search: string, memberName: string) {
    await page.goto(`/members?search=${encodeURIComponent(search)}`);
    await page.getByRole("button", { name: new RegExp(`^Actions for ${memberName}`, "i") }).click();
    await page.getByRole("menuitem", { name: "Correct plan" }).click();
    return page.locator("dialog[open]");
  }

  test("a Manager corrects an unpaid Annual plan to Monthly, and the new expiry is counted from the start date", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.manager.email);
    const modal = await openCorrectPlan(page, "Plan Unpaid", fixtures.plan.unpaid.name);

    await expect(modal.getByText("Current plan")).toBeVisible();
    await modal.getByLabel(/New plan/).selectOption({ label: "E2E MONTHLY · 15,000 XAF · 30 days" });
    await modal.getByLabel(/Reason/).fill("Wrong plan chosen at sign-up");
    const rule = modal.getByText(/The new expiry is counted from the start date \(.*\), not from today\./);
    await expect(rule).toBeVisible();
    await modal.getByRole("button", { name: "Correct plan" }).click();

    // start_date + 30 days, formatted as the page formats it
    const [y, m, d] = fixtures.plan.unpaid.startDate.split("-").map(Number);
    const expected = await page.evaluate(
      ([year, month, day]) => new Date(year, month - 1, day + 30).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      [y, m, d],
    );
    await expect(page.getByRole("status").filter({ hasText: /Plan corrected\./ })).toContainText(`is now on E2E MONTHLY; expires ${expected} · Active.`);
    await expect(page.locator("dialog[open]")).toHaveCount(0);

    // the list shows the new plan in place
    await expect(page.getByRole("row", { name: new RegExp(fixtures.plan.unpaid.name, "i") })).toContainText("E2E MONTHLY");
  });

  test("the same action on a member with a verified payment shows F1 with [Open payments]", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.manager.email);
    const modal = await openCorrectPlan(page, "Plan Paid", fixtures.plan.paid.name);

    const alert = modal.getByRole("alert");
    await expect(alert).toContainText("Can't correct the plan yet. The payment of 250,000 XAF on");
    await expect(alert).toContainText("(Cash) is still recorded. Refund it fully first, then correct the plan.");
    await expect(modal.getByLabel(/Reason/)).toHaveCount(0);
    await expect(modal.getByRole("link", { name: "Open payments" })).toHaveAttribute("href", new RegExp(`/payments\\?memberId=${fixtures.plan.paid.memberId}`));
  });

  test("a Receptionist's row menu has no [Correct plan]", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.receptionist.email);
    await page.goto(`/members?search=${encodeURIComponent("Plan Paid")}`);
    await page.getByRole("button", { name: new RegExp(`^Actions for ${fixtures.plan.paid.name}`, "i") }).click();
    await expect(page.getByRole("menuitem", { name: "Correct plan" })).toHaveCount(0);
  });

  test("an annual plan card reads 'Paid once' in English and in French", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.manager.email);
    await page.goto("/plans");
    await expect(page.getByText("XAF 250,000 · 365 days · Paid once")).toBeVisible();
    await expect(page.getByText("Includes 15% annual discount")).toBeVisible();
    // the monthly row keeps its shipped wording
    await expect(page.getByText("XAF 15,000 / monthly · 30 days")).toBeVisible();

    const admin = createClient(supabaseUrl(), supabaseServiceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } });
    try {
      await admin.from("users").update({ preferred_language: "fr" }).eq("id", fixtures.manager.userId);
      await page.goto("/plans");
      const text = ((await page.locator("body").textContent()) ?? "").replace(/[\u00a0\u202f]/g, " ");
      expect(text).toContain("250 000 XAF · 365 jours · Payé en une fois");
      expect(text).toContain("Dont 15 % de remise annuelle");
    } finally {
      await admin.from("users").update({ preferred_language: "en" }).eq("id", fixtures.manager.userId);
    }
  });
});
