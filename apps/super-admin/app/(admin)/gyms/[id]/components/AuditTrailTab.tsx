import type { AuditTrailEntry } from "@/services/gyms";

const ACTION_LABELS: Record<string, string> = {
  gym_created: "Gym created",
  gym_suspended: "Gym suspended",
  gym_deactivated: "Gym deactivated",
  gym_reinstated: "Gym reinstated",
  gym_tier_changed: "Tier changed",
  gym_cap_overridden: "Cap override changed",
  gym_data_escalation: "Accessed gym data",
};

function describeEntry(entry: AuditTrailEntry): string {
  const label = ACTION_LABELS[entry.actionType] ?? entry.actionType;
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
  return (
    <div className="space-y-3 rounded-md border p-6">
      <h2 className="text-sm font-semibold text-muted-foreground">Audit trail</h2>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No audit activity recorded for this gym yet.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-0.5 border-b pb-2 last:border-b-0 last:pb-0"
            >
              <span>{describeEntry(entry)}</span>
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
