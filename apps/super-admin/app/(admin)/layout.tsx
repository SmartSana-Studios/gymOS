import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authorizePlatformAction } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { AdminNavLink } from "@/components/AdminNavLink";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "@/components/logout-button";
import { MobileNavMenu } from "@/components/MobileNavMenu";

// Single source of truth for both the >=768px inline nav and the <768px
// hamburger panel (MobileNavMenu) below, so the two can never drift apart.
const NAV_LINKS = [
  { href: "/gyms", labelKey: "nav.gyms" },
  { href: "/metrics", labelKey: "nav.metrics" },
  { href: "/tiers", labelKey: "nav.tiers" },
  { href: "/payment-providers", labelKey: "nav.paymentProviders" },
  { href: "/messaging", labelKey: "nav.messaging" },
  { href: "/billing", labelKey: "nav.billing" },
  { href: "/admins", labelKey: "nav.admins" },
  { href: "/security", labelKey: "nav.security" },
] as const;

// Auth-gated: this segment reads the session and may redirect, so it is allowed to block on navigation
// (silences the dev-only "validate instant UI" overlay; no effect on the build).
export const instant = false;

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

  // Story 22.4: live check (users.is_super_admin at request time), not the app_role claim.
  const authz = await authorizePlatformAction("platform.admin_access");
  if (!authz.ok) {
    // Story 22.6: a valid password session below aal2 while the flag is on goes to the
    // second-factor prompt, never into a login loop. Every other denial stays on login.
    redirect(
      authz.reason === "aal2_required"
        ? "/auth/mfa"
        : authz.reason === "session_expired" ||
        authz.reason === "account_locked" ||
        // A still-signed token whose session the provider no longer knows: the session ended.
        authz.reason === "no_session"
          ? "/auth/login?expired=1"
          : authz.reason === "not_super_admin"
            ? "/auth/login?denied=1" // signed in, but not a Super Admin: say so instead of reloading the form silently
            : "/auth/login",
    );
  }

  const { t } = await getServerTranslation(await getRequestLocale());
  const navLinks = NAV_LINKS.map((link) => ({ href: link.href, label: t(link.labelKey) }));

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="sticky top-0 z-30 w-full border-b bg-background flex items-center gap-6 px-5 h-14">
        <Link href="/gyms" className="font-semibold">
          {t("nav.brand")}
        </Link>

        {/*
          Flat links, not a role-filtered icon-rail sidebar (UX-DR4/UX-DR13
          describes that for the multi-role gym-admin dashboard,
          apps/dashboard) -- Super Admin has exactly one role, so there's no
          per-role item list to manage. `hidden md:contents`: at >=768px
          this div doesn't participate in layout at all (`display: contents`),
          so its children behave as direct flex children of `<nav>` exactly
          as before -- LanguageToggle's own `ml-auto` still pushes the
          toggle/logout group to the row's right edge unaffected by this
          wrapper. Below 768px the whole group is hidden in favor of
          MobileNavMenu's hamburger panel (2026-09-07, user-requested
          upgrade from an earlier flex-wrap-only stop-gap -- wrapping ate
          2-3 lines of vertical space on every page just for nav).
        */}
        <div className="hidden md:contents">
          {NAV_LINKS.map((link) => (
            <AdminNavLink key={link.href} href={link.href}>
              {t(link.labelKey)}
            </AdminNavLink>
          ))}
          <LanguageToggle />
          <ThemeToggle />
          <LogoutButton />
        </div>

        <MobileNavMenu navLinks={navLinks} />
      </nav>
      <main className="flex-1 p-5">{children}</main>
    </div>
  );
}
