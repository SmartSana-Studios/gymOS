import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type AppError, type CreateStaffMemberInput } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { generateTempPassword } from "@/lib/temp-password";
import { deleteAuthUserForCleanup } from "@/services/members";

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

  return { data: { tempPassword: temporaryPassword }, error: null };
}
