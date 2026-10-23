import { Suspense } from "react";
import { redirect } from "next/navigation";

import { SupportGymPicker } from "@/components/support-gym-picker";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { listSupportGyms } from "@/services/session";

/**
 * Story 23-6b: the explicit gym picker for a GymOS Support person. A request acts on exactly one gym and there is no default: the
 * list is the person's active assignments (on gyms whose Owner switch is on) and nothing is preselected. Reached only at aal2; the
 * request proxy has already run the session gate for this request.
 */
export default function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <Suspense fallback={null}>
      <PickerData searchParams={searchParams} />
    </Suspense>
  );
}

async function PickerData({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    redirect("/auth/login");
  }
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") {
    redirect(assurance?.nextLevel === "aal2" ? "/auth/mfa" : "/");
  }
  const { data: gyms, error } = await listSupportGyms();
  return <SupportGymPicker gyms={gyms ?? []} failed={Boolean(error)} next={safeRedirectPath(next)} />;
}
