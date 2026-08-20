"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MemberRole } from "@/services/session";
import type { StaffListRow, StaffStatus } from "@/services/staff";
import { getStaffList, resendStaffTempPasswordAction } from "../actions";
import { AddStaffModal } from "./AddStaffModal";
import { EditStaffModal } from "./EditStaffModal";
import { DeactivateStaffDialog } from "./DeactivateStaffDialog";

// Visible to Owner and Supervisor only (AD-16) -- this page is itself only
// reachable via the Settings "Manage staff →" link, which is already
// role-gated (Task 5), and the Sidebar's own Settings entry is role-gated to
// ["owner", "supervisor"] (Task 3). This is a second, defense-in-depth check
// on the "+ Add staff" button specifically -- a Manager/Receptionist/Coach
// reaching this route directly (RLS is the real read gate, per this file's
// page.tsx comment) must not see a create affordance that would only fail
// server-side (AC #3: no staff-creation UI at all for Manager).
const CAN_CREATE: MemberRole[] = ["owner", "supervisor"];

const ROLE_LABEL_KEY: Record<string, string> = {
  supervisor: "role.supervisor",
  manager: "role.manager",
  receptionist: "role.receptionist",
  coach: "role.coach",
};

// Code review fix: Edit/Deactivate were previously shown for every non-self
// row regardless of the caller's role ceiling, so e.g. a Supervisor saw both
// buttons on an Owner's or another Supervisor's row even though
// update_staff_role()/deactivate_staff_member() always reject those targets.
// Mirrors ROLE_OPTIONS_BY_CALLER's own ceiling shape (AddStaffModal.tsx /
// EditStaffModal.tsx) so the affordance matches what the RPC actually allows.
const ACTIONABLE_TARGET_ROLES: Record<string, string[]> = {
  owner: ["supervisor", "manager", "receptionist", "coach"],
  supervisor: ["manager", "receptionist", "coach"],
};

const STATUS_LABEL_KEY: Record<StaffStatus, string> = {
  active: "staff.status.active",
  pending_activation: "staff.status.pendingActivation",
  deactivated: "staff.status.deactivated",
};

export function StaffPageClient({
  initialStaff,
  role,
  callerMemberId,
}: {
  initialStaff: StaffListRow[];
  role: MemberRole;
  callerMemberId: string | null;
}) {
  const { t } = useTranslation();
  const canCreate = CAN_CREATE.includes(role);

  const [staff, setStaff] = useState(initialStaff);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tempPassword?: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<StaffListRow | null>(null);
  const [deactivatingRow, setDeactivatingRow] = useState<StaffListRow | null>(null);

  function showToast(message: string, tempPassword?: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, tempPassword });
    if (!tempPassword) {
      toastTimerRef.current = setTimeout(() => setToast(null), 4000);
    }
  }

  async function refreshStaff() {
    const { data } = await getStaffList();
    if (data) setStaff(data);
  }

  // Story 9.2 (AC #4): credential-invalidating action -- unlike the
  // Members Invite button (which only re-sends a message, nothing is
  // invalidated), this stops the staff member's current password (temp or
  // real) from working immediately, so it needs an explicit confirm step.
  async function handleResend(row: StaffListRow) {
    if (resendingId) return;
    if (!window.confirm(t("staff.resend.confirm", { name: row.name }))) return;

    setResendingId(row.id);
    try {
      const { data, error } = await resendStaffTempPasswordAction(row.id);
      if (error || !data) {
        showToast(error?.message ?? t("common.somethingWentWrong"));
        return;
      }
      await refreshStaff();
      showToast(
        t(data.smsSent ? "staff.toast.resendSms" : "staff.toast.resendNoSms", { phone: row.phone ?? "" }),
        data.tempPassword,
      );
    } finally {
      setResendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link href="/settings" className="text-sm text-muted-foreground hover:underline">
            {t("staff.backToSettings")}
          </Link>
          <h1 className="text-2xl font-semibold">{t("staff.title")}</h1>
        </div>
        {canCreate && (
          <Button type="button" onClick={() => setModalOpen(true)}>
            {t("staff.addStaff")}
          </Button>
        )}
      </div>

      {staff.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("staff.emptyNoStaff")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{t("staff.table.name")}</th>
                <th className="px-4 py-2 font-medium">{t("staff.table.role")}</th>
                <th className="px-4 py-2 font-medium">{t("staff.table.status")}</th>
                {canCreate && <th className="px-4 py-2 font-medium">{t("staff.table.actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {staff.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2">
                    <Badge variant="secondary">{t(ROLE_LABEL_KEY[row.role] ?? row.role)}</Badge>
                  </td>
                  <td className="px-4 py-2">{t(STATUS_LABEL_KEY[row.status])}</td>
                  {canCreate && (
                    <td className="px-4 py-2 space-x-2">
                      {row.status !== "deactivated" && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={resendingId !== null}
                            onClick={() => handleResend(row)}
                          >
                            {resendingId === row.id ? t("staff.actions.resending") : t("staff.actions.resend")}
                          </Button>
                          {(row.id === callerMemberId || (ACTIONABLE_TARGET_ROLES[role] ?? []).includes(row.role)) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingRow(row)}
                            >
                              {t("staff.actions.edit")}
                            </Button>
                          )}
                          {row.id !== callerMemberId && (ACTIONABLE_TARGET_ROLES[role] ?? []).includes(row.role) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setDeactivatingRow(row)}
                            >
                              {t("staff.actions.deactivate")}
                            </Button>
                          )}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCreate && (
        <AddStaffModal
          open={modalOpen}
          callerRole={role}
          onClose={() => setModalOpen(false)}
          onCreated={async (tempPassword, smsSent, phone) => {
            setModalOpen(false);
            await refreshStaff();
            showToast(t(smsSent ? "staff.toast.createdSms" : "staff.toast.createdNoSms", { phone }), tempPassword);
          }}
        />
      )}

      {editingRow && (
        <EditStaffModal
          open={editingRow !== null}
          callerRole={role}
          staff={editingRow}
          isSelf={editingRow.id === callerMemberId}
          onClose={() => setEditingRow(null)}
          onUpdated={async (updated) => {
            setEditingRow(null);
            await refreshStaff();
            showToast(t("staff.toast.roleUpdated", { name: updated.name }));
          }}
        />
      )}

      {deactivatingRow && (
        <DeactivateStaffDialog
          staff={deactivatingRow}
          onClose={() => setDeactivatingRow(null)}
          onDone={async () => {
            const name = deactivatingRow.name;
            setDeactivatingRow(null);
            await refreshStaff();
            showToast(t("staff.toast.deactivated", { name }));
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 max-w-sm rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
        >
          <p>{toast.message}</p>
          {toast.tempPassword && (
            <div className="mt-2 space-y-2">
              <Input
                readOnly
                value={toast.tempPassword}
                onFocus={(e) => e.currentTarget.select()}
                className="border-primary-foreground/30 bg-primary-foreground/10 text-xs text-primary-foreground"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-primary-foreground hover:text-primary-foreground"
                  onClick={() => setToast(null)}
                >
                  {t("staff.modal.close")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
