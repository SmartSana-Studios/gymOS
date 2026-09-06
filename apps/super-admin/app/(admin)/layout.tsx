import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { AdminNavLink } from "@/components/AdminNavLink";
import { LanguageToggle } from "@/components/LanguageToggle";
import { LogoutButton } from "@/components/logout-button";

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
          exactly one role and six flat destinations besides the brand link.
          Gyms is listed explicitly rather than left implicit behind the
          brand wordmark: it is the app's primary destination, and without
          its own link it was the one route where the active-state highlight
          below had nothing to attach to.
        */}
        <AdminNavLink href="/gyms">{t("nav.gyms")}</AdminNavLink>
        <AdminNavLink href="/metrics">{t("nav.metrics")}</AdminNavLink>
        <AdminNavLink href="/tiers">{t("nav.tiers")}</AdminNavLink>
        <AdminNavLink href="/payment-providers">{t("nav.paymentProviders")}</AdminNavLink>
        <AdminNavLink href="/messaging">{t("nav.messaging")}</AdminNavLink>
        <AdminNavLink href="/billing">{t("nav.billing")}</AdminNavLink>
        <LanguageToggle />
        <LogoutButton />
      </nav>
      <main className="flex-1 p-5">{children}</main>
    </div>
  );
}
