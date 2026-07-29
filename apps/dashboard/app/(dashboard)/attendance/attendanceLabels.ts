import { AlertTriangle, CheckCircle2, Clock, HelpCircle, UserX, XCircle } from "lucide-react";
import type { CurrentlyCheckedInRow } from "@/services/attendance";

// Same 6-state badge shape as members/memberLabels.ts's STATUS_BADGE_CONFIG/
// resolveBadgeStatus (identical icons/classNames/label keys, reusing the
// same `members.status.*` i18n keys) -- copied, not cross-imported, since
// attendanceLabels.ts lives under a sibling route folder to members/, and
// every existing cross-file reuse in this app is either same-folder or via
// services/ (Scope Note #7).
export type AttendanceBadgeStatus = CurrentlyCheckedInRow["status"] | "deactivated";

export const STATUS_BADGE_CONFIG: Record<
  AttendanceBadgeStatus,
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

export function resolveBadgeStatus(row: {
  status: CurrentlyCheckedInRow["status"];
  deactivatedAt: string | null;
}): AttendanceBadgeStatus {
  return row.deactivatedAt ? "deactivated" : row.status;
}
