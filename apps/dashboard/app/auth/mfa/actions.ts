"use server";

import { recordSupportCodeFailure } from "@/services/support-stepup";

/**
 * Story 23-6c: the sign-in form reports a rejected authenticator code here so it is counted in the same per-user counter as the
 * step-up dialogs (`stepup_record_failure`). It only ever counts against the caller's own account, and only an activated support
 * account has a counter; for anyone else the database does nothing. Returns whether the threshold was reached (account locked and
 * sessions ended). The code itself never reaches the server.
 */
export async function recordMfaFailureAction(): Promise<{ locked: boolean }> {
  try {
    return { locked: await recordSupportCodeFailure() };
  } catch {
    return { locked: false };
  }
}
