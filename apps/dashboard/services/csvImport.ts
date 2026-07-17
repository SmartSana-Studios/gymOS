import {
  CSV_TEMPLATE_COLUMNS,
  csvMemberRowSchema,
  type AppError,
} from "@gymos/types";

import { createClient } from "@/lib/supabase/server";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { listPlans } from "@/services/plans";
import {
  deleteAuthUserForCleanup,
  deleteMemberForCleanup,
  logMemberChange,
  memberCountForGym,
  provisionMemberRow,
  type MemberSubscriptionStatus,
} from "@/services/members";

// Story 2.4: CSV Member Import (FR-008, FR-009) -- Task 3's header mapping,
// Step 1 batch validation, and Step 2 confirm/write orchestration. No new
// migration/table/RLS policy (Scope Note #2) -- everything here writes
// through the same members/subscriptions INSERT paths Story 2.3 already
// built.

/** Copied verbatim from members.ts/plans.ts's own (unexported) helper --
 * this file's own per-file-copy convention (Scope Note #3 of Story 2.3's
 * own precedent). */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id;
  if (!gymId) {
    console.warn("[csvImport] resolved to not_found: no gym_id claim on caller's session");
    const { t } = await getServerTranslation(await getRequestLocale());
    return { gymId: null, error: { code: "not_found", message: t("members.errors.memberNotFound") } };
  }

  return { gymId, error: null };
}

export interface CsvRowError {
  row: number;
  column: string;
  message: string;
}

export interface ValidatedCsvRow {
  row: number;
  name: string;
  phone: string;
  planId: string;
  planName: string;
  joinDate: string;
  subscriptionStatus: MemberSubscriptionStatus;
  expiryDate: string | null;
}

export interface MappedCsvRow {
  row: number;
  fields: Record<string, string>;
  malformed: boolean;
}

export interface MappedCsvRows {
  rows: MappedCsvRow[];
  skippedBlankRows: number[];
}

// Hard ceiling on import size, independent of the gym's member-cap check --
// mirrors exportMembersCsv's own EXPORT_ROW_LIMIT (members.ts) pattern so an
// unbounded-cap gym (or a malformed upload) can't submit an unbounded
// sequential, in-request import.
const IMPORT_ROW_LIMIT = 1000;

/** `mapCsvRows`'s header→canonical-column-name step (Scope Note #5):
 * order-independent, ignores extra/unrecognized columns. Takes
 * `parseCsvRows`'s (lib/csv.ts) raw output -- the first row is the header. */
