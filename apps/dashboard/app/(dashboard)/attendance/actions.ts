"use server";

import { staffCheckInSchema, voidStaffCheckInSchema, type AppError } from "@gymos/types";
import {
  checkOutMember,
  searchMembersForCheckIn,
  staffCheckIn,
  voidStaffCheckIn,
  type CheckInSearchRow,
  type StaffCheckInResult,
  type VoidStaffCheckInResult,
} from "@/services/attendance";
import {
  isLiveSupportSession,
  isWellFormedSupportCode,
  issueSupportStepUp,
  supportStepUpError,
  type SupportGrantAction,
} from "@/services/support-stepup";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Thin wrapper over `checkOutMember()` (Story 3.5's `check_out_member()`
 * RPC) -- no Zod schema needed, `memberId` is a bare UUID passed straight
 * through with nothing else to validate, matching `checkOutMember`'s own
 * established rationale from Story 3.5. `check_out_member()`'s RPC already
 * logs its own audit entry (`attendance_manual_checkout`) -- no separate
 * audit call needed here, unlike `deactivateMember`'s two-step pattern. */
export async function checkOutMemberAction(
  memberId: string,
): Promise<{ data: { checkedOutAt: string } | null; error: AppError | null }> {
  return checkOutMember(memberId);
}

/**
 * Story 27.3 (AD-30, FR-251): a live GymOS Support session must present a fresh authenticator code before a staff check-in or a void.
 * The code is verified server side and turned into a single-use grant bound to (action, subject); the database function consumes it
 * (`support_stepup_require`). The database decides whether this is a live support session. Returns the error to show, or null when
 * nothing is needed or the grant was issued. The same pattern as `requireSupportGrant` in payments/actions.ts (the epic's "SA-21
 * prompt" is this typed code, as for every other support write).
 */
async function requireSupportGrant(
  action: SupportGrantAction,
  subjectId: string,
  input: unknown,
  t: (key: string) => string,
): Promise<AppError | null> {
  if (!(await isLiveSupportSession())) return null;
  const code = (input as { authCode?: unknown } | null)?.authCode;
  if (!isWellFormedSupportCode(code)) return supportStepUpError("code_required", t);
  const result = await issueSupportStepUp({ action, subjectId, code: code as string });
  return result === "issued" ? null : supportStepUpError(result, t);
}

/** Step 1 of the Check in a member modal. A bare search term; the service enforces the thresholds and the gym. */
export async function searchMembersForCheckInAction(
  term: string,
): Promise<{ data: { rows: CheckInSearchRow[]; hasMore: boolean } | null; error: AppError | null }> {
  return searchMembersForCheckIn(typeof term === "string" ? term : "");
}

/**
 * AD-30: check a member in. No time, no date, no scan id: the server stamps now() (FR-248). Every outcome is a coded result of
 * `staff_check_in`; only a suspended gym, a refused role or a failed step-up come back as `error`.
 */
export async function staffCheckInAction(
  input: unknown,
): Promise<{ data: StaffCheckInResult | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = staffCheckInSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  const stepUpError = await requireSupportGrant("support_staff_check_in", parsed.data.memberId, input, t);
  if (stepUpError) return { data: null, error: stepUpError };

  return staffCheckIn(parsed.data.memberId);
}

/** AD-11 V1.8: void a staff entry of the current gym-local day (Manager and above, GymOS Support behind a step-up). */
export async function voidStaffCheckInAction(
  input: unknown,
): Promise<{ data: VoidStaffCheckInResult | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = voidStaffCheckInSchema.safeParse(input);
  if (!parsed.success) {
    // A reason outside 5 to 300 characters is the one input the modal can produce that fails here; it is coded like the database's.
    return { data: { outcome: "invalid_reason", attendanceId: null, voidedAt: null, sessionReleased: false, stampRemoved: false, laterIsStaffEntry: false }, error: null };
  }

  const stepUpError = await requireSupportGrant("support_void_staff_check_in", parsed.data.attendanceId, input, t);
  if (stepUpError) return { data: null, error: stepUpError };

  return voidStaffCheckIn(parsed.data.attendanceId, parsed.data.reason);
}
