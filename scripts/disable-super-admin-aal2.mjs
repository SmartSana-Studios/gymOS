#!/usr/bin/env node
// Story 22 retro item 54: turn the platform flag private.platform_flags('super_admin_aal2') OFF without
// touching anyone's factors or sessions. The only audited way to open a controlled bootstrap window, for
// example to add a new Super Admin (the in-app "Add admin" refuses while the flag is on). The window is
// the same weakness as the 22.6 first-factor window: keep it as short as possible and re-enable with
// scripts/enable-super-admin-aal2.mjs as soon as the new admin holds two factors (or one + recovery email).
//
//   node scripts/disable-super-admin-aal2.mjs                                 # dry run, rolled back
//   node scripts/disable-super-admin-aal2.mjs --apply --operator <name>       # asks for typed confirmation
//
// One transaction: flag update + one audit_log row (actor_id null, actor_display_name operator:<name>).
// Connection: see scripts/lib/operator-pg.mjs. Operator runbook: docs/runbooks/super-admin-recovery.md.
import { makeClient, parseArgs, confirmTyped, operatorName } from "./lib/operator-pg.mjs";

const { flags, values } = parseArgs(process.argv.slice(2), ["--operator"]);
const apply = flags.has("--apply");
const operator = operatorName(values);
if (apply && !operator) {
  console.error("usage: disable-super-admin-aal2.mjs [--apply --operator <name>]  (--apply requires --operator)");
  process.exit(2);
}

const CONFIRM = "disable super admin aal2";
const client = makeClient();
let exitCode = 0;
await client.connect();
try {
  await client.query("begin");
  await client.query("set local lock_timeout = '10s'");
  const flag = (await client.query(
    "select enabled from private.platform_flags where flag = 'super_admin_aal2' for update",
  )).rows[0];
  if (!flag) throw new Error("private.platform_flags has no super_admin_aal2 row (migration 0126 not applied?)");
  if (!flag.enabled) {
    console.log("super_admin_aal2 is already off. Nothing changed.");
    await client.query("rollback");
    process.exit(0);
  }

  const admins = Number((await client.query("select count(*) n from public.users where is_super_admin")).rows[0].n);
  console.log(`=== disable super_admin_aal2 ${apply ? "APPLY" : "DRY RUN (rolled back)"} ===`);
  console.log(`${admins} Super Admin account(s). Factors and sessions are NOT touched.`);
  console.log("While the flag is off, a password alone opens a Super Admin session. Keep the window short.");

  if (!apply) {
    console.log("Dry run: rolling back, nothing changed.");
    await client.query("rollback");
    process.exit(0);
  }
  if (!(await confirmTyped(CONFIRM))) {
    console.error("Confirmation did not match. Rolled back, nothing changed.");
    await client.query("rollback");
    process.exit(1);
  }

  await client.query("update private.platform_flags set enabled = false where flag = 'super_admin_aal2'");
  await client.query(
    `insert into public.audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
     values (null, null, $1, 'super_admin_aal2_disabled', 'platform_flag', 'super_admin_aal2', $2::jsonb)`,
    [`operator:${operator}`, JSON.stringify({ operator, super_admins: admins })],
  );
  await client.query("commit");
  console.log("super_admin_aal2 is now OFF. One audit_log row written. Re-enable it as soon as the window is not needed.");
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("\nERROR:", e.message);
  exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
process.exit(exitCode);
