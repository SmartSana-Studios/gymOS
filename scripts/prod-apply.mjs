#!/usr/bin/env node
// Apply V1.6 stage 1 migrations to the deployed project through a Node `pg` client.
//
// Why not scripts/deploy-0106-0110.sh: that one pipes SQL through the local DB container's psql, and
// containers in this devcontainer die silently on any network lookup (project_docker_no_network).
// This runs on the devcontainer itself, which does reach the pooler.
//
//   1a   0106, 0107, 0108, 0109   head must be 0105
//   1b   0110 ALONE               head must be 0109 (starts the 7-day soak before 0111)
//   2    0111, 0112, 0113, 0114, 0116   head must be 0110
//   3    0115 ALONE                     head must be 0116 (0116 shipped with stage 2; 0115 is the default flip)
//   4    0117-0120 loyalty              head must be 0116
//   5    0121 early renewal carry       head must be 0120 (Story 20.7)
//   4    0117, 0118, 0119, 0120         head must be 0116 (Epic 20 loyalty; every gym stays loyalty-off, the
//                                       hooks fire only when a gym enables it. Ship BEFORE the dashboard)
//
//   node scripts/prod-apply.mjs 1a --dry-run                      # ONE transaction, ROLLED BACK at the end
//   node scripts/prod-apply.mjs 1a --apply --backup-confirmed     # one transaction per migration
//
// --dry-run is the rehearsal on production-shaped data: every migration (including its own DO $verify$
// block) and the verification queries run inside a transaction that is rolled back, so nothing persists.
// It does take the migrations' table locks until the rollback (seconds on this data size).
// --apply requires --backup-confirmed: the operator asserts db-backup was triggered and finished green
// immediately before. Each migration commits together with its schema_migrations ledger row; the run
// stops at the first failure.
//
// pg client: `npm i pg@8` somewhere and set PG_MODULE_DIR=<dir>/node_modules (or have it in node_modules).
// Password: ~/.supabase-db-password (override PROD_PASSWORD_FILE); never printed.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);
function loadPg() {
  const tries = [process.env.PG_MODULE_DIR && join(process.env.PG_MODULE_DIR, "pg"), "pg"].filter(Boolean);
  for (const t of tries) { try { return req(t); } catch { /* next */ } }
  console.error("pg module not found. `npm i pg@8` in a temp dir and set PG_MODULE_DIR=<dir>/node_modules.");
  process.exit(2);
}
const { Client } = loadPg();

const [stage, ...flags] = process.argv.slice(2);
const dry = flags.includes("--dry-run");
const apply = flags.includes("--apply");
if (!["1a", "1b", "2", "3", "4", "5"].includes(stage) || dry === apply) {
  console.error("usage: prod-apply.mjs <1a|1b|2|3|4|5> (--dry-run | --apply --backup-confirmed)");
  process.exit(2);
}
if (apply && !flags.includes("--backup-confirmed")) {
  console.error("Refusing --apply without --backup-confirmed: trigger db-backup, wait for green, then pass it.");
  process.exit(2);
}

const PLAN = {
  "1a": { head: "0105", files: ["0106_flagged_payment_reason", "0107_charge_guests_setting_session_record", "0108_desk_session_payment", "0109_in_app_tara_session_payment"] },
  "1b": { head: "0109", files: ["0110_front_desk_alert_kind"] },
  "2": { head: "0110", files: ["0111_check_in_session_gate", "0112_class_attendance_session_gate", "0113_session_refunds_revenue_line", "0114_guest_sessions_overview_rpcs", "0116_session_alert_cooldown"] },
  "3": { head: "0116", files: ["0115_enable_charge_guests_default"] },
  "4": { head: "0116", files: ["0117_loyalty_program_ledger_foundation", "0118_loyalty_guest_rule", "0119_loyalty_subscriber_rule", "0120_loyalty_refund_reversal_lapse_sweep"],
    // A cron job the stage schedules gets one run right after the commit: job-runs-alert flags a job
    // that has never run once its allowance (27 h for a daily job) has passed, and the schedule is
    // usually later than the deploy. The functions are idempotent (Epic 20 retro P-1).
    firstRuns: [{ job: "loyalty_sweep", fn: "run_loyalty_sweep_job" }] },
  // Story 20.7: early renewal carries the remaining days. Two function bodies, no objects, no data.
  "5": { head: "0120", files: ["0121_early_renewal_carries_remaining_days"] },
}[stage];

