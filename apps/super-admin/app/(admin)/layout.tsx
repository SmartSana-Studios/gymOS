import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authorizePlatformAction } from "@/lib/authz";
import { loginRedirectFor } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { AdminNavGroup } from "@/components/AdminNavGroup";
import { AdminNavLink } from "@/components/AdminNavLink";
import { NAV_ENTRIES } from "@/lib/nav";
import { LanguageToggle } from "@/components/LanguageToggle";
import { NoticeBell } from "@/components/NoticeBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "@/components/logout-button";
import { MobileNavMenu } from "@/components/MobileNavMenu";
import { Watermark } from "@/components/Watermark";



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
    redirect(loginRedirectFor(authz.reason));
  }

  const { t } = await getServerTranslation(await getRequestLocale());
  // Labels resolved on the server; the inline bar and the hamburger panel both read this one list (lib/nav.ts).
  const navEntries = NAV_ENTRIES.map((entry) =>
    entry.type === "link"
      ? { type: "link" as const, href: entry.href, label: t(entry.labelKey) }
      : { type: "group" as const, label: t(entry.labelKey), items: entry.items.map((i) => ({ href: i.href, label: t(i.labelKey) })) },
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/*
        Page container: the bar's background and border stay full width, but its content and <main> share one centred, width-capped
        column with side padding that grows with the screen (px-4 -> px-6 -> px-8). On an extra-wide screen the free space becomes
        equal margins on both sides instead of every table and card stretching edge to edge.
      */}
      <nav className="sticky top-0 z-30 w-full border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-screen-2xl items-center gap-6 px-4 sm:px-6 lg:px-8">
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
          {navEntries.map((entry) =>
            entry.type === "link" ? (
              <AdminNavLink key={entry.href} href={entry.href}>
                {entry.label}
              </AdminNavLink>
            ) : (
              <AdminNavGroup key={entry.label} label={entry.label} items={entry.items} />
            ),
          )}
          <LanguageToggle />
          <ThemeToggle />
          <LogoutButton />
        </div>

        {/* Story 23.9: one bell for every width (a second mount would poll twice). */}
        <div className="ml-auto md:ml-0">
          <NoticeBell />
        </div>

        <MobileNavMenu entries={navEntries} />
      </div>
      </nav>
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
      <Watermark />
    </div>
  );
}
