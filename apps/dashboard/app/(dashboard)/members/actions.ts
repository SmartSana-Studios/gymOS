"use server";

import { assignCoachSchema, createMemberSchema, editMemberSchema, deactivateMemberSchema, type AppError } from "@gymos/types";
import {
  deactivateMember as deactivateMemberRow,
  exportMembersCsv as exportMembersCsvRow,
  getMemberForInvite,
  getPlanTypeForGym,
  logMemberChange,
  memberCountForGym,
  provisionMemberRow,
  updateMember,
} from "@/services/members";
import {
  assignCoach as assignCoachRow,
  getCoachAssignments as getCoachAssignmentsRow,
} from "@/services/coaches";
import {
  confirmCsvImport as confirmCsvImportRows,
  mapCsvRows,
  validateCsvImport as validateCsvImportRows,
  type CsvRowError,
  type ValidatedCsvRow,
} from "@/services/csvImport";
import { getDashboardShellContext } from "@/services/session";
import { parseCsvRows } from "@/lib/csv";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { sendEvolutionApiMessage } from "@/lib/messaging/EvolutionApiMessageProvider";

/** Manager/Owner Create Member (AC #1, #2). `{ data, error }` never-throws
 * contract, matches `createGym`/`createPlan`'s established Process Pattern.
 * No gymId argument -- implicitly scoped to the caller's own gym via
 * `getCallerGymId()` inside every service call this orchestrates. */
export async function createMember(
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = createMemberSchema.safeParse(input);
  if (!parsed.success) {
    // createMemberSchema's own issue messages are hardcoded English
    // literals (matches gym.ts/plan.ts/tier.ts's established, project-wide
    // pattern) -- always fall back to the localized generic message
    // instead of surfacing raw English text to a French-locale user who
    // bypasses MemberModal's pre-Zod client-side guards (Review-precedent
    // discipline from createPlan/editPlan).
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }
  const member = parsed.data;

  // Step 1: fast-fail cap check (AC #2). The real guarantee is the
  // enforce_member_cap DB trigger (0018) -- this is the friendly-copy path,
  // not the enforcement backstop.
  const { count, cap, error: countError } = await memberCountForGym();
  if (countError) {
    return { data: null, error: countError };
  }
  if (cap !== null && count >= cap) {
    return {
      data: null,
      error: { code: "member_cap_reached", message: t("members.errors.capReached", { count, max: cap }) },
    };
  }

  // Step 2: look up the selected plan's plan_type server-side (never trust
  // a client-supplied planType, which isn't even a form field -- Scope Note
  // #6) to validate expiryDate's presence/absence. createMemberSchema
  // itself cannot express this cross-entity invariant (no access to the
  // plan row) -- this is that check's server-side half. The
  // enforce_subscription_expiry_matches_plan_type DB trigger (0018) is the
  // real backstop either way.
  const { data: plan, error: planError } = await getPlanTypeForGym(member.planId);
  if (planError || !plan) {
    return { data: null, error: planError };
  }
  const expiryRequired = plan.planType !== "pay_per_session";
  if (expiryRequired && !member.expiryDate) {
    return {
      data: null,
      error: { code: "validation_error", message: t("members.errors.expiryDateRequired") },
    };
  }
  if (!expiryRequired && member.expiryDate) {
    return {
      data: null,
      error: { code: "validation_error", message: t("members.errors.expiryDateNotAllowed") },
    };
  }

  // Steps 3-5: find-or-create the member's platform account, insert the
  // member row, insert the subscription row -- with compensating cleanup on
  // failure at each step (Scope Note #1, Story 2.3). Extracted into
  // provisionMemberRow (Story 2.4, Task 4) so this Server Action and the
  // CSV import loop share one implementation; no behavior change here.
  const { data: provisioned, error: provisionError } = await provisionMemberRow({
    name: member.name,
    phone: member.phone,
    email: member.email ?? null,
    dob: member.dob ?? null,
    photoUrl: member.photoUrl ?? null,
    emergencyContact: member.emergencyContact ?? null,
    joinDate: member.joinDate,
    planId: member.planId,
    subscriptionStatus: member.subscriptionStatus,
    expiryDate: member.expiryDate ?? null,
  });
  if (provisionError || !provisioned) {
    return { data: null, error: provisionError };
  }
  const memberRow = { id: provisioned.id };

  // Step 6: audit log entry.
  const { error: auditError } = await logMemberChange("member_created", memberRow.id, {
    name: member.name,
    phone: member.phone,
    plan_id: member.planId,
    join_date: member.joinDate,
  });
  if (auditError) {
    return {
      data: { id: memberRow.id },
      error: { code: "audit_log_failed", message: t("members.errors.auditLogFailedCreate") },
    };
  }

  return { data: { id: memberRow.id }, error: null };
}

/** Manager/Owner Edit Member (edit-mode identity fields only, Scope Note's
 * Edit-mode boundary). */
export async function editMember(
  memberId: string,
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = editMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }
  const member = parsed.data;

  const { error } = await updateMember(memberId, {
    name: member.name,
    email: member.email ?? null,
    dob: member.dob ?? null,
    photoUrl: member.photoUrl ?? null,
    emergencyContact: member.emergencyContact ?? null,
  });
  if (error) {
    return { data: null, error };
  }

  const { error: auditError } = await logMemberChange("member_edited", memberId, {
    name: member.name,
  });
  if (auditError) {
    return {
      data: { id: memberId },
      error: { code: "audit_log_failed", message: t("members.errors.auditLogFailedEdit") },
    };
  }

  return { data: { id: memberId }, error: null };
}

/** Manager/Owner Deactivate Member (AC #3): mandatory reason, recorded in
 * audit_log metadata only (not a members/subscriptions column). */
