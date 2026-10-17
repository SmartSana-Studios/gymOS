"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelRecovery } from "./actions";

export function CancelRecoveryForm({ token }: { token: string }) {
  const { t } = useTranslation();
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "done" | "invalid">(token ? "idle" : "invalid");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t("recoveryCancel.title")}</CardTitle>
        <CardDescription>
          {state === "idle" && t("recoveryCancel.description")}
          {state === "done" && t("recoveryCancel.done")}
          {state === "invalid" && t("recoveryCancel.invalid")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state === "idle" && (
          <Button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setState((await cancelRecovery({ token })).ok ? "done" : "invalid"))}
          >
            {t("recoveryCancel.confirm")}
          </Button>
        )}
        {state !== "idle" && (
          <Link href="/auth/login" className="text-sm underline">
            {t("recoveryCancel.home")}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
