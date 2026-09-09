"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isPhoneIdentifier, toE164Phone } from "@gymos/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** Seconds before the resend link re-arms. Matches the member-onboarding OTP
 * screen's own cooldown so the two phone flows behave identically. */
const RESEND_COOLDOWN_SECONDS = 30;

type Step = "identify" | "verify" | "emailSent";

/**
 * Password reset for BOTH kinds of dashboard account.
 *
 * Owners have an email (createGym() sets one) and keep the original
 * `resetPasswordForEmail` link flow untouched.
 *
 * Staff -- Supervisor / Manager / Receptionist / Coach -- are provisioned by
 * `createStaffMember()` from a phone number with NO email, so a reset *link*
 * can never reach them. Until now that left them with no self-service recovery
 * at all; their only route was an Owner re-sending a temp password. They now
 * reset by one-time code over the same rails member onboarding already uses:
 * `signInWithOtp` -> the `send-sms-hook` edge function -> the Evolution API /
 * Twilio provider chain, then `verifyOtp`, which yields a real session. That
 * session is all `/auth/update-password` needs -- it calls
 * `updateUser({ password })` and never touches an email address.
 */
export function ForgotPasswordForm({
  className,
  /** Test seam. The countdown is only a client-side convenience -- the real
   * limit is `record_otp_resend` server-side -- so a test overriding it to 0
   * to reach the resend handler does not weaken what is being verified. */
  resendCooldownSeconds = RESEND_COOLDOWN_SECONDS,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { resendCooldownSeconds?: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [step, setStep] = useState<Step>("identify");
  const [identifier, setIdentifier] = useState("");
  // The canonical "+"-prefixed form, resolved once when the code is sent, so
  // verify/resend cannot drift from what was actually sent to.
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function sendCode(targetPhone: string): Promise<boolean> {
    const supabase = createClient();
    // Existence check BEFORE signInWithOtp, mirroring the member phone screen:
    // an unknown or non-staff number never reaches the messaging provider
    // (Story 2.6's cost-abuse mitigation), and a deactivated staff account
    // stays revoked (Story 9.3).
    const { data: isStaff, error: rpcError } = await supabase.rpc("phone_has_staff_membership", {
      p_phone: targetPhone,
    });
    if (rpcError) {
      setError(t("auth.errors.network"));
      return false;
    }
    if (!isStaff) {
      setError(t("auth.errors.phoneNotStaff"));
      return false;
    }

    // `shouldCreateUser: false` is load-bearing on a pre-auth surface: the
    // default would PROVISION an account for any number typed here.
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: targetPhone,
      options: { shouldCreateUser: false },
    });
    if (otpError) {
      setError(t("auth.errors.otpSendFailed"));
      return false;
    }
    return true;
  }

  const handleIdentify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (isPhoneIdentifier(identifier)) {
        const targetPhone = toE164Phone(identifier);
        if (await sendCode(targetPhone)) {
          setPhone(targetPhone);
          setCountdown(resendCooldownSeconds);
          setStep("verify");
        }
        return;
      }

      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(identifier.trim(), {
        redirectTo: `${window.location.origin}/auth/update-password`,
      });
      if (resetError) throw resetError;
      setStep("emailSent");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : t("common.somethingWentWrong"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: code.trim(),
        type: "sms",
      });
      if (verifyError || !data.session) {
        setError(t("auth.errors.otpIncorrect"));
        setCode("");
        return;
      }
      // A real session now exists, which is the only thing the update-password
      // screen requires -- it never reads an email.
      router.push("/auth/update-password");
      router.refresh();
    } catch {
      setError(t("auth.errors.network"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || isLoading) return;
    setError(null);
    setIsLoading(true);
    try {
      const supabase = createClient();
      // Server-side lockout, shared with member onboarding -- the client
      // countdown above is a convenience, this is the actual limit.
      const { data: resendResult, error: rpcError } = await supabase.rpc("record_otp_resend", {
        p_phone: phone,
      });
      const result = Array.isArray(resendResult) ? resendResult[0] : resendResult;
      if (rpcError) {
        setError(t("auth.errors.network"));
        return;
      }
      if (!result?.allowed) {
        setError(t("auth.errors.otpLockedOut"));
        return;
      }
      if (await sendCode(phone)) {
        setCountdown(resendCooldownSeconds);
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (step === "emailSent") {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{t("auth.checkYourEmail")}</CardTitle>
            <CardDescription>{t("auth.passwordResetSent")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t("auth.passwordResetSentBody")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{t("auth.otpTitle")}</CardTitle>
            <CardDescription>{t("auth.otpSentTo", { phone })}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerify}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="otp">{t("auth.otpLabel")}</Label>
                  <Input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading || code.length < 6}>
                  {isLoading ? t("auth.otpVerifying") : t("auth.otpVerify")}
                </Button>
                <div className="flex flex-col gap-2 text-center text-sm">
                  <button
                    type="button"
                    onClick={() => void handleResend()}
                    disabled={countdown > 0 || isLoading}
                    className="underline underline-offset-4 disabled:no-underline disabled:text-muted-foreground"
                  >
                    {countdown > 0
                      ? t("auth.otpResendCountdown", { seconds: countdown })
                      : t("auth.otpResend")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep("identify");
                      setCode("");
                      setError(null);
                    }}
                    className="text-muted-foreground underline underline-offset-4"
                  >
                    {t("auth.otpChangeNumber")}
                  </button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t("auth.resetPasswordTitle")}</CardTitle>
          <CardDescription>{t("auth.resetIdentifierDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleIdentify}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="identifier">{t("auth.identifierLabel")}</Label>
                <Input
                  id="identifier"
                  // `text`, not `email`: staff reset by phone, and native email
                  // validation would reject a number before submit.
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  placeholder={t("auth.identifierPlaceholder")}
                  required
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t("auth.resetSendingCode") : t("auth.resetSendCode")}
              </Button>
              <div className="text-center text-sm">
                {t("auth.alreadyHaveAccount")}{" "}
                <Link href="/auth/login" className="underline underline-offset-4">
                  {t("auth.loginLink")}
                </Link>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
