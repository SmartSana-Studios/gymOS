"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { changeGymTierSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { GymDetail, TierOption } from "@/services/gyms";
import { changeGymTier } from "../../actions";

/** SA-03 "Change" tier. AC #1: existing members are never automatically
 * reclassified -- the confirmation copy says so explicitly. */
export function ChangeTierDialog({
  gym,
  tiers,
  onClose,
  onDone,
}: {
  gym: GymDetail;
  tiers: TierOption[];
  onClose: () => void;
  onDone: (warning?: string) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tierId, setTierId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const selectedTier = tiers.find((tier) => tier.id === tierId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = changeGymTierSchema.safeParse({ tierId });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("gyms.changeTier.errorSelectTier"));
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await changeGymTier(gym.id, parsed.data);
      if (actionError) {
        // "no_op" (already on that tier) and "audit_log_failed" (the
        // reassignment saved, only the audit entry failed to write) both
        // mean the gym's real tier already matches this dialog's request --
        // treat them as done rather than a blocking error.
        if (actionError.code === "no_op") {
          onDone();
          return;
        }
        if (actionError.code === "audit_log_failed") {
          onDone(actionError.message);
          return;
        }
        setError(actionError.message);
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
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{t("gyms.changeTier.title")}</h2>

        <div className="space-y-2">
          <Label htmlFor="newTier">{t("gyms.changeTier.newTier")}</Label>
          <select
            id="newTier"
            value={tierId}
            onChange={(e) => setTierId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">{t("gyms.changeTier.selectTier")}</option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}
              </option>
            ))}
          </select>
        </div>

        {selectedTier && (
          <p className="text-sm text-muted-foreground">
            {t("gyms.changeTier.confirmText", {
              gymName: gym.name,
              oldTier: gym.tierName,
              newTier: selectedTier.name,
            })}
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting || !tierId}>
            {submitting
              ? t("gyms.changeTier.changing")
              : selectedTier
                ? t("gyms.changeTier.changeTo", { tierName: selectedTier.name })
                : t("gyms.changeTier.changeTierButton")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
