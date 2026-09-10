import { AlertTriangle, CheckCircle2, Clock, HelpCircle, UserX, XCircle } from "lucide-react";
import type { CurrentlyCheckedInRow } from "@/services/attendance";
import type { SubscriptionListRow } from "@/services/subscriptions";

// Story 17.1: the Overview's two status-badge maps, COPIED rather than
// imported from the sibling route folders -- this app's per-file-copy
// discipline for route-local label logic (attendance/attendanceLabels.ts:4-9;
// subscriptions/subscriptionLabels.ts was itself copied from attendance's).
// Both reuse the existing `members.status.*` i18n keys; no new status copy.

// Currently Checked-In table: attendance/attendanceLabels.ts's 6-state map,
// since an open check-in can belong to a deactivated member or one with no
// active plan.
export type CheckedInBadgeStatus = CurrentlyCheckedInRow["status"] | "deactivated";

export const CHECKED_IN_STATUS_BADGE_CONFIG: Record<
  CheckedInBadgeStatus,
  { labelKey: string; icon: typeof CheckCircle2; className: string }
> = {
  active: {
    labelKey: "members.status.active",
    icon: CheckCircle2,
    className: "border-green-200 bg-green-100 text-green-800",
  },
  expiring_soon: {
    labelKey: "members.status.expiringSoon",
    icon: Clock,
    className: "border-orange-200 bg-orange-100 text-orange-800",
  },
  grace_period: {
    labelKey: "members.status.gracePeriod",
    icon: AlertTriangle,
    className: "border-orange-200 bg-orange-100 text-orange-800",
  },
  expired: {
    labelKey: "members.status.expired",
    icon: XCircle,
    className: "border-red-200 bg-red-100 text-red-800",
  },
  deactivated: {
    labelKey: "members.status.deactivated",
    icon: UserX,
    className: "border-gray-200 bg-gray-100 text-gray-800",
  },
  no_active_plan: {
    labelKey: "members.status.noActivePlan",
    icon: HelpCircle,
    className: "border-gray-200 bg-gray-100 text-gray-800",
  },
};

export function resolveCheckedInBadgeStatus(row: {
  status: CurrentlyCheckedInRow["status"];
  deactivatedAt: string | null;
}): CheckedInBadgeStatus {
  return row.deactivatedAt ? "deactivated" : row.status;
}

// Expiring This Week table: subscriptions/subscriptionLabels.ts's 4-state
// map over exactly `subscription_status` -- these rows come from
// `subscriptions_current`, which never carries a deactivated member or a
// member with no subscription.
export const EXPIRING_STATUS_BADGE_CONFIG: Record<
  SubscriptionListRow["status"],
  { labelKey: string; icon: typeof CheckCircle2; className: string }
> = {
  active: {
    labelKey: "members.status.active",
    icon: CheckCircle2,
    className: "border-green-200 bg-green-100 text-green-800",
  },
  expiring_soon: {
    labelKey: "members.status.expiringSoon",
    icon: Clock,
    className: "border-orange-200 bg-orange-100 text-orange-800",
  },
  grace_period: {
    labelKey: "members.status.gracePeriod",
    icon: AlertTriangle,
    className: "border-orange-200 bg-orange-100 text-orange-800",
  },
  expired: {
    labelKey: "members.status.expired",
    icon: XCircle,
    className: "border-red-200 bg-red-100 text-red-800",
  },
};
