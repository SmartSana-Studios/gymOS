/**
 * Story 11.3 (Task 4, AC #1-#5): unit tests for the saas-billing-reminders
 * Vercel Cron route. `createAdminClient()` is mocked with a generic
 * per-table FIFO-queue query builder (chainable select/eq/neq/is/in,
 * thenable, plus maybeSingle()/insert() terminal calls) since the real
 * Supabase query builder is exercised end-to-end by the pgTAP suite
 * already -- these tests are about this route's own orchestration logic
 * (due-gym computation, dedup, fan-out, dual-channel dispatch, aggregation),
 * not RLS/SQL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryResponse = { data: unknown; error: unknown };
type CallLogEntry = { table: string; op: string; args: unknown[] };

let queues: Record<string, QueryResponse[]>;
let callLog: CallLogEntry[];
let insertCalls: { table: string; payload: unknown }[];

function popResponse(table: string): QueryResponse {
  const q = queues[table];
  if (!q || q.length === 0) {
    throw new Error(`test setup error: no queued response for table "${table}"`);
  }
  return q.shift()!;
}

function makeAdminStub() {
  return {
    from: (table: string) => {
      const builder: {
        select: (...args: unknown[]) => typeof builder;
        eq: (...args: unknown[]) => typeof builder;
        neq: (...args: unknown[]) => typeof builder;
        is: (...args: unknown[]) => typeof builder;
        in: (...args: unknown[]) => typeof builder;
        maybeSingle: () => Promise<QueryResponse>;
        insert: (payload: unknown) => Promise<QueryResponse>;
        then: (resolve: (v: QueryResponse) => unknown, reject: (e: unknown) => unknown) => unknown;
      } = {
        select: (...args) => {
          callLog.push({ table, op: "select", args });
          return builder;
        },
        eq: (...args) => {
          callLog.push({ table, op: "eq", args });
          return builder;
        },
        neq: (...args) => {
          callLog.push({ table, op: "neq", args });
          return builder;
        },
        is: (...args) => {
          callLog.push({ table, op: "is", args });
          return builder;
        },
        in: (...args) => {
          callLog.push({ table, op: "in", args });
          return builder;
        },
        maybeSingle: async () => popResponse(table),
        insert: async (payload: unknown) => {
          insertCalls.push({ table, payload });
          return popResponse(table);
        },
        then: (resolve, reject) => Promise.resolve(popResponse(table)).then(resolve, reject),
      };
      return builder;
    },
  };
}

const sendEvolutionApiMessage = vi.fn();
const sendTwilioSms = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => makeAdminStub()),
}));

vi.mock("@/lib/messaging/EvolutionApiMessageProvider", () => ({
  sendEvolutionApiMessage: (...args: unknown[]) => sendEvolutionApiMessage(...args),
}));

vi.mock("@/lib/messaging/sendTwilioSms", () => ({
  sendTwilioSms: (...args: unknown[]) => sendTwilioSms(...args),
}));

const CRON_SECRET = "test-cron-secret";

function makeRequest(secret: string | null): Request {
  const headers = new Headers();
  if (secret !== null) headers.set("authorization", `Bearer ${secret}`);
  return new Request("https://example.com/api/cron/saas-billing-reminders", { headers });
}

// Every test that reaches the due-gym loop needs all 4 offset queries plus a
// job_runs write queued -- this helper seeds the "no due gyms anywhere"
// baseline that individual tests then override for the offset(s) they care
// about.
function seedEmptyGymQueues() {
  queues.gyms = [
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  ];
  queues.job_runs = [{ data: null, error: null }];
}

describe("GET /api/cron/saas-billing-reminders", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
    queues = {};
    callLog = [];
    insertCalls = [];
    sendEvolutionApiMessage.mockReset();
    sendTwilioSms.mockReset();
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.DASHBOARD_APP_URL = "https://app.example.com";
    delete process.env.SAAS_BILLING_REMINDERS_ENABLED;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 401 and queries nothing when the CRON_SECRET is missing", async () => {
    const { GET } = await import("./route");

    const response = await GET(makeRequest(null) as never);

    expect(response.status).toBe(401);
    expect(callLog).toEqual([]);
  });

  it("returns 401 and queries nothing when the CRON_SECRET is wrong", async () => {
    const { GET } = await import("./route");

    const response = await GET(makeRequest("wrong-secret") as never);

    expect(response.status).toBe(401);
    expect(callLog).toEqual([]);
  });

  it("returns 401 when CRON_SECRET is not configured on the server at all, even with a matching header", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("./route");

    const response = await GET(makeRequest(CRON_SECRET) as never);

    expect(response.status).toBe(401);
  });

  it("SAAS_BILLING_REMINDERS_ENABLED=false short-circuits before any DB query, after the CRON_SECRET check passes", async () => {
    process.env.SAAS_BILLING_REMINDERS_ENABLED = "false";
    const { GET } = await import("./route");

    const response = await GET(makeRequest(CRON_SECRET) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, sent: 0, skipped: 0, failed: 0, disabled: true });
    expect(callLog).toEqual([]);
  });

  it("SAAS_BILLING_REMINDERS_ENABLED unset reaches the due-gym query -- the kill switch does not block the default-enabled path", async () => {
    seedEmptyGymQueues();
    const { GET } = await import("./route");

    await GET(makeRequest(CRON_SECRET) as never);

    expect(callLog.some((c) => c.table === "gyms")).toBe(true);
  });

  it("queries gyms at exactly the 4 offsets (0/1/3/5 days), not one day early or late", async () => {
    seedEmptyGymQueues();
    const { GET } = await import("./route");

    await GET(makeRequest(CRON_SECRET) as never);

    const anchorDateFilters = callLog
      .filter((c) => c.table === "gyms" && c.op === "eq" && c.args[0] === "saas_billing_anchor_date")
      .map((c) => c.args[1]);

    // System time frozen at 2026-08-27 -- offsets 0/1/3/5 days back.
    expect(anchorDateFilters).toEqual(["2026-08-27", "2026-08-26", "2026-08-24", "2026-08-22"]);
  });

  it("excludes deactivated and suspended gyms from every offset's query", async () => {
    seedEmptyGymQueues();
    const { GET } = await import("./route");

    await GET(makeRequest(CRON_SECRET) as never);

    const gymsCalls = callLog.filter((c) => c.table === "gyms");
    const deactivatedExclusions = gymsCalls.filter((c) => c.op === "neq" && c.args[0] === "status" && c.args[1] === "deactivated");
    const suspendedExclusions = gymsCalls.filter(
      (c) => c.op === "neq" && c.args[0] === "saas_billing_status" && c.args[1] === "suspended",
    );
    expect(deactivatedExclusions).toHaveLength(4);
    expect(suspendedExclusions).toHaveLength(4);
  });

  it("skips a gym already notified for the same (gym, cycle, offset) -- no messages sent, no second notice inserted", async () => {
    queues.gyms = [
      { data: [{ id: "gym-1", saas_billing_anchor_date: "2026-08-27" }], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ];
    // alreadyNotified() finds an existing row.
    queues.saas_billing_notices = [{ data: { id: "notice-existing" }, error: null }];
    queues.job_runs = [{ data: null, error: null }];
    const { GET } = await import("./route");

    const response = await GET(makeRequest(CRON_SECRET) as never);
    const body = await response.json();

    expect(body).toEqual({ success: true, sent: 0, skipped: 1, failed: 0 });
    expect(sendEvolutionApiMessage).not.toHaveBeenCalled();
    expect(sendTwilioSms).not.toHaveBeenCalled();
    expect(insertCalls.filter((c) => c.table === "saas_billing_notices")).toHaveLength(0);
  });

  it("sends to every active owner-role member (multi-owner fan-out), and records one aggregated notice row with sent status", async () => {
    queues.gyms = [
      { data: [{ id: "gym-1", saas_billing_anchor_date: "2026-08-27" }], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues.saas_billing_notices = [
      { data: null, error: null }, // alreadyNotified() -- not yet notified
      { data: null, error: null }, // insert
    ];
    queues.members = [
      {
        data: [
          { phone: "+237680000001", email: "owner1@example.com", user_id: "user-1" },
          { phone: "+237680000002", email: null, user_id: "user-2" },
        ],
        error: null,
      },
    ];
    queues.users = [
      {
        data: [
          { id: "user-1", preferred_language: "fr" },
          { id: "user-2", preferred_language: "en" },
        ],
        error: null,
      },
    ];
    queues.job_runs = [{ data: null, error: null }];
    sendEvolutionApiMessage.mockResolvedValue({ success: true, channel: "whatsapp" });
    sendTwilioSms.mockResolvedValue({ success: true });
    const { GET } = await import("./route");

    const response = await GET(makeRequest(CRON_SECRET) as never);
    const body = await response.json();

    expect(body).toEqual({ success: true, sent: 1, skipped: 0, failed: 0 });
    expect(sendEvolutionApiMessage).toHaveBeenCalledTimes(2);
    expect(sendTwilioSms).toHaveBeenCalledTimes(2);

    // Owner 1 (fr) gets the French copy with their own gym's due date/link.
    const [phone1, message1] = sendEvolutionApiMessage.mock.calls[0] as [string, string];
    expect(phone1).toBe("+237680000001");
    expect(message1).toContain("2026-08-27");
    expect(message1).toContain("https://app.example.com/settings");
    expect(message1).toContain("abonnement GymOS");

    // Owner 2 (en) gets the English copy.
    const [phone2, message2] = sendEvolutionApiMessage.mock.calls[1] as [string, string];
    expect(phone2).toBe("+237680000002");
    expect(message2).toContain("GymOS subscription payment");

    const noticeInsert = insertCalls.find((c) => c.table === "saas_billing_notices");
    expect(noticeInsert?.payload).toMatchObject({
      gym_id: "gym-1",
      notice_day_offset: 0,
      billing_anchor_date_at_notice: "2026-08-27",
      sms_status: "sent",
      whatsapp_status: "sent",
      // Owner 1 has an email on file -- best-effort email is "attempted"
      // but there's no provider, so this is an honest no-op, not a
      // fabricated success.
      email_status: "skipped_no_provider",
    });
  });

  it("records email_status as skipped_no_email_on_file when no owner has an email on file", async () => {
    queues.gyms = [
      { data: [{ id: "gym-1", saas_billing_anchor_date: "2026-08-27" }], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues.saas_billing_notices = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    queues.members = [{ data: [{ phone: "+237680000001", email: null, user_id: "user-1" }], error: null }];
    queues.users = [{ data: [{ id: "user-1", preferred_language: "en" }], error: null }];
    queues.job_runs = [{ data: null, error: null }];
    sendEvolutionApiMessage.mockResolvedValue({ success: true, channel: "whatsapp" });
    sendTwilioSms.mockResolvedValue({ success: true });
    const { GET } = await import("./route");

    await GET(makeRequest(CRON_SECRET) as never);

    const noticeInsert = insertCalls.find((c) => c.table === "saas_billing_notices");
    expect((noticeInsert?.payload as { email_status: string }).email_status).toBe("skipped_no_email_on_file");
  });

  it("records a channel as failed (with the first real error) when every owner's send on that channel fails -- never a fabricated success", async () => {
    queues.gyms = [
      { data: [{ id: "gym-1", saas_billing_anchor_date: "2026-08-27" }], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues.saas_billing_notices = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    queues.members = [{ data: [{ phone: "+237680000001", email: null, user_id: "user-1" }], error: null }];
    queues.users = [{ data: [{ id: "user-1", preferred_language: "en" }], error: null }];
    queues.job_runs = [{ data: null, error: null }];
    sendEvolutionApiMessage.mockResolvedValue({ success: false, error: "Evolution API 500: gateway error" });
    sendTwilioSms.mockResolvedValue({ success: true });
    const { GET } = await import("./route");

    await GET(makeRequest(CRON_SECRET) as never);

    const noticeInsert = insertCalls.find((c) => c.table === "saas_billing_notices");
    expect(noticeInsert?.payload).toMatchObject({
      whatsapp_status: "failed",
      whatsapp_error: "Evolution API 500: gateway error",
      sms_status: "sent",
      sms_error: null,
    });
  });

  it("continues processing other due gyms when one gym's processing throws (per-gym isolation)", async () => {
    queues.gyms = [
      { data: [{ id: "gym-broken", saas_billing_anchor_date: "2026-08-27" }], error: null },
      { data: [{ id: "gym-2", saas_billing_anchor_date: "2026-08-26" }], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ];
    // gym-broken's own dedup check errors out; gym-2's own dedup + full
    // send flow succeeds.
    queues.saas_billing_notices = [
      { data: null, error: { message: "connection reset" } }, // gym-broken -- throws
      { data: null, error: null }, // gym-2 -- not yet notified
      { data: null, error: null }, // gym-2 -- insert
    ];
    queues.members = [{ data: [{ phone: "+237680000009", email: null, user_id: "user-9" }], error: null }];
    queues.users = [{ data: [{ id: "user-9", preferred_language: "en" }], error: null }];
    queues.job_runs = [{ data: null, error: null }];
    sendEvolutionApiMessage.mockResolvedValue({ success: true, channel: "whatsapp" });
    sendTwilioSms.mockResolvedValue({ success: true });
    const { GET } = await import("./route");

    const response = await GET(makeRequest(CRON_SECRET) as never);
    const body = await response.json();

    expect(body).toEqual({ success: true, sent: 1, skipped: 0, failed: 1 });
  });

  it("records a job_runs failure row and returns 500 when the due-gym query itself fails", async () => {
    queues.gyms = [{ data: null, error: { message: "connection refused" } }];
    queues.job_runs = [{ data: null, error: null }];
    const { GET } = await import("./route");

    const response = await GET(makeRequest(CRON_SECRET) as never);

    expect(response.status).toBe(500);
    const jobRunInsert = insertCalls.find((c) => c.table === "job_runs");
    expect((jobRunInsert?.payload as { status: string }).status).toBe("failure");
  });
});
