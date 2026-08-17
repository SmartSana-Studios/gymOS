import { Suspense } from "react";

import { listSubscriptions, SUBSCRIPTIONS_PAGE_SIZE } from "@/services/subscriptions";
import { SubscriptionsPageClient } from "./components/SubscriptionsPageClient";
import SubscriptionsLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { isMobileMoneyInitiationEnabled } from "@/lib/featureFlags";

/**
 * AD-08 Subscriptions List. Server Component + explicit <Suspense> -- same
 * requirement as members/page.tsx and plans/page.tsx: the cookie-based
 * Supabase read must sit inside an explicit Suspense boundary under this
 * app's `cacheComponents: true`.
 *
 * No route-level role guard beyond `(dashboard)/layout.tsx`'s existing
 * gym-staff gate (matches settings/page.tsx's/plans/page.tsx's/
 * members/page.tsx's documented "Sidebar hides it, RLS is the real
 * enforcement" precedent) -- Sidebar's `NAV_ITEMS` already restricts the
 * `/subscriptions` link to `["manager", "owner"]`, but that's UI-only. A
 * Receptionist reaching this route directly still gets full read access via
 * `gym_staff_read_own_subscriptions` (`0018_member_management.sql`) -- a
 * known, accepted gap inherited from that policy, not introduced or fixed
 * here (same shape as `plans`/`members`/`settings`'s own accepted gaps, see
 * docs/decisions.md). As of Story 5.2 (`0040_coach_portal_member_list_rls.sql`),
 * `coach` was dropped from this policy's role array -- a Coach reaching this
 * route directly now only sees their own assigned members' subscriptions via
 * `coach_read_assigned_subscriptions`, not the full roster this comment used
 * to describe. Writes stay backstopped by
 * `manager_or_owner_insert_own_subscriptions`/`manager_or_owner_update_own_subscriptions`
 * and `confirm_renewal()`'s own role check. No `listPlans()`/
 * `getDashboardShellContext()` fetch is needed -- no role-conditional UI on
 * this page (every visitor who can reach it can already Renew, per
 * `confirm_renewal()`'s own role check), and the plan-type filter uses the
 * closed `plan_type` enum's static label map, not a per-gym plan list.
 */
export default function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; planType?: string; sort?: string; dir?: string; page?: string }>;
}) {
  return (
    <Suspense fallback={<SubscriptionsLoading />}>
      <SubscriptionsData searchParams={searchParams} />
    </Suspense>
  );
}

async function SubscriptionsData({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; planType?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const params = await searchParams;
  const parsedPage = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const { data: subscriptionsPage, error } = await listSubscriptions({
    status: params.status,
    planType: params.planType,
    sort: params.sort,
    dir: params.dir,
    page,
  });

  if (error) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return (
    <SubscriptionsPageClient
      initialSubscriptions={subscriptionsPage?.rows ?? []}
      total={subscriptionsPage?.total ?? 0}
      page={page}
      pageSize={SUBSCRIPTIONS_PAGE_SIZE}
      status={params.status ?? ""}
      planType={params.planType ?? ""}
      sort={params.sort ?? "name"}
      dir={params.dir ?? "asc"}
      mobileMoneyEnabled={isMobileMoneyInitiationEnabled()}
    />
  );
}
