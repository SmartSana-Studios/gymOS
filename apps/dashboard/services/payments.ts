import { createClient } from "@/lib/supabase/server";
import {
  initiatePaymentSchema,
  recordManualPaymentSchema,
  recordRefundSchema,
  type InitiatePaymentInput,
  type RecordManualPaymentInput,
  type RecordRefundInput,
  type AppError,
} from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Story 4.2: real payment orchestration. Backend-only (no `actions.ts`/UI
 * yet -- see the story file's Scope Note; Story 4.7's Inline Renewal Panel
 * imports this function directly, exactly as `subscriptions.ts`'s own
 * comment already tells the reader to expect for `renewSubscription`). */

/** Every function in this file needs the caller's own `gym_id`, read from
 * claims -- copied verbatim from members.ts's own (unexported) helper
 * rather than reaching across service files, matching this app's
 * established per-file-copy discipline. */
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

interface MostRecentSubscriptionPlan {
  plans: { price: number; currency: string } | null;
}

/**
 * Inserts a `processing` `payments` row (proving authorization via the
 * gym_staff_insert_own_payments RLS policy, 0030 migration) and calls the
 * `payment-webhook`'s new `/initiate/<providerKey>` route to trigger the
 * real TaraMoney charge. On any failure the row is already deleted by the
 * initiate route itself (Edge Function, Task 2) -- this function never
 * deletes it, avoiding a double-delete race.
 */
