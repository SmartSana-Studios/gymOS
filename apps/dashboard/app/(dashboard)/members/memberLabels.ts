import { AlertTriangle, CheckCircle2, Clock, HelpCircle, UserX, XCircle } from "lucide-react";
import type { MemberListRow } from "@/services/members";

// UX-DR5's 6-state badge system: color AND label text AND icon, never color
// alone. "deactivated" isn't a `subscriptions.status` value -- it's a
// `members`-level concept (deactivated_at is not null) layered on top,
// resolved by the table cell (deactivatedAt overrides the raw subscription
// status for display) rather than by the service layer.
export type MemberBadgeStatus = MemberListRow["status"] | "deactivated";

export const STATUS_BADGE_CONFIG: Record<
  MemberBadgeStatus,
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

export function resolveBadgeStatus(row: { status: MemberListRow["status"]; deactivatedAt: string | null }): MemberBadgeStatus {
  return row.deactivatedAt ? "deactivated" : row.status;
}
