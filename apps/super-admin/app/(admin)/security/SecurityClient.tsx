"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { RecoverySection } from "./RecoverySection";
import type { RecoveryStatus } from "./recovery-actions";
import { EnrollDialog } from "@/components/enroll-dialog";
import { StepUpPrompt } from "@/components/step-up-prompt";
import { enrollFactor, removeFactor, verifyFactor, type EnrollResult, type FactorRow } from "./actions";

export function SecurityClient({ initialFactors, recovery }: { initialFactors: FactorRow[]; recovery: RecoveryStatus }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enroll, setEnroll] = useState<EnrollResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [stepUpFor, setStepUpFor] = useState<string | null>(null);

  const closeEnroll = () => {
    setEnroll(null);
    setEnrollError(null);
  };

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
            setEnroll(res.data);
          })
        }
      >
        {t("security.addFactor")}
      </button>

      <RecoverySection status={recovery} />

      <EnrollDialog
        enroll={enroll}
        error={enrollError}
        pending={pending}
        onClose={closeEnroll}
        onSubmit={(code) =>
          start(async () => {
            if (!enroll) return;
            const res = await verifyFactor({ factorId: enroll.factorId, code });
            if (res.error) {
              setEnrollError(res.error.message);
              return;
            }
            closeEnroll();
            router.refresh();
          })
        }
      />
    </div>
  );
}
