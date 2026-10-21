/** Story 23.8: the Owner's disclosure request wraps 0142's RPCs and turns a refusal code into Owner copy. */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown };
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<typeof rpcResult>>(async () => rpcResult);

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { fileDisclosureRequest, listDisclosureRequests } from "./auditDisclosure";

describe("fileDisclosureRequest", () => {
  beforeEach(() => rpc.mockClear());

  it("files against one audit row and returns the due date", async () => {
    rpcResult = { data: [{ ok: true, code: "ok", request_id: "req-1", answer_due_at: "2026-10-28T10:00:00Z" }], error: null };
    await expect(fileDisclosureRequest("audit-1", "Who made this change?")).resolves.toEqual({
      data: { requestId: "req-1", answerDueAt: "2026-10-28T10:00:00Z" },
      error: null,
    });
    expect(rpc.mock.calls[0]).toEqual(["file_audit_disclosure_request", { p_audit_log_id: "audit-1", p_question: "Who made this change?" }]);
  });

  it.each([
    ["question_invalid", "audit.disclosure.errors.questionInvalid"],
    ["not_found", "audit.disclosure.errors.notFound"],
    ["already_open", "audit.disclosure.errors.alreadyOpen"],
  ])("turns the %s refusal into Owner copy", async (code, key) => {
    rpcResult = { data: [{ ok: false, code, request_id: null, answer_due_at: null }], error: null };
    const result = await fileDisclosureRequest("audit-1", "x");
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe(key);
  });

  it("returns a mapped error when the RPC raises (a non-Owner is refused by the database)", async () => {
    rpcResult = { data: null, error: { message: "permission denied" } };
    await expect(fileDisclosureRequest("audit-1", "Who?")).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});

describe("listDisclosureRequests", () => {
  it("maps the Owner's rows and never carries who answered", async () => {
    rpcResult = {
      data: [{ id: "req-1", audit_log_id: "audit-1", question: "Who?", requested_at: "2026-10-21T10:00:00Z", answer_due_at: "2026-10-26T10:00:00Z", answered_at: null, answer: null }],
      error: null,
    };
    const result = await listDisclosureRequests();
    expect(result.data).toEqual([
      { id: "req-1", auditLogId: "audit-1", question: "Who?", requestedAt: "2026-10-21T10:00:00Z", answerDueAt: "2026-10-26T10:00:00Z", answeredAt: null, answer: null },
    ]);
    expect(Object.keys(result.data?.[0] ?? {})).not.toContain("answeredBy");
  });
});
