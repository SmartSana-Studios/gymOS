"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { ActiveEscalation, GymDetail } from "@/services/gyms";
import { RevokeAccessDialog } from "./RevokeAccessDialog";
import { hasLapsed, useNow } from "./use-now";

/**
 * SA-03 "Active data access" (Story 1.15 AC #3): every Super Admin currently
 * holding a live escalation grant on this gym, with when it was granted,
 * when it expires, and a revoke action.
 *
 * Rendered as a single always-visible labeled section, the same shape as
 * AuditTrailTab -- not a tab-switcher widget, since no Tabs primitive exists
 * in components/ui/ and this story does not add one.
 *
 * Renders nothing at all when no grant is active. An empty-state line would
 * be noise: on the overwhelming majority of gyms, nobody has escalated, and
 * a permanent "nobody currently has access" row on every gym detail page
 * would train the eye to skip the section precisely when it does appear.
 *
 * ONE ROW PER HOLDER, not per grant (Story 1.15 review) -- see
 * `listActiveEscalations`. Rows whose deadline passes while the page is open
 * drop out on the next tick rather than sitting there with a live-looking
 * Revoke button on a grant the database has already stopped honouring.
 */
export function ActiveAccessList({
  gym,
  escalations,
  currentActorId,
  onRevoked,
}: {
  gym: GymDetail;
  escalations: ActiveEscalation[];
  currentActorId: string | null;
  onRevoked: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [revoking, setRevoking] = useState<ActiveEscalation | null>(null);
  const now = useNow();

  const live = escalations.filter((escalation) => !hasLapsed(escalation.expiresAt, now));

  if (live.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-md border p-6">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {t("gyms.dataAccess.title")}
      </h2>

      <ul className="space-y-2 text-sm">
        {live.map((escalation) => {
          const isSelf = escalation.actorId === currentActorId;
          return (
            <li
              key={escalation.actorId}
              className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
            >
              <span className="flex flex-col gap-0.5">
                <span>
                  {isSelf
                    ? t("gyms.dataAccess.holderSelf", { holder: escalation.actorDisplayName })
                    : escalation.actorDisplayName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("gyms.dataAccess.grantedAndExpires", {
                    granted: new Date(escalation.grantedAt).toLocaleString(i18n.language),
                    expires: new Date(escalation.expiresAt).toLocaleString(i18n.language),
                  })}
                  {/* Only when it is not 1 -- a "1 grant" badge on every row
                      would be noise; several open grants is the case worth
                      surfacing, since revoking takes all of them at once. */}
                  {escalation.grantCount > 1 &&
                    ` · ${t("gyms.dataAccess.grantCount", { count: escalation.grantCount })}`}
                </span>
              </span>
              <Button variant="outline" size="sm" onClick={() => setRevoking(escalation)}>
                {t("gyms.dataAccess.revokeButton")}
              </Button>
            </li>
          );
        })}
      </ul>

      {revoking && (
        <RevokeAccessDialog
          gym={gym}
          escalation={revoking}
          isSelf={revoking.actorId === currentActorId}
          onClose={() => setRevoking(null)}
          onDone={() => {
            setRevoking(null);
            onRevoked();
          }}
        />
      )}
    </div>
  );
}
