"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface EnrollDialogData {
  factorId: string;
  qrCode: string;
  secret: string;
}

/** Authenticator enrollment as a modal (native <dialog>, like TierModal). Used by /security and by the
 * first-authenticator page after a recovery. The parent owns the provider calls. */
export function EnrollDialog({
  enroll,
  error,
  pending,
  onSubmit,
  onClose,
}: {
  enroll: EnrollDialogData | null;
  error: string | null;
  pending: boolean;
  onSubmit: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (enroll && !dialog.open) {
      setCode("");
      dialog.showModal();
    } else if (!enroll && dialog.open) {
      dialog.close();
    }
  }, [enroll]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      className="w-full max-w-[480px] rounded-md border p-0 backdrop:bg-black/50"
    >
      {enroll && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(code);
          }}
          className="space-y-4 p-6"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t("security.enrollTitle")}</h2>
            <button
              type="button"
              aria-label={t("security.close")}
              onClick={onClose}
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
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("security.verify")}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