const password = readFileSync(process.env.PROD_PASSWORD_FILE ?? join(homedir(), ".supabase-db-password"), "utf8").trim();
const client = new Client({
  host: process.env.PROD_HOST ?? "aws-0-eu-west-1.pooler.supabase.com",
  port: Number(process.env.PROD_PORT ?? 5432),
  user: process.env.PROD_USER ?? "postgres.vfxezibagiznrirdwkwh",
  database: process.env.PROD_DB ?? "postgres",
  password,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const show = async (title, sql) => {
  const r = await client.query(sql);
  console.log(`\n-- ${title}`);
  console.table(r.rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v === null ? "NULL" : String(v)]))));
};

const VERIFY = [
  ["head / members / payments / alerts / active alerts", `select (select max(version) from supabase_migrations.schema_migrations) as head,
     (select count(*) from members) as members, (select count(*) from payments) as payments,
     (select count(*) from front_desk_alerts) as alerts, (select count(*) from front_desk_alerts where dismissed_at is null) as active_alerts`],
  ["gyms with charging on (expect 0)", `select count(*) as n from gyms where to_jsonb(gyms) ? 'charge_guests_per_session' and (to_jsonb(gyms)->>'charge_guests_per_session')::boolean`],
  ["V1.6 RPCs present (1a: expect 5)", `select count(*) as n from pg_proc where pronamespace='public'::regnamespace and proname in ('record_session_payment','initiate_session_payment','set_guest_charging','guest_charging_impact','update_plan_pricing')`],
  ["alert kinds (1b: only subscription_status)", `select coalesce((select string_agg(distinct coalesce(to_jsonb(f)->>'kind', 'n/a (kind not added yet)'), ',') from front_desk_alerts f), 'no alerts') as kinds`],
  ["one-active alert index", `select coalesce(string_agg(indexname, ','), 'none') as idx from pg_indexes where tablename='front_desk_alerts' and indexname like 'idx_front_desk_alerts_one_active%'`],
  ["EXECUTE on V1.6 RPCs (anon must be false)", `select p.oid::regprocedure::text as fn, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
     from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('record_session_payment','initiate_session_payment','set_guest_charging','guest_charging_impact','update_plan_pricing','check_in') order by 1`],
  ["stage 2: V1.6 objects (expect session_attempts, consume fn, summary RPC, hold-back trigger, refund trigger)", `select
     (select count(*) from information_schema.tables where table_schema='public' and table_name='session_attempts') as session_attempts,
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('consume_guest_session','on_session_consumed','hold_back_repeat_session_alert','apply_session_refund')) as private_fns,
     (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('guest_sessions_summary','list_guest_sessions_paid','list_session_attempts','list_free_guest_sessions','gym_session_revenue_mtd')) as overview_rpcs,
     (select count(*) from pg_trigger where not tgisinternal and tgname in ('front_desk_alerts_hold_back_repeat_session_alert')) as cooldown_trigger`],
  ["stage 2: direct client writes revoked (expect all false) / anon EXECUTE on stage-2 functions (expect 0)", `select
     has_table_privilege('authenticated','public.attendance_events','INSERT') as att_insert,
     has_table_privilege('authenticated','public.attendance_events','UPDATE') as att_update,
     has_table_privilege('authenticated','public.attendance_events','DELETE') as att_delete,
     has_table_privilege('service_role','public.attendance_events','INSERT') as att_insert_service,
     has_column_privilege('authenticated','public.class_bookings','attended_at','UPDATE') as booking_attended_update,
     (select count(*) from pg_proc p where p.pronamespace in ('public'::regnamespace) and has_function_privilege('anon', p.oid, 'EXECUTE') and p.proname in ('check_in','mark_class_attendance','guest_sessions_summary','list_guest_sessions_paid','list_session_attempts','list_free_guest_sessions','gym_session_revenue_mtd','gym_revenue_mtd')) as anon_exec_count`],
  ["stage 3: charge_guests_per_session default (expect 'true' / NO) and existing gyms with the flag on (expect 0 -- 0115 must not change any existing gym)", `select
     (select column_default from information_schema.columns where table_schema='public' and table_name='gyms' and column_name='charge_guests_per_session') as col_default,
     (select is_nullable from information_schema.columns where table_schema='public' and table_name='gyms' and column_name='charge_guests_per_session') as nullable,
     (select count(*) from gyms where charge_guests_per_session) as gyms_with_charging_on,
     (select count(*) from gyms) as gyms_total`],
  ["stage 4: loyalty objects (expect tables 2, columns 4, setter+read+sweep fns 3, cron job 1)", `select
     (select count(*) from information_schema.tables where table_schema='public' and table_name in ('loyalty_events','loyalty_progress')) as tables,
     (select count(*) from information_schema.columns where table_schema='public' and table_name='gyms' and column_name in ('loyalty_enabled','loyalty_guest_threshold','loyalty_renewal_threshold','loyalty_reward_days')) as gym_columns,
     (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('set_loyalty_program','effective_loyalty','run_loyalty_sweep_job')) as public_fns,
     (select count(*) from cron.job where jobname='loyalty_sweep') as cron_job`],
  ["stage 5: renewal functions carry the remaining days (expect carries_confirm true, carries_webhook true, hook_kept true, anon_exec_count 0, authenticated_cvp false)", `select
     position('v_carried_from' in pg_get_functiondef('public.confirm_renewal(uuid, text, text, boolean)'::regprocedure)) > 0 as carries_confirm,
     position('v_prev_expiry' in pg_get_functiondef('public.complete_verified_payment(uuid, integer)'::regprocedure)) > 0 as carries_webhook,
     (position('award_renewal_stamp' in pg_get_functiondef('public.confirm_renewal(uuid, text, text, boolean)'::regprocedure)) > 0
      and position('award_renewal_stamp' in pg_get_functiondef('public.complete_verified_payment(uuid, integer)'::regprocedure)) > 0) as hook_kept,
     (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('confirm_renewal','complete_verified_payment') and has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_exec_count,
     has_function_privilege('authenticated', 'public.complete_verified_payment(uuid, integer)', 'EXECUTE') as authenticated_cvp`],
  ["stage 4: every gym loyalty-OFF (expect enabled 0) / clients cannot write the ledger (expect all false) / anon EXECUTE (expect 0)", `select
     (select count(*) from gyms where loyalty_enabled) as gyms_loyalty_on,
     has_table_privilege('authenticated','public.loyalty_events','INSERT') as events_insert,
     has_table_privilege('authenticated','public.loyalty_events','UPDATE') as events_update,
     has_table_privilege('authenticated','public.loyalty_progress','INSERT') as progress_insert,
     has_table_privilege('anon','public.loyalty_events','SELECT') as anon_select,
     (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('set_loyalty_program','effective_loyalty','run_loyalty_sweep_job','confirm_renewal','complete_verified_payment') and has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_exec_count`],
];

