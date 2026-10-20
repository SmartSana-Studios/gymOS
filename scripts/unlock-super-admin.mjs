#!/usr/bin/env node
// Epic 22 retro item 61: audited unlock of a Super Admin locked by too many wrong step-up codes (Story 22.7),
// WITHOUT the destructive full reset: factors, sessions, recovery data and the super_admin_aal2 flag are not touched.
// (The account's sessions were already ended when it locked; the Super Admin signs in again with password + code.)
//
//   node scripts/unlock-super-admin.mjs <email>                                  # dry run, rolled back
//   node scripts/unlock-super-admin.mjs <email> --apply --operator <name>        # typed confirmation
//
// Only a LOCKED account is unlocked. An account that is not locked, a non-Super-Admin and an unknown email are
// refused / left alone. One transaction, one audit_log row (action super_admin_unlocked, actor_id null,
// actor_display_name operator:<name>). Secrets are never selected or printed. Connection: scripts/lib/operator-pg.mjs.
// Runbook: docs/runbooks/super-admin-recovery.md ("Session limits, step-up and lockout").
import { makeClient, parseArgs, confirmTyped, operatorName } from "./lib/operator-pg.mjs";

const { flags, values, positional } = parseArgs(process.argv.slice(2), ["--operator"]);
const apply = flags.has("--apply");
const operator = operatorName(values);
const email = (positional[0] ?? "").trim().toLowerCase();
if (!email || (apply && !operator)) {
  console.error("usage: unlock-super-admin.mjs <email> [--apply --operator <name>]  (--apply requires --operator)");
  process.exit(2);
}

const client = makeClient();
let exitCode = 0;
await client.connect();
try {
  await client.query("begin");
  await client.query("set local lock_timeout = '10s'");
  const target = (await client.query(
    `select au.id, au.email, u.is_super_admin
       from auth.users au left join public.users u on u.id = au.id
      where lower(au.email) = $1`,
    [email],
  )).rows[0];
  if (!target) {
    console.error(`REFUSED: no account with email ${email}.`);
    await client.query("rollback");
    process.exit(1);
  }
  if (!target.is_super_admin) {
    console.error(`REFUSED: ${email} is not a Super Admin.`);
    await client.query("rollback");
    process.exit(1);
  }

  const lock = (await client.query(
    "select failed_count, locked_at from private.super_admin_lockout where user_id = $1 for update",
    [target.id],
  )).rows[0];
  const factors = Number((await client.query(
    "select count(*) n from auth.mfa_factors where user_id = $1 and status = 'verified'", [target.id],
  )).rows[0].n);
  const flagOn = (await client.query("select enabled from private.platform_flags where flag = 'super_admin_aal2'")).rows[0]?.enabled ?? false;

  console.log(`=== unlock ${email} ${apply ? "APPLY" : "DRY RUN (rolled back)"} ===`);
  console.log(`verified factors: ${factors} (kept), super_admin_aal2 flag: ${flagOn ? "on" : "off"} (unchanged)`);
  if (!lock || !lock.locked_at) {
    console.log(`Not locked${lock ? ` (wrong-code count ${lock.failed_count}, below the threshold)` : ""}. Nothing to do.`);
    await client.query("rollback");
    process.exit(0);
  }
  console.log(`LOCKED since ${lock.locked_at.toISOString()} after ${lock.failed_count} wrong step-up codes.`);

  if (!apply) {
    console.log("Dry run: rolling back, nothing changed.");
    await client.query("rollback");
    process.exit(0);
  }
  if (!(await confirmTyped(`unlock ${email}`))) {
    console.error("Confirmation did not match. Rolled back, nothing changed.");
    await client.query("rollback");
    process.exit(1);
  }

  await client.query("delete from private.super_admin_lockout where user_id = $1", [target.id]);
  const metadata = {
    operator,
    target_email: email,
    attempts_before: lock.failed_count,
    locked_at: lock.locked_at.toISOString(),
    verified_factors_kept: factors,
    flag_unchanged: flagOn,
  };
  await client.query(
    `insert into public.audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
     values (null, null, $1, 'super_admin_unlocked', 'user', $2, $3::jsonb)`,
    [`operator:${operator}`, target.id, JSON.stringify(metadata)],
  );
  await client.query("commit");
  console.log("Done: lock cleared, one audit_log row written. Factors, sessions and the flag were not touched.");
  console.log("Next: the Super Admin signs in with password + code.");
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("\nERROR:", e.message);
  exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
process.exit(exitCode);
