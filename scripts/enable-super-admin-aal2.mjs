#!/usr/bin/env node
// Story 22.6: flip the platform flag private.platform_flags('super_admin_aal2') ON, once, and only
// when every Super Admin holds exactly two verified TOTP factors.
//
//   node scripts/enable-super-admin-aal2.mjs                                   # dry run, rolled back
//   node scripts/enable-super-admin-aal2.mjs --apply --operator <name>         # asks for typed confirmation
//
// One transaction: flag update + one audit_log row (actor_id null, actor_display_name operator:<name>).
// Prints factor friendly names and created_at, never a secret (auth.mfa_factors.secret is not selected).
// Connection: see scripts/lib/operator-pg.mjs. Operator runbook: docs/runbooks/super-admin-recovery.md.
import { makeClient, parseArgs, confirmTyped, operatorName } from "./lib/operator-pg.mjs";

const { flags, values } = parseArgs(process.argv.slice(2), ["--operator"]);
const apply = flags.has("--apply");
const operator = operatorName(values);
if (apply && !operator) {
  console.error("usage: enable-super-admin-aal2.mjs [--apply --operator <name>]  (--apply requires --operator)");
  process.exit(2);
}

const CONFIRM = "enable super admin aal2";
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
  if (flag.enabled) {
    console.log("super_admin_aal2 is already on. Nothing changed.");
    await client.query("rollback");
    process.exit(0);
  }

  const admins = (await client.query(
    `select u.id, au.email, count(f.id) filter (where f.status = 'verified') as verified,
            count(f.id) filter (where f.status <> 'verified') as unverified
       from public.users u
       left join auth.users au on au.id = u.id
       left join auth.mfa_factors f on f.user_id = u.id and f.factor_type = 'totp'
      where u.is_super_admin
      group by u.id, au.email
      order by au.email`,
  )).rows;
  const factors = (await client.query(
    `select f.id, f.user_id, f.friendly_name, f.status, f.created_at
       from auth.mfa_factors f join public.users u on u.id = f.user_id
      where u.is_super_admin and f.factor_type = 'totp'
      order by f.user_id, f.created_at`,
  )).rows;

  console.log(`=== enable super_admin_aal2 ${apply ? "APPLY" : "DRY RUN (rolled back)"} ===`);
  const short = [];
  for (const a of admins) {
    const verified = Number(a.verified);
    console.log(`\n${a.email ?? a.id}: ${verified} verified, ${a.unverified} unverified TOTP factor(s)`);
    for (const f of factors.filter((x) => x.user_id === a.id)) {
      console.log(`  - ${f.friendly_name || "(unnamed)"}  [${f.status}]  created ${f.created_at.toISOString()}`);
    }
    if (verified !== 2) short.push(`${a.email ?? a.id} has ${verified} verified (needs exactly 2)`);
  }
  if (admins.length === 0) short.push("no Super Admin account exists");

  if (short.length > 0) {
    console.error("\nREFUSED, flag unchanged:");
    for (const s of short) console.error(`  - ${s}`);
    await client.query("rollback");
    process.exit(1);
  }
  console.log("\nVerdict: every Super Admin has exactly two verified TOTP factors.");

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

  await client.query("update private.platform_flags set enabled = true where flag = 'super_admin_aal2'");
  const metadata = {
    operator,
    super_admins: admins.length,
    factor_count: factors.filter((f) => f.status === "verified").length,
    factors: factors.filter((f) => f.status === "verified").map((f) => ({
      id: f.id, user_id: f.user_id, friendly_name: f.friendly_name, created_at: f.created_at.toISOString(),
    })),
  };
  await client.query(
    `insert into public.audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
     values (null, null, $1, 'super_admin_aal2_enabled', 'platform_flag', 'super_admin_aal2', $2::jsonb)`,
    [`operator:${operator}`, JSON.stringify(metadata)],
  );
  await client.query("commit");
  console.log("super_admin_aal2 is now ON. One audit_log row written.");
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("\nERROR:", e.message);
  exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
process.exit(exitCode);
