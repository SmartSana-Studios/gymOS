"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cancelPendingRecoveryOnSignIn, requestRecoveryCode, submitRecoveryCode } from "@/app/auth/mfa/recovery-actions";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MfaForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const [factorIds, setFactorIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [recovery, setRecovery] = useState<"closed" | "ask" | "code" | "done">("closed");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [applyAt, setApplyAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: listError } = await createClient().auth.mfa.listFactors();
      if (cancelled) return;
      // listFactors().totp holds verified factors only.
      setFactorIds(listError ? [] : (data?.totp ?? []).map((f) => f.id));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (factorIds.length === 0) return;
    setIsLoading(true);
    setError(null);
    try {
      // The lost device may hold the first factor: try each verified factor until one accepts the code.
      let verifyError: unknown = null;
      for (const factorId of factorIds) {
        ({ error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.trim() }));
        if (!verifyError) break;
      }
      if (verifyError) {
        setError(t("mfaPrompt.invalidCode"));
        return;
      }
      await cancelPendingRecoveryOnSignIn(); // owner proved the authenticator: a pending recovery was not theirs
      router.push("/gyms");
      router.refresh();
    } catch {
      setError(t("mfaPrompt.invalidCode"));
    } finally {
      setIsLoading(false);
    }
  };

  const askForCode = async () => {
    setIsLoading(true);
    setRecoveryError(null);
    try {
      await requestRecoveryCode(); // identical answer whatever the account state
      setRecovery("code");
    } finally {
      setIsLoading(false);
    }
  };

  const confirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setRecoveryError(null);
    try {
      const res = await submitRecoveryCode({ code: recoveryCode });
      if (res.error) {
        if (res.error.locked) {
          window.location.assign("/auth/login?expired=1");
          return;
        }
        setRecoveryError(res.error.message);
        return;
      }
      setApplyAt(res.data?.applyAt ?? null);
      setRecoveryCode("");
      setRecovery("done");
    } finally {
      setIsLoading(false);
    }
  };

  const recoveryPanel = (
    <div className="mt-6 border-t pt-4 text-sm">
      {recovery === "closed" && (
        <button type="button" className="underline" onClick={() => setRecovery("ask")}>
          {t("mfaPrompt.recovery.link")}
        </button>
      )}
      {recovery === "ask" && (
        <div className="flex flex-col gap-3">
          <p>{t("mfaPrompt.recovery.intro")}</p>
          <Button type="button" variant="outline" disabled={isLoading} onClick={askForCode}>
            {t("mfaPrompt.recovery.send")}
          </Button>
        </div>
      )}
      {recovery === "code" && (
        <form onSubmit={confirmCode} className="flex flex-col gap-3">
          <p>{t("mfaPrompt.recovery.sent")}</p>
          <Label htmlFor="recovery-code">{t("mfaPrompt.recovery.codeLabel")}</Label>
          <Input
            id="recovery-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
          />
          {recoveryError && <p role="alert" className="text-red-500">{recoveryError}</p>}
          <Button type="submit" disabled={isLoading}>{t("mfaPrompt.recovery.submit")}</Button>
        </form>
      )}
      {recovery === "done" && (
        <p role="status">
          {t("mfaPrompt.recovery.scheduled", { time: applyAt ? new Date(applyAt).toLocaleString() : "" })}
        </p>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t("mfaPrompt.title")}</CardTitle>
        <CardDescription>{t("mfaPrompt.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loaded && factorIds.length === 0 ? (
          <p className="text-sm text-red-500">{t("mfaPrompt.noFactor")}</p>
        ) : (
          <form onSubmit={handleVerify} className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="code">{t("mfaPrompt.codeLabel")}</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={isLoading || factorIds.length === 0}>
              {isLoading ? t("mfaPrompt.verifying") : t("mfaPrompt.verify")}
            </Button>
          </form>
        )}
        {recoveryPanel}
      </CardContent>
    </Card>
  );
}
