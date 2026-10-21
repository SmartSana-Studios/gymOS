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
  inviteState: "none" | "pending" | "expired" | "used" | "dead" | "deactivated";
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
 * Issues a fresh invite (earlier ones are superseded; service-role call with the authorised Super Admin as p_actor) and emails the link to the account's @gymosapps.com address. The
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
  // Issuance is service_role only: the token exists only on this server and in the mailbox, never in a browser session.
  // The actor is the Super Admin the gate just authorised; the database re-verifies it live.
  const { error: rpcError } = await createAdminClient().rpc("issue_support_invite", {
    p_user_id: userId,
    p_token: token,
    p_actor: authz.actorId,
  });
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

// ===== Story 23.5: assign, confirm, unassign, deactivate, remove =====

export interface SupportAssignmentRow {
  assignmentId: string;
  supportUserId: string;
  displayName: string | null;
  email: string | null;
  gymId: string;
  gymName: string;
  state: "pending" | "active" | "suspended" | "ended";
  reason: string | null;
  createdAt: string;
  activatedAt: string | null;
  endedAt: string | null;
  suspendedBySwitch: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** The typed result the five database functions return. */
interface SupportResultRow {
  ok: boolean;
  code: string;
  assignment_id: string | null;
}

/** The individual's name and address come back here only: Super Admin at the support section and the gym detail page. */
export async function listSupportAssignments(
  filter: { gymId?: string; userId?: string } = {},
): Promise<{ data: SupportAssignmentRow[] | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  if ((filter.gymId !== undefined && !isUuid(filter.gymId)) || (filter.userId !== undefined && !isUuid(filter.userId))) {
    return { data: null, error: { code: "validation_error", message: "invalid filter" } };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_support_assignments", {
    p_gym_id: filter.gymId ?? null,
    p_user_id: filter.userId ?? null,
  } as never);
  if (error) return { data: null, error: await mapAndLog(error) };
  const rows = (data ?? []) as {
    assignment_id: string;
    support_user_id: string;
    display_name: string | null;
    email: string | null;
    gym_id: string;
    gym_name: string;
    state: SupportAssignmentRow["state"];
    reason: string | null;
    created_at: string;
    activated_at: string | null;
    ended_at: string | null;
    suspended_by_switch: boolean;
  }[];
  return {
    data: rows.map((r) => ({
      assignmentId: r.assignment_id,
      supportUserId: r.support_user_id,
      displayName: r.display_name,
      email: r.email,
      gymId: r.gym_id,
      gymName: r.gym_name,
      state: r.state,
      reason: r.reason,
      createdAt: r.created_at,
      activatedAt: r.activated_at,
      endedAt: r.ended_at,
      suspendedBySwitch: r.suspended_by_switch,
    })),
    error: null,
  };
}

/** Active gyms an assignment can be made in (the database re-checks). */
export async function listAssignableGyms(): Promise<{ data: { id: string; name: string }[] | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const supabase = await createClient();
  const { data, error } = await supabase.from("gyms").select("id, name").eq("status", "active").order("name").limit(500);
  if (error) return { data: null, error: await mapAndLog(error) };
  return { data: (data ?? []) as { id: string; name: string }[], error: null };
}

type SupportOutcome = { data: { code: string; assignmentId: string | null } | null; error: AppError | null };

/** Runs one of the five functions as the real Super Admin (their session, not service role) and maps the typed result. */
async function runSupportFunction(fn: string, args: Record<string, unknown>): Promise<SupportOutcome> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { data: null, error: await mapAndLog(error) };
  const row = ((data ?? []) as SupportResultRow[])[0];
  if (!row) return { data: null, error: { code: "support_refused", message: t("support.errors.refused") } };
  if (!row.ok) {
    return { data: null, error: { code: row.code, message: t(`support.codes.${row.code}`, { defaultValue: t("support.errors.refused") }) } };
  }
  return { data: { code: row.code, assignmentId: row.assignment_id }, error: null };
}

function badInput(t: (k: string) => string): SupportOutcome {
  return { data: null, error: { code: "validation_error", message: t("support.errors.refused") } };
}

export async function assignSupport(input: unknown): Promise<SupportOutcome> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { userId?: unknown; gymId?: unknown; reason?: unknown };
  if (!isUuid(raw.userId) || !isUuid(raw.gymId) || typeof raw.reason !== "string") return badInput(t);
  return runSupportFunction("assign_support", { p_user_id: raw.userId, p_gym_id: raw.gymId, p_reason: raw.reason });
}

export async function confirmSupportAssignment(input: unknown): Promise<SupportOutcome> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { assignmentId?: unknown; reason?: unknown };
  if (!isUuid(raw.assignmentId) || typeof raw.reason !== "string") return badInput(t);
  return runSupportFunction("confirm_support_assignment", { p_assignment_id: raw.assignmentId, p_reason: raw.reason });
}

export async function unassignSupport(input: unknown): Promise<SupportOutcome> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { assignmentId?: unknown; reason?: unknown };
  if (!isUuid(raw.assignmentId) || typeof raw.reason !== "string") return badInput(t);
  return runSupportFunction("unassign_support", { p_assignment_id: raw.assignmentId, p_reason: raw.reason });
}

/**
 * Deactivates the account in the database (assignments ended, memberships off, sessions deleted, invites dead), then bans the
 * auth user so it cannot sign in again. A repeat call on an already-deactivated account still applies the ban, so a ban that
 * failed the first time can be retried.
 */
export async function deactivateSupportAccount(input: unknown): Promise<SupportOutcome> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { userId?: unknown; reason?: unknown };
  if (!isUuid(raw.userId) || typeof raw.reason !== "string") return badInput(t);
  const res = await runSupportFunction("deactivate_support_account", { p_user_id: raw.userId, p_reason: raw.reason });
  if (res.error && res.error.code !== "already_deactivated") return res;

  try {
    const admin = createAdminClient();
    const { error: banError } = await admin.auth.admin.updateUserById(raw.userId, { ban_duration: "876000h" });
    if (banError) throw banError;
  } catch (err) {
    console.error("[deactivateSupportAccount] the account is deactivated but banning the auth user failed", err);
    return { data: null, error: { code: "ban_failed", message: t("support.errors.banFailed") } };
  }
  return res.error ? { data: { code: "deactivated", assignmentId: null }, error: null } : res;
}

/** Removes an account that was never activated (mistyped address): the database deletes it and its auth user. */
export async function removeSupportAccount(input: unknown): Promise<SupportOutcome> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { userId?: unknown; reason?: unknown };
  if (!isUuid(raw.userId) || typeof raw.reason !== "string") return badInput(t);
  return runSupportFunction("remove_support_account", { p_user_id: raw.userId, p_reason: raw.reason });
}
