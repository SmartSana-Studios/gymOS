"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { StepUpPrompt } from "@/components/step-up-prompt";
import { enrollFactor, removeFactor, verifyFactor, type EnrollResult, type FactorRow } from "./actions";

export function SecurityClient({ initialFactors }: { initialFactors: FactorRow[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enroll, setEnroll] = useState<EnrollResult | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [stepUpFor, setStepUpFor] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error: { message: string } | null }>, done?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) {
        setMessage(res.error.message);
        return;
      }
      setMessage(null);
      done?.();
      router.refresh();
    });

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
      setMessage(null);
      setStepUpFor(null);
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

      {!enroll ? (
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
              setEnroll(res.data);
            })
          }
        >
          {t("security.addFactor")}
        </button>
      ) : (
        <div className="space-y-3 border rounded p-4">
          <p className="text-sm">{t("security.scanQr")}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qrCode} alt={t("security.qrAlt")} width={192} height={192} />
          <p className="text-xs break-all">
            {t("security.manualKey")}: <code>{enroll.secret}</code>
          </p>
          <label className="block text-sm">
            {t("security.codeLabel")}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="block border rounded px-2 py-1 mt-1"
            />
          </label>
          <button
            type="button"
            disabled={pending}
            className="border rounded px-3 py-2 text-sm"
            onClick={() =>
              run(
                () => verifyFactor({ factorId: enroll.factorId, code }),
                () => {
                  setEnroll(null);
                  setCode("");
                },
              )
            }
          >
            {t("security.verify")}
          </button>
        </div>
      )}
    </div>
  );
}