async function runMigration(base) {
  const v = base.slice(0, 4), name = base.slice(5);
  const sql = readFileSync(join(root, "supabase/migrations", `${base}.sql`), "utf8");
  process.stdout.write(`${v}  ${name.padEnd(46)} `);
  await client.query(sql);
  await client.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)", [v, name]);
  console.log(dry ? "ok (will roll back)" : "applied");
}

await client.connect();
let exitCode = 0;
try {
  const head = (await one("select max(version) as v from supabase_migrations.schema_migrations")).v;
  console.log(`=== stage ${stage} ${dry ? "DRY RUN (rolled back)" : "APPLY"}: head before ${head} (expected ${PLAN.head}) ===`);
  if (head !== PLAN.head) { console.error(`Expected head ${PLAN.head}; stopping without changing anything.`); process.exit(1); }
  await client.query("set lock_timeout = '10s'");
  await client.query("set statement_timeout = '120s'");
  const before = await one("select (select count(*) from members) m, (select count(*) from payments) p, (select count(*) from front_desk_alerts) a");
  console.log(`before: members ${before.m}, payments ${before.p}, alerts ${before.a}\n`);

  if (dry) {
    await client.query("begin");
    try {
      for (const f of PLAN.files) await runMigration(f);
      console.log("\n=== VERIFICATION inside the transaction ===");
      for (const [t, q] of VERIFY) await show(t, q);
    } finally {
      await client.query("rollback");
      console.log("\nROLLED BACK. Re-reading the head to prove nothing persisted:");
      console.log("head now:", (await one("select max(version) as v from supabase_migrations.schema_migrations")).v);
    }
  } else {
    for (const f of PLAN.files) {
      await client.query("begin");
      try {
        await runMigration(f);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback").catch(() => {});
        console.log("FAILED -- this migration was rolled back; stopping.");
        throw e;
      }
    }
    console.log("\n=== VERIFICATION (committed state) ===");
    for (const [t, q] of VERIFY) await show(t, q);
    for (const { job, fn } of PLAN.firstRuns ?? []) {
      const ran = await one("select count(*)::int n from job_runs where job_name = $1", [job]);
      if (ran.n === 0) await client.query(`select ${fn}()`);
      const last = await one("select status, started_at from job_runs where job_name = $1 order by started_at desc limit 1", [job]);
      console.log(`first run ${job}: ${ran.n === 0 ? "called" : "already ran"} -> latest ${last.status} at ${last.started_at.toISOString()}`);
    }
  }
} catch (e) {
  console.error("\nERROR:", e.message);
  exitCode = 1;
} finally {
  await client.end();
}
process.exit(exitCode);
