import { redirect } from "next/navigation";

import { getDashboardShellContext } from "@/services/session";
import { DashboardChrome } from "@/components/shared/DashboardChrome";

/**
 * Hard security boundary, not incidental scaffolding: `apps/dashboard` and
 * `apps/super-admin` share one Supabase project/Auth instance. A session
 * with no valid gym-scoped staff role (missing claims, a `super_admin`-only
 * session, or a non-staff `member` role) must not reach the gym-scoped
 * dashboard -- the symmetric case to
 * apps/super-admin/app/(admin)/layout.tsx's own guard against gym staff
 * reaching `/gyms`. `getDashboardShellContext()` is the single source of
 * truth for that check (Review finding: this layout previously duplicated
 * the same claims/role validation `getDashboardShellContext()` already
 * does, making its own "no gym context" branch unreachable given this was
 * its only caller).
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: shell, error: shellError } = await getDashboardShellContext();

  if (shellError) {
    // A genuine backend error (e.g. the gym row lookup failed) for an
    // otherwise-authenticated session -- redirecting to /auth/login here
    // would be wrong (the user IS logged in) and could loop, since they'd
    // hit the same failure again immediately after re-authenticating
    // (Review finding). Show an inline error instead, matching
    // apps/super-admin's own established pattern for this exact situation.
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-sm text-destructive">
        Something went wrong on our end. Try refreshing the page.
      </div>
    );
  }

  if (!shell) {
    // No valid gym-scoped staff session (not logged in, or logged in with
    // a role that has no place on this dashboard) -- redirect to login.
    redirect("/auth/login");
  }

  return (
    <DashboardChrome role={shell.role} gymName={shell.gymName} memberName={shell.memberName}>
      {children}
    </DashboardChrome>
  );
}
