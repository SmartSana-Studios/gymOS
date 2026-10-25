"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resendOwnerInvitationSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GymDetail } from "@/services/gyms";
import { resendOwnerInvitation } from "../../actions";

type Outcome = {
  tempPassword: string;
  welcomeMessage: string | null;
  loginUrl: string | null;
  smsSent: boolean;
  linkSent: boolean;
};

/**
 * SA-03 "Resend invitation". Step 1: a mandatory reason and a clear warning (a NEW temporary password, the old one
 * stops working, every gym of this owner account). Step 2: what happened - delivered with or without the link - and
 * the password and a copy-ready message so the admin can pass them on when WhatsApp did not deliver.
 */
export function ResendInvitationDialog({
  gym,
  onClose,
  onDone,
}: {
  gym: Pick<GymDetail, "id" | "name" | "ownerName" | "ownerPhone">;
  onClose: () => void;
  /** Called when the dialog is closed after a successful resend, so the page can refresh. */
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = resendOwnerInvitationSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.invalidInput"));
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: actionError } = await resendOwnerInvitation(gym.id, parsed.data);
      if (actionError || !data) {
        setError(actionError?.message ?? t("common.somethingWentWrong"));
        return;
      }
      setOutcome(data);
    } catch {
      setError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // the text stays visible and selectable
    }
  }

  function close() {
    if (outcome) onDone();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={close}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[480px] rounded-md border p-0 backdrop:bg-black/50"
    >
      {outcome ? (
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">{t("gyms.detail.resendInvitation.doneTitle")}</h2>
          <p role="status" className="text-sm">
            {!outcome.smsSent
              ? t("gyms.detail.resendInvitation.notSent")
              : outcome.linkSent
                ? t("gyms.detail.resendInvitation.sentWithLink")
                : t("gyms.detail.resendInvitation.sentNoLink", { url: outcome.loginUrl ?? "—" })}
          </p>
          <div className="space-y-2">
            <Label htmlFor="resendTempPassword">{t("gyms.detail.resendInvitation.newPassword")}</Label>
            <Input
              id="resendTempPassword"
              readOnly
              value={outcome.tempPassword}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => copy(outcome.welcomeMessage ?? outcome.tempPassword)}>
              {copied
                ? t("gyms.toast.passwordCopied")
                : outcome.welcomeMessage
                  ? t("gyms.toast.copyMessage")
                  : t("gyms.toast.copyPassword")}
            </Button>
            <Button type="button" onClick={() => dialogRef.current?.close()}>
              {t("gyms.detail.resendInvitation.close")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">{t("gyms.detail.resendInvitation.title", { gymName: gym.name })}</h2>
          <p className="text-sm text-muted-foreground">
            {t("gyms.detail.resendInvitation.body", { owner: gym.ownerName ?? "—", phone: gym.ownerPhone ?? "—" })}
          </p>

          <div className="space-y-2">
            <Label htmlFor="resendReason">{t("gyms.detail.resendInvitation.reasonLabel")}</Label>
            <textarea
              id="resendReason"
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
            <Button type="button" variant="outline" onClick={() => dialogRef.current?.close()} disabled={submitting}>
              {t("gyms.detail.resendInvitation.cancel")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("gyms.detail.resendInvitation.sending") : t("gyms.detail.resendInvitation.send")}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
