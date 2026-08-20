import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type AppError, type CreateStaffMemberInput, type UpdateStaffRoleInput, type DeactivateStaffInput } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { generateTempPassword } from "@/lib/temp-password";
import { deleteAuthUserForCleanup } from "@/services/members";
import { sendEvolutionApiMessage } from "@/lib/messaging/EvolutionApiMessageProvider";

/** Story 9.2 Task 1: dashboard's own copy, pointing at itself -- distinct
 * from apps/super-admin's own getDashboardAppUrl() (that one points
 * super-admin AT the dashboard). Mirrors that function's shape exactly
 * (apps/super-admin/app/(admin)/gyms/actions.ts, ~line 234) but is not
 * imported across apps (AD-7: no shared code across apps). */
function getDashboardAppUrl(): string {
  const url = process.env.DASHBOARD_APP_URL;
  if (!url) {
    throw new Error("DASHBOARD_APP_URL is not set");
  }
  return url.replace(/\/+$/, "");
}

/** Shared by every "0 rows affected" / "no gym_id claim" branch in this file
 * -- same discipline as members.ts's memberNotFoundError. `context` is
 * logged server-side only, never shown to the caller. */
async function staffNotFoundError(context: string): Promise<AppError> {
  console.warn(`[staff] resolved to not_found: ${context}`);
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("members.errors.memberNotFound") };
}

/** Every function in this file needs the caller's own `gym_id`, read from
 * claims -- copied verbatim from members.ts/coaches.ts's own (unexported)
 * helper, matching this app's established per-file-copy discipline. */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id;
  if (!gymId) {
    return { gymId: null, error: await staffNotFoundError("no gym_id claim on caller's session") };
  }

  return { gymId, error: null };
}

export type StaffStatus = "active" | "pending_activation" | "deactivated";

export interface StaffListRow {
  id: string;
  name: string;
  phone: string | null;
  role: string;
  status: StaffStatus;
}

interface StaffRowFromDb {
  id: string;
  name: string;
  phone: string | null;
  role: string;
  user_id: string;
  deactivated_at: string | null;
}

/** AC #5: every non-'member'-role row in the gym, name/role/status. Status
 * is derived, not stored: `deactivated_at is not null` -> "Deactivated";
 * else looks up the row's `users.must_change_password` -> true -> "Pending
 * activation"; false -> "Active". Reuses the existing
 * `users.must_change_password` column (0016, Story 1.11) -- no new
 * status/pending_activation column.
 *
 * The `must_change_password` lookup MUST use the admin (service-role) client
 * -- `self_read_own_user` (0015) is the only SELECT policy on `users`,
 * scoped to `id = auth.uid()` only, so a Manager/Owner/Supervisor session
 * has zero RLS-granted read access to any other user's row (unlike
 * `listPendingPayments()`'s own two-query actor-lookup precedent, which
 * reads `members.name` -- readable via `gym_staff_read_own_members` -- not
 * `users.*`). Safe to elevate here: the user_id set being looked up was
 * already derived from a gym-scoped, RLS-filtered `members` query above, so
 * this can only ever reveal `must_change_password` for staff already
 * confirmed to belong to the caller's own gym. */
export async function listStaff(): Promise<{ data: StaffListRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("members")
    .select("id, name, phone, role, user_id, deactivated_at")
    .eq("gym_id", gymId)
    .neq("role", "member")
    .order("created_at", { ascending: true });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows = (data ?? []) as unknown as StaffRowFromDb[];

  const activeUserIds = rows.filter((row) => row.deactivated_at === null).map((row) => row.user_id);
  const mustChangePasswordByUserId = new Map<string, boolean>();
  if (activeUserIds.length > 0) {
    const admin = createAdminClient();
    const { data: userRows, error: userError } = await admin
      .from("users")
      .select("id, must_change_password")
      .in("id", activeUserIds);
    if (userError) {
      return { data: null, error: await mapAndLog(userError) };
    }
    for (const row of (userRows ?? []) as { id: string; must_change_password: boolean }[]) {
      mustChangePasswordByUserId.set(row.id, row.must_change_password);
    }
  }

  return {
    data: rows.map((row) => {
      let status: StaffStatus;
      if (row.deactivated_at !== null) {
        status = "deactivated";
      } else if (mustChangePasswordByUserId.get(row.user_id)) {
        status = "pending_activation";
      } else {
        status = "active";
      }
      return { id: row.id, name: row.name, phone: row.phone, role: row.role, status };
    }),
    error: null,
  };
}

