import { redirect } from "next/navigation";

import { MfaForm } from "@/components/mfa-form";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Auth-gated: this segment reads the session and may redirect, so it is allowed to block on navigation
// (silences the dev-only "validate instant UI" overlay; no effect on the build).
export const instant = false;

/** Story 22.6: second-factor prompt for a password (aal1) session. It only verifies; never enrolls. */
export default async function Page() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    redirect("/auth/login");
  }
  // Story 22.8: a recovery reset just applied and no authenticator exists yet -> enrol the first one.
  const { data: enrol } = await createAdminClient().rpc("recovery_enrol_allowed", { p_user: data.user.id });
  if (enrol === true) redirect("/auth/mfa/enroll");
  return <MfaForm />;
}
