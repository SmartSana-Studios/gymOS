"use server";

import type { AppError } from "@gymos/types";

import { authorizeOrRedirect } from "@/lib/authz-action";
import { consumeStepUp, STEP_UP_REQUIRED_CODE } from "@/lib/authz";
import { drainEmailOutbox } from "@/lib/email-outbox";
import { executeDueFactorResets, generateResetCancelToken, supportResetCancelLink, type ResetExecutorClient } from "@/lib/support-reset";
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
    const { t } = await getServerTranslation(await getRequestLocale());
    return { data: null, error: { code: "validation_error", message: t("support.errors.refused") } };
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
 * Bans the auth user so it cannot sign in again, then deactivates the account in the database (assignments ended, memberships
 * off, sessions deleted, invites dead). Every step is repeatable, so a failure at either step is retried by calling again.
 */
export async function deactivateSupportAccount(input: unknown): Promise<SupportOutcome> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { userId?: unknown; reason?: unknown };
  if (!isUuid(raw.userId) || typeof raw.reason !== "string") return badInput(t);
  const reason = raw.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    return { data: null, error: { code: "reason_invalid", message: t("support.codes.reason_invalid") } };
  }

  // Ban first: a crash between the two steps leaves a banned, not-yet-deactivated account (safe; Deactivate again finishes
  // it) instead of a deactivated account that can still sign in. The ban uses the service role, so the target is first
  // confirmed to be a support account through the caller's own session; the database re-checks everything afterwards.
  const supabase = await createClient();
  const { data: accounts, error: listError } = await supabase.rpc("get_support_accounts");
  if (listError) return { data: null, error: await mapAndLog(listError) };
  if (!((accounts ?? []) as { user_id: string }[]).some((a) => a.user_id === raw.userId)) {
    return { data: null, error: { code: "not_found", message: t("support.codes.not_found") } };
  }
  try {
    const admin = createAdminClient();
    const { error: banError } = await admin.auth.admin.updateUserById(raw.userId, { ban_duration: "876000h" });
    if (banError) throw banError;
  } catch (err) {
    console.error("[deactivateSupportAccount] banning the auth user failed; nothing was deactivated", err);
    return { data: null, error: { code: "ban_failed", message: t("support.errors.banFailed") } };
  }

  const res = await runSupportFunction("deactivate_support_account", { p_user_id: raw.userId, p_reason: reason });
  if (res.error && res.error.code === "already_deactivated") return { data: { code: "deactivated", assignmentId: null }, error: null };
  return res;
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

// ---------------------------------------------------------------------------
// Story 23.8 (0142): the real person behind a support action, and the Owner disclosure inbox. Super Admin at aal2 only; the database
// re-checks both. The individual's name and address are shown here and on nowhere a gym role can reach.
// ---------------------------------------------------------------------------

export interface RealActor {
  subjectId: string;
  realUserId: string;
  name: string | null;
  email: string | null;
  recordedAt: string;
}

/** The tables whose rows carry a support identity (23.7/23.8/23.9): the audit trail, payments, refunds and connected credential rows. */
export type IdentitySubjectTable = "audit_log" | "payments" | "refunds" | "gym_payment_credentials";
const IDENTITY_SUBJECT_TABLES: readonly IdentitySubjectTable[] = ["audit_log", "payments", "refunds", "gym_payment_credentials"];

/** The real person for each of these rows (audit rows by default; also payments, refunds and credential rows, which the gym sees under the proxy).
 * A row support did not write has none. A refusal degrades to an empty map. */
export async function listRealActors(
  auditLogIds: string[],
  subjectTable: IdentitySubjectTable = "audit_log",
): Promise<{ data: Record<string, RealActor>; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: {}, error: authz.error };
  if (!IDENTITY_SUBJECT_TABLES.includes(subjectTable)) return { data: {}, error: null };
  const ids = auditLogIds.filter((id) => isUuid(id));
  if (ids.length === 0) return { data: {}, error: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_support_action_identity", { p_subject_table: subjectTable, p_subject_ids: ids });
  if (error) return { data: {}, error: await mapAndLog(error) };
  const byId: Record<string, RealActor> = {};
  for (const row of data ?? []) {
    byId[row.subject_id] = {
      subjectId: row.subject_id,
      realUserId: row.real_user_id,
      name: row.real_name,
      email: row.real_email,
      recordedAt: row.recorded_at,
    };
  }
  return { data: byId, error: null };
}

export interface DisclosureInboxRow {
  id: string;
  gymId: string;
  gymName: string;
  auditLogId: string;
  auditActionType: string;
  auditCreatedAt: string;
  question: string;
  requestedAt: string;
  answerDueAt: string;
  overdue: boolean;
  answeredAt: string | null;
  answer: string | null;
}

