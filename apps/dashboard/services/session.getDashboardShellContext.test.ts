/**
 * Story 11.4 (Task 2, Dev Notes): "the dashboard shell fix is the part most
 * likely to look done when it isn't... only shows up in a real click-through
 * (or a Vitest test of getDashboardShellContext()'s suspended branch
 * specifically)." This is that test -- proves the suspension short-circuit
 * fires *before* the (now RLS-gated) members lookup, returns a distinct
 * `suspended` shape (not overloaded onto `data === null`), and that an
 * active gym still returns the normal shell unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: unknown; error: unknown };

function makeQueryBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    in: vi.fn(() => builder),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
  };
  // Query builders without a terminal .single()/.maybeSingle() call (the
  // unfiltered allMembershipsResult read) are awaited directly -- make the
  // builder itself thenable so `await supabase.from(...).select().eq().is()`
  // resolves to `result`, mirroring the real supabase-js client.
  builder.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };
// `getDashboardShellContext()` calls `.from("members")` twice (the self-
// membership row, then the unfiltered across-gyms read) -- a per-table
// queue, not a single per-table result, is needed to give each call site
// its own shape (an object vs. an array).
let tableResultQueues: Record<string, QueryResult[]>;
let fromCalls: string[];
// Review finding fix (multi-gym switcher on the suspended screens): the
// suspended branch calls `list_own_active_gym_memberships()` (0074) via
// `.rpc()` instead of `.from("members")`, since the ordinary RLS-scoped
// query is blocked once the session's current gym is suspended.
let rpcResult: QueryResult;

function makeSupabaseStub() {
  return {
    auth: {
      getClaims: vi.fn(async () => claimsResult),
    },
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const queue = tableResultQueues[table] ?? [];
      const result = queue.length > 1 ? queue.shift()! : (queue[0] ?? { data: null, error: null });
      return makeQueryBuilder(result);
    }),
    rpc: vi.fn(async () => rpcResult),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeSupabaseStub()),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({
    t: (key: string) => key,
  })),
}));

const GYM_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const USER_ID = "9e107d9d-372b-4e19-9d69-8a4b1e1a5d0a";

describe("getDashboardShellContext -- suspension short-circuit (Story 11.4)", () => {
  beforeEach(() => {
    fromCalls = [];
    tableResultQueues = {};
    rpcResult = { data: [], error: null };
    claimsResult = {
      data: {
        claims: { sub: USER_ID, email: "owner@example.com", gym_id: GYM_ID, app_role: "owner" },
      },
      error: null,
    };
  });

  it("short-circuits on a suspended gym: returns a distinct `suspended` shape, isBillingSuspension true for the Owner, and never queries members", async () => {
    tableResultQueues.gyms = [{ data: { name: "FitZone", status: "suspended" }, error: null }];
    tableResultQueues.users = [{ data: { must_change_password: false }, error: null }];
    const { getDashboardShellContext } = await import("./session");

    const result = await getDashboardShellContext();

    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
    expect(result.suspended).toEqual({
      gymName: "FitZone",
      role: "owner",
      isBillingSuspension: true,
      mustChangePassword: false,
      gymId: GYM_ID,
      availableGyms: [],
    });
    expect(fromCalls).toEqual(["gyms", "users"]);
  });

  it("treats a deactivated gym as suspended too (isBillingSuspension false, even for the Owner)", async () => {
    tableResultQueues.gyms = [{ data: { name: "FitZone", status: "deactivated" }, error: null }];
    tableResultQueues.users = [{ data: { must_change_password: false }, error: null }];
    const { getDashboardShellContext } = await import("./session");

    const result = await getDashboardShellContext();

    expect(result.suspended).toEqual({
      gymName: "FitZone",
      role: "owner",
      isBillingSuspension: false,
      mustChangePassword: false,
      gymId: GYM_ID,
      availableGyms: [],
    });
  });

  it("reports isBillingSuspension true but role !== owner for a suspended gym's Manager -- caller (layout) decides that means the neutral screen", async () => {
    claimsResult.data!.claims = { sub: USER_ID, gym_id: GYM_ID, app_role: "manager" };
    tableResultQueues.gyms = [{ data: { name: "FitZone", status: "suspended" }, error: null }];
    tableResultQueues.users = [{ data: { must_change_password: false }, error: null }];
    const { getDashboardShellContext } = await import("./session");

    const result = await getDashboardShellContext();

    expect(result.suspended).toEqual({
      gymName: "FitZone",
      role: "manager",
      isBillingSuspension: true,
      mustChangePassword: false,
      gymId: GYM_ID,
      availableGyms: [],
    });
  });

  it("routes a suspended gym's temp-password Owner to /auth/update-password instead of the Pay-Now screen (mustChangePassword takes priority)", async () => {
    tableResultQueues.gyms = [{ data: { name: "FitZone", status: "suspended" }, error: null }];
    tableResultQueues.users = [{ data: { must_change_password: true }, error: null }];
    const { getDashboardShellContext } = await import("./session");

    const result = await getDashboardShellContext();

    expect(result.suspended).toEqual({
      gymName: "FitZone",
      role: "owner",
      isBillingSuspension: true,
      mustChangePassword: true,
      gymId: GYM_ID,
      availableGyms: [],
    });
  });

  it("populates availableGyms on the suspended branch via list_own_active_gym_memberships() (bypasses the RLS block a direct members query would hit)", async () => {
    tableResultQueues.gyms = [{ data: { name: "FitZone", status: "suspended" }, error: null }];
    tableResultQueues.users = [{ data: { must_change_password: false }, error: null }];
    rpcResult = {
      data: [
        { gym_id: GYM_ID, gym_name: "FitZone", role: "owner" },
        { gym_id: "other-gym-id", gym_name: "Second Gym", role: "manager" },
      ],
      error: null,
    };
    const { getDashboardShellContext } = await import("./session");

    const result = await getDashboardShellContext();

    expect(result.suspended?.availableGyms).toEqual([
      { gymId: GYM_ID, gymName: "FitZone", role: "owner" },
      { gymId: "other-gym-id", gymName: "Second Gym", role: "manager" },
    ]);
  });

  it("returns the normal shell (suspended: null) for an active gym", async () => {
    tableResultQueues.gyms = [{ data: { name: "FitZone", status: "active" }, error: null }];
    tableResultQueues.members = [
      { data: { id: "member-1", name: "Jane Owner" }, error: null },
      { data: [], error: null },
    ];
    tableResultQueues.users = [{ data: { must_change_password: false }, error: null }];
    const { getDashboardShellContext } = await import("./session");

    const result = await getDashboardShellContext();

    expect(result.suspended).toBeNull();
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      gymId: GYM_ID,
      gymName: "FitZone",
      role: "owner",
      mustChangePassword: false,
    });
    expect(fromCalls).toContain("members");
  });

  it("returns {data:null, error:null, suspended:null} for a session with no gym-scoped staff role, without ever querying gyms", async () => {
    claimsResult.data!.claims = { sub: USER_ID, app_role: "super_admin" };
    const { getDashboardShellContext } = await import("./session");

    const result = await getDashboardShellContext();

    expect(result).toEqual({ data: null, error: null, suspended: null });
    expect(fromCalls).toEqual([]);
  });
});