export async function mapCsvRows(
  rawRows: string[][],
): Promise<{ data: MappedCsvRows; error: null } | { data: null; error: AppError }> {
  const { t } = await getServerTranslation(await getRequestLocale());

  if (rawRows.length === 0) {
    return { data: null, error: { code: "csv_empty_file", message: t("members.csvImport.errors.emptyFile") } };
  }

  const header = rawRows[0];
  const columnIndex = new Map<string, number>();
  const duplicateColumns = new Set<string>();
  header.forEach((name, index) => {
    const key = name.trim().toLowerCase();
    if (columnIndex.has(key)) {
      duplicateColumns.add(key);
    }
    columnIndex.set(key, index);
  });

  const missing = CSV_TEMPLATE_COLUMNS.filter((col) => !columnIndex.has(col));
  // A required column name appearing twice in the header is just as
  // ambiguous as a missing one -- the column-index map above silently kept
  // only the last match, which would otherwise misread every row.
  const duplicated = CSV_TEMPLATE_COLUMNS.filter((col) => duplicateColumns.has(col));
  if (missing.length > 0 || duplicated.length > 0) {
    return {
      data: null,
      error: {
        code: "csv_invalid_template",
        message: t("members.csvImport.errors.invalidTemplate", { columns: [...missing, ...duplicated].join(", ") }),
      },
    };
  }

  // Tolerates a trailing blank line (parseCsvRows' own tolerance, Task 2) --
  // a data row where every cell is empty carries no real data and isn't
  // counted toward "zero data rows". Row numbers (1-indexed including the
  // header, Excel's own numbering) are assigned from each row's original
  // position BEFORE filtering blanks out, so a blank row in the middle of
  // the file doesn't shift every later row's reported number.
  const allRows = rawRows.slice(1).map((cells, index) => ({ row: index + 2, cells }));
  const dataRows = allRows.filter(({ cells }) => cells.some((cell) => cell.trim() !== ""));
  // A blank row is not itself an error (nothing to validate), but silently
  // dropping it with zero indication means fewer members get imported than
  // the file appeared to contain -- surfaced as an informational note by the
  // caller rather than a hard error (code review fix).
  const skippedBlankRows = allRows
    .filter(({ cells }) => !cells.some((cell) => cell.trim() !== ""))
    .map(({ row }) => row);
  if (dataRows.length === 0) {
    return { data: null, error: { code: "csv_empty_file", message: t("members.csvImport.errors.emptyFile") } };
  }
  if (dataRows.length > IMPORT_ROW_LIMIT) {
    return {
      data: null,
      error: {
        code: "csv_too_many_rows",
        message: t("members.csvImport.errors.tooManyRows", { count: dataRows.length, max: IMPORT_ROW_LIMIT }),
      },
    };
  }

  const mapped = dataRows.map(({ row, cells }) => {
    const fields: Record<string, string> = {};
    for (const col of CSV_TEMPLATE_COLUMNS) {
      const idx = columnIndex.get(col);
      fields[col] = (idx !== undefined ? cells[idx] : undefined)?.trim() ?? "";
    }
    // A row with more or fewer cells than the header has (e.g. an
    // unescaped comma inside an unquoted field) shifts every later column
    // -- reading by index would otherwise silently misassign values.
    return { row, fields, malformed: cells.length !== header.length };
  });

  return { data: { rows: mapped, skippedBlankRows }, error: null };
}

// Maps a csvMemberRowSchema issue's path[0] (the schema's own camelCase
// field name) back to the CSV column name a gym manager sees in their own
// spreadsheet app (Task 3's row/column/message contract).
const SCHEMA_FIELD_TO_COLUMN: Record<string, string> = {
  memberName: "member_name",
  phone: "phone",
  planName: "plan_type",
  joinDate: "join_date",
  subscriptionStatus: "subscription_status",
  expiryDate: "expiry_date",
};

function toCsvMemberRowCandidate(raw: Record<string, string>) {
  return {
    memberName: raw.member_name ?? "",
    phone: raw.phone ?? "",
    planName: raw.plan_type ?? "",
    joinDate: raw.join_date ?? "",
    subscriptionStatus: raw.subscription_status ?? "",
    expiryDate: raw.expiry_date ?? "",
  };
}

/** Step 1 (AD-07 Step 2a/2b) batch validation entrypoint. `row` numbers are
 * 1-indexed *including the header* (Excel's own row numbering -- header is
 * row 1, first data row is row 2), matching what a non-technical gym
 * manager sees when they open the file in a spreadsheet app. Runs every
 * check across every row before returning -- never short-circuits on the
 * first failing check *category* (AC #1's "all rows validated before any
 * are written"). */
