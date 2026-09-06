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
  gym_data_escalation_revoked: "gyms.auditTrail.action.gym_data_escalation_revoked",
  saas_payment_marked_received: "gyms.auditTrail.action.saas_payment_marked_received",
  saas_billing_credit_applied: "gyms.auditTrail.action.saas_billing_credit_applied",
  saas_billing_retry_triggered: "gyms.auditTrail.action.saas_billing_retry_triggered",
};

/**
 * Story 1.15 review: a revocation entry has to say WHOSE access was revoked.
 * `revoke_gym_data_access()` records the holder correctly (0085:257), but the
 * trail rendered only the action label and the reason -- attributed to the
 * REVOKER. On a gym with more than one holder that entry is ambiguous by
 * construction, in a table that can never be corrected (0007:108).
 *
 * The holder is stored as a bare uuid, so it is resolved against the display
 * names already present in this same trail: every holder necessarily escalated
 * on this gym first, and that escalation row carries their denormalized
 * `actor_display_name` (0007). Deliberately no live join to `public.users` --
 * there is no Super Admin SELECT policy on that table, and the audit log's
 * whole point is that it survives the deletion of what it refers to. A holder
 * whose escalation has aged past this view's row cap falls back to a
 * truncated id, which still distinguishes two holders from each other.
 */
function resolveHolderNames(entries: AuditTrailEntry[]): Map<string, string> {
  const byActorId = new Map<string, string>();
  for (const entry of entries) {
    if (entry.actorId && !byActorId.has(entry.actorId)) {
      byActorId.set(entry.actorId, entry.actorDisplayName);
    }
  }
  return byActorId;
}

function describeEntry(
  entry: AuditTrailEntry,
  t: TFunction,
  holderNames: Map<string, string>,
): string {
  const labelKey = ACTION_LABEL_KEY[entry.actionType];
  let label = labelKey ? t(labelKey) : entry.actionType;

  if (entry.actionType === "gym_data_escalation_revoked" && entry.targetEntityId) {
    const holder =
      holderNames.get(entry.targetEntityId) ?? `${entry.targetEntityId.slice(0, 8)}…`;
    label = t("gyms.auditTrail.revokedTarget", { label, holder });
  }

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
  const { t, i18n } = useTranslation();
  const holderNames = resolveHolderNames(entries);
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
              <span>{describeEntry(entry, t, holderNames)}</span>
              <span className="text-xs text-muted-foreground">
                {entry.actorDisplayName} · {new Date(entry.createdAt).toLocaleString(i18n.language)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
