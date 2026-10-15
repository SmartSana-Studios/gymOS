"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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
      router.push("/gyms");
      router.refresh();
    } catch {
      setError(t("mfaPrompt.invalidCode"));
    } finally {
      setIsLoading(false);
    }
  };

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
      </CardContent>
    </Card>
  );
}
