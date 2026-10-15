"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "./SectionHeader";
import { regenerateQrCode } from "./actions";

export function useQrCode({
  initialToken,
  showToast,
}: {
  initialToken: string;
  showToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [gymToken, setGymToken] = useState(initialToken);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const regenerateDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (regenerateOpen) {
      regenerateDialogRef.current?.showModal();
    }
  }, [regenerateOpen]);

  useEffect(() => {
    QRCode.toDataURL(gymToken).then(setQrDataUrl).catch(() => setQrDataUrl(null));
  }, [gymToken]);

  async function handleRegenerateConfirm() {
    setRegenerating(true);
    try {
      const { data, error, warning } = await regenerateQrCode();
      if (error || !data) {
        showToast(t("settings.qr.regenerateFailedToast"));
        return;
      }
      setGymToken(data.gymToken);
      if (warning) {
        showToast(warning);
      }
    } catch {
      showToast(t("settings.qr.regenerateFailedToast"));
    } finally {
      setRegenerating(false);
      setRegenerateOpen(false);
    }
  }

  function handleDownloadQr() {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = "gym-qr-code.png";
    link.click();
  }

  return {
    qrDataUrl,
    regenerating,
    regenerateDialogRef,
    setRegenerateOpen,
    handleRegenerateConfirm,
    handleDownloadQr,
  };
}

type QrCodeState = ReturnType<typeof useQrCode>;

export function QrCodeCard({ qr }: { qr: QrCodeState }) {
  const { t } = useTranslation();
  const { qrDataUrl, setRegenerateOpen, handleDownloadQr } = qr;
  return (
        <Card>
          <SectionHeader
            icon={QrCode}
            accent="blue"
            title={t("settings.sections.qrCode")}
            description={t("settings.sectionDescriptions.qrCode")}
          />
          <CardContent className="flex flex-col items-center gap-5">
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt={t("settings.qr.qrCodeAlt")}
                className="h-auto w-full max-w-[280px] rounded-md border p-3"
              />
            )}
            <div className="flex w-full max-w-[280px] flex-col gap-2">
              <Button type="button" variant="outline" className="w-full" onClick={handleDownloadQr}>
                {t("settings.qr.download")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setRegenerateOpen(true)}
              >
                {t("settings.qr.regenerate")}
              </Button>
            </div>
          </CardContent>
        </Card>
  );
}

export function QrRegenerateDialog({ qr }: { qr: QrCodeState }) {
  const { t } = useTranslation();
  const { regenerating, regenerateDialogRef, setRegenerateOpen, handleRegenerateConfirm } = qr;
  return (
    <dialog
      ref={regenerateDialogRef}
      onClose={() => setRegenerateOpen(false)}
      onCancel={(e) => {
        if (regenerating) e.preventDefault();
      }}
      className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{t("settings.qr.regenerateConfirmTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.qr.regenerateConfirmBody")}</p>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={regenerating}
            onClick={() => regenerateDialogRef.current?.close()}
          >
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={regenerating} onClick={handleRegenerateConfirm}>
            {regenerating ? t("settings.qr.regenerating") : t("settings.qr.regenerate")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
