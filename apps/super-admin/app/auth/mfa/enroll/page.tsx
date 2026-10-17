import { redirect } from "next/navigation";

import { EnrollFirstFactor } from "./enroll-first-factor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Story 22.8: first authenticator after a recovery reset. Anyone else is sent back to the prompt. */
export default async function Page() {
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data?.user) redirect("/auth/login");
  const { data: allowed } = await createAdminClient().rpc("recovery_enrol_allowed", { p_user: data.user.id });
  if (allowed !== true) redirect("/auth/mfa");
  return <EnrollFirstFactor />;
}
