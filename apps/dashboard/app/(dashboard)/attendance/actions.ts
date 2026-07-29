"use server";

import { type AppError } from "@gymos/types";
import { checkOutMember } from "@/services/attendance";

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
