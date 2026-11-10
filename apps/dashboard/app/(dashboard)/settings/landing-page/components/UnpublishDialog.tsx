"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { unpublishPageAction } from "../actions";

/** Unpublishing is always allowed (also for a suspended gym or a page the gate already failed). */
export function UnpublishDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await unpublishPageAction();
      if (err) {
        setError(err.message);
        return;
      }
      onOpenChange(false);
      await onDone();
    } catch {
      setError(t("pageEditor.errors.load_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("pageEditor.unpublish.title")}</DialogTitle>
          <DialogDescription>{t("pageEditor.unpublish.body")}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {busy ? t("common.saving") : t("pageEditor.unpublish.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
