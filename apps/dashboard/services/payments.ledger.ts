import { createClient } from "@/lib/supabase/server";
import type { AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { resolveActorNames } from "@/services/actorNames";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import type { GuestSessionStateEmbed } from "./payments";

/**
 * Payments ledger, refund history and CSV export. Split out of payments.ts
 * (Epic 20 retro G-2) with no behavior change; payments.ts re-exports everything
 * here, so callers and test mocks keep importing "@/services/payments".
 */

/** Per-file copy of the caller-gym helper (same discipline as payments.ts / members.ts). */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; actorId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, actorId: null, error: await mapAndLog(claimsError) };
  }

  const claims = claimsData?.claims as { gym_id?: string; sub?: string } | undefined;
  const gymId = claims?.gym_id ?? null;
  const actorId = claims?.sub ?? null;
  if (!gymId) {
    console.warn("[payments] getCallerGymId: no gym_id claim on caller's session");
    const { t } = await getServerTranslation(await getRequestLocale());
    return { gymId: null, actorId, error: { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  return { gymId, actorId, error: null };
}

// ---------------------------------------------------------------------------
// Story 19.9c: the All Payments ledger (AD-09) -- every payment of the gym,
// newest first, filterable by purpose and member, with a CSV export.
// ---------------------------------------------------------------------------

export const PAYMENTS_LEDGER_PAGE_SIZE = 50;
export const PAYMENTS_EXPORT_ROW_LIMIT = 1000;

/** The purposes the ledger filter offers (payments.purpose, migration 0107). */
export const LEDGER_PURPOSES = ["subscription", "registration_fee", "session"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hand-edited URL params fall back to "no filter" instead of erroring. */
export function normalizeLedgerFilters(params: { purpose?: string | null; memberId?: string | null }): {
  purpose?: (typeof LEDGER_PURPOSES)[number];
  memberId?: string;
} {
  const purpose = (LEDGER_PURPOSES as readonly string[]).includes(params.purpose ?? "")
    ? (params.purpose as (typeof LEDGER_PURPOSES)[number])
    : undefined;
  const memberId = params.memberId && UUID_RE.test(params.memberId) ? params.memberId : undefined;
  return { purpose, memberId };
}

export interface PaymentLedgerRow {
  id: string;
  memberId: string;
  memberName: string;
  amount: number;
  currency: string;
  method: string;
  purpose: string;
  status: string;
  flaggedReason: string | null;
  voidedAt: string | null;
  note: string | null;
  createdAt: string;
  actorName: string | null;
  /** A `refunds` row exists for this payment (see listRefundHistory). */
  refunded?: boolean;
}

interface LedgerRowFromDb {
  id: string;
  member_id: string;
  amount: number;
  currency: string;
  method: string;
  purpose: string;
  status: string;
  flagged_reason: string | null;
  voided_at: string | null;
  reason: string | null;
  created_at: string;
  actor_id: string | null;
  members: { name: string } | null;
  // refunds.payment_id is unique, so PostgREST embeds one object or null.
  refunds?: { id: string } | null;
}

const LEDGER_SELECT =
  "id, member_id, amount, currency, method, purpose, status, flagged_reason, voided_at, reason, created_at, actor_id, members(name), refunds(id)";

function applyLedgerFilters<T>(query: T, filters: { purpose?: string; memberId?: string }): T {
  type Chainable = { eq(column: string, value: unknown): Chainable };
  let next = query as unknown as Chainable;
  if (filters.purpose) next = next.eq("purpose", filters.purpose);
  if (filters.memberId) next = next.eq("member_id", filters.memberId);
  return next as unknown as T;
}

async function mapLedgerRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gymId: string,
  rows: LedgerRowFromDb[],
): Promise<{ data: PaymentLedgerRow[] | null; error: AppError | null }> {
  const actorUserIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const actorNames = await resolveActorNames(supabase, gymId, actorUserIds);
  if (actorNames.error) {
    return { data: null, error: actorNames.error };
  }
  const actorNameByUserId = actorNames.data;
  return {
    data: rows.map((row) => ({
      id: row.id,
      memberId: row.member_id,
      memberName: row.members?.name ?? "",
      amount: row.amount,
      currency: row.currency,
      method: row.method,
      purpose: row.purpose,
      status: row.status,
      flaggedReason: row.flagged_reason ?? null,
      voidedAt: row.voided_at ?? null,
      note: row.reason,
      createdAt: row.created_at,
      actorName: row.actor_id ? (actorNameByUserId.get(row.actor_id) ?? null) : null,
      refunded: Boolean(row.refunds),
    })),
    error: null,
  };
}

/** The gym's payments, all statuses (voided included), newest first, one page
 * at a time. An unknown `purpose` or a malformed `memberId` means no filter. */
export async function listAllPayments(params: {
  purpose?: string | null;
  memberId?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<{ data: { rows: PaymentLedgerRow[]; total: number } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const filters = normalizeLedgerFilters(params);
  const page = params.page && params.page > 0 ? params.page : 1;
  const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : PAYMENTS_LEDGER_PAGE_SIZE;
  const rangeFrom = (page - 1) * pageSize;

  let query = supabase.from("payments").select(LEDGER_SELECT, { count: "exact" }).eq("gym_id", gymId);
  query = applyLedgerFilters(query, filters);
  query = query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeFrom + pageSize - 1);

  const { data, count, error } = await query;
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const mapped = await mapLedgerRows(supabase, gymId, (data ?? []) as unknown as LedgerRowFromDb[]);
  if (mapped.error || !mapped.data) {
    return { data: null, error: mapped.error };
  }
  return { data: { rows: mapped.data, total: count ?? 0 }, error: null };
}

// Refund history: the gym's `refunds` rows, newest first. Read-only; recording
// stays in recordRefund. Refunds are rare, so one capped page is fetched and the
// true total is returned so the UI can say when the list is truncated.
export const REFUND_HISTORY_LIMIT = 200;

export interface RefundHistoryRow {
  id: string;
  paymentId: string;
  memberName: string;
  /** Refunded amount (can be below the payment amount). */
  amount: number;
  paymentAmount: number;
  currency: string;
  method: string;
  purpose: string;
  reason: string;
  createdAt: string;
  actorName: string | null;
  /** Session payments only: `unused` (session cancelled) or `used` (stays consumed). */
  sessionState: "unused" | "used" | null;
}

interface RefundHistoryRowFromDb {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  reason: string;
  created_at: string;
  actor_id: string;
  payments: {
    amount: number;
    method: string;
    purpose: string;
    members: { name: string } | null;
    guest_sessions: GuestSessionStateEmbed | GuestSessionStateEmbed[] | null;
  } | null;
}

export async function listRefundHistory(): Promise<{
  data: { rows: RefundHistoryRow[]; total: number } | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, count, error } = await supabase
    .from("refunds")
    .select(
      "id, payment_id, amount, currency, reason, created_at, actor_id, payments(amount, method, purpose, members(name), guest_sessions(consumed_at, voided_at))",
      { count: "exact" },
    )
    .eq("gym_id", gymId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(REFUND_HISTORY_LIMIT);
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows = (data ?? []) as unknown as RefundHistoryRowFromDb[];
  const actorUserIds = [...new Set(rows.map((row) => row.actor_id))];
  const actorNames = await resolveActorNames(supabase, gymId, actorUserIds);
  if (actorNames.error) {
    return { data: null, error: actorNames.error };
  }
  const actorNameByUserId = actorNames.data;

  return {
    data: {
      total: count ?? rows.length,
      rows: rows.map((row) => {
        const payment = row.payments;
        const sessionRow = Array.isArray(payment?.guest_sessions)
          ? payment?.guest_sessions[0]
          : payment?.guest_sessions;
        return {
          id: row.id,
          paymentId: row.payment_id,
          memberName: payment?.members?.name ?? "",
          amount: row.amount,
          paymentAmount: payment?.amount ?? row.amount,
          currency: row.currency,
          method: payment?.method ?? "",
          purpose: payment?.purpose ?? "",
          reason: row.reason,
          createdAt: row.created_at,
          actorName: actorNameByUserId.get(row.actor_id) ?? null,
          sessionState: payment?.purpose === "session" ? (sessionRow?.consumed_at ? "used" : "unused") : null,
        } satisfies RefundHistoryRow;
      }),
    },
    error: null,
  };
}

export type ExportPaymentsCsvResult = { data: string; error: null } | { data: null; error: AppError };

// Copied from subscriptions.ts's csvEscape -- per-file-copy convention
// (OWASP CSV-injection guard), not a cross-file import.
function csvEscape(value: string): string {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

const LEDGER_EXPORT_ROLES = ["owner", "manager", "supervisor", "receptionist", "support"];

/** Mirrors `exportSubscriptionsCsv`: count pre-check against the 1,000-row
 * ceiling, then a capped data query, honouring the purpose/member filter. */
export async function exportPaymentsCsv(params: {
  purpose?: string | null;
  memberId?: string | null;
}): Promise<ExportPaymentsCsvResult> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError ?? { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  // Same roles as the payments read policy; RLS is the real gate, this keeps a
  // direct Server Action call from a coach from reaching the query at all.
  const { data: claimsData } = await supabase.auth.getClaims();
  const role = (claimsData?.claims as { app_role?: string } | undefined)?.app_role;
  if (!role || !LEDGER_EXPORT_ROLES.includes(role)) {
    return { data: null, error: { code: "forbidden", message: t("payments.export.forbidden") } };
  }

  const filters = normalizeLedgerFilters(params);

  let countQuery = supabase.from("payments").select("*", { count: "exact", head: true }).eq("gym_id", gymId);
  countQuery = applyLedgerFilters(countQuery, filters);
  const { count, error: countError } = await countQuery;
  if (countError) {
    return { data: null, error: await mapAndLog(countError) };
  }
  if ((count ?? 0) > PAYMENTS_EXPORT_ROW_LIMIT) {
    return { data: null, error: { code: "export_too_large", message: t("payments.export.tooLarge") } };
  }

  let dataQuery = supabase.from("payments").select(LEDGER_SELECT).eq("gym_id", gymId);
  dataQuery = applyLedgerFilters(dataQuery, filters);
  dataQuery = dataQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, PAYMENTS_EXPORT_ROW_LIMIT - 1);
  const { data, error } = await dataQuery;
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const mapped = await mapLedgerRows(supabase, gymId, (data ?? []) as unknown as LedgerRowFromDb[]);
  if (mapped.error || !mapped.data) {
    return { data: null, error: mapped.error ?? { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  const header = [
    "date",
    "member_name",
    "amount",
    "currency",
    "method",
    "purpose",
    "status",
    "flagged_reason",
    "voided",
    "actor",
    "note",
  ];
  const lines = [header.join(",")];
  for (const row of mapped.data) {
    const actor = row.actorName ?? (row.method === "mobile_money" ? t("payments.ledger.actorTara") : "");
    lines.push(
      [
        csvEscape(row.createdAt),
        csvEscape(row.memberName),
        csvEscape(String(row.amount)),
        csvEscape(row.currency),
        csvEscape(row.method),
        csvEscape(row.purpose),
        csvEscape(row.status),
        csvEscape(row.flaggedReason ?? ""),
        row.voidedAt ? "true" : "false",
        csvEscape(actor),
        csvEscape(row.note ?? ""),
      ].join(","),
    );
  }

  return { data: lines.join("\r\n"), error: null };
}
