"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MemberRole } from "@/services/session";
import type { StaffListRow, StaffStatus } from "@/services/staff";
import { getStaffList } from "../actions";
import { AddStaffModal } from "./AddStaffModal";

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

const STATUS_LABEL_KEY: Record<StaffStatus, string> = {
  active: "staff.status.active",
  pending_activation: "staff.status.pendingActivation",
  deactivated: "staff.status.deactivated",
};

export function StaffPageClient({
  initialStaff,
  role,
}: {
  initialStaff: StaffListRow[];
  role: MemberRole;
}) {
  const { t } = useTranslation();
  const canCreate = CAN_CREATE.includes(role);

  const [staff, setStaff] = useState(initialStaff);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tempPassword?: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          onCreated={async (tempPassword) => {
            setModalOpen(false);
            await refreshStaff();
            showToast(t("staff.tempPasswordToast", { password: tempPassword }), tempPassword);
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
