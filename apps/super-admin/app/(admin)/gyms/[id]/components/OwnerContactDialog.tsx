"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { changeOwnerContactSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import type { GymDetail } from "@/services/gyms";
import { changeOwnerContact } from "../../actions";

/**
 * SA-03 "Edit owner contact": the owner account's sign-in email and/or phone. Blank = keep. A reason is mandatory and
 * audited. Same native <dialog> pattern as EscalateAccessDialog. The phone/email must not belong to another account
 * (the server refuses it) and the change applies to every gym this owner account belongs to.
 */
export function OwnerContactDialog({
  gym,
  onClose,
  onDone,
}: {
  gym: GymDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = changeOwnerContactSchema.safeParse({ email: email.trim(), phone, reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.invalidInput"));
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await changeOwnerContact(gym.id, parsed.data);
      if (actionError) {
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
      className="w-full max-w-[460px] rounded-md border p-0 backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{t("gyms.detail.ownerContact.title", { gymName: gym.name })}</h2>
        <p className="text-sm text-muted-foreground">{t("gyms.detail.ownerContact.body")}</p>

        <div className="space-y-2">
          <Label htmlFor="ownerContactEmail">{t("gyms.detail.ownerContact.emailLabel")}</Label>
          <Input
            id="ownerContactEmail"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ownerContactPhone">{t("gyms.detail.ownerContact.phoneLabel")}</Label>
          <PhoneInput
            id="ownerContactPhone"
            countries="global"
            value={phone}
            onChange={(value) => setPhone(value ?? "")}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ownerContactReason">{t("gyms.detail.ownerContact.reasonLabel")}</Label>
          <textarea
            id="ownerContactReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("gyms.detail.ownerContact.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("gyms.detail.ownerContact.saving") : t("gyms.detail.ownerContact.save")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