export async function deactivateMember(
  memberId: string,
  input: unknown,
): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = deactivateMemberSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }

  const { error } = await deactivateMemberRow(memberId);
  if (error) {
    return { error };
  }

  const { error: auditError } = await logMemberChange("member_deactivated", memberId, {
    reason: parsed.data.reason,
  });
  if (auditError) {
    return { error: { code: "audit_log_failed", message: t("members.errors.auditLogFailedDeactivate") } };
  }

  return { error: null };
}

/** Story 2.10 (AC #1, #2, #3, #4): automated WhatsApp invite send via the
 * Evolution API gateway, replacing the manual copy/share step as the
 * primary flow -- `InviteMemberModal.tsx` is kept, unmodified, demoted to a
 * failure-path fallback the client opens when `sent: false`. Re-fetches
 * name/phone server-side (never trusts a client-supplied value, this file's
 * established discipline) and resolves `gymName` server-side via
 * `getDashboardShellContext()` rather than accepting it as a parameter.
 * `error` is only set for genuine failures (validation, member not found) --
 * `sent: false` with `error: null` is the expected "gateway unreachable or
 * not configured" outcome AC #3 requires the client to render as the
 * fallback state, not a generic error toast. No audit-log entry (Story
 * 2.5 Scope Note #3 precedent) and no persisted state -- this action reads
 * and calls out only. */
export async function sendMemberInvite(
  memberId: string,
): Promise<{ data: { sent: boolean } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = assignCoachSchema.shape.memberId.safeParse(memberId);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  const { data: member, error: memberError } = await getMemberForInvite(parsed.data);
  if (memberError || !member) {
    return { data: null, error: memberError };
  }

  const { data: shell, error: shellError } = await getDashboardShellContext();
  if (shellError || !shell) {
    return { data: null, error: shellError ?? { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  const message = t("members.invite.message", { name: member.name, gymName: shell.gymName });
  const result = await sendEvolutionApiMessage(member.phone, message);

  return { data: { sent: result.success }, error: null };
}

/** Story 5.1 (AC #1, #2): Manager/Owner assign/reassign a member's coach.
 * No separate audit-log step here (unlike createMember's explicit
 * logMemberChange call) -- assign_coach()'s own log_audit_event() call
 * already covers AC #4 atomically inside the RPC. */
export async function assignCoach(
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = assignCoachSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }
  const { data, error } = await assignCoachRow(parsed.data.memberId, parsed.data.coachId);
  if (error || !data) {
    return { data: null, error };
  }
  return { data: { id: data.id }, error: null };
}

/** Story 5.1 (AC #3): a member's coach assignment history for the modal's
 * View mode. Validates `memberId` with the same `memberId` schema `assignCoach`
 * above uses, rather than passing the raw string straight to the service layer. */
export async function getCoachAssignments(memberId: string) {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = assignCoachSchema.shape.memberId.safeParse(memberId);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }
  return getCoachAssignmentsRow(parsed.data);
}

/** AC #4: thin wrapper -- returns the CSV text itself, the client triggers
 * the download via a Blob (no file-system write on the server). */
export async function exportMembersCsv(params: {
  search?: string;
  status?: string;
}): Promise<{ data: string | null; error: AppError | null }> {
  return exportMembersCsvRow(params);
}

/** Story 2.4 (AC #1, #2): Step 1 (Validate) entrypoint -- thin wrapper:
 * parseCsvRows → mapCsvRows → validateCsvImport (services/csvImport.ts).
 * Returns the validation-shaped result directly (not this file's usual
 * `{data,error}` convention) -- AD-07's Step 2a/2b UI needs the full
 * row/column/message list, not a single AppError. A template-level failure
 * (missing column, empty file) has no row of its own -- surfaced as a
 * single synthetic `row: 0` entry, which CsvImportModal renders as a plain
 * banner instead of a per-row table. */
export async function validateCsvImport(
  rawText: string,
): Promise<
  | { valid: true; rows: ValidatedCsvRow[]; skippedBlankRows: number[] }
  | { valid: false; errors: CsvRowError[] }
> {
  const rows = parseCsvRows(rawText);
  const mapped = await mapCsvRows(rows);
  if (mapped.error) {
    return { valid: false, errors: [{ row: 0, column: "file", message: mapped.error.message }] };
  }
  const result = await validateCsvImportRows(mapped.data.rows);
  if (!result.valid) return result;
  // Blank rows aren't validation errors (nothing to validate) but are worth
  // surfacing as an informational note -- otherwise "N imported" silently
  // undercounts the file with no explanation (code review fix).
  return { ...result, skippedBlankRows: mapped.data.skippedBlankRows };
}

/** Story 2.4 (AC #3): Step 2 (Confirm) entrypoint -- re-runs the full
 * parse→map→validate→confirm pipeline server-side from the raw CSV text
 * (never trust a client-supplied "already validated" row array -- the
 * client only ever sends the original file text, matching this app's
 * "Server Actions re-validate, never trust the client" discipline already
 * established for every other mutation in this file). A revalidation
 * failure at this stage (e.g. a plan deleted between Step 1 and Step 2)
 * collapses to the same generic mid-import-failure copy AD-07 specifies --
 * Step 1 already showed per-row detail, so nothing is lost. */
export async function confirmCsvImport(
  rawText: string,
): Promise<{ data: { count: number } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const rows = parseCsvRows(rawText);
  const mapped = await mapCsvRows(rows);
  if (mapped.error) {
    return { data: null, error: mapped.error };
  }
  const validation = await validateCsvImportRows(mapped.data.rows);
  if (!validation.valid) {
    return {
      data: null,
      error: { code: "csv_import_failed", message: t("members.csvImport.errors.midImportFailure") },
    };
  }
  return confirmCsvImportRows(validation.rows);
}
