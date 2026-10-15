import { redirect } from "next/navigation";

import { MfaForm } from "@/components/mfa-form";
import { createClient } from "@/lib/supabase/server";

/** Story 22.6: second-factor prompt for a password (aal1) session. It only verifies; never enrolls. */
export default async function Page() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    redirect("/auth/login");
  }
  return <MfaForm />;
}
