"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PAGE_APPEAL_REASON_MAX } from "@gymos/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { submitPageAppealAction } from "../actions";

/**
 * AD-27: the Owner's appeal against a takedown. One required textarea (500 characters). Mount it only while the dialog is open so its text starts
 * empty each time. On a refusal the message stays in the dialog; after "appeal_open" or "appeal_decided" the banner is refreshed too (the state
 * changed under the Owner), so `onSent` runs for those as well.
 */
export function AppealDialog({ onClose, onSent }: { onClose: () => void; onSent: () => Promise<void> | void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= 1 && reason.trim().length <= PAGE_APPEAL_REASON_MAX;

  async function send() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await submitPageAppealAction(reason.trim());
      if (err) {
        setError(err.message);
        if (err.code === "appeal_open" || err.code === "appeal_decided" || err.code === "not_taken_down") await onSent();
        return;
      }
      onClose();
      await onSent();
    } catch {
      setError(t("pageAppeal.errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent closeLabel={t("common.close")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("pageAppeal.title")}</DialogTitle>
            <DialogDescription>{t("pageAppeal.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label htmlFor="appeal-reason" className="text-sm font-medium">
              {t("pageAppeal.label")}
            </label>
            <textarea
              id="appeal-reason"
              className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={PAGE_APPEAL_REASON_MAX}
              required
              aria-describedby="appeal-count"
            />
            <p id="appeal-count" className="text-xs text-muted-foreground">
              {t("pageAppeal.count", { count: reason.length, max: PAGE_APPEAL_REASON_MAX })}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {busy ? t("common.saving") : t("pageAppeal.send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
