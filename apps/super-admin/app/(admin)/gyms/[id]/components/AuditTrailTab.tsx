import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { TablePagination } from "@/components/TablePagination";
import { useClientPagination } from "@/hooks/use-table-pagination";
import type { AuditTrailEntry } from "@/services/gyms";
import type { RealActor } from "../../../support/actions";

const ACTION_LABEL_KEY: Record<string, string> = {
  gym_created: "gyms.auditTrail.action.gym_created",
  gym_suspended: "gyms.auditTrail.action.gym_suspended",
  gym_deactivated: "gyms.auditTrail.action.gym_deactivated",
  gym_reinstated: "gyms.auditTrail.action.gym_reinstated",
  gym_tier_changed: "gyms.auditTrail.action.gym_tier_changed",
  gym_category_changed: "gyms.auditTrail.action.gym_category_changed",
  gym_renamed: "gyms.auditTrail.action.gym_renamed",
  gym_owner_contact_changed: "gyms.auditTrail.action.gym_owner_contact_changed",
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
): { label: string; details: string } {
  const labelKey = ACTION_LABEL_KEY[entry.actionType];
  const label = labelKey ? t(labelKey) : entry.actionType;
  const parts: string[] = [];

  if (entry.actionType === "gym_data_escalation_revoked" && entry.targetEntityId) {
    const holder =
      holderNames.get(entry.targetEntityId) ?? `${entry.targetEntityId.slice(0, 8)}…`;
    parts.push(holder);
  }

  if (entry.actionType === "gym_tier_changed") {
    const m = entry.metadata;
    if (typeof m.previous_tier_name === "string" && typeof m.new_tier_name === "string") {
      parts.push(
        t("gyms.auditTrail.tierChange", {
          from: m.previous_tier_name,
          fromPrice: Number(m.previous_tier_monthly_price ?? 0).toLocaleString(),
          to: m.new_tier_name,
          toPrice: Number(m.new_tier_monthly_price ?? 0).toLocaleString(),
        }),
      );
    }
  }

  if (entry.actionType === "gym_renamed") {
    const m = entry.metadata;
    if (typeof m.previous_name === "string" && typeof m.new_name === "string") {
      parts.push(`${m.previous_name} → ${m.new_name}`);
    }
  }

  if (entry.actionType === "gym_owner_contact_changed") {
    const m = entry.metadata;
    if (typeof m.new_phone === "string") parts.push(`${t("gyms.auditTrail.phone")}: ${m.previous_phone ?? "—"} → ${m.new_phone}`);
    if (typeof m.new_email === "string") parts.push(`${t("gyms.auditTrail.email")}: ${m.previous_email ?? "—"} → ${m.new_email}`);
  }

  const reason = typeof entry.metadata.reason === "string" ? entry.metadata.reason : null;
  if (reason) parts.push(`"${reason}"`);
  return { label, details: parts.join(" — ") };
}

/**
 * SA-03's "Audit trail" tab (Story 1.7, FR-072). Renders as a single
 * always-visible labeled section, not a tab-switcher widget -- the mockup
 * shows exactly one tab (`Tabs: [ Audit trail ]`) and no Tabs primitive
 * exists in components/ui/ yet. Shows this gym's full audit_log history
 * (every action type, not just escalations -- Dev Notes Open Question 2),
 * newest first, no filter controls (unlike Epic 7's fuller AD-12 page).
 */
export function AuditTrailTab({
  entries,
  realActors = {},
}: {
  entries: AuditTrailEntry[];
  /** Story 23.8: the real person behind a "GymOS Support" entry, keyed by audit row id. Shown here only (Super Admin at aal2). */
  realActors?: Record<string, RealActor>;
}) {
  const { t, i18n } = useTranslation();
  const holderNames = resolveHolderNames(entries);
  const pg = useClientPagination(entries, 10);
  return (
    <div className="space-y-3 rounded-md border p-6 bg-card">
      <h2 className="text-sm font-semibold text-muted-foreground">{t("gyms.auditTrail.title")}</h2>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("gyms.auditTrail.empty")}</p>
      ) : (
        <>
          <TablePagination compact {...pg} />
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="p-3 font-medium">{t("gyms.auditTrail.columns.date")}</th>
                  <th scope="col" className="p-3 font-medium">{t("gyms.auditTrail.columns.action")}</th>
                  <th scope="col" className="p-3 font-medium">{t("gyms.auditTrail.columns.details")}</th>
                  <th scope="col" className="p-3 font-medium">{t("gyms.auditTrail.columns.by")}</th>
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((entry) => {
                  const { label, details } = describeEntry(entry, t, holderNames);
                  const real = realActors[entry.id];
                  return (
                    <tr key={entry.id} className="border-b last:border-0 align-top">
                      <td className="whitespace-nowrap p-3">{new Date(entry.createdAt).toLocaleString(i18n.language)}</td>
                      <td className="p-3">{label}</td>
                      <td className="p-3">{details || "—"}</td>
                      <td className="p-3">
                        {entry.actorDisplayName}
                        {real && (
                          <span className="block text-xs font-medium">
                            {t("gyms.auditTrail.realActor", {
                              name: real.name ?? real.realUserId.slice(0, 8),
                              email: real.email ?? "—",
                            })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination {...pg} />
        </>
      )}
    </div>
  );
}
