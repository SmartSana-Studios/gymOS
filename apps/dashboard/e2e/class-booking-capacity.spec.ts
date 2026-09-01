import { test, expect } from "@playwright/test";

import { loadFixtures } from "./helpers/fixtures";
import { loginViaUi, signInForApi, callRpc } from "./helpers/auth";

// Story 13.5 Task 7 -- Flow 4: class booking capacity limits (AD-21).
// apps/mobile has no UI automation (Subtask 1.2's documented scope cut) --
// exercised entirely via APIRequestContext against the real book_class_session()
// RPC, the same server boundary a real mobile client uses.

test.describe("Flow 4: class booking capacity limits", () => {
  // Non-idempotent against the shared global fixture session (a successful
  // booking here permanently consumes the one open seat) -- a CI retry
  // would hit book_class_session()'s unique (class_session_id, member_id)
  // index for whichever request already succeeded, masking the original
  // transient failure with a new, misleading deterministic one.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.retry > 0, "non-idempotent against shared global fixtures -- see file header");
  });

  test("exactly one of three concurrent requests wins the last open seat, the rest are rejected", async ({ page, request }) => {
    const fixtures = loadFixtures();

    // Subtasks 7.1/7.2: fixtures/seed.ts pre-filled capacity-1 bookings (2 of
    // 3) via real book_class_session() calls, leaving exactly one genuinely
    // open slot. Race three distinct members for that one slot via
    // Promise.all (not sequential awaits) -- this is what actually exercises
    // book_class_session()'s `SELECT ... FOR UPDATE` row lock (AD-21). A
    // test that awaits one booking to fill the last slot before "racing"
    // the rest against an already-full session can never detect a broken
    // lock, since every attempt would be rejected by a plain count() check
    // regardless of locking.
    const [fillerC, fillerD] = fixtures.classFillerMembers.slice(2);
    const [memberSession, sessionC, sessionD] = await Promise.all([
      signInForApi(request, { phone: fixtures.member.phone }),
      signInForApi(request, { phone: fillerC.phone }),
      signInForApi(request, { phone: fillerD.phone }),
    ]);

    const [memberResponse, responseC, responseD] = await Promise.all([
      callRpc(request, memberSession, "book_class_session", { p_class_session_id: fixtures.classSessionId }),
      callRpc(request, sessionC, "book_class_session", { p_class_session_id: fixtures.classSessionId }),
      callRpc(request, sessionD, "book_class_session", { p_class_session_id: fixtures.classSessionId }),
    ]);

    // Exactly one open slot existed -- exactly one of the three genuinely
    // concurrent attempts must succeed, and the other two must be rejected.
    // If AD-21's row lock were silently broken, more than one could
    // incorrectly succeed, overbooking the session past its capacity.
    const results = [memberResponse, responseC, responseD];
    expect(results.filter((r) => r.ok())).toHaveLength(1);
    expect(results.filter((r) => !r.ok())).toHaveLength(2);

    // Subtask 7.3 (optional cross-check): ClassesPageClient.tsx does
    // surface a real booked-count/capacity cell ({cls.bookedCount} /
    // {cls.capacity}) -- confirm the dashboard reflects the session as
    // full after the race.
    await loginViaUi(page, fixtures.owner.email);
    await page.goto("/classes");
    // A plain `tr` locator, not getByRole("row") -- ClassesPageClient.tsx
    // overrides the row's ARIA role to "button" when attendance-marking is
    // available to the caller's role (Owner here), so it no longer exposes
    // as an accessibility-tree "row".
    await expect(page.locator("tr", { hasText: "E2E Fixture Class" })).toContainText(
      `${fixtures.classCapacity} / ${fixtures.classCapacity}`,
    );
  });
});
