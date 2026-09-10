import type { AppError } from "@gymos/types";

import type { Locale } from "@/lib/i18n/config";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { StatCard } from "@/components/ui/stat-card";
import { countSubscriptions, type SubscriptionStatusFilter } from "@/services/subscriptions";
import { countMembersJoinedBetween } from "@/services/members";
import { countClassSessionsBetween } from "@/services/classes";
import { getGymLocalPeriodBounds } from "@/services/gym-settings";

// Each status card counts by the same named group its link filters by, so the
// figure and the page it opens share one predicate (applySubscriptionFilters).
const ACTIVE_OR_EXPIRING = "active_or_expiring" satisfies SubscriptionStatusFilter;
const AT_RISK = "at_risk" satisfies SubscriptionStatusFilter;

type CountResult = { data: number | null; error: AppError | null };

/**
 * Story 17.2: AD-02 V2's second card row -- "how is the gym doing" beside row
 * 1's "what is happening now". Rendered by the Overview page for Manager-plus
 * roles only, inside its own <Suspense> so these reads never hold back row 1
 * or the tables.
 *
 * Every figure is a head COUNT in a service, never a sum over fetched rows
 * (FR-143; max_rows truncates rows silently). The two date-bounded counts
 * share ONE gym-local bounds read, and start as soon as it resolves, in
 * parallel with the two status counts rather than after them.
 *
 * Per-card failure isolation: every service returns `{ data, error }` and
 * never throws, so no single failure rejects the row. A failed read shows
 * `overview.cards.unavailable` on its own card; a failed bounds read shows it
 * on exactly the two cards that needed the bounds, and their counts are not
 * attempted. Each failure is logged once.
 */
export async function GymHealthRow({ locale }: { locale: Locale }) {
  const bounds = getGymLocalPeriodBounds();

  const [{ t }, active, atRisk, boundsResult, joined, sessions] = await Promise.all([
    getServerTranslation(locale),
    countSubscriptions({ status: ACTIVE_OR_EXPIRING }),
    countSubscriptions({ status: AT_RISK }),
    bounds,
    bounds.then(({ data }) =>
      data ? countMembersJoinedBetween(data.monthStartDate, data.nextMonthStartDate) : null,
    ),
    bounds.then(({ data }) => (data ? countClassSessionsBetween(data.dayStart, data.nextDayStart) : null)),
  ]);

  if (boundsResult.error || !boundsResult.data) {
    logFailure("getGymLocalPeriodBounds", boundsResult.error);
  }

  const unavailable = t("overview.cards.unavailable");

  // `null` is a count that was never attempted (its bounds failed, already
  // logged); anything else that did not load is logged here, once.
  function loaded(read: string, result: CountResult | null): number | null {
    if (!result) return null;
    if (result.error || result.data == null) {
      logFailure(read, result.error);
      return null;
    }
    return result.data;
  }

  const activeCount = loaded(`countSubscriptions(${ACTIVE_OR_EXPIRING})`, active);
  const atRiskCount = loaded(`countSubscriptions(${AT_RISK})`, atRisk);
  const joinedCount = loaded("countMembersJoinedBetween", joined);
  const sessionsCount = loaded("countClassSessionsBetween", sessions);

  // Explicit locale on every number -- a bare toLocaleString() was a real
  // shipped bug (PaymentsPageClient.tsx).
  const format = (count: number | null) => (count == null ? unavailable : count.toLocaleString(locale));

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label={t("overview.cards.activeMembers")}
        value={format(activeCount)}
        href={`/subscriptions?status=${ACTIVE_OR_EXPIRING}`}
      />
      <StatCard label={t("overview.cards.newThisMonth")} value={format(joinedCount)} href="/members" />
      <StatCard label={t("overview.cards.todaysClasses")} value={format(sessionsCount)} href="/classes" />
      {/* Red only when the count loaded AND is non-zero: a healthy gym must
          not see a red number, and "Unavailable" is not an alert. */}
      <StatCard
        label={t("overview.cards.atRisk")}
        value={format(atRiskCount)}
        href={`/subscriptions?status=${AT_RISK}`}
        tone={atRiskCount != null && atRiskCount > 0 ? "alert" : "default"}
      />
    </div>
  );
}

function logFailure(read: string, error: AppError | null) {
  console.error(`GymHealthRow: ${read} failed -- ${error?.message ?? "no data returned"}`);
}

// The row's loading state: four text-free tiles, the same tile skeleton as row
// 1. Shared by this row's own boundary and the staff Overview skeleton, so the
// heights match and nothing jumps when it streams in.
export function GymHealthRowSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[86px] w-full animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}
