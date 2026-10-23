"use client";

import { useTranslation } from "react-i18next";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Epic 23 retro: tells a support person their recertification is overdue (they have no access until GymOS recertifies them). */
export function SupportRecertificationNotice() {
  const { t } = useTranslation();

  const signOut = async () => {
    try {
      await createClient().auth.signOut();
    } finally {
      window.location.assign("/auth/login");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t("supportAccess.recertTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p role="status" className="text-sm">
          {t("supportAccess.recertBody")}
        </p>
        <Button type="button" variant="outline" onClick={signOut}>
          {t("supportAccess.signOut")}
        </Button>
      </CardContent>
    </Card>
  );
}
