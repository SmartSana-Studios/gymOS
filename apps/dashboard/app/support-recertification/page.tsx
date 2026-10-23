import { Suspense } from "react";
import { redirect } from "next/navigation";

import { SupportRecertificationNotice } from "@/components/support-recertification-notice";
import { createClient } from "@/lib/supabase/server";

/**
 * Epic 23 retro: shown to a GymOS Support person whose recertification is overdue. The live gate already denies every gym row, so
 * nothing here depends on that; this page only says why, instead of the generic error, and offers sign out. The request proxy sends
 * the person here and runs the session gate first. A person who is not overdue is sent back to the picker.
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <RecertificationData />
    </Suspense>
  );
}

async function RecertificationData() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    redirect("/auth/login");
  }
  const { data: overdue } = await supabase.rpc("support_recertification_overdue");
  if (overdue !== true) {
    redirect("/support-gym");
  }
  return <SupportRecertificationNotice />;
}
