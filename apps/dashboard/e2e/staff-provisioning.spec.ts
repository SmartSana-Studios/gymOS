import { test, expect } from "@playwright/test";

import { loadFixtures } from "./helpers/fixtures";
import { loginViaUi, signInForApi, callRpc } from "./helpers/auth";

// Story 13.5 Task 4 -- Flow 1: staff provisioning + role enforcement
// (NFR-013). Owner has a real email (createGym()'s own shape) so its UI
// assertions drive the real, unmodified login form. Supervisor/Manager get
// a fixture-only synthetic email too (see fixtures/seed.ts's own comment on
// why -- the dashboard's login form is email-only and every real staff
// account is phone-only, a documented, out-of-scope-for-this-story product
// gap) purely to obtain a session for the UI portion of these assertions;
// the *decisive* proof for AC #3 is always the APIRequestContext calls
// below, which exercise create_staff_member()/update_staff_role() directly
// under a real signed-in session -- independent of any UI affordance.
//
// Rejections assert `response.status()).toBe(400)`, not just `ok() ===
// false`: create_staff_member()/update_staff_role() reject a disallowed
// role via a plain PL/pgSQL `raise exception` with no custom SQLSTATE
// (0061/0064), which PostgREST maps to HTTP 400. Asserting the specific
// status distinguishes this role-ceiling rejection from an unrelated server
// error (e.g. a 500 from a broken migration), which a bare ok()===false
// check cannot.

test.describe("Flow 1: staff provisioning + role enforcement", () => {
  test("Owner's Add Staff role field never offers Owner or Super Admin", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.owner.email);
    await page.goto("/settings/staff");
    await page.getByRole("button", { name: "+ Add staff" }).click();

    const options = await page.locator("#staffRole option").evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));

    expect(options).toContain("supervisor");
    expect(options).toContain("manager");
    expect(options).toContain("receptionist");
    expect(options).toContain("coach");
    expect(options).not.toContain("owner");
    expect(options).not.toContain("super_admin");
  });

  test("Supervisor's Add Staff role field never offers Supervisor or Owner", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.supervisor.email);
    await page.goto("/settings/staff");
    await page.getByRole("button", { name: "+ Add staff" }).click();

    const options = await page.locator("#staffRole option").evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));

    expect(options).toContain("manager");
    expect(options).toContain("receptionist");
    expect(options).toContain("coach");
    expect(options).not.toContain("supervisor");
    expect(options).not.toContain("owner");
    expect(options).not.toContain("super_admin");
  });

  test("Manager has no staff-creation UI at all", async ({ page }) => {
    const fixtures = loadFixtures();
    await loginViaUi(page, fixtures.manager.email);
    await page.goto("/settings/staff");

    await expect(page.getByRole("button", { name: "+ Add staff" })).toHaveCount(0);
  });

  // AC #3's "Owner cannot mint or promote-to Super Admin" clause has two
  // distinct halves, tested differently: Super Admin is `users.is_super_admin`,
  // never a `member_role` enum value (0061's own header comment), so
  // `create_staff_member`/`update_staff_role` -- both typed `p_role
  // member_role` -- cannot represent it at all; any attempt fails at
  // PostgREST's JSON->enum type-cast layer for every caller identically,
  // before either function's own ceiling check ever runs. That's a
  // structural (type-system) guarantee, not an Owner-specific runtime
  // check, so asserting it here would prove Postgres enum validation works,
  // not that this RPC's ceiling logic rejects Owner specifically -- already
  // covered by the "never offers Super Admin" UI assertion above and by the
  // schema itself. The genuinely Owner-specific, ceiling-check-exercising
  // half is `owner` itself: create_staff_member()/update_staff_role()'s own
  // allowlist for an Owner caller never includes `'owner'` (0061:99-102,
  // 0064:235-238) -- "no branch ever permits p_role = 'owner', for any
  // caller, including an Owner targeting another Owner" -- which is the
  // real server-side ceiling proof for AC #3's Owner clause.
  test("APIRequestContext: Owner cannot mint or promote-to Owner (Super Admin has no member_role representation at all, see comment above)", async ({ request }) => {
    const fixtures = loadFixtures();
    const session = await signInForApi(request, { email: fixtures.owner.email });

    const mintResponse = await callRpc(request, session, "create_staff_member", {
      p_user_id: "00000000-0000-4000-8000-000000000004",
      p_name: "Attempted Owner",
      p_phone: "+237680099904",
      p_role: "owner",
    });
    expect(mintResponse.status()).toBe(400);

    const promoteResponse = await callRpc(request, session, "update_staff_role", {
      p_member_id: fixtures.manager.memberId,
      p_name: fixtures.manager.name,
      p_role: "owner",
    });
    expect(promoteResponse.status()).toBe(400);
  });

  test("APIRequestContext: Supervisor cannot mint or promote-to Supervisor or Owner, including self-elevation", async ({ request }) => {
    const fixtures = loadFixtures();
    const session = await signInForApi(request, { email: fixtures.supervisor.email });

    // Attempt to mint a new Owner/Supervisor. create_staff_member()'s own
    // role-ceiling check runs before p_user_id is ever looked up (confirmed
    // by reading 0061/0064's function bodies) -- a random, non-existent
    // user_id is enough to prove the rejection is the ceiling check itself,
    // not a downstream FK/lookup failure that would incidentally reject
    // too.
    const mintOwnerResponse = await callRpc(request, session, "create_staff_member", {
      p_user_id: "00000000-0000-4000-8000-000000000001",
      p_name: "Attempted Owner",
      p_phone: "+237680099901",
      p_role: "owner",
    });
    expect(mintOwnerResponse.status()).toBe(400);

    const mintSupervisorResponse = await callRpc(request, session, "create_staff_member", {
      p_user_id: "00000000-0000-4000-8000-000000000002",
      p_name: "Attempted Supervisor",
      p_phone: "+237680099902",
      p_role: "supervisor",
    });
    expect(mintSupervisorResponse.status()).toBe(400);

    // Promote an existing staff member (Manager) to Supervisor -- also
    // must be rejected.
    const promoteResponse = await callRpc(request, session, "update_staff_role", {
      p_member_id: fixtures.manager.memberId,
      p_name: fixtures.manager.name,
      p_role: "supervisor",
    });
    expect(promoteResponse.status()).toBe(400);

    // Self-elevation attempt: Supervisor -> Owner on their own member row.
    const selfElevateResponse = await callRpc(request, session, "update_staff_role", {
      p_member_id: fixtures.supervisor.memberId,
      p_name: fixtures.supervisor.name,
      p_role: "owner",
    });
    expect(selfElevateResponse.status()).toBe(400);
  });

  test("APIRequestContext: Manager cannot mint or edit staff roles at all", async ({ request }) => {
    const fixtures = loadFixtures();
    const session = await signInForApi(request, { email: fixtures.manager.email });

    const mintResponse = await callRpc(request, session, "create_staff_member", {
      p_user_id: "00000000-0000-4000-8000-000000000003",
      p_name: "Attempted Coach Mint",
      p_phone: "+237680099903",
      p_role: "coach",
    });
    expect(mintResponse.status()).toBe(400);

    const editResponse = await callRpc(request, session, "update_staff_role", {
      p_member_id: fixtures.coach.memberId,
      p_name: fixtures.coach.name,
      p_role: "manager",
    });
    expect(editResponse.status()).toBe(400);
  });
});