export async function listDisclosureInbox(): Promise<{ data: DisclosureInboxRow[] | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_disclosure_inbox");
  if (error) return { data: null, error: await mapAndLog(error) };
  return {
    data: (data ?? []).map((r: NonNullable<typeof data>[number]) => ({
      id: r.id,
      gymId: r.gym_id,
      gymName: r.gym_name,
      auditLogId: r.audit_log_id,
      auditActionType: r.audit_action_type,
      auditCreatedAt: r.audit_created_at,
      question: r.question,
      requestedAt: r.requested_at,
      answerDueAt: r.answer_due_at,
      overdue: r.overdue,
      answeredAt: r.answered_at,
      answer: r.answer,
    })),
    error: null,
  };
}

/** Stores the answer (delivered to the Owner outside the product) and writes the audit row. */
export async function answerDisclosureRequest(input: unknown): Promise<{ data: { code: string } | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { requestId?: unknown; answer?: unknown };
  if (!isUuid(raw.requestId) || typeof raw.answer !== "string") {
    return { data: null, error: { code: "validation_error", message: t("support.errors.refused") } };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("answer_audit_disclosure_request", { p_request_id: raw.requestId, p_answer: raw.answer });
  if (error) return { data: null, error: await mapAndLog(error) };
  const row = data?.[0];
  if (!row?.ok) {
    const code = row?.code ?? "refused";
    return { data: null, error: { code, message: t(`support.disclosure.codes.${code}`, { defaultValue: t("support.errors.refused") }) } };
  }
  return { data: { code: row.code }, error: null };
}

// ---------------------------------------------------------------------------
// Story 23.10 (0144): accounts locked by the velocity limit or by too many wrong step-up codes, and the unlock with a recorded reason.
// ---------------------------------------------------------------------------

export interface SupportLockRow {
  userId: string;
  displayName: string | null;
  email: string | null;
  lockedAt: string;
  /** velocity_gym | velocity_account | velocity_payment | stepup_failures (a code, translated in the panel). */
  lockedReason: string | null;
  gymNames: string | null;
}

/** The locked accounts, with the individual's name (visible here only). */
export async function listSupportLocks(): Promise<{ data: SupportLockRow[] | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_support_locks");
  if (error) return { data: null, error: await mapAndLog(error) };
  return {
    data: (data ?? []).map((r: NonNullable<typeof data>[number]) => ({
      userId: r.user_id,
      displayName: r.display_name,
      email: r.email,
      lockedAt: r.locked_at,
      lockedReason: r.locked_reason,
      gymNames: r.gym_names,
    })),
    error: null,
  };
}

/** Unlocks one account. The reason (3 to 500 characters) is mandatory; the database records the lock, the unlock and the reason. */
export async function unlockSupportAccount(input: unknown): Promise<SupportOutcome> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { userId?: unknown; reason?: unknown };
  if (!isUuid(raw.userId) || typeof raw.reason !== "string") return badInput(t);
  return runSupportFunction("unlock_support_account", { p_user_id: raw.userId, p_reason: raw.reason });
}

// ---------------------------------------------------------------------------
// Story 23.11 (0145): recertification, authenticator reset and contact changes. Super Admin at aal2 only; the database re-checks.
// ---------------------------------------------------------------------------

export interface SupportLifecycleRow {
  userId: string;
  displayName: string | null;
  email: string | null;
  activated: boolean;
  deactivated: boolean;
  lockedAt: string | null;
  lockedReason: string | null;
  recertifyDueAt: string | null;
  recertificationLapsed: boolean;
  resetPendingAt: string | null;
  /** cooling_off | due | executing | executed, or null when no reset is open. */
  resetState: string | null;
  resetExecutesAt: string | null;
  lastActiveAt: string | null;
}

export async function listSupportLifecycle(): Promise<{ data: SupportLifecycleRow[] | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_support_lifecycle");
  if (error) return { data: null, error: await mapAndLog(error) };
  return {
    data: (data ?? []).map((r: NonNullable<typeof data>[number]) => ({
      userId: r.user_id,
      displayName: r.display_name,
      email: r.email,
      activated: r.activated,
      deactivated: r.deactivated,
      lockedAt: r.locked_at,
      lockedReason: r.locked_reason,
      recertifyDueAt: r.recertify_due_at,
      recertificationLapsed: r.recertification_lapsed,
      resetPendingAt: r.reset_pending_at,
      resetState: r.reset_state,
      resetExecutesAt: r.reset_executes_at,
      lastActiveAt: r.last_active_at,
    })),
    error: null,
  };
}

/** Recertifies one person (a reason is mandatory). The database moves the due date, restores suspended assignments and audits it. */
export async function recertifySupportAccount(input: unknown): Promise<SupportOutcome> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { userId?: unknown; reason?: unknown };
  if (!isUuid(raw.userId) || typeof raw.reason !== "string") return badInput(t);
  return runSupportFunction("recertify_support_account", { p_user_id: raw.userId, p_reason: raw.reason });
}

/**
 * Starts an authenticator reset: a fresh step-up code bound to this person, then the database (sessions ended, cooling-off, frozen
 * contact, cancel link e-mailed to the address on file). The token is made here; only its hash is stored. The e-mail is delivered at once
 * through the outbox worker (the daily run is the fallback).
 */
