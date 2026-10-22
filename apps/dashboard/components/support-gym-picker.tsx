"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { switchActiveGym } from "@/app/(dashboard)/actions";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Story 23-6b: lists the gyms a GymOS Support person is actively assigned to. Nothing is preselected. Choosing one calls
 * `switch_active_gym` (which succeeds only for an active assignment) and refreshes the token, so the next request carries exactly
 * that gym. With no active assignment the person is told so and signed out.
 */
export function SupportGymPicker({
  gyms,
  failed = false,
  next = "/",
}: {
  gyms: { gymId: string; gymName: string }[];
  failed?: boolean;
  next?: string;
}) {
  const { t } = useTranslation();
  const [pendingGymId, setPendingGymId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const signOut = async () => {
    try {
      await createClient().auth.signOut();
    } finally {
      window.location.assign("/auth/login");
    }
  };

  const choose = async (gymId: string) => {
    if (pendingGymId) return;
    setPendingGymId(gymId);
    setError(false);
    try {
      const { error: switchError } = await switchActiveGym({ gymId });
      if (switchError) {
        setError(true);
        setPendingGymId(null);
        return;
      }
      // Full navigation: the client Router Cache must not serve a page rendered under the previous session.
      window.location.replace(next);
    } catch {
      setError(true);
      setPendingGymId(null);
    }
  };

  if (failed || gyms.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t("supportAccess.pickerTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            {failed ? t("common.loadError") : t("supportAccess.noGym")}
          </p>
          <Button type="button" variant="outline" onClick={signOut}>
            {t("supportAccess.signOut")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t("supportAccess.pickerTitle")}</CardTitle>
        <CardDescription>{t("supportAccess.pickerDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {gyms.map((gym) => (
            <li key={gym.gymId}>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                disabled={pendingGymId !== null}
                onClick={() => choose(gym.gymId)}
              >
                {pendingGymId === gym.gymId ? t("supportAccess.entering") : gym.gymName}
              </Button>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t("supportAccess.switchFailed")}
          </p>
        )}
        <Button type="button" variant="ghost" onClick={signOut}>
          {t("supportAccess.signOut")}
        </Button>
      </CardContent>
    </Card>
  );
}
