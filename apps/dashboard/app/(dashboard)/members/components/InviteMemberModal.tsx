"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { MemberListRow } from "@/services/members";

/**
 * Client-side message composition only -- no Server Action, no persisted
 * state (see Story 2.5 Scope Note #2/#3). The invite text is copy/share-only;
 * the phone-to-account association it used to require a deep link for
 * already exists from Story 2.3's member-creation flow.
 */
export function InviteMemberModal({
  member,
  gymName,
  onClose,
}: {
  member: MemberListRow;
  gymName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const message = t("members.invite.message", { name: member.name, gymName });
  // member.phone is already E.164-normalized ("+2376...") -- wa.me takes the
  // number without the leading "+". Without this, "Share via WhatsApp"
  // opened a generic compose screen instead of a chat targeted at the
  // invited member (code review fix). MemberListRow.phone is typed nullable
  // even though the "Invite" button is only rendered for rows with a phone
  // (Scope Note #7) -- fall back to the untargeted link rather than crash if
  // this component is ever reached defensively without one.
  const whatsappPhone = member.phone?.replace(/^\+/, "");
  const whatsappUrl = whatsappPhone
    ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      // Clipboard API can be denied (permissions, insecure context) -- the
      // message is still selectable in the textarea as a fallback, so this
      // is silent rather than surfacing a second error on top of a success.
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="w-full max-w-[480px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
            {member.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t("members.invite.title", { name: member.name })}</h2>
            <p className="text-sm text-muted-foreground">{gymName}</p>
          </div>
        </div>

        <textarea
          readOnly
          value={message}
          rows={4}
          className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button type="button" variant="outline" asChild>
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              {t("members.invite.shareWhatsapp")}
            </a>
          </Button>
          <Button type="button" onClick={copyMessage}>
            {copied ? t("members.invite.copied") : t("members.invite.copyMessage")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
