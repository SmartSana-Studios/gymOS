"use server";

import {
  assignCoachSchema,
  assignInitialPlanSchema,
  createFeeGymMemberSchema,
  createMemberSchema,
  editMemberSchema,
  deactivateMemberSchema,
  mapSupabaseError,
  memberIdSchema,
  type AppError,
} from "@gymos/types";
import {
  deactivateMember as deactivateMemberRow,
  exportMembersCsv as exportMembersCsvRow,
  getMemberForInvite,
  getMemberSubscriptionState,
  getPlanTypeForGym,
  insertSubscription,
  logMemberChange,
  memberCountForGym,
  provisionMemberRow,
  updateMember,
} from "@/services/members";
import { getGymSettings } from "@/services/gym-settings";
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

/** `YYYY-MM-DD` plus whole days, in UTC so the result never shifts with the
 * server's timezone. Same arithmetic as MemberModal.computeExpiryDate (start
 * date + the plan's duration_days), done server-side. */
function addDaysToIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Story 18.5: the shared `registration_fee_due` error (same code and EN/FR copy
 * the 0098 gate's `registration_fee_not_settled` raise maps to in
 * `mapSupabaseError`), for the paths that detect the awaiting state before the
 * database does. */
async function registrationFeeDueError(): Promise<AppError> {
  return mapSupabaseError({ message: "registration_fee_not_settled" }, await getRequestLocale());
}

/** The fields only a fee-0 create may carry. In a fee gym the first plan is
 * assigned after the fee is settled, so a client that still sends any of them
 * is rejected before anything is created. */
const FEE_GYM_FORBIDDEN_FIELDS = ["planId", "subscriptionStatus", "expiryDate"] as const;

function carriesPlanFields(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  return FEE_GYM_FORBIDDEN_FIELDS.some((field) => record[field] !== undefined && record[field] !== null);
}

/** Manager/Owner Create Member (AC #1, #2). `{ data, error }` never-throws
 * contract, matches `createGym`/`createPlan`'s established Process Pattern.
 * No gymId argument -- implicitly scoped to the caller's own gym via
 * `getCallerGymId()` inside every service call this orchestrates. */
export async function createMember(
  input: unknown,
): Promise<{ data: { id: string; inviteSent?: boolean } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());

  // Story 18.5: the registration fee is read server-side, never from a client
  // flag. A fee gym creates the member awaiting (no plan, no subscription); the
  // first plan is assigned later by assignInitialPlan. Unreadable fee: stop
  // here rather than guess which flow applies.
  const { data: gymSettings, error: gymSettingsError } = await getGymSettings();
  if (gymSettingsError || !gymSettings) {
    return { data: null, error: gymSettingsError };
  }
  if (gymSettings.registrationFee > 0) {
    return createAwaitingMember(input);
  }

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

  // A member created in a gym with no registration fee is settled from the start, so
  // the invite is sent right away (a fee gym sends it once the fee is settled instead --
  // see MembersPageClient). A failed send never fails the creation: the caller only
  // changes its toast and staff can use Send invite in the row menu.
  let inviteSent = false;
  try {
    const invite = await sendMemberInvite(memberRow.id);
    inviteSent = invite.data?.sent === true;
  } catch {
    inviteSent = false;
  }

  return { data: { id: memberRow.id, inviteSent }, error: null };
}

/** Story 18.5: the fee-gym half of `createMember`. Identity fields and the join
 * date only; the member is created with no subscription, so the 0098 trigger
 * leaves `registration_fee_settled_at` null (awaiting) and the member counts
 * toward the cap from the start. */
