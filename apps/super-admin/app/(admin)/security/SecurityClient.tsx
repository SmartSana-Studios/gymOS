"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepUpPrompt } from "@/components/step-up-prompt";
import { enrollFactor, removeFactor, verifyFactor, type EnrollResult, type FactorRow } from "./actions";

export function SecurityClient({ initialFactors }: { initialFactors: FactorRow[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enroll, setEnroll] = useState<EnrollResult | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stepUpFor, setStepUpFor] = useState<string | null>(null);

  const closeEnroll = () => {
    setEnroll(null);
    setCode("");
    setEnrollError(null);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (enroll && !dialog.open) dialog.showModal();
    else if (!enroll && dialog.open) dialog.close();
  }, [enroll]);

  const removeWithStepUp = (factorId: string) =>
    start(async () => {
      const res = await removeFactor({ factorId });
      if (res.error?.code === "step_up_required") {
        setStepUpFor(factorId);
        return;
      }
      if (res.error) {
        setMessage(res.error.message);
        return;
      }
      setStepUpFor(null);
      if (res.data?.signOutFailed) {
        // Fail loudly: the factor is gone but other sessions may still be live.
        setMessage(t("security.errors.signOutFailed"));
        router.refresh();
        return;
      }
      setMessage(null);
      if (res.data?.signedOut) {
        window.location.assign("/auth/login?expired=1");
        return;
      }
      router.refresh();
    });

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">{t("security.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("security.description")}</p>
      {message && <div role="alert" className="text-sm text-red-600">{message}</div>}

      <ul className="space-y-2">
        {initialFactors.length === 0 && <li className="text-sm">{t("security.noFactors")}</li>}
        {initialFactors.map((f) => (
          <li key={f.id} className="flex items-center justify-between border rounded p-3 text-sm">
            <span>
              {f.friendlyName ?? t("security.unnamedFactor")} ·{" "}
              {f.status === "verified" ? t("security.verified") : t("security.unverified")}
            </span>
            <button
              type="button"
              disabled={pending}
              className="text-red-600 underline"
              onClick={() => removeWithStepUp(f.id)}
            >
              {t("security.remove")}
            </button>
          </li>
        ))}
      </ul>

      {stepUpFor && (
        <StepUpPrompt
          action="remove_super_admin_factor"
          subjectId={stepUpFor}
          onCancel={() => setStepUpFor(null)}
          onIssued={() => removeWithStepUp(stepUpFor)}
        />
      )}

      <button
        type="button"
        disabled={pending}
        className="border rounded px-3 py-2 text-sm"
        onClick={() =>
          start(async () => {
            const res = await enrollFactor({});
            if (res.error || !res.data) {
              setMessage(res.error?.message ?? t("security.errors.generic"));
              return;
            }
            setMessage(null);
            setEnrollError(null);
            setCode("");
            setEnroll(res.data);
          })
        }
      >
        {t("security.addFactor")}
      </button>

      <dialog
        ref={dialogRef}
        onClose={closeEnroll}
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
        className="w-full max-w-[480px] rounded-md border p-0 backdrop:bg-black/50"
      >
        {enroll && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await verifyFactor({ factorId: enroll.factorId, code });
                if (res.error) {
                  setEnrollError(res.error.message);
                  return;
                }
                setEnroll(null);
                setCode("");
                router.refresh();
              });
            }}
            className="space-y-4 p-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("security.enrollTitle")}</h2>
              <button
                type="button"
                aria-label={t("security.close")}
                onClick={closeEnroll}
                disabled={pending}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm">{t("security.scanQr")}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qrCode} alt={t("security.qrAlt")} width={192} height={192} />
            <p className="text-xs break-all">
              {t("security.manualKey")}: <code>{enroll.secret}</code>
            </p>
            <div className="space-y-2">
              <Label htmlFor="enroll-code">{t("security.codeLabel")}</Label>
              <Input
                id="enroll-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              {enrollError && (
                <p role="alert" className="text-sm text-red-600">
                  {enrollError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeEnroll} disabled={pending}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("security.verify")}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
