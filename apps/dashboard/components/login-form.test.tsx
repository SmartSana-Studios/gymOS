/**
 * Story 23-6b: sign-in routing. A person with a verified authenticator (GymOS Support: nextLevel aal2) goes to the code step before
 * anything loads; staff with no factor go straight on, exactly as before. The expired banner shows after the proxy ended a session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signInWithPassword = vi.fn();
const getAuthenticatorAssuranceLevel = vi.fn();
const signOut = vi.fn();
const push = vi.fn();
const refresh = vi.fn();
const assign = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      signOut: (...a: unknown[]) => signOut(...a),
      mfa: { getAuthenticatorAssuranceLevel: () => getAuthenticatorAssuranceLevel() },
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { LoginForm } from "./login-form";

async function signIn(props: Parameters<typeof LoginForm>[0] = {}) {
  render(<LoginForm {...props} />);
  await userEvent.type(screen.getByLabelText("auth.identifierLabel"), "qa@example.com");
  await userEvent.type(document.getElementById("password") as HTMLInputElement, "secret-pass-1");
  await userEvent.click(screen.getByRole("button", { name: "auth.signIn" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  signInWithPassword.mockResolvedValue({ error: null });
  getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
});

describe("LoginForm second factor routing", () => {
  it("sends a person with a verified authenticator to the code step, carrying a safe next", async () => {
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    await signIn({ redirectTo: "/members?filter=x" });
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`/auth/mfa?next=${encodeURIComponent("/members?filter=x")}`));
    expect(push).not.toHaveBeenCalled();
  });

  it("never carries an off-site next to the code step", async () => {
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    await signIn({ redirectTo: "//evil.example.com" });
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`/auth/mfa?next=${encodeURIComponent("/")}`));
  });

  it("staff with no factor go straight to the dashboard (unchanged)", async () => {
    await signIn({ redirectTo: "/plans" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/plans"));
    expect(assign).not.toHaveBeenCalled();
  });

  it("fails closed when the assurance level cannot be read: generic error, signed out, no navigation", async () => {
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: null, error: { message: "boom" } });
    await signIn();
    await screen.findByText("common.somethingWentWrong");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(push).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("a wrong password never reaches the assurance check", async () => {
    signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials" } });
    await signIn();
    await screen.findByText("auth.errors.invalidCredentials");
    expect(getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });

  it("shows the expired banner only when asked", () => {
    const { unmount } = render(<LoginForm expired />);
    expect(screen.getByText("auth.sessionExpired")).toBeInTheDocument();
    unmount();
    render(<LoginForm />);
    expect(screen.queryByText("auth.sessionExpired")).toBeNull();
  });
});
