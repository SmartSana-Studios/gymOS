#!/usr/bin/env node
// Story 22.6: audited out-of-band recovery for a Super Admin who lost a device. Deletes the target's
// TOTP factors and auth.sessions and turns the super_admin_aal2 flag OFF in the same transaction, so
// the account can sign in with its password and re-enroll at /security (otherwise the sole Super Admin
// would be locked out). It reopens the first-factor window on purpose: re-enroll both factors and run
// scripts/enable-super-admin-aal2.mjs immediately. Since 22.7 it also clears the step-up wrong-code lock, session state and step-up grants. See docs/runbooks/super-admin-recovery.md.
//
//   node scripts/reset-super-admin-factors.mjs <email>                                # dry run, rolled back
//   node scripts/reset-super-admin-factors.mjs <email> --apply --operator <name>      # typed confirmation
//
// One transaction, one audit_log row (actor_id null, actor_display_name operator:<name>). Secrets are
// never selected or printed.
import { makeClient, parseArgs, confirmTyped, operatorName } from "./lib/operator-pg.mjs";

const { flags, values, positional } = parseArgs(process.argv.slice(2), ["--operator"]);
const apply = flags.has("--apply");
const operator = operatorName(values);
const email = (positional[0] ?? "").trim().toLowerCase();
if (!email || (apply && !operator)) {
  console.error("usage: reset-super-admin-factors.mjs <email> [--apply --operator <name>]  (--apply requires --operator)");
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
  const factors = (await client.query(
    "select id, friendly_name, factor_type, status, created_at from auth.mfa_factors where user_id = $1 order by created_at",
    [target.id],
  )).rows;
  const sessions = Number((await client.query("select count(*) n from auth.sessions where user_id = $1", [target.id])).rows[0].n);
  const flagBefore = (await client.query(
    "select enabled from private.platform_flags where flag = 'super_admin_aal2' for update",
  )).rows[0]?.enabled ?? false;

  console.log(`=== reset factors for ${email} ${apply ? "APPLY" : "DRY RUN (rolled back)"} ===`);
  for (const f of factors) console.log(`  - ${f.friendly_name || "(unnamed)"}  [${f.factor_type}/${f.status}]  created ${f.created_at.toISOString()}`);
  console.log(`factors to delete: ${factors.length}, sessions to delete: ${sessions}, flag before: ${flagBefore ? "on" : "off"} -> off`);

  if (!apply) {
    console.log("Dry run: rolling back, nothing changed.");
    await client.query("rollback");
    process.exit(0);
  }
  if (!(await confirmTyped(`reset ${email}`))) {
    console.error("Confirmation did not match. Rolled back, nothing changed.");
    await client.query("rollback");
    process.exit(1);
  }

  await client.query("delete from auth.mfa_factors where user_id = $1", [target.id]);
  await client.query("delete from auth.sessions where user_id = $1", [target.id]);
  // Story 22.7: clear the wrong-code lock, session state and any step-up grants.
  const lock = (await client.query("select failed_count, locked_at from private.super_admin_lockout where user_id = $1", [target.id])).rows[0];
  await client.query("delete from private.super_admin_lockout where user_id = $1", [target.id]);
  await client.query("delete from private.support_session_state where user_id = $1", [target.id]);
  await client.query("delete from private.support_stepup where user_id = $1", [target.id]);
  await client.query(
    `insert into private.platform_flags (flag, enabled) values ('super_admin_aal2', false)
     on conflict (flag) do update set enabled = false`,
  );
  const metadata = {
    operator,
    target_email: email,
    factor_count: factors.length,
    factors: factors.map((f) => ({ id: f.id, friendly_name: f.friendly_name, status: f.status, created_at: f.created_at.toISOString() })),
    sessions_deleted: sessions,
    lock_cleared: Boolean(lock?.locked_at),
    flag_before: flagBefore,
    flag_after: false,
  };
  await client.query(
    `insert into public.audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
     values (null, null, $1, 'super_admin_factors_reset', 'user', $2, $3::jsonb)`,
    [`operator:${operator}`, target.id, JSON.stringify(metadata)],
  );
  await client.query("commit");
  console.log("Done: factors and sessions deleted, super_admin_aal2 OFF, one audit_log row written.");
  console.log("Next: sign in, re-enroll two factors at /security, then run enable-super-admin-aal2.mjs.");
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("\nERROR:", e.message);
  exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
process.exit(exitCode);