async function createAwaitingMember(
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());

  if (carriesPlanFields(input)) {
    return { data: null, error: await registrationFeeDueError() };
  }

  const parsed = createFeeGymMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }
  const member = parsed.data;

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

  const { data: provisioned, error: provisionError } = await provisionMemberRow({
    name: member.name,
    phone: member.phone,
    email: member.email ?? null,
    dob: member.dob ?? null,
    photoUrl: member.photoUrl ?? null,
    emergencyContact: member.emergencyContact ?? null,
    joinDate: member.joinDate,
  });
  if (provisionError || !provisioned) {
    return { data: null, error: provisionError };
  }

  const { error: auditError } = await logMemberChange("member_created", provisioned.id, {
    name: member.name,
    phone: member.phone,
    join_date: member.joinDate,
    awaiting_registration_fee: true,
  });
  if (auditError) {
    return {
      data: { id: provisioned.id },
      error: { code: "audit_log_failed", message: t("members.errors.auditLogFailedCreate") },
    };
  }

  return { data: { id: provisioned.id }, error: null };
}

/** Story 18.5: assigns the first plan to a settled member who has no
 * subscription (a fee-gym member after collection). No payment is written --
 * recording a payment for the plan's price is out of scope for Epic 18 -- and
 * no cap check, since the member already counts. Owner, supervisor and manager
 * only, through the subscriptions INSERT policy (a receptionist's insert is
 * denied by RLS, which is the enforcement; no role check lives here). An
 * awaiting member is rejected by the 0098 gate (`registration_fee_not_settled`,
 * mapped to `registration_fee_due`) and nothing is inserted. The expiry date is
 * computed here from the plan's `duration_days`; a pay-per-session plan gets
 * none, matching MemberModal.computeExpiryDate. */
export async function assignInitialPlan(
  memberId: string,
  planId: string,
  startDate: string,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = assignInitialPlanSchema.safeParse({ memberId, planId, startDate });
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }
  const input = parsed.data;

  const { data: state, error: stateError } = await getMemberSubscriptionState(input.memberId);
  if (stateError || !state) {
    return { data: null, error: stateError };
  }
  if (state.hasSubscription) {
    return {
      data: null,
      error: { code: "member_already_has_subscription", message: t("members.errors.alreadyHasSubscription") },
    };
  }

  const { data: plan, error: planError } = await getPlanTypeForGym(input.planId);
  if (planError || !plan) {
    // The plan lookup is gym-scoped, so a plan from another gym lands here too.
    return {
      data: null,
      error: planError?.code === "plan_not_found" ? { ...planError, code: "not_found" } : planError,
    };
  }

  const expiryDate =
    plan.planType === "pay_per_session" || plan.durationDays == null
      ? null
      : addDaysToIsoDate(input.startDate, plan.durationDays);

  const { data: subscription, error: insertError } = await insertSubscription(state.gymId, input.memberId, {
    planId: input.planId,
    status: "active",
    startDate: input.startDate,
    expiryDate,
  });
  if (insertError || !subscription) {
    return { data: null, error: insertError };
  }

  const { error: auditError } = await logMemberChange("member_plan_assigned", input.memberId, {
    plan_id: input.planId,
    start_date: input.startDate,
    expiry_date: expiryDate,
  });
  if (auditError) {
    return {
      data: { id: subscription.id },
      error: { code: "audit_log_failed", message: t("members.errors.auditLogFailedPlanAssigned") },
    };
  }

  return { data: { id: subscription.id }, error: null };
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
  const parsed = memberIdSchema.safeParse(memberId);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  const { data: member, error: memberError } = await getMemberForInvite(parsed.data);
  if (memberError || !member) {
    return { data: null, error: memberError };
  }
  // Story 18.5: the invite waits for settlement. An awaiting member has no
  // access to the app yet, so nothing is sent.
  if (member.awaitingRegistrationFee) {
    return { data: null, error: await registrationFeeDueError() };
  }

  // Sequential, not parallel: getDashboardShellContext() awaits supabase.auth.getClaims()
  // before its own internal Promise.all (session.ts, Story 1.7 finding) specifically so that
  // an unguarded getClaims() throw never lands inside a Promise.all and rejects an unrelated
  // batch. Wrapping it in a Promise.all here with getMemberForInvite() would reintroduce that
  // exact bug on every invite attempt, including ones that would have failed fast above.
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
