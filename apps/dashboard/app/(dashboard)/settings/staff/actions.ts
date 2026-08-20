"use server";

import { createStaffMemberSchema, memberIdSchema, type AppError } from "@gymos/types";
import {
  createStaffMember,
  listStaff,
  resendStaffTempPassword,
  type CreateStaffMemberResult,
  type StaffListRow,
} from "@/services/staff";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Story 9.1: Staff List page's data fetch, wrapped as a Server Action so
 * the client component (needed for the Add Staff modal's own interactivity)
 * can re-fetch the list after a successful create, matching
 * `settings/actions.ts`'s existing thin-wrapper shape in this same
 * directory. */
export async function getStaffList(): Promise<{ data: StaffListRow[] | null; error: AppError | null }> {
  return listStaff();
}

/** AD-17 Add Staff Member. `{data,error}` contract, never throws for
 * expected errors -- matches `createGym`'s established Process Pattern. The
 * RPC's own role-ceiling allowlist is the real enforcement boundary (the
 * modal's client-side role-dropdown filtering is a UX convenience only) --
 * a rejected role assignment surfaces here as `staff_role_not_permitted`
 * (packages/types/src/errors.ts), matching AD-17's documented rejection
 * copy. */
export async function createStaffMemberAction(
  input: unknown,
): Promise<{ data: CreateStaffMemberResult | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = createStaffMemberSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      data: null,
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }

  return createStaffMember(parsed.data);
}

/** Story 9.2 (AC #4): "Resend password" action. `staff_account_for_reset()`
 * (0062) is the real authorization boundary (Owner/Supervisor only) -- the
 * Staff List's own role-gated button (StaffPageClient.tsx's `CAN_CREATE`)
 * is a UX convenience only, matching createStaffMemberAction's own comment
 * on this file's established RPC-is-the-real-gate discipline. */
export async function resendStaffTempPasswordAction(
  memberId: unknown,
): Promise<{ data: { tempPassword: string; smsSent: boolean } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = memberIdSchema.safeParse(memberId);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  return resendStaffTempPassword(parsed.data);
}
