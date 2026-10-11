/**
 * Story 19.9b: listMemberGuestSessions -- 90-day cutoff for voided and lapsed
 * rows, source from payment_id, method and recorder from the payments embed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let sessionRows: unknown[];
let actorRows: unknown[];

function from(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = () => b;
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: table === "members" ? actorRows : sessionRows, error: null }).then(resolve);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }) },
    from,
  })),
}));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "m" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })),
}));

const day = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
const ahead = (d: number) => new Date(Date.now() + d * day).toISOString();

const row = (o: Record<string, unknown>) => ({
  id: "s",
  payment_id: "p1",
  loyalty_grant_id: null,
  created_at: ago(1),
  usable_until: ahead(5),
  consumed_at: null,
  covered_day: null,
  voided_at: null,
  payments: { method: "cash", actor_id: "u1" },
  ...o,
});

describe("listMemberGuestSessions", () => {
  beforeEach(() => {
    actorRows = [{ user_id: "u1", name: "Rita" }];
  });

  it("drops voided and lapsed rows older than 90 days, keeps recent and used ones", async () => {
    sessionRows = [
      row({ id: "old-void", voided_at: ago(100) }),
      row({ id: "new-void", voided_at: ago(5) }),
      row({ id: "old-lapse", usable_until: ago(100) }),
      row({ id: "new-lapse", usable_until: ago(10) }),
      row({ id: "used", consumed_at: ago(200), usable_until: ago(190), covered_day: "2026-01-01" }),
    ];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.map((s) => s.id)).toEqual(["new-void", "new-lapse", "used"]);
  });

  it("marks a row without payment_id as free, with no method or recorder", async () => {
    sessionRows = [row({ payment_id: null, loyalty_grant_id: "g1", payments: null })];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.[0]).toMatchObject({ source: "free", method: null, recordedByName: null });
  });

  it("reads method and recorder from an array-shaped payments embed", async () => {
    sessionRows = [row({ payments: [{ method: "manual_momo", actor_id: "u1" }] })];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.[0]).toMatchObject({ source: "paid", method: "manual_momo", recordedByName: "Rita" });
  });

  it("gives a null recorder when the actor cannot be resolved", async () => {
    actorRows = [];
    sessionRows = [row({})];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.[0].recordedByName).toBeNull();
  });
});
