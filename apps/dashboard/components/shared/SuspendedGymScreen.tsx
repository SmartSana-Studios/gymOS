"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PayNowButton } from "@/components/shared/PayNowButton";
import { createClient } from "@/lib/supabase/client";
import { switchActiveGym } from "@/app/(dashboard)/actions";
import type { MemberRole } from "@/services/session";
import type { SelectableTier } from "@/services/billing";

/**
 * Review finding: neither suspended screen rendered `DashboardChrome`
 * (where `Sidebar`'s sign-out control lives), leaving a user on the wrong
 * account with no in-app way out. A plain, unconfirmed sign-out link is
 * enough here -- unlike `Sidebar`'s logout button, there's no in-progress
 * dashboard state on this screen a confirmation dialog would be protecting.
 */
function SignOutLink() {
  const { t } = useTranslation();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={handleSignOut}>
      {t("sidebar.logout")}
    </Button>
  );
}

/**
 * Review finding: the suspended short-circuit previously locked a multi-gym
 * staff/Owner out of *every* gym they belong to, not just the suspended
 * one -- there was no way to reach `GymSwitcher` (only mounted inside
 * `DashboardChrome`, which this screen bypasses). A plain button list is
 * enough here -- unlike `GymSwitcher`'s dropdown (built for the Sidebar's
 * dark-header context), this screen has room and no nav chrome to compete
 * with. Reuses the same `switchActiveGym` server action + `router.refresh()`
 * shape.
 */
function SwitchGymList({
  currentGymId,
  availableGyms,
}: {
  currentGymId: string;
  availableGyms: { gymId: string; gymName: string; role: MemberRole }[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pendingGymId, setPendingGymId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const otherGyms = availableGyms.filter((g) => g.gymId !== currentGymId);
  if (otherGyms.length === 0) return null;

  async function handleSwitch(gymId: string) {
    setPendingGymId(gymId);
    setError(false);
    try {
      const { error: switchError } = await switchActiveGym({ gymId });
      if (switchError) {
        setError(true);
        return;
      }
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPendingGymId(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 border-t pt-4">
      <p className="text-xs text-muted-foreground">{t("saasBilling.switchGymPrompt")}</p>
      {otherGyms.map((gym) => (
        <Button
          key={gym.gymId}
          type="button"
          variant="outline"
          size="sm"
          disabled={pendingGymId !== null}
          onClick={() => handleSwitch(gym.gymId)}
        >
          {pendingGymId === gym.gymId ? t("sidebar.switchingGym") : gym.gymName}
        </Button>
      ))}
      {error && <p className="text-xs text-destructive">{t("sidebar.gymSwitchError")}</p>}
    </div>
  );
}

/**
 * Story 11.4 (AC #1, #3): the two full-screen states `(dashboard)/layout.tsx`
 * renders in place of `<DashboardChrome>{children}</DashboardChrome>` when
 * `getDashboardShellContext()` reports the caller's gym as suspended/
 * deactivated. Copy is verbatim from `EXPERIENCE.md`'s "V1.5 -- New State
 * Patterns" section (FR-132 treats the wording itself as a compliance
 * boundary, not just style) -- do not paraphrase either string.
 *
 * `<PayNowButton>` gets no `initialOwnerPhone` here (unlike
 * `SettingsForm.tsx`'s Billing card) -- this screen deliberately does not
 * fetch `getGymBillingInfo()`, since it needs no data beyond the `gyms` row
 * `getDashboardShellContext()` already read (Task 2's own scoping). The
 * Owner simply types their payer number in the dialog, same as an Owner
 * with no phone on file would today.
 */
export function OwnerSuspendedScreen({
  gymName,
  gymId,
  availableGyms,
  selectableTiers,
}: {
  gymName: string;
  gymId: string;
  availableGyms: { gymId: string; gymName: string; role: MemberRole }[];
  selectableTiers: SelectableTier[];
}) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <AlertTriangle className="size-10 text-amber-500" aria-hidden="true" />
          <h1 className="text-base font-semibold">{gymName}</h1>
          <p className="text-sm text-muted-foreground">{t("saasBilling.ownerSuspendedMessage")}</p>
          <PayNowButton selectableTiers={selectableTiers} onPaymentConfirmed={() => router.refresh()} />
          <SwitchGymList currentGymId={gymId} availableGyms={availableGyms} />
          <SignOutLink />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Every non-Owner role on a suspended gym, and every role at all on a
 * deactivated one -- identical neutral copy, no exceptions. Never mentions
 * billing/payment/subscription (`EXPERIENCE.md`: "they aren't the billing
 * relationship either, and shouldn't see GymOS's dunning language").
 */
export function NeutralSuspendedScreen({
  gymId,
  availableGyms,
}: {
  gymId: string;
  availableGyms: { gymId: string; gymName: string; role: MemberRole }[];
}) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <AlertTriangle className="size-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t("saasBilling.neutralSuspendedMessage")}</p>
          <SwitchGymList currentGymId={gymId} availableGyms={availableGyms} />
          <SignOutLink />
        </CardContent>
      </Card>
    </div>
  );
}
