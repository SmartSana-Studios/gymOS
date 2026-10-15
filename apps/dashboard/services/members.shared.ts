import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// Shared by the members service files (split out of members.ts, Epic 20 retro G-2): the caller-gym helper,
// the list row mapping and the list filters. No behavior change; members.ts re-exports the public names.

// Default rows per page (the user can pick 5/10/25/50).
export const MEMBERS_PAGE_SIZE = 5;

/** Shared by every "0 rows affected" (RLS-denied) / "no gym_id claim" / "not
 * found" branch in this file -- same discipline as plans.ts's
 * planNotFoundError / gym-settings.ts's gymNotFoundError. `context` is
 * logged server-side only, never shown to the caller. */
export async function memberNotFoundError(context: string): Promise<AppError> {
  console.warn(`[members] resolved to not_found: ${context}`);
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("members.errors.memberNotFound") };
}

/** Every function in this file needs the caller's own `gym_id`, read from
 * claims -- copied verbatim from plans.ts/gym-settings.ts's own (unexported)
 * helper rather than reaching across service files, matching this app's
 * established per-file-copy discipline. Resolved internally by every
 * exported function below, never accepted as a parameter from the Server
 * Action layer. */
export async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id;
  if (!gymId) {
    return { gymId: null, error: await memberNotFoundError("no gym_id claim on caller's session") };
  }

  return { gymId, error: null };
}

export type MemberSubscriptionStatus = "active" | "expiring_soon" | "grace_period" | "expired";

// The "no_active_plan" case is real (UX-DR5 lists it as a 6th badge state)
// even though this story never produces it directly -- a member created
// here always gets exactly one subscription. Represented in the type now so
// list rendering doesn't need a later breaking change; no code path in this
// story produces it.
export interface MemberListRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  photoUrl: string | null;
  emergencyContact: string | null;
  planId: string | null;
  planName: string | null;
  planType: string | null;
  status: MemberSubscriptionStatus | "no_active_plan";
  expiryDate: string | null;
  joinDate: string;
  deactivatedAt: string | null;
  /** Story 18.5: `members.registration_fee_settled_at`. Null on a role=member
   * row means the registration fee is still owed (awaiting). */
  registrationFeeSettledAt: string | null;
}

interface MemberSubscriptionEmbed {
  status: MemberSubscriptionStatus;
  expiry_date: string | null;
  plan_id: string;
  created_at: string;
  plans: { name: string; plan_type: string } | null;
}

export interface MemberRowFromDb {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  photo_url: string | null;
  emergency_contact: string | null;
  join_date: string;
  deactivated_at: string | null;
  registration_fee_settled_at?: string | null;
  subscriptions: MemberSubscriptionEmbed[] | null;
}

// dob/photo_url/emergency_contact are selected here (not just id/name/
// phone/email/join_date/deactivated_at, AD-03's own list-column set)
// specifically so MemberModal's Edit mode can populate its identity-field
// form directly from the already-fetched list row, with no second
// round-trip to fetch a member's full detail.
export function toMemberListRow(row: MemberRowFromDb): MemberListRow {
  const sub = row.subscriptions?.[0] ?? null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    dob: row.dob,
    photoUrl: row.photo_url,
    emergencyContact: row.emergency_contact,
    planId: sub?.plan_id ?? null,
    planName: sub?.plans?.name ?? null,
    planType: sub?.plans?.plan_type ?? null,
    status: sub?.status ?? "no_active_plan",
    expiryDate: sub?.expiry_date ?? null,
    joinDate: row.join_date,
    deactivatedAt: row.deactivated_at,
    registrationFeeSettledAt: row.registration_fee_settled_at ?? null,
  };
}

// Escapes ilike's wildcard characters ('%', '_'), the escape character
// itself ('\') -- matches planNameExists/tierNameExists' exact escaping --
// and '"', since the result is always wrapped in double quotes below (a
// comma or parenthesis in a raw search term would otherwise be parsed by
// PostgREST's `.or()` as a condition separator/grouping character; quoting
// the value, per PostgREST's own quoted-value syntax, neutralizes both
// without needing to special-case them individually).
function escapeIlike(value: string): string {
  return value.replace(/[\\%_"]/g, (char) => `\\${char}`);
}

/** "Deactivated" is a `members`-level concept (deactivated_at is not null),
 * layered on top of the `subscriptions.status` enum, which has no
 * "deactivated" value of its own (Task 6's own note) -- callers pass one of
 * the four subscription_status values, "deactivated", or "" (all).
 *
 * `T` is preserved across the call (the caller's own PostgrestFilterBuilder
 * type, opaque here since this app's Supabase client carries no `Database`
 * generic, matching every other service file's own loosely-typed-client
 * discipline) -- the cast inside is required to invoke the chainable
 * `.or()/.not()/.is()/.eq()` methods without declaring their full,
 * unstable-across-supabase-js-versions signatures here. */
// The only values `subscriptions.status` (a Postgres enum) actually
// contains, plus this feature's "deactivated" pseudo-status (see
// memberLabels.ts's identical MemberBadgeStatus set) -- anything else in the
// `?status=` query param (hand-edited, stale link, etc.) would otherwise
// reach `.eq("subscriptions.status", ...)` below and raise a raw Postgres
// invalid-enum-value error, surfaced to the user as a generic load failure.
// "awaiting_registration_fee" (Story 18.5) is a members-level state too, not
// a subscriptions.status value: it filters on members.registration_fee_settled_at.
const VALID_STATUS_FILTERS = new Set([
  "active",
  "expiring_soon",
  "grace_period",
  "expired",
  "deactivated",
  "awaiting_registration_fee",
]);

// The filters that live on the `members` row itself. Every other valid filter
// is a subscriptions.status value and needs the inner-joined embed.
const MEMBER_LEVEL_STATUS_FILTERS = new Set(["deactivated", "awaiting_registration_fee"]);

export function usesSubscriptionInnerJoin(status: string | undefined): boolean {
  return isValidStatusFilter(status) && !MEMBER_LEVEL_STATUS_FILTERS.has(status as string);
}

function isValidStatusFilter(status: string | undefined): boolean {
  return Boolean(status && VALID_STATUS_FILTERS.has(status));
}

export function applyMemberFilters<T>(
  query: T,
  params: { search?: string; status?: string },
): T {
  type ChainableFilter = {
    or(filters: string): ChainableFilter;
    not(column: string, operator: string, value: unknown): ChainableFilter;
    is(column: string, value: null): ChainableFilter;
    eq(column: string, value: unknown): ChainableFilter;
  };
  let next = query as unknown as ChainableFilter;
  if (params.search) {
    const escaped = escapeIlike(params.search);
    next = next.or(`name.ilike."%${escaped}%",phone.ilike."%${escaped}%"`);
  }
  const status = isValidStatusFilter(params.status) ? params.status : undefined;
  if (status === "deactivated") {
    next = next.not("deactivated_at", "is", null);
  } else if (status === "awaiting_registration_fee") {
    // A plain column filter on `members` (never an inner join: an awaiting
    // member has no subscription row to join to). Deactivated members show the
    // "Deactivated" badge, so they stay out of this filter like the others.
    next = next.is("deactivated_at", null).is("registration_fee_settled_at", null);
  } else if (status) {
    next = next.is("deactivated_at", null).eq("subscriptions.status", status);
  }
  return next as unknown as T;
}
