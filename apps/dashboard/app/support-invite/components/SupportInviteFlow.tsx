"use client";

import { useState, useTransition } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { beginSupportTotp, setSupportInvitePassword, verifySupportTotp } from "../actions";

type Step = "password" | "totp" | "done" | "invalid";

interface Enrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

/** Story 23.4: the two-step invite page: set a password, then enrol an authenticator. Every failure shows one generic message. */
export function SupportInviteFlow({ token, initialStep }: { token: string | null; initialStep: "password" | "totp" | null }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(token && initialStep ? initialStep : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 'invalid' is also the dead end after the invite is used up or locked.
  const generic = t("supportInvite.invalid");

  function startEnrollment() {
    startTransition(async () => {
      if (!token) return;
      const res = await beginSupportTotp(token);
      if (!res.ok) {
        setError(t("supportInvite.enrollRetry"));
        return;
      }
      setError(null);
      setEnrollment({ factorId: res.factorId, qrCode: res.qrCode, secret: res.secret });
    });
  }

  function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("supportInvite.mismatch"));
      return;
    }
    startTransition(async () => {
      if (!token) return;
      const res = await setSupportInvitePassword(token, password);
      if (!res.ok) {
        if (res.weak) setError(t("supportInvite.weak"));
        else setStep("invalid");
        return;
      }
      setPassword("");
      setConfirm("");
      setStep("totp");
      const enroll = await beginSupportTotp(token);
      if (!enroll.ok) {
        // The password is already saved: stay on step 2 and let the person retry the QR code.
        setError(t("supportInvite.enrollRetry"));
        return;
      }
      setEnrollment({ factorId: enroll.factorId, qrCode: enroll.qrCode, secret: enroll.secret });
    });
  }

  function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      if (!token || !enrollment) return;
      const res = await verifySupportTotp(token, enrollment.factorId, code.trim());
      if (res.ok) {
        setStep("done");
        return;
      }
      setCode("");
      if (res.canRetry) setError(t("supportInvite.codeWrong"));
      else setStep("invalid");
    });
  }

  return (
    <div className="relative flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">{t("supportInvite.title")}</CardTitle>
          <CardDescription>
            {step === "password" && t("supportInvite.passwordBody")}
            {step === "totp" && t("supportInvite.totpBody")}
            {step === "done" && t("supportInvite.doneBody")}
            {step === "invalid" && generic}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "password" && (
            <form onSubmit={submitPassword} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="support-password">{t("supportInvite.password")}</Label>
                <Input id="support-password" type="password" autoComplete="new-password" required value={password} disabled={pending} onChange={(e) => setPassword(e.target.value)} />
                <p className="text-xs text-muted-foreground">{t("supportInvite.passwordHint")}</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="support-confirm">{t("supportInvite.confirm")}</Label>
                <Input id="support-confirm" type="password" autoComplete="new-password" required value={confirm} disabled={pending} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
              <Button type="submit" disabled={pending}>{t("supportInvite.continue")}</Button>
            </form>
          )}

          {step === "totp" && !enrollment && (
            <div className="flex flex-col gap-4">
              {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
              <Button onClick={startEnrollment} disabled={pending} className="w-full">{t("supportInvite.showQr")}</Button>
            </div>
          )}
          {step === "totp" && enrollment && (
            <form onSubmit={submitCode} className="flex flex-col gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URI from the auth server */}
              <img src={enrollment.qrCode} alt={t("supportInvite.qrAlt")} className="mx-auto h-44 w-44 bg-white p-2" />
              <p className="break-all text-center font-mono text-xs">{enrollment.secret}</p>
              <div className="grid gap-2">
                <Label htmlFor="support-code">{t("supportInvite.code")}</Label>
                <Input id="support-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={pending} onChange={(e) => setCode(e.target.value)} />
              </div>
              {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
              <Button type="submit" disabled={pending}>{t("supportInvite.verify")}</Button>
            </form>
          )}

          {step === "done" && (
            <Button asChild className="w-full">
              <a href="/auth/login">{t("supportInvite.signIn")}</a>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
