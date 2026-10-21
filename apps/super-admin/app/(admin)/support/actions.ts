"use server";

import type { AppError } from "@gymos/types";

import { authorizeOrRedirect } from "@/lib/authz-action";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapAndLog } from "@/services/gyms";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { sendMail } from "@/lib/mail";
import {
  dashboardBaseUrl,
  generateSupportInviteToken,
  isSupportEmail,
  supportInviteLink,
  supportInviteMail,
} from "@/lib/support-invite";

export interface SupportAccountRow {
  userId: string;
  displayName: string | null;
  email: string;
  assignable: boolean;
  activated: boolean;
  activatedAt: string | null;
  inviteState: "none" | "pending" | "expired" | "used" | "dead";
  inviteExpiresAt: string | null;
}

/** Story 23.4: the account list. Names and addresses are visible to Super Admin only. */
export async function listSupportAccounts(): Promise<{ data: SupportAccountRow[] | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_support_accounts");
  if (error) return { data: null, error: await mapAndLog(error) };
  const rows = (data ?? []) as {
    user_id: string;
    display_name: string | null;
    email: string;
    assignable: boolean;
    activated: boolean;
    activated_at: string | null;
    invite_state: SupportAccountRow["inviteState"];
    invite_expires_at: string | null;
  }[];
  return {
    data: rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      email: r.email,
      assignable: r.assignable,
      activated: r.activated,
      activatedAt: r.activated_at,
      inviteState: r.invite_state,
      inviteExpiresAt: r.invite_expires_at,
    })),
    error: null,
  };
}

/**
 * Creates the inactive, assignable support account. The auth user (no password, email confirmed) is created through the
 * Admin API, then `create_support_account` re-checks everything in the database as the real Super Admin at aal2. Any
 * refusal (domain, collision, flag off) answers with the same message and removes the auth user just made.
 */
export async function createSupportAccount(input: unknown): Promise<{ data: { userId: string } | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const refused: AppError = { code: "support_account_refused", message: t("support.errors.refused") };

  const raw = (input ?? {}) as { displayName?: unknown; email?: unknown };
  const displayName = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (displayName.length < 1 || displayName.length > 100) {
    return { data: null, error: { code: "validation_error", message: t("support.errors.nameRequired") } };
  }
  if (!isSupportEmail(email)) {
    return { data: null, error: { code: "validation_error", message: t("support.errors.domain") } };
  }

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true });
  const userId = created?.user?.id;
  if (createError || !userId) {
    // An existing address looks the same as any other refusal.
    return { data: null, error: refused };
  }

  const session = await createClient();
  const { error: rpcError } = await session.rpc("create_support_account", {
    p_user_id: userId,
    p_display_name: displayName,
    p_email: email,
  });
  if (rpcError) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (err) {
      console.error("[createSupportAccount] cleanup of the new auth user failed", err);
    }
    if (String(rpcError.message ?? "").includes("support_account_refused")) return { data: null, error: refused };
    return { data: null, error: await mapAndLog(rpcError) };
  }
  return { data: { userId }, error: null };
}

/**
 * Issues a fresh invite (earlier ones are superseded) and emails the link to the account's @gymosapps.com address. The
 * link is never returned to the browser, logged or audited.
 */
export async function sendSupportInvite(userId: unknown): Promise<{ data: { sent: true } | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return { data: null, error: { code: "validation_error", message: t("support.errors.refused") } };
  }

  const origin = dashboardBaseUrl();
  if (!origin) return { data: null, error: { code: "not_configured", message: t("support.errors.notConfigured") } };

  const { data: userData, error: userError } = await createAdminClient().auth.admin.getUserById(userId);
  const email = userData?.user?.email?.toLowerCase();
  if (userError || !email || !isSupportEmail(email)) {
    return { data: null, error: { code: "support_invite_refused", message: t("support.errors.refused") } };
  }

  const token = generateSupportInviteToken();
  const session = await createClient();
  const { error: rpcError } = await session.rpc("issue_support_invite", { p_user_id: userId, p_token: token });
  if (rpcError) {
    if (String(rpcError.message ?? "").includes("support_invite_refused")) {
      return { data: null, error: { code: "support_invite_refused", message: t("support.errors.refused") } };
    }
    return { data: null, error: await mapAndLog(rpcError) };
  }

  const locale = (await getRequestLocale()) === "fr" ? "fr" : "en";
  let sent = false;
  try {
    sent = (await sendMail({ to: email, ...supportInviteMail({ link: supportInviteLink(origin, token), locale }) })).ok;
  } catch {
    sent = false;
  }
  if (!sent) return { data: null, error: { code: "mail_failed", message: t("support.errors.mailFailed") } };
  return { data: { sent: true }, error: null };
}
