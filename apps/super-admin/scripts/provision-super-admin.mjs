#!/usr/bin/env node
// Story 1.12: scripted, auditable way to create a new Super Admin account or
// promote an existing user to Super Admin -- replaces hand-written SQL as the
// only way to set `public.users.is_super_admin`. Lives inside
// apps/super-admin/scripts (not a repo-root scripts/*.mjs) because it needs
// this workspace's own @supabase/supabase-js dependency -- a root-level
// script can't resolve a workspace-only dependency under pnpm's isolated
// node_modules layout (docs/decisions.md 2026-07-10 Decision 8).
//
// Usage:
//   pnpm --filter @gymos/super-admin provision-super-admin -- --email=someone@example.com
//   pnpm --filter @gymos/super-admin provision-super-admin -- --email=someone@example.com --yes
//
// - No existing auth.users row for --email: creates one (Admin API,
//   generated temp password printed once to stdout) and sets
//   is_super_admin = true on the resulting public.users row.
// - An existing auth.users row for --email: no new account is created;
//   the matched account's email/id/current role are printed and the
//   operator must retype the email to confirm before the matching
//   public.users row is promoted (is_super_admin = true) -- pass --yes to
//   skip the prompt for scripted use. A no-op (already a Super Admin) makes
//   no writes and no audit-log entry.
// Either path writes an audit_log record via the canonical log_audit_event()
// RPC. A partially-created/promoted user is rolled back if anything after
// the initial write fails, so no orphaned account or unaudited privilege
// change is left behind.

import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import { generateTempPassword } from "../lib/temp-password.mjs";

// Deliberately not zod's z.email() from @gymos/types: this plain-Node CLI
// (run via bare `node`, no bundler) cannot import that package -- its `main`
// points straight at un-transpiled `.ts` source with no build step, and zod
// itself isn't a direct dependency of this workspace under pnpm's isolated
// node_modules layout (confirmed empirically; same class of gotcha as
// docs/decisions.md 2026-07-10 Decision 8). Tightened over a naive
// `[^\s@]+@[^\s@]+\.[^\s@]+` to reject empty dot-separated labels
// (`a@b..c`, `a@.com`, `a@b.`), which that pattern let through.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

// supabase-js's own thrown/returned errors aren't uniform: auth-js's
// AuthError extends Error, but postgrest-js's PostgrestError (from
// `.from()`/`.rpc()` calls) is a plain `{ message, details, hint, code }`
// object -- `instanceof Error` is false for it, so a naive
// `String(err)` on one of those prints "[object Object]" instead of the
// actual message. Prefer `.message` whenever present, regardless of type.
function errorMessage(err) {
  if (err && typeof err === "object" && typeof err.message === "string") {
    return err.message;
  }
  return String(err);
}

async function main() {
  let email, yes;
  try {
    ({
      values: { email, yes },
    } = parseArgs({
      options: {
        email: { type: "string" },
        yes: { type: "boolean", default: false },
      },
    }));
  } catch (err) {
    throw new Error(`failed to parse arguments: ${errorMessage(err)}`);
  }

  if (!email || !EMAIL_RE.test(email)) {
    throw new Error("missing or malformed --email=<address> argument");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set (see .env.local)",
    );
  }

  // Duplicated from lib/supabase/admin.ts rather than imported -- that
  // module may pull in Next.js-only module resolution this plain Node
  // script doesn't have (Story 1.11 Task 2's identical reasoning for not
  // importing across the Next.js/CLI boundary).
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const existing = await findUserByEmail(admin, email);

  if (existing) {
    await promoteExistingUser(admin, existing, yes);
    return;
  }

  await createAndProvisionUser(admin, email);
}

async function findUserByEmail(admin, targetEmail) {
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
async function setSuperAdmin(admin, userId) {
  const { data, error } = await admin
    .from("users")
    .update({ is_super_admin: true })
    .eq("id", userId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`no public.users row found for auth user ${userId}`);
  }
}

async function writeAuditLog(admin, actionType, userId) {
  const { error } = await admin.rpc("log_audit_event", {
    p_action_type: actionType,
    p_target_entity_id: userId,
    p_target_entity_type: "users",
    p_system_actor_label: "system:provision-super-admin-cli",
  });
  if (error) throw error;
}

async function revertSuperAdmin(admin, userId) {
  const { error } = await admin
    .from("users")
    .update({ is_super_admin: false })
    .eq("id", userId);
  if (error) {
    console.error(
      `provision-super-admin: compensating cleanup failed to revert is_super_admin for ${userId}`,
      error,
    );
  }
}

async function confirmPromotion(email) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `Type the email address to confirm promoting ${email} to Super Admin: `,
    );
    return answer.trim() === email;
  } finally {
    rl.close();
  }
}

async function promoteExistingUser(admin, authUser, skipConfirm) {
  const { email, id: userId } = authUser;

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("is_super_admin")
    .eq("id", userId)
    .single();
  if (profileError) throw profileError;

  if (profile.is_super_admin) {
    console.log(`${email} (${userId}) is already a Super Admin -- no change made.`);
    return;
  }

  console.log(`Matched existing account: ${email} (${userId}).`);
  console.log("This will grant Super Admin (the platform's highest-privilege role) to this account.");

  if (!skipConfirm && !(await confirmPromotion(email))) {
    console.log("Aborted -- no changes made.");
    return;
  }

  await setSuperAdmin(admin, userId);

  try {
    await writeAuditLog(admin, "super_admin_promoted", userId);
  } catch (err) {
    // AC #4 rollback -- mirrors createAndProvisionUser's compensating
    // cleanup: don't leave is_super_admin flipped with no audit trail if
    // the audit-log RPC fails after the UPDATE already succeeded.
    await revertSuperAdmin(admin, userId);
    throw err;
  }

  console.log(`Promoted existing user ${email} (${userId}) to Super Admin.`);
}

async function createAndProvisionUser(admin, email) {
  const tempPassword = generateTempPassword();

  const { data, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (createError || !data?.user) {
    throw createError ?? new Error("createUser returned no user");
  }

  const userId = data.user.id;

  try {
    await setSuperAdmin(admin, userId);
    await writeAuditLog(admin, "super_admin_provisioned", userId);
  } catch (err) {
    // AC #4 rollback -- mirrors deleteAuthUserAndLog's compensating-cleanup
    // pattern (apps/super-admin/app/(admin)/gyms/actions.ts:239-250): don't
    // leave a half-provisioned auth user behind if the is_super_admin
    // UPDATE or the audit-log RPC fails after createUser already succeeded.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error(
        `provision-super-admin: compensating cleanup failed to delete auth user ${userId}`,
        deleteError,
      );
    }
    throw err;
  }

  console.log(`Created new Super Admin ${email} (${userId}).`);
  console.log(`Temporary password: ${tempPassword}`);
}

main().catch((err) => {
  console.error(`provision-super-admin: ${errorMessage(err)}`);
  process.exitCode = 1;
});
