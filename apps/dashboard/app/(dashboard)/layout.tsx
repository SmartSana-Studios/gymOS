import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getDashboardShellContext } from "@/services/session";
import { listSelectableTiers } from "@/services/billing";
import { DashboardChrome } from "@/components/shared/DashboardChrome";
import { OwnerSuspendedScreen, NeutralSuspendedScreen } from "@/components/shared/SuspendedGymScreen";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <DashboardLayoutData>{children}</DashboardLayoutData>
    </Suspense>
  );
}

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
async function DashboardLayoutData({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: shell, error: shellError, suspended } = await getDashboardShellContext();

  if (shellError) {
    // A genuine backend error (e.g. the gym row lookup failed) for an
    // otherwise-authenticated session -- redirecting to /auth/login here
    // would be wrong (the user IS logged in) and could loop, since they'd
    // hit the same failure again immediately after re-authenticating
    // (Review finding). Show an inline error instead, matching
    // apps/super-admin's own established pattern for this exact situation.
    const { t } = await getServerTranslation(await getRequestLocale());
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-sm text-destructive">
        {t("common.loadError")}
      </div>
    );
  }

  if (suspended) {
    // Review finding: must_change_password (Story 1.11) also gates ahead of
    // the suspended screens -- a temp-password Owner must not reach Pay-Now
    // (including submitting a real payment) without completing that flow
    // first, same reasoning as the `!suspended` branch below.
    if (suspended.mustChangePassword) {
      redirect("/auth/update-password");
    }

    // Story 11.4 (AC #1, #3): checked before the `!shell` -> redirect
    // branch below -- a suspended gym's Owner must reach the Pay-Now
    // recovery screen here, not bounce into a login-redirect loop (`shell`
    // is `null` in this case too, since the now-gated `members` lookup was
    // deliberately never attempted).
    if (suspended.isBillingSuspension && suspended.role === "owner") {
      // Story 11.7 (Task 4): the Pay-Now tier selector's own data -- only
      // fetched on this branch (never for NeutralSuspendedScreen/the normal
      // dashboard) since it's the only screen that renders <PayNowButton>
      // here.
      const { data: selectableTiers } = await listSelectableTiers();
      return (
        <OwnerSuspendedScreen
          gymName={suspended.gymName}
          gymId={suspended.gymId}
          availableGyms={suspended.availableGyms}
          selectableTiers={selectableTiers ?? []}
        />
      );
    }
    return <NeutralSuspendedScreen gymId={suspended.gymId} availableGyms={suspended.availableGyms} />;
  }

  if (!shell) {
    // No valid gym-scoped staff session (not logged in, or logged in with
    // a role that has no place on this dashboard) -- redirect to login.
    redirect("/auth/login");
  }

  if (shell.mustChangePassword) {
    // Story 1.11: a temp-password-activated owner must set a real password
    // before reaching any (dashboard) route. No loop risk: /auth/update-
    // password is a top-level app/auth/update-password/ route, not nested
    // under this route group, so this redirect target never re-triggers
    // this check.
    redirect("/auth/update-password");
  }

  return (
    <DashboardChrome
      role={shell.role}
      gymId={shell.gymId}
      gymName={shell.gymName}
      memberName={shell.memberName}
      availableGyms={shell.availableGyms}
    >
      {children}
    </DashboardChrome>
  );
}