export async function initiatePayment(
  input: InitiatePaymentInput,
): Promise<{ data: { paymentId: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = initiatePaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }

  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  // Reuses the same "most recent subscription" join pattern members.ts/
  // subscriptions.ts already use -- subscriptions -> plans is a many-to-one
  // FK (unlike members -> subscriptions' one-to-many), so `plans` embeds as
  // a single object here, not an array.
  const { data: subscriptionRow, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("plans(price, currency)")
    .eq("gym_id", gymId)
    .eq("member_id", parsed.data.memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError) {
    return { data: null, error: await mapAndLog(subscriptionError) };
  }

  const plan = (subscriptionRow as unknown as MostRecentSubscriptionPlan | null)?.plans ?? null;
  if (!plan) {
    console.warn(
      `[payments] initiatePayment: member ${parsed.data.memberId} has no subscription/plan to price the payment from`,
    );
    return { data: null, error: { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  const { data: providerKey, error: providerError } = await supabase.rpc("active_payment_provider");
  if (providerError) {
    return { data: null, error: await mapAndLog(providerError) };
  }
  if (!providerKey) {
    console.error("[payments] initiatePayment: no active_payment_provider() configured");
    return { data: null, error: { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  const { data: paymentRow, error: insertError } = await supabase
    .from("payments")
    .insert({
      gym_id: gymId,
      member_id: parsed.data.memberId,
      amount: plan.price,
      currency: plan.currency,
      method: parsed.data.method,
      status: "processing",
      provider: providerKey,
    })
    .select("id")
    .single();

  if (insertError || !paymentRow) {
    return { data: null, error: await mapAndLog(insertError) };
  }

  // TaraMoney's real API takes bare-digit Cameroon numbers with no leading
  // '+' (confirmed via Story 4.1's real request/response evidence) --
  // members.phone/initiatePaymentSchema's phoneNumber are both stored/
  // validated E.164 with a leading '+'; stripped here, at the one call site
  // that actually talks to the provider, rather than loosening the schema's
  // own validation.
  const bareDigitPhone = parsed.data.phoneNumber.replace(/^\+/, "");

  const { error: invokeError } = await supabase.functions.invoke(
    `payment-webhook/initiate/${providerKey}`,
    { body: { paymentId: paymentRow.id, phoneNumber: bareDigitPhone } },
  );

  if (invokeError) {
    console.error(
      `[payments] initiatePayment: payment-webhook initiate failed for payment ${paymentRow.id}`,
      invokeError,
    );
    return { data: null, error: await mapAndLog(invokeError) };
  }

  return { data: { paymentId: paymentRow.id }, error: null };
}

// ============================================================================
// Story 4.3: manual payment recording + verification queue. This is a
// payment *ledger* entry, not a renewal -- see the story file's Scope Note.
// Nothing below ever touches subscriptions or calls renew_subscription().
// ============================================================================

/** Shared by every "0 rows affected" (RLS-denied, not pending, or stale/
 * cross-gym id) branch below -- same discipline as members.ts's
 * memberNotFoundError. `context` is logged server-side only, never shown to
 * the caller. */
async function paymentNotFoundError(context: string): Promise<AppError> {
  console.warn(`[payments] resolved to not_found: ${context}`);
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("payments.errors.paymentNotFound") };
}

// Escapes ilike's wildcard characters ('%', '_'), the escape character
// itself ('\'), and '"', since the result is always wrapped in double quotes
// below (a comma or parenthesis in a raw search term would otherwise be
// parsed by PostgREST's `.or()` as a condition separator/grouping character;
// quoting the value, per PostgREST's own quoted-value syntax, neutralizes
// both without needing to special-case them individually). Copied verbatim
// from members.ts's own escapeIlike -- per-file-copy convention, not a
// cross-import (matches this file's own getCallerGymId precedent).
function escapeIlike(value: string): string {
  return value.replace(/[\\%_"]/g, (char) => `\\${char}`);
}

export interface PendingPaymentRow {
  id: string;
  memberId: string;
  memberName: string;
  memberPhone: string | null;
  amount: number;
  method: string;
  reason: string | null;
  createdAt: string;
  actorName: string | null;
}

interface PendingPaymentRowFromDb {
  id: string;
  member_id: string;
  amount: number;
  method: string;
  reason: string | null;
  created_at: string;
  actor_id: string | null;
  members: { name: string; phone: string | null } | null;
}

/**
 * Records a manual (cash/bank transfer/manual mobile-money) payment as a
 * `pending` row awaiting verification (AC #1). `actor_id` is the caller's
 * own `auth.uid()`, read from `getClaims()` -- never trusted from the client
 * input, mirroring `log_audit_event`'s own actor-derivation discipline.
 */
export async function recordManualPayment(
  input: RecordManualPaymentInput,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = recordManualPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  const supabase = await createClient();
  const { gymId, actorId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("payments")
    .insert({
      gym_id: gymId,
      member_id: parsed.data.memberId,
      amount: parsed.data.amount,
      currency: "XAF",
      method: parsed.data.method,
      status: "pending",
      actor_id: actorId,
      reason: parsed.data.reason,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { id: data.id }, error: null };
}

/**
 * AC #2: the Verification Queue, FIFO-ordered (oldest-awaiting-verification
 * first). No pagination -- out of scope (Scope Note), and a pilot-scale
 * gym's pending-queue depth is small (NFR-009: ~30 members/gym).
 *
 * `users.display_name` is dead data for staff accounts -- it's only ever
 * written by the mobile app's member self-service profile flow (Story 2.6/
 * 2.8), never by anything a Receptionist/Manager/Owner account goes through
 * (see services/session.ts's own "members.name is used instead of the
 * never-populated users.display_name" precedent). `actor_id` is a
 * `users.id`, not a `members.id`, so there's no direct FK to embed the
 * submitting staff member's name through -- resolved as a second, batched
 * `members` query instead, scoped to the same gym.
 */
export async function listPendingPayments(): Promise<{
  data: PendingPaymentRow[] | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("payments")
    .select("id, member_id, amount, method, reason, created_at, actor_id, members(name, phone)")
    .eq("gym_id", gymId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows = (data ?? []) as unknown as PendingPaymentRowFromDb[];

  const actorUserIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const actorNameByUserId = new Map<string, string>();
  if (actorUserIds.length > 0) {
    const { data: actorRows, error: actorError } = await supabase
      .from("members")
      .select("user_id, name")
      .eq("gym_id", gymId)
      .in("user_id", actorUserIds);
    if (actorError) {
      return { data: null, error: await mapAndLog(actorError) };
    }
    for (const row of actorRows ?? []) {
      actorNameByUserId.set(row.user_id, row.name);
    }
  }

  return {
    data: rows.map((row) => ({
      id: row.id,
      memberId: row.member_id,
      memberName: row.members?.name ?? "",
      memberPhone: row.members?.phone ?? null,
      amount: row.amount,
      method: row.method,
      reason: row.reason,
      createdAt: row.created_at,
      actorName: row.actor_id ? (actorNameByUserId.get(row.actor_id) ?? null) : null,
    })),
    error: null,
  };
}

/** The row's own authoritative fields, read back from the UPDATE itself
 * rather than trusted from the caller -- `verifyPayment`/`flagPayment`'s
 * callers (Server Actions) use this for what gets written into the audit
 * log, instead of a client-supplied `context` object that could be stale or
 * fabricated by the time the request lands. */
export interface VerifiedPaymentInfo {
  memberId: string;
  amount: number;
  method: string;
  reason: string | null;
}

/**
 * AC #3: marks a queued payment Verified. The `gym_staff_verify_own_payments`
 * RLS policy (0031) is the real authorization/state-machine gate -- 0 rows
 * back means RLS-denied, not-pending, or a stale/cross-gym id, all
 * indistinguishable from "not found" to the caller (matches
 * `updateMember`/`verifyPayment`-shaped precedent throughout this app).
 */
export async function verifyPayment(
  paymentId: string,
): Promise<{ data: VerifiedPaymentInfo | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("payments")
    .update({ status: "verified" })
    .eq("gym_id", gymId)
    .eq("id", paymentId)
    .select("member_id, amount, method, reason")
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  if (!data) {
    return {
      data: null,
      error: await paymentNotFoundError(
        "0 rows affected by payment verify UPDATE (non-staff session, not pending, or stale/cross-gym id)",
      ),
    };
  }
  return {
    data: { memberId: data.member_id, amount: data.amount, method: data.method, reason: data.reason },
    error: null,
  };
}

/**
 * AC #3: flags a queued payment for review. The flag reason is **not**
 * stored on the `payments` row (that column already holds the original
 * Record Payment note, FR-038) -- it lives in the audit log metadata only,
 * mirroring `deactivateMember`'s established "reason lives in audit_log
 * metadata, not a table column" precedent.
 */
export async function flagPayment(
  paymentId: string,
): Promise<{ data: VerifiedPaymentInfo | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("payments")
    .update({ status: "flagged" })
    .eq("gym_id", gymId)
    .eq("id", paymentId)
    .select("member_id, amount, method, reason")
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  if (!data) {
    return {
      data: null,
      error: await paymentNotFoundError(
        "0 rows affected by payment flag UPDATE (non-staff session, not pending, or stale/cross-gym id)",
      ),
    };
  }
  return {
    data: { memberId: data.member_id, amount: data.amount, method: data.method, reason: data.reason },
    error: null,
  };
}

/**
 * Backs the Record Payment modal's type-to-filter member combobox. Empty/
 * blank query returns an empty array without querying (AD-10: "must select
 * from results" -- no reason to list all members before the user types).
 */
export async function searchMembersForPayment(
  query: string,
): Promise<{ data: { id: string; name: string; phone: string | null }[] | null; error: AppError | null }> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { data: [], error: null };
  }

  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const escaped = escapeIlike(trimmed);
  const { data, error } = await supabase
    .from("members")
    .select("id, name, phone")
    .eq("gym_id", gymId)
    .eq("role", "member")
    .is("deactivated_at", null)
    .or(`name.ilike."%${escaped}%",phone.ilike."%${escaped}%"`)
    .order("name", { ascending: true })
    .limit(10);

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: data ?? [], error: null };
}

// ============================================================================
// Story 4.4: nightly reconciliation discrepancies, read-only. The
// `run_payment_reconciliation_job()` cron job (0032 migration) is the only
// writer of `payment_discrepancies` -- nothing below ever inserts/updates it.
// ============================================================================

export interface PaymentDiscrepancyRow {
  id: string;
  discrepancyType: "stale_processing" | "amount_mismatch";
  memberId: string;
  memberName: string;
  amount: number;
  currency: string;
  details: Record<string, unknown>;
  detectedAt: string;
}

interface PaymentDiscrepancyRowFromDb {
  id: string;
  discrepancy_type: string;
  details: unknown;
  detected_at: string;
  payments: { member_id: string; amount: number; currency: string; members: { name: string } | null } | null;
}

function isDisplayableDiscrepancyType(value: string): value is "stale_processing" | "amount_mismatch" {
  return value === "stale_processing" || value === "amount_mismatch";
}

/**
 * AC #1-#3: backs the Payments page's Discrepancies section. RLS
 * (`gym_staff_read_own_payment_discrepancies`, 0032 migration) already
 * scopes rows to the caller's own gym -- the explicit `.eq` below is
 * defense-in-depth, matching every other list function in this file. The
 * gym-scoped query can never legitimately return a `missing_internal_record`
 * row (it carries `gym_id = null`, invisible under RLS/the `.eq` above), so
 * `isDisplayableDiscrepancyType` below only needs to guard against an
 * unexpected value rather than special-case that type. No pagination -- same
 * NFR-009-scale reasoning as `listPendingPayments`.
 */
export async function listPaymentDiscrepancies(): Promise<{
  data: PaymentDiscrepancyRow[] | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("payment_discrepancies")
    .select("id, discrepancy_type, details, detected_at, payments(member_id, amount, currency, members(name))")
    .eq("gym_id", gymId)
    .order("detected_at", { ascending: false });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows = (data ?? []) as unknown as PaymentDiscrepancyRowFromDb[];

  return {
    data: rows
      .filter((row) => row.payments !== null && isDisplayableDiscrepancyType(row.discrepancy_type))
      .map((row) => ({
        id: row.id,
        discrepancyType: row.discrepancy_type as "stale_processing" | "amount_mismatch",
        memberId: row.payments!.member_id,
        memberName: row.payments!.members?.name ?? "",
        amount: row.payments!.amount,
        currency: row.payments!.currency,
        details: (row.details ?? {}) as Record<string, unknown>,
        detectedAt: row.detected_at,
      })),
    error: null,
  };
}

/** Thin `log_audit_event` wrapper, following `logMemberChange`'s pattern. */
export async function logPaymentChange(
  actionType: "manual_payment_recorded" | "payment_verified" | "payment_flagged",
  paymentId: string,
  metadata: Record<string, unknown>,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { error: gymIdError };
  }

  const { error } = await supabase.rpc("log_audit_event", {
    p_action_type: actionType,
    p_gym_id: gymId,
    p_target_entity_id: paymentId,
    p_target_entity_type: "payment",
    p_metadata: metadata,
  });

  if (error) {
    console.error(`[logPaymentChange] audit log write failed for payment ${paymentId}`, error);
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}

// ============================================================================
// Story 4.5: refund recording. Refunds live in a brand-new `refunds` table,
// entirely separate from `payments` -- see the story file's Scope Note and
// 0033_refund_recording.sql. Nothing below ever mutates payments.status or
// touches subscriptions; a refund is a pure ledger entry.
// ============================================================================

export interface RefundEligiblePaymentRow {
  id: string;
  amount: number;
  currency: string;
  method: string;
  createdAt: string;
}

interface RefundEligiblePaymentRowFromDb {
  id: string;
  amount: number;
  currency: string;
  method: string;
  created_at: string;
  refunds: { id: string } | null;
}

/**
 * Backs the Record Refund modal's payment-selection step: a member's
 * `verified` payments that have no existing `refunds` row yet, newest
 * first. `refunds.payment_id` is unique, so PostgREST embeds the reverse-FK
 * as a single object (or `null`), not an array -- rows with a non-null
 * `refunds` embed are filtered out here rather than expressed as a query
 * predicate, since PostgREST has no direct "embedded relation is empty"
 * filter.
 */
export async function listRefundEligiblePayments(
  memberId: string,
): Promise<{ data: RefundEligiblePaymentRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("payments")
    .select("id, amount, currency, method, created_at, refunds(id)")
    .eq("gym_id", gymId)
    .eq("member_id", memberId)
    .eq("status", "verified")
    .order("created_at", { ascending: false });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows = (data ?? []) as unknown as RefundEligiblePaymentRowFromDb[];

  return {
    data: rows
      .filter((row) => !row.refunds)
      .map((row) => ({
        id: row.id,
        amount: row.amount,
        currency: row.currency,
        method: row.method,
        createdAt: row.created_at,
      })),
    error: null,
  };
}

/** Read back out for the audit-log call site (Task 4) -- authoritative
 * fields read from the target payment row, not trusted from the caller,
 * same discipline as `verifyPayment`/`flagPayment`. */
export interface RecordedRefundInfo {
  id: string;
  memberId: string;
}

/**
 * AC #1: records a refund against an already-`verified` payment. The
 * `amount <= original payment amount` rule is checked here for a friendly
 * error message, and again -- the real, uncircumventable gate -- inside the
 * `manager_or_owner_insert_own_refunds` RLS policy's own `exists` clause
 * (0033_refund_recording.sql). A concurrent duplicate-refund race hits
 * `refunds.payment_id`'s unique constraint at the INSERT below; `mapAndLog`
 * maps that the same way every other unique-violation path in this codebase
 * already does.
 */
export async function recordRefund(
  input: RecordRefundInput,
): Promise<{ data: RecordedRefundInfo | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = recordRefundSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  const supabase = await createClient();
  const { gymId, actorId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data: paymentRow, error: paymentError } = await supabase
    .from("payments")
    .select("id, gym_id, member_id, amount, currency, status")
    .eq("id", parsed.data.paymentId)
    .eq("gym_id", gymId)
    .maybeSingle();

  if (paymentError) {
    return { data: null, error: await mapAndLog(paymentError) };
  }
  if (!paymentRow || paymentRow.status !== "verified") {
    return {
      data: null,
      error: await paymentNotFoundError(
        "recordRefund: target payment not found, cross-gym, or not verified",
      ),
    };
  }
  if (parsed.data.amount > paymentRow.amount) {
    return {
      data: null,
      error: { code: "validation_error", message: t("payments.refundModal.errors.amountExceedsPayment") },
    };
  }

  const { data, error } = await supabase
    .from("refunds")
    .insert({
      gym_id: gymId,
      payment_id: parsed.data.paymentId,
      amount: parsed.data.amount,
      currency: paymentRow.currency,
      reason: parsed.data.reason,
      actor_id: actorId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { id: data.id, memberId: paymentRow.member_id }, error: null };
}

/** A new, separate thin `log_audit_event` wrapper -- not folded into
 * `logPaymentChange`'s `actionType` union, since a refund's
 * `target_entity_type` ("refund") differs from every existing call in that
 * function ("payment"), and that function has no parameter for it. */
export async function logRefundChange(
  refundId: string,
  metadata: Record<string, unknown>,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { error: gymIdError };
  }

  const { error } = await supabase.rpc("log_audit_event", {
    p_action_type: "refund_recorded",
    p_gym_id: gymId,
    p_target_entity_id: refundId,
    p_target_entity_type: "refund",
    p_metadata: metadata,
  });

  if (error) {
    console.error(`[logRefundChange] audit log write failed for refund ${refundId}`, error);
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
