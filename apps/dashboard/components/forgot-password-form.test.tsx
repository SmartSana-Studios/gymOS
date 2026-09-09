/**
 * Password reset for staff (phone) alongside Owners (email).
 *
 * WHY THIS FLOW EXISTS. `createStaffMember()` provisions Supervisor / Manager /
 * Receptionist / Coach accounts from a phone number with NO email, so
 * `resetPasswordForEmail()` can never reach them -- staff had no self-service
 * recovery at all, only an Owner re-sending a temp password. Phone accounts now
 * reset by one-time code over the same rails member onboarding uses
 * (`signInWithOtp` -> `send-sms-hook` -> Evolution API / Twilio), then land on
 * `/auth/update-password`, which only needs a session.
 *
 * The assertions that matter most here are the negative ones: an OTP must never
 * be sent to a number that is not an active staff account (cost abuse on a
 * pre-auth surface, and Story 9.3's immediate revocation), and `signInWithOtp`
 * must never be called without `shouldCreateUser: false` -- the default would
 * provision an account for any number typed into a logged-out form.
 *
 * Mocking follows SettingsForm.billing.test.tsx: mock the boundary, render with
 * React Testing Library, drive the real submit flow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const rpc = vi.fn();
const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const resetPasswordForEmail = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => rpc(...args),
    auth: {
      signInWithOtp: (...args: unknown[]) => signInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => verifyOtp(...args),
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmail(...args),
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const TRANSLATIONS: Record<string, string> = {
  "auth.resetPasswordTitle": "Reset Your Password",
  "auth.resetIdentifierDescription": "Enter your email address or phone number",
  "auth.identifierLabel": "Email address or phone number *",
  "auth.identifierPlaceholder": "you@example.com or +237…",
  "auth.resetSendCode": "Send code",
  "auth.resetSendingCode": "Sending…",
  "auth.otpTitle": "Enter your code",
  "auth.otpLabel": "6-digit code",
  "auth.otpVerify": "Verify code",
  "auth.otpVerifying": "Verifying…",
  "auth.otpResend": "Resend code",
  "auth.otpChangeNumber": "Use a different email or number",
  "auth.checkYourEmail": "Check Your Email",
  "auth.passwordResetSent": "Password reset instructions sent",
  "auth.passwordResetSentBody": "If you registered using your email…",
  "auth.alreadyHaveAccount": "Already have an account?",
  "auth.loginLink": "Login",
  "auth.errors.phoneNotStaff": "No active staff account uses that phone number.",
  "auth.errors.otpSendFailed": "Couldn’t send the code. Try again.",
  "auth.errors.otpIncorrect": "That code is incorrect or has expired.",
  "auth.errors.otpLockedOut": "Too many attempts. Try again later.",
  "auth.errors.network": "Couldn't connect. Check your internet connection.",
  "common.somethingWentWrong": "Something went wrong.",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "auth.otpSentTo") return `We sent a 6-digit code to ${vars?.phone}`;
      if (key === "auth.otpResendCountdown") return `Resend in ${vars?.seconds}s`;
      return TRANSLATIONS[key] ?? key;
    },
    i18n: { language: "en" },
  }),
}));

const { ForgotPasswordForm } = await import("./forgot-password-form");

afterEach(cleanup);

async function submitIdentifier(value: string, props: { resendCooldownSeconds?: number } = {}) {
  const user = userEvent.setup();
  render(<ForgotPasswordForm {...props} />);
  await user.type(screen.getByLabelText(TRANSLATIONS["auth.identifierLabel"]!), value);
  await user.click(screen.getByRole("button", { name: "Send code" }));
  return user;
}

/** Drives the phone path all the way to the code-entry step. */
async function reachVerifyStep(props: { resendCooldownSeconds?: number } = {}) {
  const user = await submitIdentifier("+237670000005", props);
  await screen.findByText("Enter your code");
  return user;
}

