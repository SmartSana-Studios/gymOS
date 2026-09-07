"use server";

import { createOrPromoteSuperAdminSchema, type AppError } from "@gymos/types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapAndLog } from "@/services/gyms";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import {
  createAuthUserWithTempPassword,
  deleteAuthUserAndLog,
  displayNameFromEmail,
  findUserByEmail,
} from "@/lib/super-admin-provisioning.mjs";

export interface SuperAdminRow {
  id: string;
  email: string;
  displayName: string | null;
  since: string | null;
}

/**
 * AC #1: every current Super Admin (email, display name, "since"). Goes
 * through the `list_super_admins()` RPC (0087) via the regular session
 * client -- not the admin client -- since the RPC self-enforces
 * `private.is_super_admin()` internally and no service-role bypass is
 * needed for a read the caller is now authorized to make.
 *
 * Email is resolved per-row via the admin client's `getUserById` -- the one
 * genuinely sanctioned admin-client use here (`lib/supabase/admin.ts`'s own
 * "sanctioned use is auth.admin.* only" header): `public.users` has no
 * email column at all (0003_members_and_users.sql), and this app's Super
 * Admin population is small and tightly held, unlike `listUsers()`'s full
 * pagination (that's `findUserByEmail`'s job for a single lookup by email,
 * a different problem).
 *
 * A per-row lookup failure fails the whole read rather than silently
 * dropping that admin from the list -- an incomplete Super Admin list is a
 * security-relevant omission, not a benign partial success.
 */
export async function listSuperAdmins(): Promise<{
  data: SuperAdminRow[] | null;
  error: AppError | null;
}> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const supabase = await createClient();
  // Annotated explicitly: this app's Supabase clients are constructed
  // without the `Database` generic (lib/supabase/server.ts), so a
  // set-returning rpc() yields no row type to infer from. Mirrors 0086's
  // list_active_gym_data_escalations() call site (services/gyms.ts).
  const { data: rows, error } = await supabase.rpc("list_super_admins");
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const admins = (rows ?? []) as {
    id: string;
    display_name: string | null;
    since: string | null;
  }[];
  if (admins.length === 0) {
    return { data: [], error: null };
  }

  const adminClient = createAdminClient();
  const result: SuperAdminRow[] = [];
  for (const row of admins) {
    const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(row.id);
    if (userError || !userData?.user?.email) {
      console.error(`[listSuperAdmins] failed to resolve email for Super Admin ${row.id}`, userError);
      return { data: null, error: { code: "unknown", message: t("common.somethingWentWrong") } };
    }
    result.push({
      id: row.id,
      email: userData.user.email,
      displayName: row.display_name,
      since: row.since,
    });
  }

  return { data: result, error: null };
}

/**
 * AC #2/#3/#4: creates a new Super Admin account, or promotes an existing
 * `auth.users` account, from a single email input -- mirroring the CLI's
 * (`provision-super-admin.mjs`, Story 1.12) own create-or-promote flow,
 * just exposed in-app (Story 1.16). Identity mutation is shared with the
 * CLI via `lib/super-admin-provisioning.mjs`; audit logging is
 * deliberately NOT shared -- see that module's header comment and
 * `1-16-...md` Dev Notes -> "Why audit logging is not shared" -- this
 * action calls `log_audit_event` through the regular session client so the
 * write is attributed to the real calling Super Admin, not a system label.
 */
