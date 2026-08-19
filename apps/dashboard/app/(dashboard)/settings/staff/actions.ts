"use server";

import { createStaffMemberSchema, type AppError } from "@gymos/types";
import { createStaffMember, listStaff, type CreateStaffMemberResult, type StaffListRow } from "@/services/staff";
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