export async function validateCsvImport(
  rawRowObjects: MappedCsvRow[],
): Promise<{ valid: true; rows: ValidatedCsvRow[] } | { valid: false; errors: CsvRowError[] }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const errors: CsvRowError[] = [];

  // Per-row schema parse (Scope Note #6). A malformed row (wrong field
  // count, mapCsvRows) is flagged and skipped here -- its cell values are
  // already known to be misaligned, so a schema-level error on top would
  // just be confusing noise on top of the real problem.
  const parsedRows: ({ row: number; data: ReturnType<typeof csvMemberRowSchema.parse> } | null)[] =
    rawRowObjects.map(({ row, fields, malformed }) => {
      if (malformed) {
        errors.push({ row, column: "file", message: t("members.csvImport.errors.rowColumnCountMismatch") });
        return null;
      }
      const parsed = csvMemberRowSchema.safeParse(toCsvMemberRowCandidate(fields));
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? "");
          errors.push({ row, column: SCHEMA_FIELD_TO_COLUMN[field] ?? field, message: issue.message });
        }
        return null;
      }
      return { row, data: parsed.data };
    });

  // Batch-resolve plan names (Scope Note #1) -- one listPlans() call, not
  // one query per row. An infra failure here still surfaces every per-row
  // schema error already collected above (AC #2's "every failing row's
  // reason shown together") instead of discarding them in favor of a single
  // synthetic row.
  const { data: plans, error: plansError } = await listPlans();
  if (plansError) {
    errors.push({ row: 0, column: "plan_type", message: plansError.message });
    errors.sort((a, b) => a.row - b.row);
    return { valid: false, errors };
  }
  const plansByName = new Map((plans ?? []).map((plan) => [plan.name.toLowerCase(), plan]));

  const seenPhones = new Map<string, number>();
  const candidatePhones = new Set<string>();

  const resolvedRows: (ValidatedCsvRow | null)[] = parsedRows.map((entry) => {
    if (!entry) return null;
    const { row, data } = entry;

    const plan = plansByName.get(data.planName.toLowerCase());
    if (!plan) {
      errors.push({
        row,
        column: "plan_type",
        message: t("members.csvImport.errors.planNotConfigured", { value: data.planName }),
      });
      return null;
    }

    const expiryRequired = plan.planType !== "pay_per_session";
    if (expiryRequired && !data.expiryDate) {
      errors.push({
        row,
        column: "expiry_date",
        message: t("members.csvImport.errors.expiryDateRequiredForPlan"),
      });
      return null;
    }
    if (!expiryRequired && data.expiryDate) {
      errors.push({ row, column: "expiry_date", message: t("members.errors.expiryDateNotAllowed") });
      return null;
    }

    // In-file duplicate phone detection (Scope Note #7a) -- without this,
    // two rows sharing a phone would both resolve to the same platform user
    // via findOrCreateUserByPhone's find-or-create, and the second row's
    // members insert would only fail during the write phase, defeating AC
    // #1's "before any are written" guarantee.
    const seenAtRow = seenPhones.get(data.phone);
    if (seenAtRow !== undefined) {
      errors.push({
        row,
        column: "phone",
        message: t("members.csvImport.errors.duplicatePhoneInFile", { row: seenAtRow }),
      });
      return null;
    }
    seenPhones.set(data.phone, row);
    candidatePhones.add(data.phone);

    return {
      row,
      name: data.memberName,
      phone: data.phone,
      planId: plan.id,
      planName: plan.name,
      joinDate: data.joinDate,
      subscriptionStatus: data.subscriptionStatus,
      expiryDate: data.expiryDate ?? null,
    };
  });

  // Existing-member-phone-at-gym batch check (Scope Note #7b) -- one
  // .in("phone", [...]) query scoped to the caller's gym, not one query per
  // row. Only run against rows that passed every earlier check (a malformed
  // or duplicate phone was already rejected above).
  if (candidatePhones.size > 0) {
    const supabase = await createClient();
    const { gymId, error: gymIdError } = await getCallerGymId(supabase);
    if (gymIdError || !gymId) {
      errors.push({ row: 0, column: "phone", message: gymIdError?.message ?? "" });
      errors.sort((a, b) => a.row - b.row);
      return { valid: false, errors };
    }

    const { data: existingMembers, error: existingError } = await supabase
      .from("members")
      .select("phone")
      .eq("gym_id", gymId)
      .eq("role", "member")
      .is("deactivated_at", null)
      .in("phone", [...candidatePhones]);

    if (existingError) {
      const mapped = await mapAndLog(existingError);
      errors.push({ row: 0, column: "phone", message: mapped.message });
      errors.sort((a, b) => a.row - b.row);
      return { valid: false, errors };
    }

    const takenPhones = new Set((existingMembers ?? []).map((m) => m.phone as string));
    if (takenPhones.size > 0) {
      resolvedRows.forEach((resolved, index) => {
        if (resolved && takenPhones.has(resolved.phone)) {
          errors.push({ row: resolved.row, column: "phone", message: t("errors.memberPhoneTaken") });
          resolvedRows[index] = null;
        }
      });
    }
  }

  if (errors.length > 0) {
    errors.sort((a, b) => a.row - b.row);
    return { valid: false, errors };
  }

  return { valid: true, rows: resolvedRows.filter((row): row is ValidatedCsvRow => row !== null) };
}

