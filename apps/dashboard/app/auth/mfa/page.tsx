import { Suspense } from "react";
import { redirect } from "next/navigation";

import { MfaForm } from "@/components/mfa-form";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * Story 23-6b: the second-factor step after password sign-in. Only a person with a verified authenticator (GymOS Support) is ever
 * sent here; staff with no factor never see it. It only verifies -- it never enrols (enrolment is the invite flow, 23.4).
 */
export default function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <Suspense fallback={null}>
      <MfaStep searchParams={searchParams} />
    </Suspense>
  );
}

async function MfaStep({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    redirect("/auth/login");
  }
  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) {
    redirect("/auth/login");
  }
  const target = safeRedirectPath(next);
  // Already verified: on to the gym picker. No factor to verify: nothing to do here.
  if (assurance?.currentLevel === "aal2") {
    redirect(target === "/" ? "/support-gym" : `/support-gym?next=${encodeURIComponent(target)}`);
  }
  if (assurance?.nextLevel !== "aal2") {
    redirect(target);
  }
  return <MfaForm next={target} />;
}
