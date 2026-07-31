import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { LanguageToggle } from "@/components/LanguageToggle";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <AdminLayoutData>{children}</AdminLayoutData>
    </Suspense>
  );
}

/**
 * Hard security boundary, not incidental scaffolding: `apps/super-admin` and
 * `apps/dashboard` share one Supabase project/Auth instance. Without this
 * check, any authenticated user (including a gym member/owner from the
 * entirely separate dashboard login flow) could reach Super Admin pages.
 */
async function AdminLayoutData({
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

  const { t } = await getServerTranslation(await getRequestLocale());

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="w-full border-b h-14 flex items-center gap-6 px-5">
        <Link href="/gyms" className="font-semibold">
          {t("nav.brand")}
        </Link>
        {/*
          Flat links, not the responsive icon-rail/hamburger sidebar
          (UX-DR4/UX-DR13) -- that component is specified for the
          multi-role gym-admin dashboard (apps/dashboard); Super Admin has
          exactly one role and two flat destinations besides the brand link,
          which already points to /gyms -- no separate "Gyms" link needed.
        */}
        <Link href="/metrics" className="text-sm text-muted-foreground hover:text-foreground">
          {t("nav.metrics")}
        </Link>
        <Link href="/tiers" className="text-sm text-muted-foreground hover:text-foreground">
          {t("nav.tiers")}
        </Link>
        <Link href="/payment-providers" className="text-sm text-muted-foreground hover:text-foreground">
          {t("nav.paymentProviders")}
        </Link>
        <LanguageToggle />
      </nav>
      <main className="flex-1 p-5">{children}</main>
    </div>
  );
}