export async function startSupportFactorReset(
  input: unknown,
): Promise<{ data: { executesAt: string } | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { userId?: unknown; identityNote?: unknown };
  if (!isUuid(raw.userId) || typeof raw.identityNote !== "string") {
    return { data: null, error: { code: "validation_error", message: t("support.errors.refused") } };
  }
  const note = raw.identityNote.trim();
  if (note.length < 3 || note.length > 500) {
    return { data: null, error: { code: "reason_invalid", message: t("support.codes.reason_invalid") } };
  }
  const origin = dashboardBaseUrl();
  if (!origin) return { data: null, error: { code: "not_configured", message: t("support.errors.notConfigured") } };

  if (!(await consumeStepUp(authz.actorId, "start_support_factor_reset", raw.userId))) {
    return { data: null, error: { code: STEP_UP_REQUIRED_CODE, message: t("stepUp.title") } };
  }

  const token = generateResetCancelToken();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_support_factor_reset", {
    p_user_id: raw.userId,
    p_identity_note: note,
    p_cancel_token: token,
    p_cancel_link: supportResetCancelLink(origin, token),
  });
  if (error) return { data: null, error: await mapAndLog(error) };
  const row = (data ?? [])[0];
  if (!row) return { data: null, error: { code: "support_refused", message: t("support.errors.refused") } };
  if (!row.ok) {
    return { data: null, error: { code: row.code, message: t(`support.codes.${row.code}`, { defaultValue: t("support.errors.refused") }) } };
  }

  // deliver the person's e-mail now (best effort: the daily run retries a failure)
  try {
    await drainEmailOutbox(createAdminClient(), sendMail);
  } catch {
    console.error("[startSupportFactorReset] immediate e-mail delivery failed; the daily run will retry");
  }
  return { data: { executesAt: row.executes_at ?? "" }, error: null };
}

/** Runs the executor now (the same function the daily cron calls) for resets whose cooling-off has ended. */
export async function runDueFactorResets(): Promise<{ data: { claimed: number; done: number; failed: number } | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  try {
    const result = await executeDueFactorResets(createAdminClient() as unknown as ResetExecutorClient, sendMail, dashboardBaseUrl());
    if (result.error) return { data: null, error: { code: result.error, message: t("support.errors.notConfigured") } };
    return { data: { claimed: result.claimed, done: result.done, failed: result.failed }, error: null };
  } catch {
    return { data: null, error: { code: "execute_failed", message: t("support.errors.refused") } };
  }
}

/**
 * The only path for a support person's address. The database validates and records it (aal2, reason, refused during a reset, audited);
 * this action then applies it to the auth user and, if that fails, records the previous address again so the nightly drift check does
 * not lock a healthy account. Support accounts keep no phone (the database answers phone_not_allowed).
 */
export async function changeSupportContact(input: unknown): Promise<SupportOutcome> {
  const authz = await authorizeOrRedirect("platform.support_manage");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const raw = (input ?? {}) as { userId?: unknown; email?: unknown; phone?: unknown; reason?: unknown };
  if (!isUuid(raw.userId) || typeof raw.email !== "string" || typeof raw.reason !== "string" || (raw.phone !== undefined && typeof raw.phone !== "string")) {
    return badInput(t);
  }
  const email = raw.email.trim().toLowerCase();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_support_contact", {
    p_user_id: raw.userId,
    p_email: email,
    p_phone: (raw.phone as string | undefined) || null,
    p_reason: raw.reason,
  });
  if (error) return { data: null, error: await mapAndLog(error) };
  const row = (data ?? [])[0];
  if (!row) return { data: null, error: { code: "support_refused", message: t("support.errors.refused") } };
  if (!row.ok) {
    return { data: null, error: { code: row.code, message: t(`support.codes.${row.code}`, { defaultValue: t("support.errors.refused") }) } };
  }

  let applied = false;
  try {
    const { error: updateError } = await createAdminClient().auth.admin.updateUserById(raw.userId, { email, email_confirm: true, phone: "" });
    applied = !updateError;
  } catch {
    applied = false;
  }
  if (!applied) {
    if (row.previous_email) {
      // put the record back (audited like any change) so record and auth agree again
      let reverted = false;
      try {
        const { data: back, error: backError } = await supabase.rpc("change_support_contact", {
          p_user_id: raw.userId,
          p_email: row.previous_email,
          p_phone: null,
          p_reason: "automatic revert: the new address could not be applied",
        });
        reverted = !backError && (back ?? [])[0]?.ok === true;
      } catch {
        reverted = false;
      }
      if (!reverted) return { data: null, error: { code: "contact_revert_failed", message: t("support.errors.contactRevertFailed") } };
    }
    return { data: null, error: { code: "contact_apply_failed", message: t("support.errors.contactApplyFailed") } };
  }
  return { data: { code: "changed", assignmentId: null }, error: null };
}
