import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

/**
 * Hard security boundary, not incidental scaffolding: `apps/super-admin` and
 * `apps/dashboard` share one Supabase project/Auth instance. Without this
 * check, any authenticated user (including a gym member/owner from the
 * entirely separate dashboard login flow) could reach Super Admin pages.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  if (data.claims.app_role !== "super_admin") {
    redirect("/auth/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="w-full border-b h-14 flex items-center px-5">
        <Link href="/gyms" className="font-semibold">
          GymOS Super Admin
        </Link>
      </nav>
      <main className="flex-1 p-5">{children}</main>
    </div>
  );
}
