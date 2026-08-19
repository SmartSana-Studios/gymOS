"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { createStaffMemberSchema, type CreateStaffMemberInput } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MemberRole } from "@/services/session";
import { createStaffMemberAction } from "../actions";

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// AD-16/AD-17's role-ceiling: an Owner sees Supervisor/Manager/Receptionist/
// Coach; a Supervisor sees only Manager/Receptionist/Coach (never Supervisor
// or Owner). This client-side filtering is a UX convenience, not the
// enforcement boundary -- create_staff_member()'s own RPC allowlist is what
// actually rejects a stale/bypassed client (AD-17: "On rejection... inline
// error 'You don't have permission to assign that role'").
const ROLE_OPTIONS_BY_CALLER: Record<string, CreateStaffMemberInput["role"][]> = {
  owner: ["supervisor", "manager", "receptionist", "coach"],
  supervisor: ["manager", "receptionist", "coach"],
};

const ROLE_LABEL_KEY: Record<CreateStaffMemberInput["role"], string> = {
  supervisor: "role.supervisor",
  manager: "role.manager",
  receptionist: "role.receptionist",
  coach: "role.coach",
};

interface FieldErrors {
  name?: string;
  phone?: string;
  role?: string;
}

const FIELD_ERROR_KEY: Record<keyof FieldErrors, string> = {
  name: "staff.modal.errors.nameInvalid",
  phone: "staff.modal.errors.phoneInvalid",
  role: "staff.modal.errors.roleRequired",
};

const emptyForm = { name: "", phone: "", role: "" as CreateStaffMemberInput["role"] | "" };

export function AddStaffModal({
  open,
  callerRole,
  onClose,
  onCreated,
}: {
  open: boolean;
  callerRole: MemberRole;
  onClose: () => void;
  onCreated: (tempPassword: string) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const roleOptions = ROLE_OPTIONS_BY_CALLER[callerRole] ?? [];

  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open && !syncedOpen) {
    setSyncedOpen(true);
    setForm(emptyForm);
    setFieldErrors({});
    setFormError(null);
  } else if (!open && syncedOpen) {
    setSyncedOpen(false);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function resetAndClose() {
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const parsed = createStaffMemberSchema.safeParse({
      name: form.name,
      phone: form.phone,
      role: form.role,
    });

    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (!errors[field] && FIELD_ERROR_KEY[field]) {
          errors[field] = t(FIELD_ERROR_KEY[field]);
        }
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await createStaffMemberAction(parsed.data);
      if (error || !data) {
        // AD-17's documented rejection copy: a stale/bypassed client
        // attempting a role the RPC's own ceiling check rejects. Highlights
        // the Role field rather than a generic form-level error, matching
        // the mockup's own "Role field highlighted" spec.
        if (error?.code === "staff_role_not_permitted") {
          setFieldErrors({ role: error.message });
        } else {
          setFormError(error?.message ?? t("staff.errors.createFailed"));
        }
        return;
      }
      onCreated(data.tempPassword);
    } catch {
      setFormError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={resetAndClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("staff.modal.addTitle")}</h2>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label={t("staff.modal.close")}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        {formError && (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="staffName">{t("staff.modal.name")}</Label>
          <Input
            id="staffName"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {fieldErrors.name && <p className="text-sm text-red-600">{fieldErrors.name}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="staffPhone">{t("staff.modal.phone")}</Label>
          <Input
            id="staffPhone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+237"
          />
          {fieldErrors.phone && <p className="text-sm text-red-600">{fieldErrors.phone}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="staffRole">{t("staff.modal.role")}</Label>
          <select
            id="staffRole"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as CreateStaffMemberInput["role"] })}
            className={selectClassName}
          >
            <option value="">{t("staff.modal.selectRole")}</option>
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {t(ROLE_LABEL_KEY[role])}
              </option>
            ))}
          </select>
          {fieldErrors.role && <p className="text-sm text-red-600">{fieldErrors.role}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" disabled={submitting} onClick={resetAndClose}>
            {t("staff.modal.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("staff.modal.creating") : t("staff.modal.create")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
