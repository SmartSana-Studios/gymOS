"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslation } from "react-i18next";

import { EnrollDialog, type EnrollDialogData } from "@/components/enroll-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { enrollFirstFactor, verifyFirstFactor } from "./actions";

export function EnrollFirstFactor() {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enroll, setEnroll] = useState<EnrollDialogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const close = () => {
    setEnroll(null);
    setError(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t("mfaEnroll.title")}</CardTitle>
        <CardDescription>{t("mfaEnroll.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pageError && <p role="alert" className="text-sm text-red-500">{pageError}</p>}
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await enrollFirstFactor();
              if (res.error || !res.data) {
                setPageError(res.error?.message ?? t("security.errors.generic"));
                return;
              }
              setPageError(null);
              setEnroll(res.data);
            })
          }
        >
          {t("security.addFactor")}
        </Button>
      </CardContent>
      <EnrollDialog
        enroll={enroll}
        error={error}
        pending={pending}
        onClose={close}
        onSubmit={(code) =>
          start(async () => {
            if (!enroll) return;
            const res = await verifyFirstFactor({ factorId: enroll.factorId, code });
            if (res.error) {
              setError(res.error.message);
              return;
            }
            close();
            router.push("/gyms");
            router.refresh();
          })
        }
      />
    </Card>
  );
}
