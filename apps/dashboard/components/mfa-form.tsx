"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { createClient } from "@/lib/supabase/client";
import { recordMfaFailureAction } from "@/app/auth/mfa/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Story 23-6b: the authenticator-code step. A wrong code gets one generic message and a retry. Once the code is accepted the session
 * is aal2; `support_begin_session()` then forgets any previous gym (a support person never gets a default gym) and the token is
 * refreshed, so the next page load carries no gym claim and lands on the picker.
 */
export function MfaForm({ next = "/" }: { next?: string }) {
  const { t } = useTranslation();
  const [factorIds, setFactorIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [ended, setEnded] = useState(false);

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

  const signOutAndRestart = async () => {
    try {
      await createClient().auth.signOut({ scope: "local" });
    } finally {
      window.location.assign("/auth/login");
    }
  };

  // The code was accepted but the session could not be prepared: end it locally and say so neutrally (not "invalid code").
  const failClosed = async () => {
    try {
      await createClient().auth.signOut({ scope: "local" });
    } catch {
      // the next request is refused by the gate anyway
    }
    setEnded(true);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (factorIds.length === 0) return;
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      let verifyError: unknown = null;
      for (const factorId of factorIds) {
        ({ error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() }));
        if (!verifyError) break;
      }
      if (verifyError) {
        // Story 23-6c: a rejected code (not a provider error) is counted in the per-user step-up counter; at the threshold the
        // account is locked and its sessions ended, so the person lands on the login page with the expired notice.
        const rejectedCode = (verifyError as { code?: string }).code;
        if (rejectedCode === "mfa_verification_failed" || rejectedCode === "mfa_verification_rejected") {
          const { locked } = await recordMfaFailureAction().catch(() => ({ locked: false }));
          if (locked) {
            try {
              await supabase.auth.signOut({ scope: "local" });
            } catch {
              // the session is already ended server side
            }
            window.location.assign("/auth/login?expired=1");
            return;
          }
        }
        setError(t("supportAccess.invalidCode"));
        return;
      }
      const { error: beginError } = await supabase.rpc("support_begin_session");
      if (beginError) {
        // Fail closed: a session that could not forget its previous gym is not carried on.
        await failClosed();
        return;
      }
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        await failClosed();
        return;
      }
      // Full navigation (not router.push + refresh): the refresh can win over the push and leave you on the prompt.
      window.location.assign(next === "/" ? "/support-gym" : `/support-gym?next=${encodeURIComponent(next)}`);
    } catch {
      setError(t("supportAccess.invalidCode"));
    } finally {
      setIsLoading(false);
    }
  };

  if (ended) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <p role="alert" className="text-sm text-destructive">
            {t("supportAccess.signInFailed")}
          </p>
          <Button type="button" variant="outline" onClick={() => window.location.assign("/auth/login")}>
            {t("supportAccess.backToSignIn")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t("supportAccess.mfaTitle")}</CardTitle>
        <CardDescription>{t("supportAccess.mfaDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loaded && factorIds.length === 0 ? (
          <div className="flex flex-col gap-4">
            <p role="alert" className="text-sm text-destructive">
              {t("supportAccess.noFactor")}
            </p>
            <Button type="button" variant="outline" onClick={signOutAndRestart}>
              {t("supportAccess.signOut")}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleVerify} className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="code">{t("supportAccess.codeLabel")}</Label>
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
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={isLoading || factorIds.length === 0}>
              {isLoading ? t("supportAccess.verifying") : t("supportAccess.verify")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
