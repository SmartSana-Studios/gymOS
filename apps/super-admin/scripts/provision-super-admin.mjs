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
// See also the Admins page in the Super Admin dashboard (Story 1.16) for the
// ordinary, in-app way to do this -- this CLI remains the bootstrap path for
// creating the first Super Admin where none yet exists.
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
import {
  createSuperAdmin,
  findUserByEmail,
  promoteToSuperAdmin,
} from "../lib/super-admin-provisioning.mjs";

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

  // promoteToSuperAdmin (lib/super-admin-provisioning.mjs, Story 1.16) owns
  // only the identity mutation; this script keeps its own audit-log call and
  // revert-on-failure step, since audit logging is deliberately not shared
  // between this CLI (no real session -- logs via the admin client with a
  // system actor label) and the Admins page's Server Action (logs via the
  // real caller's session) -- see that module's header comment.
  await promoteToSuperAdmin(admin, userId, email);

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
  // createSuperAdmin already rolls back (deletes the auth user) and rethrows
  // if it fails after createUser succeeds -- nothing extra to do here for
  // that failure window.
  const { userId, tempPassword } = await createSuperAdmin(admin, email);

  try {
    await writeAuditLog(admin, "super_admin_provisioned", userId);
  } catch (err) {
    // AC #4 rollback -- mirrors createSuperAdmin's own createUser-failure
    // rollback, one layer up: audit logging now happens outside the shared
    // module (Story 1.16), so this caller owns its own revert when ITS step
    // fails after the account was otherwise fully created. Same shape as
    // deleteAuthUserAndLog (apps/super-admin/app/(admin)/gyms/actions.ts).
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
