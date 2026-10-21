// Epic 23 QA: move the clock for the time-based lifecycle rules, run the cron bodies by hand, show state. LOCAL DB only.
//   node scripts/epic23-qa/lifecycle.mjs status                 # accounts, assignments, resets at a glance
//   node scripts/epic23-qa/lifecycle.mjs age <handle> <days>    # pretend the person last acted <days> ago (e.g. active 40)
//   node scripts/epic23-qa/lifecycle.mjs sweep                  # inactivity sweep (30 d) as the 03:10 cron runs it
//   node scripts/epic23-qa/lifecycle.mjs recert-due <handle>    # make recertification overdue now
//   node scripts/epic23-qa/lifecycle.mjs reset-due <handle>     # end the 30-minute cooling-off now, mark the reset due
//   node scripts/epic23-qa/lifecycle.mjs digest                 # the daily support activity digest to Owners
//   node scripts/epic23-qa/lifecycle.mjs drift                  # the nightly contact drift check
import { psql } from "./lib.mjs";

const [cmd, handle, arg] = process.argv.slice(2);
const uid = (h) => {
  const id = psql(`select id from auth.users where email = 'qa23-${h}@gymosapps.com'`);
  if (!id) throw new Error(`no qa23-${h}@gymosapps.com (handles: active second idle recert reset locked fresh)`);
  return id;
};
const table = (sql) => console.log(psql(`select * from (${sql}) t`).replaceAll("|", " | "));

switch (cmd) {
  case "status":
    console.log("-- accounts");
    console.log(psql(`select au.email, case when sa.deactivated_at is not null then 'deactivated' when sa.locked_at is not null then 'LOCKED:'||coalesce(sa.locked_reason,'') when sa.reset_pending_at is not null then 'reset pending' when sa.activated_at is null then 'inactive' else 'active' end,
      coalesce(to_char(la.last_active_at,'MM-DD HH24:MI'),'-'), coalesce(to_char(sa.recertify_due_at,'MM-DD'),'-')
      from private.support_accounts sa join auth.users au on au.id=sa.user_id left join private.support_last_active la on la.user_id=sa.user_id order by 1`).replaceAll("|", "  |  "));
    console.log("-- assignments (email | gym | state)");
    console.log(psql(`select au.email, g.name, a.state from support_assignments a join auth.users au on au.id=a.support_user_id join gyms g on g.id=a.gym_id order by 1,2`).replaceAll("|", "  |  "));
    console.log("-- factor resets (email | state | executes_at)");
    console.log(psql(`select au.email, r.state, to_char(r.executes_at,'MM-DD HH24:MI') from private.support_factor_resets r join auth.users au on au.id=r.user_id order by r.started_at`).replaceAll("|", "  |  ") || "(none)");
    break;
  case "age":
    if (!handle || !arg) throw new Error("usage: age <handle> <days>");
    psql(`insert into private.support_last_active (user_id, last_active_at) values ('${uid(handle)}', now() - make_interval(days => ${Number(arg)}))
          on conflict (user_id) do update set last_active_at = excluded.last_active_at`);
    // The sweep's clock starts at the newest ACTIVE assignment too, so move that back with it.
    psql(`begin; set local session_replication_role = replica; update support_assignments set activated_at = least(activated_at, now() - make_interval(days => ${Number(arg)})) where support_user_id = '${uid(handle)}' and state = 'active'; commit;`);
    console.log(`${handle}: last active ${arg} days ago`);
    break;
  case "sweep":
    psql(`select private.support_inactivity_sweep()`);
    console.log(psql(`select job_name||': '||status||coalesce(' '||error,'') from job_runs where job_name = 'support_inactivity_sweep' order by started_at desc limit 1`));
    break;
  case "recert-due":
    psql(`update private.support_accounts set recertify_due_at = now() - interval '1 minute' where user_id = '${uid(handle)}'`);
    console.log(`${handle}: recertification overdue`);
    break;
  case "reset-due":
    psql(`update private.support_factor_resets set executes_at = now() - interval '1 minute' where user_id = '${uid(handle)}' and state = 'cooling_off'`);
    psql(`select private.support_factor_reset_mark_due()`);
    console.log(`${handle}: reset marked due. Super Admin -> GymOS support -> "Run due resets" (or the executor route) to execute it.`);
    break;
  case "digest":
    psql(`select private.support_activity_digest()`);
    console.log("digest run: Owners' notifications / history show it");
    break;
  case "drift":
    psql(`select private.support_contact_drift_check()`);
    console.log("drift check run");
    break;
  default:
    console.log("commands: status | age <handle> <days> | sweep | recert-due <handle> | reset-due <handle> | digest | drift");
}
