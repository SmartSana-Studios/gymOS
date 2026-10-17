/** Story 22.8: the cancel link is the credential; it cancels once and both mailboxes are told. */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const rpc = vi.fn<(fn: string, params: Record<string, unknown>) => Promise<typeof rpcResult>>(async () => rpcResult);
const send = vi.fn<(m: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (fn: string, p: Record<string, unknown>) => rpc(fn, p) }) }));
vi.mock("@/lib/mail", () => ({ sendMail: (m: unknown) => send(m) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));

import { cancelRecovery } from "./actions";

const token = "t".repeat(43);

beforeEach(() => {
  rpc.mockClear();
  send.mockClear();
  rpcResult = { data: [{ ok: true, user_id: "sa-1", login_email: "login@x.co", recovery_email: "rec@y.co" }], error: null };
});

describe("cancelRecovery", () => {
  it.each([undefined, "", "short", "x".repeat(201)])("rejects a malformed token (%s) without a database call", async (bad) => {
    expect(await cancelRecovery({ token: bad as never })).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("cancels once and tells both mailboxes", async () => {
    expect(await cancelRecovery({ token })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("recovery_cancel", { p_token: token });
    expect(send.mock.calls.map((c) => (c[0] as { to: string }).to).sort()).toEqual(["login@x.co", "rec@y.co"]);
  });
  it("answers not-ok and sends nothing for an unknown or used token", async () => {
    rpcResult = { data: [{ ok: false, user_id: null, login_email: null, recovery_email: null }], error: null };
    expect(await cancelRecovery({ token })).toEqual({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });
  it("a database error is not-ok and sends nothing", async () => {
    rpcResult = { data: null, error: { message: "down" } };
    expect(await cancelRecovery({ token })).toEqual({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });
  it("a failing mail send does not undo the cancel", async () => {
    send.mockRejectedValue(new Error("smtp down"));
    expect(await cancelRecovery({ token })).toEqual({ ok: true });
  });
});
