"use client";

import { useState, useTransition } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelSupportFactorReset } from "../../support-invite/actions";

/** Story 23.11: cancel a pending authenticator reset. Any failure (unknown, used or expired link) shows the one generic message. */
export function SupportResetCancel({ token }: { token: string | null }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"ask" | "done" | "invalid">(token ? "ask" : "invalid");
  const [pending, startTransition] = useTransition();

  function cancel() {
    startTransition(async () => {
      if (!token) return;
      const res = await cancelSupportFactorReset(token);
      setState(res.ok ? "done" : "invalid");
    });
  }

  return (
    <div className="relative flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">{t("supportResetCancel.title")}</CardTitle>
          <CardDescription>
            {state === "ask" && t("supportResetCancel.body")}
            {state === "done" && t("supportResetCancel.done")}
            {state === "invalid" && t("supportResetCancel.invalid")}
          </CardDescription>
        </CardHeader>
        {state === "ask" && (
          <CardContent>
            <Button onClick={cancel} disabled={pending} className="w-full">
              {t("supportResetCancel.confirm")}
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
