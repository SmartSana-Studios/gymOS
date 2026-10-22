/**
 * Story 23-6b: the authenticator-code step. A wrong code gets one generic message and a retry; an accepted code forgets the previous
 * gym (support_begin_session) and refreshes the token before the picker; any failure after the code fails closed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listFactors = vi.fn();
const challengeAndVerify = vi.fn();
const refreshSession = vi.fn();
const signOut = vi.fn();
const rpc = vi.fn();
const assign = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: {
      mfa: { listFactors: () => listFactors(), challengeAndVerify: (...a: unknown[]) => challengeAndVerify(...a) },
      refreshSession: () => refreshSession(),
      signOut: (...a: unknown[]) => signOut(...a),
    },
  }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { MfaForm } from "./mfa-form";

async function submit(code: string) {
  await userEvent.type(await screen.findByLabelText("supportAccess.codeLabel"), code);
  await userEvent.click(screen.getByRole("button", { name: "supportAccess.verify" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  listFactors.mockResolvedValue({ data: { totp: [{ id: "f1" }] }, error: null });
  challengeAndVerify.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ error: null });
  refreshSession.mockResolvedValue({ error: null });
  signOut.mockResolvedValue({ error: null });
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
});

describe("MfaForm", () => {
  it("verifies, forgets the previous gym, refreshes the token and moves on to the picker", async () => {
    render(<MfaForm />);
    await submit("123456");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/support-gym"));
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
    expect(rpc).toHaveBeenCalledWith("support_begin_session");
    expect(refreshSession).toHaveBeenCalled();
    const order = [challengeAndVerify, rpc, refreshSession].map((m) => m.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("carries a non-default next to the picker", async () => {
    render(<MfaForm next="/payments" />);
    await submit("123456");
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`/support-gym?next=${encodeURIComponent("/payments")}`));
  });

  it("a wrong code shows one generic message and allows a retry; nothing else runs", async () => {
    challengeAndVerify.mockResolvedValue({ error: { message: "Invalid TOTP code entered" } });
    render(<MfaForm />);
    await submit("000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("supportAccess.invalidCode");
    expect(rpc).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "supportAccess.verify" })).toBeEnabled();
  });

  it("fails closed when the session cannot begin: signed out locally, a neutral error (not 'invalid code')", async () => {
    rpc.mockResolvedValue({ error: { message: "boom" } });
    render(<MfaForm />);
    await submit("123456");
    expect(await screen.findByRole("alert")).toHaveTextContent("supportAccess.signInFailed");
    expect(screen.queryByText("supportAccess.invalidCode")).toBeNull();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(refreshSession).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalledWith("/support-gym");
  });

  it("fails closed when the token cannot be refreshed", async () => {
    refreshSession.mockResolvedValue({ error: { message: "boom" } });
    render(<MfaForm />);
    await submit("123456");
    expect(await screen.findByRole("alert")).toHaveTextContent("supportAccess.signInFailed");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(assign).not.toHaveBeenCalledWith("/support-gym");
  });

  it("with no verified authenticator there is no code field, only a sign-out", async () => {
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    render(<MfaForm />);
    expect(await screen.findByRole("alert")).toHaveTextContent("supportAccess.noFactor");
    expect(screen.queryByLabelText("supportAccess.codeLabel")).toBeNull();
  });
});
