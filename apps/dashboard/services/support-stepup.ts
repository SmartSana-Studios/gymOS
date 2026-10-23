import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Story 23.9 / 23-6c: the single-use step-up a live support session needs before a money- or access-changing write (payment
 * connection, refund, registration-fee waiver, staff creation).
 *
 * The fresh authenticator code is verified HERE, server side, on the caller's own session client (never `amr`); only then does the
 * service-role RPC `stepup_issue` record a grant for this user, bound to (action, subject) and valid for the configured minutes. The
 * database refuses to issue it to anyone but an activated, unlocked support account, and the write consumes it inside the same
 * transaction. The code is never stored or logged.
 *
 * Wrong codes are counted per user in the database (`stepup_record_failure`, Story 23.10): each writes an audit row (counts only) and
 * the threshold locks the account and ends its sessions. Supabase's own MFA rate limit still applies to the verify call.
 *
 * `verifySupportCode` and `issueSupportGrant` are split so staff creation can verify the code BEFORE it provisions an auth user and
 * issue the grant once the user id is known (the grant subject is that user id).
 */
export type SupportStepUpResult = "issued" | "invalid_code" | "unavailable" | "locked";

export type SupportGrantAction =
  | "support_payment_connection"
  | "support_refund"
  | "support_waive_registration_fee"
  | "support_create_staff";

export type SupportCodeResult = { status: "verified"; userId: string } | { status: "invalid_code" | "unavailable" | "locked" };

/** True only for a live support session; the database decides (its live gate), not a claim read here. */
export async function isLiveSupportSession(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_support_connection_gym");
  return !error && typeof data === "string" && data.length > 0;
}

export async function verifySupportCode(rawCode: string): Promise<SupportCodeResult> {
  const code = (rawCode ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { status: "invalid_code" };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { status: "unavailable" };

  const { data: list, error: listError } = await supabase.auth.mfa.listFactors();
  const factors = list?.totp ?? [];
  if (listError || factors.length === 0) return { status: "invalid_code" };

  let verified = false;
  let wrongCode = false;
  for (const factor of factors) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (!error) {
      verified = true;
      break;
    }
    if (error.code === "mfa_verification_failed" || error.code === "mfa_verification_rejected") wrongCode = true;
  }
  if (verified) return { status: "verified", userId };

  if (!wrongCode) return { status: "unavailable" };
  // Only a rejected code counts; provider or network errors never do. A failed count must not turn a wrong code into a pass.
  const { data } = await createAdminClient().rpc("stepup_record_failure", { p_user: userId });
  const row = Array.isArray(data) ? data[0] : null;
  return { status: row?.locked === true ? "locked" : "invalid_code" };
}

export async function issueSupportGrant(input: {
  userId: string;
  action: SupportGrantAction;
  subjectId: string;
}): Promise<"issued" | "unavailable"> {
  if (!input.subjectId) return "unavailable";
  const { data: expires, error } = await createAdminClient().rpc("stepup_issue", {
    p_user: input.userId,
    p_action: input.action,
    p_subject: input.subjectId,
  });
  return error || !expires ? "unavailable" : "issued";
}

export async function issueSupportStepUp(input: {
  action: SupportGrantAction;
  subjectId: string;
  code: string;
}): Promise<SupportStepUpResult> {
  if (!input.subjectId) return "invalid_code";
  const verified = await verifySupportCode(input.code);
  if (verified.status !== "verified") return verified.status;
  return issueSupportGrant({ userId: verified.userId, action: input.action, subjectId: input.subjectId });
}

/** Sign-in (23-6b): count one wrong authenticator code for the caller; true when that reached the lock threshold. */
export async function recordSupportCodeFailure(): Promise<boolean> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return false;
  const { data } = await createAdminClient().rpc("stepup_record_failure", { p_user: userId });
  const row = Array.isArray(data) ? data[0] : null;
  return row?.locked === true;
}

/** The authenticator code is six digits (spaces allowed); anything else is refused before the provider or the database is touched. */
export function isWellFormedSupportCode(raw: unknown): boolean {
  return typeof raw === "string" && /^\d{6}$/.test(raw.replace(/\s+/g, ""));
}

/** Maps a step-up outcome to the generic, bilingual error every dialog shows (never the person's name). */
export function supportStepUpError(
  result: Exclude<SupportStepUpResult, "issued"> | "code_required",
  t: (key: string) => string,
): { code: string; message: string } {
  switch (result) {
    case "code_required":
      return { code: "code_required", message: t("supportStepUp.codeRequired") };
    case "invalid_code":
      return { code: "invalid_code", message: t("supportStepUp.codeInvalid") };
    case "locked":
      return { code: "account_locked", message: t("supportStepUp.locked") };
    default:
      return { code: "step_up_unavailable", message: t("supportStepUp.unavailable") };
  }
}
