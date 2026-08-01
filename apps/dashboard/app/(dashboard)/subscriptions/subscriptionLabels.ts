import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { SubscriptionListRow } from "@/services/subscriptions";

// Copied from attendance/attendanceLabels.ts's own STATUS_BADGE_CONFIG/
// resolveBadgeStatus shape (per-file-copy convention -- same reasoning
// attendance used to copy from members/memberLabels.ts), restricted to the
// 4 real subscription_status values only -- this page's rows are never
// deactivated (the subscriptions_current view's own
// `.is("deactivated_at", null)` filter excludes them) and never
// "no_active_plan" (every row here has a resolved subscription by
// construction). Reuses the existing `members.status.*` i18n keys exactly as
// attendanceLabels.ts already does -- no third duplicate set of status
// strings.
export const STATUS_BADGE_CONFIG: Record<
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
