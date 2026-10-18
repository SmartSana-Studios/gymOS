"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { StepUpPrompt } from "@/components/step-up-prompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  removeRecoveryEmail,
  requestRecoveryEmailCode,
  verifyRecoveryEmail,
  type RecoveryStatus,
} from "./recovery-actions";

const STEP_UP_REQUIRED_CODE = "step_up_required"; // same value as lib/authz (server-only)

/** Story 22.8: the recovery email card on /security. Setting the first address needs only the aal2
 * session; changing or removing it asks for a step-up first. The code goes to the NEW address. */
export function RecoverySection({ status }: { status: RecoveryStatus }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState<null | "change_recovery_email" | "remove_recovery_email">(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const openModal = () => {
    setStep("email");
    setEmail("");
    setCode("");
    setError(null);
    setStepUp(null);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setStepUp(null);
  };

  const sendCode = () =>
    start(async () => {
      const res = await requestRecoveryEmailCode({ email });
      if (res.error?.code === STEP_UP_REQUIRED_CODE) {
        setStepUp("change_recovery_email");
        return;
      }
      if (res.error) {
        setError(res.error.message);
        return;
      }
      setError(null);
      setStepUp(null);
      setStep("code");
    });

  const verify = () =>
    start(async () => {
      const res = await verifyRecoveryEmail({ code });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      close();
      router.refresh();
    });

  const remove = () =>
    start(async () => {
      const res = await removeRecoveryEmail();
      if (res.error?.code === STEP_UP_REQUIRED_CODE) {
        setStepUp("remove_recovery_email");
        return;
      }
      if (res.error) {
        setError(res.error.message);
        return;
      }
      setStepUp(null);
      router.refresh();
    });

  return (
    <section className="space-y-3 border rounded p-4" aria-label={t("security.recovery.title")}>
      <h2 className="text-base font-semibold">{t("security.recovery.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("security.recovery.description")}</p>
      {status.hasEmail ? (
        <p className="text-sm">{t("security.recovery.current", { masked: status.masked })}</p>
      ) : (
        <p className="text-sm">{t("security.recovery.none")}</p>
      )}
      {status.pendingApplyAt && (
        <p role="alert" className="text-sm text-amber-700">
          {t("security.recovery.pending", { time: new Date(status.pendingApplyAt).toLocaleString() })}
        </p>
      )}
      {!open && error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={openModal}>
          {status.hasEmail ? t("security.recovery.change") : t("security.recovery.set")}
        </Button>
        {status.hasEmail && (
          <Button type="button" variant="outline" disabled={pending} onClick={remove}>
            {t("security.recovery.remove")}
          </Button>
        )}
      </div>

      {stepUp === "remove_recovery_email" && (
        <StepUpPrompt
          action="remove_recovery_email"
          subjectId="recovery"
          onCancel={() => setStepUp(null)}
          onIssued={() => remove()}
        />
      )}

      <dialog
        ref={dialogRef}
        onClose={(e) => {
          if (e.target === e.currentTarget) close(); // not a nested modal's close event
        }}
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
        className="w-full max-w-[480px] rounded-md border p-0 backdrop:bg-black/50"
      >
        {open && (
          <div className="space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("security.recovery.modalTitle")}</h2>
              <button
                type="button"
                aria-label={t("security.close")}
                onClick={close}
                disabled={pending}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (step === "email") sendCode();
                else verify();
              }}
              className="space-y-4"
            >
              {step === "email" ? (
                <div className="space-y-2">
                  <Label htmlFor="recovery-email">{t("security.recovery.emailLabel")}</Label>
                  <Input
                    id="recovery-email"
                    type="email"
                    autoComplete="off"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t("security.recovery.emailHint")}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm">{t("security.recovery.codeSent")}</p>
                  <Label htmlFor="recovery-code">{t("security.codeLabel")}</Label>
                  <Input
                    id="recovery-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
              )}
              {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={close} disabled={pending}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {step === "email" ? t("security.recovery.sendCode") : t("security.verify")}
                </Button>
              </div>
            </form>

            {stepUp === "change_recovery_email" && (
              <StepUpPrompt
                action="change_recovery_email"
                subjectId="recovery"
                onCancel={() => setStepUp(null)}
                onIssued={() => sendCode()}
              />
            )}
          </div>
        )}
      </dialog>
    </section>
  );
}
