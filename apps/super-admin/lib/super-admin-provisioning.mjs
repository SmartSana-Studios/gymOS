// Story 1.16: identity-mutation logic shared between the CLI
// (scripts/provision-super-admin.mjs, Story 1.12) and the in-app "Admins"
// page's Server Action (app/(admin)/admins/actions.ts). Plain JS, no build
// step -- same reasoning as lib/temp-password.mjs's extraction (Story 1.12
// Task 1): importable by both the bare-`node` CLI script and the Next.js
// app via `allowJs`.
//
// Deliberately extracts ONLY identity mutation, not audit logging. The CLI
// runs with no real user session (service-role key only) and must log via
// the admin client with a `system:*` actor label; the Server Action runs
// inside a real Super Admin session and must log via the regular session
// client so `log_audit_event()` attributes the action to the real caller,
// not a system label. Folding logging into this shared module would
// silently misattribute every UI-driven creation/promotion to a system
// label -- see 1-16-...md Dev Notes -> "Why audit logging is not shared".
// Each caller (the CLI script, the Server Action) makes its own
// log_audit_event call and owns its own revert-on-audit-failure step.
//
// Code review follow-up (2026-09-07): the actual `is_super_admin`/
// `display_name` write is ALSO not fully shared any more. The CLI (no
// session, service-role key already the top of the trust chain) still uses
// `setSuperAdmin`/`promoteToSuperAdmin` below, which write through the raw
// admin client. The Server Action (a real Super Admin session, reachable
// independently of the rendered page) instead calls the self-enforcing
// `promote_to_super_admin()`/`revert_super_admin_promotion()` RPCs (0088)
// directly -- see `admins/actions.ts` -- so its privilege-mutating write gets
// the same DB-level self-check `list_super_admins()` (0087) already has for
// the read side, closing an asymmetry a review found between the two.

import { generateTempPassword } from "./temp-password.mjs";

/**
 * Derives a human display name from an email local part:
 * `amara.ndiaye@gymos.cm` -> `Amara Ndiaye`. A placeholder, not an identity
 * claim -- it exists so the name is a distinguishable label rather than a
 * constant, and the holder can correct it later.
 */
export function displayNameFromEmail(email) {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Paginates the Admin API's listUsers() looking for a case-insensitive
 * email match -- there is no direct "get user by email" method on the
 * installed @supabase/auth-js version (Story 1.12 Task 1 verified this
 * empirically). */
export async function findUserByEmail(admin, targetEmail) {
  const perPage = 1000;
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const match = data.users.find(
      (u) => u.email?.toLowerCase() === targetEmail.toLowerCase(),
    );
    if (match) return match;

    if (!data.nextPage) return null;
    page = data.nextPage;
  }
}

// AC #2: a service-role client has no auth.uid() session at all, so
// private.protect_self_managed_user_columns()'s `auth.uid() = new.id` guard
// (supabase/migrations/0015_users_self_service_language_preference.sql:32-46)
// is never true here -- is_super_admin is written through unmodified.
//
// Never overwrites a name the holder already has -- the promote path must
// not clobber a real one.
async function setSuperAdmin(admin, userId, email) {
  const { data: existing, error: readError } = await admin
    .from("users")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (readError) throw readError;

  const patch = { is_super_admin: true };
  if (!existing?.display_name?.trim()) {
    patch.display_name = displayNameFromEmail(email);
  }

  const { data, error } = await admin
    .from("users")
    .update(patch)
    .eq("id", userId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`no public.users row found for auth user ${userId}`);
  }
}

/**
 * Deletes an auth user and logs (never throws) if the delete itself fails --
 * shared compensating-cleanup shape, now used by both this module's own
 * `createSuperAdmin` (CLI path) and `admins/actions.ts`'s Server Action
 * paths (code review follow-up, Story 1.16 -- previously each caller
 * duplicated this same delete-and-log shape independently).
 */
export async function deleteAuthUserAndLog(admin, userId, context) {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(
      `super-admin-provisioning: compensating cleanup failed to delete auth user ${userId} (${context})`,
      error,
    );
  }
}

/**
 * Creates a brand-new `auth.users` row (Admin API `createUser` + a generated
 * temp password) with no `public.users` mutation at all -- pure account
 * creation, nothing privilege-related yet. This is the only part of
 * "creating a Super Admin" that has no SQL equivalent: `auth.users` is
 * reachable exclusively via the Admin API, which requires the service-role
 * key regardless of caller. Split out (code review follow-up, Story 1.16) so
 * the Server Action's create path can run the actual `is_super_admin` write
 * through the self-enforcing `promote_to_super_admin()` RPC (0088) instead of
 * a raw admin-client write, while the CLI keeps using `createSuperAdmin`
 * below unchanged.
 */
export async function createAuthUserWithTempPassword(admin, email) {
  const tempPassword = generateTempPassword();

  const { data, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (createError || !data?.user) {
    throw createError ?? new Error("createUser returned no user");
  }

  return { userId: data.user.id, tempPassword };
}

/**
 * Creates a brand-new Super Admin account end to end: an `auth.users` row
 * plus `is_super_admin = true` on its `public.users` row. On any failure
 * AFTER the auth user is created, rolls back by deleting it before throwing
 * -- mirrors `createGym`'s `deleteAuthUserAndLog` compensating-cleanup shape
 * (app/(admin)/gyms/actions.ts). This is the ONLY rollback this function
 * owns; a caller's own subsequent audit-log call is outside this function's
 * knowledge, so each caller owns its own revert if that step fails (see
 * module header).
 *
 * Used by the CLI (`scripts/provision-super-admin.mjs`), which has no real
 * session to self-enforce a `promote_to_super_admin()` RPC call against --
 * the service-role key it runs with is already the top of the trust chain,
 * so the raw admin-client write here is not a weaker posture for it. The
 * in-app Server Action does NOT call this function for its create path --
 * see `admins/actions.ts`.
 */
export async function createSuperAdmin(admin, email) {
  const { userId, tempPassword } = await createAuthUserWithTempPassword(admin, email);

  try {
    await setSuperAdmin(admin, userId, email);
  } catch (err) {
    await deleteAuthUserAndLog(admin, userId, "setSuperAdmin failed");
    throw err;
  }

  return { userId, tempPassword };
}

/**
 * Promotes an existing `auth.users` account to Super Admin. Idempotent:
 * when the account already is one, this makes no write and returns
 * `{ alreadySuperAdmin: true }` (AC #4) -- mirrors the CLI's own
 * `promoteExistingUser` no-op guard. Callers that already know the account
 * isn't a Super Admin yet (e.g. having just checked to decide their own
 * branching) may still call this safely -- the check runs again here as a
 * defense-in-depth backstop, the same posture this codebase's other
 * privilege-mutating RPCs already take.
 */
export async function promoteToSuperAdmin(admin, userId, email) {
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("is_super_admin")
    .eq("id", userId)
    .single();
  if (profileError) throw profileError;

  if (profile.is_super_admin) {
    return { alreadySuperAdmin: true };
  }

  await setSuperAdmin(admin, userId, email);
  return { alreadySuperAdmin: false };
}
