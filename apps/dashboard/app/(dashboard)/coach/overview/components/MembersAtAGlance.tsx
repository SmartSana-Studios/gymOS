import { Badge } from "@/components/ui/badge";
import type { CoachPortalMemberRow } from "@/services/coaches";
import { STATUS_BADGE_CONFIG } from "@/app/(dashboard)/subscriptions/subscriptionLabels";

export interface MembersAtAGlanceItem {
  status: CoachPortalMemberRow["status"];
  label: string;
  count: string;
}

/**
 * Story 17.3 (AC #10), framed by Story 17.5: the body of My Members At A
 * Glance -- the assigned total, then one badge per status that has members,
 * in the order the page passes them. Label and count sit side by side rather
 * than as one composed sentence: "9 active" does not inflect the same way in
 * French. Translated strings only.
 */
export function MembersAtAGlance({
  state,
  errorLabel,
  total,
  assignedLabel,
  items,
}: {
  state: "error" | "ready";
  errorLabel: string;
  total: string;
  assignedLabel: string;
  items: MembersAtAGlanceItem[];
}) {
  if (state === "error") {
    return <p className="text-sm text-red-600">{errorLabel}</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-2xl font-semibold">{total}</p>
        <p className="text-sm text-muted-foreground">{assignedLabel}</p>
      </div>

      <ul className="flex flex-wrap gap-2">
        {items.map((item) => {
          const badge = STATUS_BADGE_CONFIG[item.status];
          const Icon = badge.icon;
          return (
            <li key={item.status}>
              <Badge variant="outline" className={badge.className}>
                <Icon size={12} className="mr-1" />
                {item.label}
                <span className="ml-1 font-semibold">{item.count}</span>
              </Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
