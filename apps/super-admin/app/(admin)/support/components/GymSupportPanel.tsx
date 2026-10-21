"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import type { SupportAccountRow, SupportAssignmentRow } from "../actions";
import { REASON_MAX, SupportAssignmentsPanel } from "./SupportAssignmentsPanel";

/** Story 23.5: the gym detail page's view of who is assigned. Super Admin only; the Owner never sees an individual. */
export function GymSupportPanel({
  gymId,
  assignments,
  accounts,
}: {
  gymId: string;
  assignments: SupportAssignmentRow[];
  accounts: SupportAccountRow[];
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t("support.assign.reason")}</span>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} placeholder={t("support.assign.reasonHint")} />
      </label>
      {message && (
        <p role="status" className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {message.text}
        </p>
      )}
      <SupportAssignmentsPanel assignments={assignments} accounts={accounts} fixedGymId={gymId} reason={reason} onMessage={setMessage} />
    </div>
  );
}
