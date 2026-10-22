"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { SupportAccountRow, SupportAssignmentRow } from "../actions";
import { AssignSupportModal } from "./AssignSupportModal";
import type { SupportMessage } from "./constants";
import { SupportAssignmentsPanel } from "./SupportAssignmentsPanel";

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
  const [message, setMessage] = useState<SupportMessage | null>(null);
  const [assigning, setAssigning] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAssigning(true)}>
          {t("support.top.assign")}
        </Button>
      </div>
      {message && (
        <p role="status" className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {message.text}
        </p>
      )}
      <SupportAssignmentsPanel assignments={assignments} fixedGymId={gymId} onMessage={setMessage} />
      {assigning && <AssignSupportModal accounts={accounts} fixedGymId={gymId} onClose={() => setAssigning(false)} onMessage={setMessage} />}
    </div>
  );
}
