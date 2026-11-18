import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// Story 27.4 (UX AD-31): the two calls of the Correct plan modal. `correct_plan_eligibility` is the opening check (read-only);
// `correct_subscription_plan` is the correction and the authority. Both live in migration 0176.
//
// The database refuses with `P0001`, the code as the message and a JSON `detail` (0176 header; 0175 returned coded rows instead). This
// file parses that into a `CorrectPlanRefusal` the modal renders as the matching F state, so a refusal is data, not an error toast.

export type StandingState = "verified" | "pending" | "in_flight" | "partly_refunded";

/** The most recent payment that still stands on the current subscription (F1 to F4) and how many more do (F5). */
export interface StandingBlock {
  state: StandingState;
  amount: number;
  method: string;
  /** ISO timestamp of the payment, or its gym-local date (`on`, yyyy-mm-dd) when the database named one. */
  createdAt: string;
  on: string | null;
  refundedAmount: number;
  more: number;
}

export interface CorrectPlanSubscription {
  subscriptionId: string;
  planId: string;
  planName: string;
  planType: string;
  billingInterval: string;
  price: number;
  durationDays: number | null;
  startDate: string;
  expiryDate: string | null;
  status: string;
}

export interface CorrectPlanEligibility {
  subscription: CorrectPlanSubscription;
  block: StandingBlock | null;
}

export type CorrectPlanRefusal =
  | { code: "payment_stands"; block: StandingBlock }
  | { code: "session_held"; lapsesOn: string | null }
  | { code: "no_current_subscription" | "subscription_changed" | "plan_not_found" | "same_plan" | "invalid_reason" };

export interface CorrectedPlan {
  subscriptionId: string;
  planId: string;
  planName: string;
  planType: string;
  expiryDate: string | null;
  status: string;
}

interface EligibilityRow {
  subscription_id: string;
  plan_id: string;
  plan_name: string;
  plan_type: string;
  billing_interval: string;
  price: number;
  duration_days: number | null;
  start_date: string;
  expiry_date: string | null;
  status: string;
  block_state: string | null;
  block_payment_id: string | null;
  block_amount: number | null;
  block_method: string | null;
  block_at: string | null;
  block_refunded_amount: number | null;
  block_more: number | null;
}

interface CorrectedRow {
  subscription_id: string;
  plan_id: string;
  plan_name: string;
  plan_type: string;
  expiry_date: string | null;
  status: string;
}

const REFUSAL_CODES = new Set(["no_current_subscription", "subscription_changed", "plan_not_found", "same_plan", "payment_stands", "session_held", "invalid_reason"]);

function parseDetail(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Turns the P0001 error of `correct_subscription_plan` into a typed refusal, or null when it is some other error. */
export function parseCorrectPlanRefusal(error: { code?: string; message?: string; details?: unknown } | null | undefined): CorrectPlanRefusal | null {
  if (!error || error.code !== "P0001" || !error.message || !REFUSAL_CODES.has(error.message)) return null;
  const detail = parseDetail(error.details);
  if (error.message === "payment_stands") {
    const state = detail.state;
    if (state !== "verified" && state !== "pending" && state !== "in_flight" && state !== "partly_refunded") return null;
    return {
      code: "payment_stands",
      block: {
        state,
        amount: Number(detail.amount ?? 0),
        method: String(detail.method ?? ""),
        createdAt: String(detail.created_at ?? ""),
        on: typeof detail.on === "string" ? detail.on : null,
        refundedAmount: Number(detail.refunded_amount ?? 0),
        more: Number(detail.more ?? 0),
      },
    };
  }
  if (error.message === "session_held") {
    return { code: "session_held", lapsesOn: typeof detail.lapses_on === "string" ? detail.lapses_on : null };
  }
  return { code: error.message as Exclude<CorrectPlanRefusal["code"], "payment_stands" | "session_held"> };
}

/** True for the database's "permission denied" raise (a role that changed, support access that ended): the modal shows F12. */
function isPermissionDenied(error: { message?: string } | null | undefined): boolean {
  return (error?.message ?? "").trim() === "permission denied";
}

/**
 * The modal's opening check. `data` is null with no error when the database answers with nothing (no current subscription, or a caller
 * it will not answer: the same empty result by design), which the modal shows as F8.
 */
export async function getCorrectPlanEligibility(
  memberId: string,
): Promise<{ data: CorrectPlanEligibility | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("correct_plan_eligibility", { p_member_id: memberId });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  const row = (Array.isArray(data) ? data[0] : data) as EligibilityRow | null | undefined;
  if (!row) return { data: null, error: null };

  const block: StandingBlock | null =
    row.block_state === "verified" || row.block_state === "pending" || row.block_state === "in_flight" || row.block_state === "partly_refunded"
      ? {
          state: row.block_state,
          amount: row.block_amount ?? 0,
          method: row.block_method ?? "",
          createdAt: row.block_at ?? "",
          on: null,
          refundedAmount: row.block_refunded_amount ?? 0,
          more: row.block_more ?? 0,
        }
      : null;

  return {
    data: {
      subscription: {
        subscriptionId: row.subscription_id,
        planId: row.plan_id,
        planName: row.plan_name,
        planType: row.plan_type,
        billingInterval: row.billing_interval,
        price: row.price,
        durationDays: row.duration_days,
        startDate: row.start_date,
        expiryDate: row.expiry_date,
        status: row.status,
      },
      block,
    },
    error: null,
  };
}

/**
 * The correction. A refusal of the rules comes back as `refusal` (the modal renders the matching F state); a permission loss as
 * `permissionDenied` (F12); anything else as `error` (F11 when it is a network failure).
 */
export async function correctSubscriptionPlan(input: {
  memberId: string;
  newPlanId: string;
  reason: string;
  subscriptionId?: string;
}): Promise<{
  data: CorrectedPlan | null;
  refusal: CorrectPlanRefusal | null;
  permissionDenied: boolean;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("correct_subscription_plan", {
    p_member_id: input.memberId,
    p_new_plan_id: input.newPlanId,
    p_reason: input.reason,
    ...(input.subscriptionId ? { p_subscription_id: input.subscriptionId } : {}),
  });
  if (error) {
    const refusal = parseCorrectPlanRefusal(error);
    if (refusal) return { data: null, refusal, permissionDenied: false, error: null };
    if (isPermissionDenied(error)) return { data: null, refusal: null, permissionDenied: true, error: null };
    return { data: null, refusal: null, permissionDenied: false, error: await mapAndLog(error) };
  }
  const row = (Array.isArray(data) ? data[0] : data) as CorrectedRow | null | undefined;
  if (!row) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return { data: null, refusal: null, permissionDenied: false, error: { code: "unknown", message: t("common.somethingWentWrong") } };
  }
  return {
    data: {
      subscriptionId: row.subscription_id,
      planId: row.plan_id,
      planName: row.plan_name,
      planType: row.plan_type,
      expiryDate: row.expiry_date,
      status: row.status,
    },
    refusal: null,
    permissionDenied: false,
    error: null,
  };
}