export async function createOrPromoteSuperAdmin(input: unknown): Promise<{
  data: { outcome: "created" | "promoted" | "already_super_admin"; tempPassword: string | null } | null;
  error: AppError | null;
}> {
  const { t } = await getServerTranslation(await getRequestLocale());

  const parsed = createOrPromoteSuperAdminSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      data: null,
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }
  const { email, currentPassword } = parsed.data;

  // AC #7: re-verify the caller's own session claims here, on top of the
  // (admin) layout guard -- a deliberate, narrow exception to this app's
  // usual convention of relying on the layout guard alone (createGym etc.
  // do not re-check). NFR-020 requires this specific action to self-enforce
  // server-side because it mints the platform's highest privilege, and a
  // Server Action endpoint is reachable independently of the rendered page.
  // Do NOT generalize this pattern to other actions in this app.
  const session = await createClient();
  const { data: claimsData, error: claimsError } = await session.auth.getClaims();
  if (claimsError || claimsData?.claims?.app_role !== "super_admin") {
    return {
      data: null,
      error: { code: "unauthorized", message: t("admins.errors.unauthorized") },
    };
  }

  // Post-review addition (2026-09-07, requested during manual testing):
  // step-up re-authentication. The acting Super Admin must prove they still
  // hold their OWN password immediately before this action runs, not just a
  // still-valid session cookie -- a stronger guard than AC #7's claims
  // re-check alone, which only confirms *what* the session is authorized
  // for, not that the person at the keyboard right now is still the one who
  // logged in. `getUser()` (not the JWT's own claims) is used for the
  // caller's email so this doesn't depend on `email` being present in the
  // custom claims shape. `signInWithPassword` against the caller's own
  // email is the supabase-js mechanism for this -- there is no separate
  // "verify password without changing session" endpoint; re-authenticating
  // as the same account is a no-op for session identity, it only refreshes
  // tokens for the same user.
  const { data: callerData, error: callerError } = await session.auth.getUser();
  if (callerError || !callerData?.user?.email) {
    return {
      data: null,
      error: { code: "unauthorized", message: t("admins.errors.unauthorized") },
    };
  }
  const { error: reauthError } = await session.auth.signInWithPassword({
    email: callerData.user.email,
    password: currentPassword,
  });
  if (reauthError) {
    // Only a genuine wrong-password attempt is reported as "incorrect
    // password" -- code review follow-up: mapping every signInWithPassword
    // failure to that message masked rate-limiting/account-disabled/other
    // conditions behind a misleading prompt to just retype the password.
    if (reauthError.code === "invalid_credentials") {
      return {
        data: null,
        error: { code: "incorrect_password", message: t("admins.errors.incorrectPassword") },
      };
    }
    return { data: null, error: await mapAndLog(reauthError) };
  }

  const admin = createAdminClient();

  let existing;
  try {
    existing = await findUserByEmail(admin, email);
  } catch (err) {
    return { data: null, error: await mapAndLog(err) };
  }

  if (!existing) {
    let created;
    try {
      created = await createAuthUserWithTempPassword(admin, email);
    } catch (err) {
      return { data: null, error: await mapAndLog(err) };
    }

    // Code review follow-up: the is_super_admin write itself now goes
    // through the self-enforcing promote_to_super_admin() RPC (0088) via the
    // session client, not a raw admin-client write -- the caller's own
    // Super Admin session is re-checked at the DB level here too, matching
    // list_super_admins()'s (0087) posture instead of relying on the
    // application-level claims/password checks above alone.
    const { error: promoteError } = await session.rpc("promote_to_super_admin", {
      p_user_id: created.userId,
      p_fallback_display_name: displayNameFromEmail(email),
    });
    if (promoteError) {
      console.error(`[createOrPromoteSuperAdmin] promote_to_super_admin failed for ${created.userId}`, promoteError);
      await deleteAuthUserAndLog(admin, created.userId, "promote_to_super_admin failed");
      return { data: null, error: await mapAndLog(promoteError) };
    }

    const { error: auditError } = await session.rpc("log_audit_event", {
      p_action_type: "super_admin_provisioned",
      p_target_entity_id: created.userId,
      p_target_entity_type: "users",
    });
    if (auditError) {
      // If this audit call fails, roll back -- do not report success for an
      // unaudited creation. Deleting the auth user cascades away its
      // public.users row too (0003_members_and_users.sql's `on delete
      // cascade`), so there is no separate is_super_admin/display_name
      // revert needed for the create path.
      console.error(`[createOrPromoteSuperAdmin] audit log write failed for ${created.userId}`, auditError);
      await deleteAuthUserAndLog(admin, created.userId, "audit log write failed");
      return { data: null, error: await mapAndLog(auditError) };
    }

    return { data: { outcome: "created", tempPassword: created.tempPassword }, error: null };
  }

  // AC #4's idempotency check now lives inside promote_to_super_admin()
  // itself (0088) -- no separate raw admin-client profile read needed here.
  const { data: promoteRows, error: promoteError } = await session.rpc("promote_to_super_admin", {
    p_user_id: existing.id,
    p_fallback_display_name: displayNameFromEmail(email),
  });
  if (promoteError) {
    return { data: null, error: await mapAndLog(promoteError) };
  }
  // No `Database` generic on this app's Supabase clients (see listSuperAdmins
  // above) -- a set-returning rpc() yields no row type to infer from.
  const [{ already_super_admin: alreadySuperAdmin, display_name_set: displayNameSet }] = promoteRows as {
    already_super_admin: boolean;
    display_name_set: boolean;
  }[];

  if (alreadySuperAdmin) {
    // AC #4: no-op -- no write, no audit-log row.
    return { data: { outcome: "already_super_admin", tempPassword: null }, error: null };
  }

  const { error: promoteAuditError } = await session.rpc("log_audit_event", {
    p_action_type: "super_admin_promoted",
    p_target_entity_id: existing.id,
    p_target_entity_type: "users",
  });
  if (promoteAuditError) {
    // Revert -- mirrors the CLI's own revert-on-audit-failure discipline
    // (1-12-...md Review Findings), executed here at the Server Action
    // layer instead of inside the shared module, since audit logging now
    // happens outside that module. Reverts display_name too, but only when
    // this same promote_to_super_admin() call is the one that set it --
    // code review follow-up: the previous inline revert reset is_super_admin
    // but left a placeholder display_name behind on a "failed" promotion.
    console.error(`[createOrPromoteSuperAdmin] audit log write failed for ${existing.id}`, promoteAuditError);
    const { error: revertError } = await session.rpc("revert_super_admin_promotion", {
      p_user_id: existing.id,
      p_revert_display_name: displayNameSet,
    });
    if (revertError) {
      console.error(
        `[createOrPromoteSuperAdmin] compensating cleanup failed to revert is_super_admin for ${existing.id}`,
        revertError,
      );
    }
    return { data: null, error: await mapAndLog(promoteAuditError) };
  }

  return { data: { outcome: "promoted", tempPassword: null }, error: null };
}
