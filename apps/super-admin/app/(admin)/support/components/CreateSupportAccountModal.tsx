"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createSupportAccount } from "../actions";
import type { SupportMessage } from "./constants";

/** Story 23.12: create a support account (name and @gymosapps.com address). Refusals show inline and keep the modal open. */
export function CreateSupportAccountModal({ onClose, onMessage }: { onClose: () => void; onMessage: (m: SupportMessage) => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await createSupportAccount({ displayName, email });
      if (err) {
        setError(err.message);
        return;
      }
      onMessage({ kind: "ok", text: t("support.toast.created") });
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent closeLabel={t("support.modal.cancel")}>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("support.modal.title.create")}</DialogTitle>
            <DialogDescription>{t("support.create.hint")}</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t("support.create.name")}</span>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} required />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t("support.create.email")}</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gymosapps.com" required />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("support.modal.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !displayName.trim() || !email.trim()}>
              {t("support.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