export interface CreateStaffMemberResult {
  tempPassword: string;
  smsSent: boolean;
}

/** AC #1/#2/#3: the two-step creation flow (Dev Notes "Creation Sequencing")
 * -- `members.user_id not null references users(id)` (0003) means a
 * `members` row cannot be inserted before a real `auth.users` row exists, so
 * account creation is structurally two client calls: (1) the service-role
 * admin client provisions `auth.users` (mirrors `createGym()`'s exact Step
 * 3, Story 1.5, including its IIFE-wrapped try/catch discipline), then (2)
 * `create_staff_member()` runs under the *caller's own* authenticated
 * session (not the admin client) so `private.current_member_role()` resolves
 * `auth.uid()` correctly and performs the real ceiling check. If the RPC
 * raises (ceiling violated, or any other failure), a compensating
 * `deleteUser()` (reused from members.ts) undoes the just-created auth user
 * so no orphaned row survives a rejected staff-creation attempt -- mirrors
 * `deleteGym()`'s exact compensating-cleanup shape. */
export async function createStaffMember(
  input: CreateStaffMemberInput,
): Promise<{ data: CreateStaffMemberResult | null; error: AppError | null }> {
  const supabase = await createClient();
  const { t } = await getServerTranslation(await getRequestLocale());

  const temporaryPassword = generateTempPassword();
  const provisioned = await (async () => {
    try {
      const admin = createAdminClient();
      const { data, error: authError } = await admin.auth.admin.createUser({
        phone: input.phone,
        password: temporaryPassword,
        phone_confirm: true,
      });

      if (authError || !data?.user) {
        return { ok: false as const, error: await mapAndLog(authError) };
      }
      return { ok: true as const, userId: data.user.id };
    } catch (err) {
      return { ok: false as const, error: await mapAndLog(err) };
    }
  })();

  if (!provisioned.ok) {
    return { data: null, error: provisioned.error };
  }

  const { data: staffRow, error: rpcError } = await supabase.rpc("create_staff_member", {
    p_user_id: provisioned.userId,
    p_name: input.name,
    p_phone: input.phone,
    p_role: input.role,
  });

  if (rpcError || !staffRow) {
    await deleteAuthUserForCleanup(provisioned.userId);
    return { data: null, error: rpcError ? await mapAndLog(rpcError) : { code: "unknown", message: t("common.somethingWentWrong") } };
  }

  // AC #1: the account is already created and committed at this point --
  // a WhatsApp send failure here must not turn a successful staff creation
  // into a reported failure (same non-blocking discipline sendMemberInvite
  // and createGym's own temp-password send already use).
  let loginUrl = "";
  try {
    loginUrl = `${getDashboardAppUrl()}/auth/login`;
  } catch (err) {
    console.error("[staff] DASHBOARD_APP_URL is not set; sending activation message without a login link", err);
  }
  const message = loginUrl
    ? t("staff.activation.message", { name: input.name, password: temporaryPassword, link: loginUrl })
    : t("staff.activation.messageNoLink", { name: input.name, password: temporaryPassword });
  const sendResult = await sendEvolutionApiMessage(input.phone, message);

  return { data: { tempPassword: temporaryPassword, smsSent: sendResult.success }, error: null };
}

/** Story 9.2 (AC #4): Owner/Supervisor-triggered password reset for a staff
 * member who lost their password -- whether it's still the original temp
 * password (never completed first login) or a real password set after
 * activation (no check on the target's current must_change_password state,
 * per explicit user instruction that this must work "even after a first
 * login"). staff_account_for_reset() (0062) does the authorization + lookup
 * under the caller's own session; the actual credential write below uses
 * the admin client because a SQL RPC cannot call the GoTrue Admin API. */
