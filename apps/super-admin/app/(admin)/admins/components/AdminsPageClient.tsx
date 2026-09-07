"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SuperAdminRow } from "../actions";
import { AddAdminModal } from "./AddAdminModal";

/**
 * Story 1.16 (AC #1, #5): the Admins list plus the "+ Add Admin" trigger.
 * No pager -- this app's Super Admin population is small and tightly held
 * (`lib/supabase/admin.ts`'s own framing), unlike SA-02's gym list.
 */
export function AdminsPageClient({ initialAdmins }: { initialAdmins: SuperAdminRow[] }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tempPassword?: string } | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // A plain status message auto-dismisses; one carrying the temp password
  // stays on screen until explicitly closed -- same rationale and shape as
  // GymsPageClient's own showToast (Story 1.5).
  function showToast(message: string, tempPassword?: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setPasswordCopied(false);
    setToast({ message, tempPassword });
    if (!tempPassword) {
      toastTimerRef.current = setTimeout(() => setToast(null), 4000);
    }
  }

  function handleDone(
    outcome: "created" | "promoted" | "already_super_admin",
    email: string,
    tempPassword: string | null,
  ) {
    setModalOpen(false);
    if (outcome === "created") {
      showToast(t("admins.toast.created", { email }), tempPassword ?? undefined);
    } else if (outcome === "promoted") {
      showToast(t("admins.toast.promoted", { email }));
    } else {
      // AC #4: distinct copy -- must not read as a fresh promotion that
      // didn't actually happen (mirrors RevokeAccessDialog's `alreadyGone`
      // branch for the equivalent no-op case).
      showToast(t("admins.toast.alreadySuperAdmin", { email }));
    }
    router.refresh();
  }

  async function copyTempPassword(password: string) {
    try {
      await navigator.clipboard.writeText(password);
      setPasswordCopied(true);
    } catch {
      // Clipboard API can be denied -- the password is still
      // selectable/visible in the toast as a fallback.
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("admins.title")}</h1>
        <Button onClick={() => setModalOpen(true)}>{t("admins.addAdmin")}</Button>
      </div>

      {initialAdmins.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admins.empty")}</p>
      ) : (
        // Matches every other table in this app (GymsPageClient,
        // BillingPageClient, GymMembersTable, GymPaymentsTable,
        // metrics/page.tsx) -- this was the one table missing it, so it was
        // the one page whose table content, not just the nav, contributed
        // to the reported mobile-overflow issue.
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{t("admins.columns.email")}</th>
                <th className="py-2 pr-4 font-medium">{t("admins.columns.displayName")}</th>
                <th className="py-2 pr-4 font-medium">{t("admins.columns.since")}</th>
              </tr>
            </thead>
            <tbody>
              {initialAdmins.map((admin) => (
                <tr key={admin.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-4">{admin.email}</td>
                  <td className="py-2 pr-4">
                    {admin.displayName ?? t("admins.columns.noDisplayName")}
                  </td>
                  <td className="py-2 pr-4">
                    {/* `since` is a full timestamptz, not a date-only column --
                        unlike join_date/createdAt elsewhere in this app, a
                        plain `new Date(iso)` carries no UTC-midnight ambiguity
                        here, so no formatLocalDate-style workaround applies. */}
                    {admin.since
                      ? new Date(admin.since).toLocaleString(i18n.language)
                      : t("admins.columns.sinceUnknown")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddAdminModal open={modalOpen} onClose={() => setModalOpen(false)} onDone={handleDone} />

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
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => copyTempPassword(toast.tempPassword!)}
                >
                  {passwordCopied ? t("admins.toast.passwordCopied") : t("admins.toast.copyPassword")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-primary-foreground hover:text-primary-foreground"
                  onClick={() => setToast(null)}
                >
                  {t("admins.toast.dismiss")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