/** Step 2 (Confirm) entrypoint (AC #3). Batch cap fast-fail, then loops
 * rows sequentially through the shared `provisionMemberRow()` orchestration
 * (Task 4), tracking every successful row so an all-or-nothing rollback can
 * undo already-committed rows if a *later* row fails (Scope Note #10) --
 * `provisionMemberRow` only cleans up its own partial failure, it has no
 * knowledge of the batch. `validatedRows` is expected to be the immediate
 * output of a `validateCsvImport` call made earlier in this same request
 * (Task 5's Server Action wrapper re-runs the full parse→map→validate
 * pipeline from raw CSV text before calling this) -- never a client-
 * supplied "already validated" array from a prior request. */
export async function confirmCsvImport(
  validatedRows: ValidatedCsvRow[],
): Promise<{ data: { count: number } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());

  const { count, cap, error: countError } = await memberCountForGym();
  if (countError) {
    return { data: null, error: countError };
  }
  if (cap !== null && count + validatedRows.length > cap) {
    return {
      data: null,
      error: {
        code: "member_cap_reached",
        message: t("members.csvImport.errors.capExceeded", { count, max: cap }),
      },
    };
  }

  const successes: { memberId: string; userId: string; authUserCreated: boolean }[] = [];

  for (const row of validatedRows) {
    const { data: provisioned, error: provisionError } = await provisionMemberRow({
      name: row.name,
      phone: row.phone,
      email: null,
      dob: null,
      photoUrl: null,
      emergencyContact: null,
      joinDate: row.joinDate,
      planId: row.planId,
      subscriptionStatus: row.subscriptionStatus,
      expiryDate: row.expiryDate,
    });

    if (provisionError || !provisioned) {
      for (let i = successes.length - 1; i >= 0; i--) {
        const prior = successes[i];
        await deleteMemberForCleanup(prior.memberId);
        if (prior.authUserCreated) {
          await deleteAuthUserForCleanup(prior.userId);
        }
      }
      return {
        data: null,
        error: { code: "csv_import_failed", message: t("members.csvImport.errors.midImportFailure") },
      };
    }

    successes.push({
      memberId: provisioned.id,
      userId: provisioned.userId,
      authUserCreated: provisioned.authUserCreated,
    });
  }

  // Sequential, not Promise.all -- matches this story's already-sequential
  // per-row processing design, avoids a burst of concurrent writes.
  // Tracks which CSV row(s) failed, not just whether any did (code review
  // fix) -- a single boolean gave an operator identical "audit log failed"
  // messaging whether 1 of 900 rows failed or all 900, with no way to
  // reconcile which member-creation events are actually missing from the
  // trail.
  const failedAuditRows: number[] = [];
  for (let i = 0; i < validatedRows.length; i++) {
    const row = validatedRows[i];
    const memberId = successes[i].memberId;
    const { error: auditError } = await logMemberChange("member_created", memberId, {
      name: row.name,
      phone: row.phone,
      plan_id: row.planId,
      join_date: row.joinDate,
      via: "csv_import",
    });
    if (auditError) {
      failedAuditRows.push(row.row);
    }
  }

  // Matches createMember's own "created, but the audit log entry failed"
  // partial-success pattern (MemberModal treats `error.code ===
  // "audit_log_failed"` as a success path with a warning, not a rollback --
  // the members themselves were provisioned correctly either way).
  if (failedAuditRows.length > 0) {
    return {
      data: { count: validatedRows.length },
      error: {
        code: "audit_log_failed",
        message: t("members.csvImport.errors.auditLogFailedRows", {
          count: failedAuditRows.length,
          rows: failedAuditRows.join(", "),
        }),
      },
    };
  }

  return { data: { count: validatedRows.length }, error: null };
}
