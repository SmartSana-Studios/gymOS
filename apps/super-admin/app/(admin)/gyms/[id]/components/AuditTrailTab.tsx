import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { AuditTrailEntry } from "@/services/gyms";

const ACTION_LABEL_KEY: Record<string, string> = {
  gym_created: "gyms.auditTrail.action.gym_created",
  gym_suspended: "gyms.auditTrail.action.gym_suspended",
  gym_deactivated: "gyms.auditTrail.action.gym_deactivated",
  gym_reinstated: "gyms.auditTrail.action.gym_reinstated",
  gym_tier_changed: "gyms.auditTrail.action.gym_tier_changed",
  gym_cap_overridden: "gyms.auditTrail.action.gym_cap_overridden",
  gym_data_escalation: "gyms.auditTrail.action.gym_data_escalation",
};

function describeEntry(entry: AuditTrailEntry, t: TFunction): string {
  const labelKey = ACTION_LABEL_KEY[entry.actionType];
  const label = labelKey ? t(labelKey) : entry.actionType;
  const reason = typeof entry.metadata.reason === "string" ? entry.metadata.reason : null;
  return reason ? `${label} — "${reason}"` : label;
}

/**
 * SA-03's "Audit trail" tab (Story 1.7, FR-072). Renders as a single
 * always-visible labeled section, not a tab-switcher widget -- the mockup
 * shows exactly one tab (`Tabs: [ Audit trail ]`) and no Tabs primitive
 * exists in components/ui/ yet. Shows this gym's full audit_log history
 * (every action type, not just escalations -- Dev Notes Open Question 2),
 * newest first, no filter controls (unlike Epic 7's fuller AD-12 page).
 */
export function AuditTrailTab({ entries }: { entries: AuditTrailEntry[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 rounded-md border p-6">
      <h2 className="text-sm font-semibold text-muted-foreground">{t("gyms.auditTrail.title")}</h2>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("gyms.auditTrail.empty")}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-0.5 border-b pb-2 last:border-b-0 last:pb-0"
            >
              <span>{describeEntry(entry, t)}</span>
              <span className="text-xs text-muted-foreground">
                {entry.actorDisplayName} · {new Date(entry.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
