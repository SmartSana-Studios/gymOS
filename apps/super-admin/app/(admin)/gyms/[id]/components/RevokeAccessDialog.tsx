"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { revokeGymAccessSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActiveEscalation, GymDetail } from "@/services/gyms";
import { revokeGymAccess } from "../../actions";

/**
 * SA-03 "Revoke access" (Story 1.15 AC #4). Mandatory reason, audit-logged
 * with the revoking admin's identity and the grant holder as the target.
 *
 * Same native <dialog>/showModal() pattern as EscalateAccessDialog and the
 * other dialogs on this page -- there is still no Dialog primitive in
 * components/ui/, and this story does not add one.
 *
 * The confirm button names its target explicitly ("Revoke Paul Nkusu's
 * access to FitZone Yaoundé") per UX-DR12's destructive-confirmation rule:
 * this dialog is opened from a list of several admins' grants, so a generic
 * "Confirm" is exactly the case that rule exists to prevent. When the target
 * is the caller's own grant, `isSelf` switches to second-person copy -- the
 * third-person default ("This ends {holder}'s access... They can escalate
 * again") reads as someone else's grant when it is your own.
 */
export function RevokeAccessDialog({
  gym,
  escalation,
  isSelf,
  onClose,
  onDone,
}: {
  gym: GymDetail;
  escalation: ActiveEscalation;
  isSelf: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set when the RPC revoked nothing -- see the handler below.
  const [alreadyGone, setAlreadyGone] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = revokeGymAccessSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.invalidInput"));
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: actionError } = await revokeGymAccess(
        gym.id,
        escalation.actorId,
        parsed.data,
      );
      if (actionError) {
        setError(actionError.message);
        return;
      }

      // `revokedCount: 0` means the grant had already lapsed, or another
      // Super Admin revoked it moments earlier. Not an error -- the caller's
      // intent holds either way -- but not a silent success either: closing
      // with an unqualified confirmation would tell this admin they had just
      // stopped access that was already gone, while their reason went into
      // the permanent, uncorrectable audit trail against zero grants. Say so
      // instead, and let them close the dialog themselves.
      if (data?.revokedCount === 0) {
        setAlreadyGone(true);
        return;
      }

      onDone();
    } catch {
      setError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[420px] rounded-md border p-0 backdrop:bg-black/50"
    >
      {alreadyGone ? (
        // `onDone` rather than `onClose`: the list must still refresh, since
        // whatever ended this grant is not reflected in the page's data yet.
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">{t("gyms.dataAccess.alreadyEndedTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {isSelf
              ? t("gyms.dataAccess.alreadyEndedBodySelf", { gymName: gym.name })
              : t("gyms.dataAccess.alreadyEndedBody", {
                  holder: escalation.actorDisplayName,
                  gymName: gym.name,
                })}
          </p>
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={onDone}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">
            {isSelf ? t("gyms.dataAccess.revokeTitleSelf") : t("gyms.dataAccess.revokeTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isSelf
              ? t("gyms.dataAccess.revokeBodySelf", { gymName: gym.name })
              : t("gyms.dataAccess.revokeBody", {
                  holder: escalation.actorDisplayName,
                  gymName: gym.name,
                })}
          </p>

          <div className="space-y-2">
            <Label htmlFor="revoke-reason">{t("gyms.dataAccess.revokeReason")}</Label>
            <textarea
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? t("gyms.dataAccess.revoking")
                : isSelf
                  ? t("gyms.dataAccess.revokeConfirmSelf", { gymName: gym.name })
                  : t("gyms.dataAccess.revokeConfirm", {
                      holder: escalation.actorDisplayName,
                      gymName: gym.name,
                    })}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
