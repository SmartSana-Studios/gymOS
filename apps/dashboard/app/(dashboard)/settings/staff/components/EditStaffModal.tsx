"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { updateStaffRoleSchema, type UpdateStaffRoleInput } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MemberRole } from "@/services/session";
import type { StaffListRow } from "@/services/staff";
import { updateStaffRoleAction } from "../actions";

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// Story 9.3 Task 12: a new sibling component rather than threading an
// `isEdit` boolean through AddStaffModal.tsx -- Create-mode's schema, phone
// field, and 3-arg onCreated callback don't cleanly generalize to Edit
// mode (no phone field per Task 13's decision, different schema, different
// submit RPC, different success callback shape). Matches this codebase's
// general "no premature abstraction for a second, meaningfully-different
// call site" discipline.
//
// ROLE_OPTIONS_BY_CALLER is redeclared here rather than imported from
// AddStaffModal.tsx -- that const is not exported, per this file's own
// "no shared cross-file consts" convention already established for the
// Zod schemas (staff.ts:6-7) and error-mapping copy.
const ROLE_OPTIONS_BY_CALLER: Record<string, UpdateStaffRoleInput["role"][]> = {
  owner: ["supervisor", "manager", "receptionist", "coach"],
  supervisor: ["manager", "receptionist", "coach"],
};

const ROLE_LABEL_KEY: Record<UpdateStaffRoleInput["role"], string> = {
  supervisor: "role.supervisor",
  manager: "role.manager",
  receptionist: "role.receptionist",
  coach: "role.coach",
};

interface FieldErrors {
  name?: string;
  role?: string;
}

const FIELD_ERROR_KEY: Record<keyof FieldErrors, string> = {
  name: "staff.modal.errors.nameInvalid",
  role: "staff.modal.errors.roleRequired",
};

export function EditStaffModal({
  open,
  callerRole,
  staff,
  isSelf,
  onClose,
  onUpdated,
}: {
  open: boolean;
  callerRole: MemberRole;
  staff: StaffListRow;
  isSelf: boolean;
  onClose: () => void;
  onUpdated: (updated: StaffListRow) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState({ name: staff.name, role: staff.role as UpdateStaffRoleInput["role"] });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The caller's own ceiling only offers roles they're allowed to assign to
  // *others* -- for a self-edit, the current row's own role is added so the
  // (disabled) select still shows the correct value rather than an empty
  // dropdown.
  const roleOptions = ROLE_OPTIONS_BY_CALLER[callerRole] ?? [];

  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open && !syncedOpen) {
    setSyncedOpen(true);
    setForm({ name: staff.name, role: staff.role as UpdateStaffRoleInput["role"] });
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
    if (submitting) return;
    setFieldErrors({});
    setFormError(null);

    const parsed = updateStaffRoleSchema.safeParse({
      name: form.name,
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
      const { data, error } = await updateStaffRoleAction(staff.id, parsed.data);
      if (error || !data) {
        // Both AD-16's ceiling-rejection copy and the self-edit
        // defense-in-depth rejection highlight the Role field, mirroring
        // AddStaffModal.tsx's own established pattern.
        if (error?.code === "staff_role_not_permitted" || error?.code === "staff_self_role_edit_not_permitted") {
          setFieldErrors({ role: error.message });
        } else {
          setFormError(error?.message ?? t("staff.errors.updateFailed"));
        }
        return;
      }
      onUpdated(data);
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
          <h2 className="text-lg font-semibold">{t("staff.editModal.title")}</h2>
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
          <Label htmlFor="editStaffName">{t("staff.modal.name")}</Label>
          <Input
            id="editStaffName"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {fieldErrors.name && <p className="text-sm text-red-600">{fieldErrors.name}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="editStaffPhone">{t("staff.modal.phone")}</Label>
          <Input id="editStaffPhone" value={staff.phone ?? ""} readOnly disabled />
        </div>

        <div className="space-y-2">
          <Label htmlFor="editStaffRole">{t("staff.modal.role")}</Label>
          <select
            id="editStaffRole"
            value={form.role}
            disabled={isSelf}
            title={isSelf ? t("staff.editModal.cannotEditOwnRole") : undefined}
            onChange={(e) => setForm({ ...form, role: e.target.value as UpdateStaffRoleInput["role"] })}
            className={selectClassName}
          >
            {!roleOptions.includes(form.role) && (
              <option value={form.role}>{t(ROLE_LABEL_KEY[form.role] ?? form.role)}</option>
            )}
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {t(ROLE_LABEL_KEY[role])}
              </option>
            ))}
          </select>
          {isSelf && <p className="text-xs text-muted-foreground">{t("staff.editModal.cannotEditOwnRole")}</p>}
          {fieldErrors.role && <p className="text-sm text-red-600">{fieldErrors.role}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" disabled={submitting} onClick={resetAndClose}>
            {t("staff.editModal.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("staff.editModal.saving") : t("staff.editModal.save")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
