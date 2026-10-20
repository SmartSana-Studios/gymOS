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
  // The aal2_required error comes with a link to the code page (retro item 73).
  const [needsVerify, setNeedsVerify] = useState(false);
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
        setMessage(
          res.data.auditFailed
            ? `${t("security.errors.signOutFailed")} ${t("security.errors.removedNotAudited")}`
            : t("security.errors.signOutFailed"),
        );
        router.refresh();
        return;
      }
      if (res.data?.signedOut) {
        // Every session ended, including this one: the sign-in page is next, so there is no page left to show an
        // audit notice on (the failure is logged server-side).
        window.location.assign("/auth/login?expired=1");
        return;
      }
      setMessage(res.data?.auditFailed ? t("security.errors.removedNotAudited") : null);
      router.refresh();
    });

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">{t("security.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("security.description")}</p>
      {message && (
        <div role="alert" className="text-sm text-red-600">
          {message}
          {needsVerify && (
            <>
              {" "}
              <a href="/auth/mfa" className="underline">{t("security.errors.verifyFirstLink")}</a>
            </>
          )}
        </div>
      )}

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
              setNeedsVerify(res.error?.code === "aal2_required");
              setMessage(res.error?.message ?? t("security.errors.generic"));
              return;
            }
            setNeedsVerify(false);
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