describe("ForgotPasswordForm -- staff phone reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: true, error: null });
    signInWithOtp.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it("checks the number is an ACTIVE STAFF account before sending, and sends the code to the canonical E.164 form", async () => {
    await submitIdentifier("+237670000005");

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("phone_has_staff_membership", { p_phone: "+237670000005" });
    // The existence check must precede the send -- that ordering is the whole
    // cost-abuse mitigation.
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(signInWithOtp.mock.invocationCallOrder[0]!);
    expect(await screen.findByText("Enter your code")).toBeTruthy();
  });

  it("never provisions an account from this logged-out form", async () => {
    await submitIdentifier("+237670000005");

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
    expect(signInWithOtp).toHaveBeenCalledWith({
      phone: "+237670000005",
      options: { shouldCreateUser: false },
    });
  });

  it("normalizes a number typed with spaces, and one typed without the leading plus", async () => {
    await submitIdentifier("237 670 000 005");

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("phone_has_staff_membership", { p_phone: "+237670000005" });
  });

  it("sends NOTHING when the number is not an active staff account", async () => {
    rpc.mockResolvedValue({ data: false, error: null });

    await submitIdentifier("+237670000101");

    expect(await screen.findByText(TRANSLATIONS["auth.errors.phoneNotStaff"]!)).toBeTruthy();
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(screen.queryByText("Enter your code")).toBeNull();
  });

  it("sends NOTHING when the staff check itself fails, rather than falling through to a send", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    await submitIdentifier("+237670000005");

    expect(await screen.findByText(TRANSLATIONS["auth.errors.network"]!)).toBeTruthy();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("stays on the identify step when the provider refuses the send", async () => {
    signInWithOtp.mockResolvedValue({ error: { message: "sms failed" } });

    await submitIdentifier("+237670000005");

    expect(await screen.findByText(TRANSLATIONS["auth.errors.otpSendFailed"]!)).toBeTruthy();
    expect(screen.queryByText("Enter your code")).toBeNull();
  });

  it("verifies the code and hands off to the update-password screen, which needs no email", async () => {
    const user = await submitIdentifier("+237670000005");
    await screen.findByText("Enter your code");

    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/auth/update-password"));
    expect(verifyOtp).toHaveBeenCalledWith({
      phone: "+237670000005",
      token: "123456",
      type: "sms",
    });
  });

  it("does not navigate on a wrong code", async () => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: "invalid" } });
    const user = await submitIdentifier("+237670000005");
    await screen.findByText("Enter your code");

    await user.type(screen.getByLabelText("6-digit code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(await screen.findByText(TRANSLATIONS["auth.errors.otpIncorrect"]!)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  // The resend pair below renders with resendCooldownSeconds={0}. Without it
  // the 30s countdown leaves the button DISABLED, and a click proves nothing --
  // `signInWithOtp` would be uncalled whether the server lockout works or not.
  // Both tests also assert on rendered outcomes, not just on a missing call, so
  // neither can pass merely because resending is broken.
  it("rejects a locked-out resend without sending another message", async () => {
    const user = await reachVerifyStep({ resendCooldownSeconds: 0 });
    signInWithOtp.mockClear();
    rpc.mockResolvedValue({
      data: [{ allowed: false, locked_until: null, attempts_remaining: 0 }],
      error: null,
    });

    await user.click(screen.getByRole("button", { name: "Resend code" }));

    expect(await screen.findByText(TRANSLATIONS["auth.errors.otpLockedOut"]!)).toBeTruthy();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("does resend when the server allows it -- so the lockout test above cannot pass vacuously", async () => {
    const user = await reachVerifyStep({ resendCooldownSeconds: 0 });
    signInWithOtp.mockClear();
    rpc.mockImplementation(async (fn: string) =>
      fn === "record_otp_resend"
        ? { data: [{ allowed: true, locked_until: null, attempts_remaining: 2 }], error: null }
        : { data: true, error: null },
    );

    await user.click(screen.getByRole("button", { name: "Resend code" }));

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(TRANSLATIONS["auth.errors.otpLockedOut"]!)).toBeNull();
  });
});

describe("ForgotPasswordForm -- Owner email reset is unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: true, error: null });
    signInWithOtp.mockResolvedValue({ error: null });
    resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it("still sends a reset link for an email, and never touches the OTP path", async () => {
    await submitIdentifier("owner@irontemple.test");

    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalled());
    expect(resetPasswordForEmail.mock.calls[0]?.[0]).toBe("owner@irontemple.test");
    expect(rpc).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(await screen.findByText("Check Your Email")).toBeTruthy();
  });
});
