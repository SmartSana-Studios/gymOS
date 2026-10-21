import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Story 23.9: the single-use step-up a live support session needs before it connects a payment account.
 *
 * The fresh authenticator code is verified HERE, server side, on the caller's own session client (never `amr`); only then does the
 * service-role RPC `stepup_issue` record a grant for this user, bound to (action, subject) and valid for the configured minutes. The
 * database refuses to issue it to anyone but an activated, unlocked support account, and `support_connect_gym_payment_credentials`
 * consumes it inside the same transaction as the write. The code is never stored or logged.
 *
 * Wrong codes are not counted toward a lockout here: the 22.7 lockout counter covers Super Admin accounts only (`stepup_record_failure`
 * is a no-op for anyone else), and Supabase's own MFA rate limit still applies to the verify call.
 */
export type SupportStepUpResult = "issued" | "invalid_code" | "unavailable";

export async function issueSupportStepUp(input: {
  action: "support_payment_connection";
  subjectId: string;
  code: string;
}): Promise<SupportStepUpResult> {
  const code = (input.code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code) || !input.subjectId) return "invalid_code";

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return "unavailable";

  const { data: list, error: listError } = await supabase.auth.mfa.listFactors();
  const factors = list?.totp ?? [];
  if (listError || factors.length === 0) return "invalid_code";

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
  if (!verified) return wrongCode ? "invalid_code" : "unavailable";

  const admin = createAdminClient();
  const { data: expires, error } = await admin.rpc("stepup_issue", {
    p_user: userId,
    p_action: input.action,
    p_subject: input.subjectId,
  });
  return error || !expires ? "unavailable" : "issued";
}