export async function resendStaffTempPassword(
  memberId: string,
): Promise<{ data: { tempPassword: string; smsSent: boolean } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { t } = await getServerTranslation(await getRequestLocale());

  const { data: targetRows, error: rpcError } = await supabase.rpc("staff_account_for_reset", {
    p_member_id: memberId,
  });

  if (rpcError || !targetRows || targetRows.length === 0) {
    return { data: null, error: rpcError ? await mapAndLog(rpcError) : await staffNotFoundError("staff_account_for_reset returned no row") };
  }
  const target = targetRows[0] as { user_id: string; phone: string; name: string };

  const newTempPassword = generateTempPassword();

  const admin = createAdminClient();
  const { error: updateUserError } = await admin.auth.admin.updateUserById(target.user_id, {
    password: newTempPassword,
  });
  if (updateUserError) {
    return { data: null, error: await mapAndLog(updateUserError) };
  }

  // The password write above already succeeded -- a failure flipping
  // must_change_password back to true must not discard the new password
  // or report an otherwise-successful reset as an error (same
  // non-blocking discipline as the WhatsApp send below): it only means
  // the staff member won't be forced through the change-password gate on
  // their next login. Losing the new password here (instead of surfacing
  // it) would be a genuine lockout, since the old one is already gone.
  const { error: flagError } = await admin.from("users").update({ must_change_password: true }).eq("id", target.user_id);
  if (flagError) {
    console.error("[staff] failed to flip must_change_password after password reset", flagError);
  }

  // Non-blocking on failure -- the password/must_change_password writes
  // above already succeeded (the old credential is already invalidated
  // either way); the UI's unconditional temp-password fallback covers a
  // failed send, matching Task 2/AC #1's own discipline.
  let loginUrl = "";
  try {
    loginUrl = `${getDashboardAppUrl()}/auth/login`;
  } catch (err) {
    console.error("[staff] DASHBOARD_APP_URL is not set; sending resend message without a login link", err);
  }
  const message = loginUrl
    ? t("staff.activation.message", { name: target.name, password: newTempPassword, link: loginUrl })
    : t("staff.activation.messageNoLink", { name: target.name, password: newTempPassword });
  const sendResult = await sendEvolutionApiMessage(target.phone, message);

  return { data: { tempPassword: newTempPassword, smsSent: sendResult.success }, error: null };
}

/** Story 9.3 (AC #1/#2): a single `update_staff_role()` RPC call under the
 * caller's own session -- the ceiling/self-edit checks must run inside the
 * real session, same as every other staff RPC call site in this file. No
 * compensating-cleanup logic needed (unlike `createStaffMember`) -- this is
 * a single-table UPDATE, not a two-system creation sequence. Not wrapped in
 * a try/catch -- matches this file's existing, deferred-work.md-flagged
 * gap (createStaffMember/resendStaffTempPassword both already lack one). */
export async function updateStaffRole(
  memberId: string,
  input: UpdateStaffRoleInput,
): Promise<{ data: StaffListRow | null; error: AppError | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("update_staff_role", {
    p_member_id: memberId,
    p_name: input.name,
    p_role: input.role,
  });

  if (error || !data) {
    return { data: null, error: error ? await mapAndLog(error) : await staffNotFoundError("update_staff_role returned no row") };
  }

  // Same must_change_password derivation as listStaff() -- an edited staff
  // member's activation state is untouched by this RPC (name/role only), so
  // the returned row's status must still reflect it accurately rather than
  // assuming "active".
  const admin = createAdminClient();
  const { data: userRow, error: userError } = await admin
    .from("users")
    .select("must_change_password")
    .eq("id", data.user_id)
    .single();
  if (userError) {
    return { data: null, error: await mapAndLog(userError) };
  }

  return {
    data: {
      id: data.id,
      name: data.name,
      phone: data.phone,
      role: data.role,
      status: userRow.must_change_password ? "pending_activation" : "active",
    },
    error: null,
  };
}

/** Story 9.3 (AC #3): `deactivate_staff_member()` under the caller's own
 * session. Returns `{ error }` only, matching `deactivateMember()`'s own
 * return shape (members.ts:692) -- nothing new to hand back to the caller
 * beyond success/failure. */
export async function deactivateStaffMember(
  memberId: string,
  input: DeactivateStaffInput,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("deactivate_staff_member", {
    p_member_id: memberId,
    p_reason: input.reason,
  });

  if (error) {
    return { error: await mapAndLog(error) };
  }

  return { error: null };
}
