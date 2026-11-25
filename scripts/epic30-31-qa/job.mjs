// Server jobs, run by hand.
//   node scripts/epic30-31-qa/job.mjs settle      run the hourly settle job now
//   node scripts/epic30-31-qa/job.mjs reminder [--keep]   (--keep leaves today's dispatch claims, so a second run must send nothing: the one-per-day rule)  run the N-08 streak reminder job now. The real window is 18:00-21:00 gym-local, so the window is opened to the
//                                                 whole day for the run and put back, and today's dispatch claims of the QA gym are cleared so it can send again.
import { psql, gymId, gymHour } from "./lib.mjs";
const which = process.argv[2];
if (which === "settle") {
  psql("call private.engagement_settle_job();");
  console.log(psql("select status, coalesce(error,'') from public.job_runs where job_name like '%engagement_settle%' order by started_at desc limit 1") || "(no job_runs row)");
} else if (which === "reminder") {
  const g = gymId();
  const old = psql("select reminder_window_start_hour || ',' || reminder_window_end_hour from public.platform_engagement_config");
  console.log(`gym-local hour is ${gymHour()}; the configured window is ${old.replace(",", " to ")} (a run outside it sends nothing, which is the point of the window).`);
  psql(`begin; set local session_replication_role = replica;
        ${process.argv.includes("--keep") ? "" : `delete from private.engagement_reminder_dispatches where gym_id = '${g}';`}
        update public.platform_engagement_config set reminder_window_start_hour = 0, reminder_window_end_hour = 24; commit;`);
  try { psql("select private.run_engagement_reminder_job();"); }
  finally {
    const [s, e] = old.split(",");
    psql(`begin; set local session_replication_role = replica; update public.platform_engagement_config set reminder_window_start_hour = ${s}, reminder_window_end_hour = ${e}; commit;`);
  }
  console.log("N-08 history rows (a member only gets one if the week is at risk, they are not opted out, and today has no dispatch yet):");
  console.log(psql(`select m.name || ' | ' || n.type || ' | ' || n.title || ' | ' || n.body from public.notifications n join public.members m on m.id = n.member_id where n.gym_id = '${g}' and n.type = 'N-08' order by n.created_at desc limit 20`) || "(none)");
  console.log(psql("select 'last run: ' || status || ' ' || coalesce(error,'') from public.job_runs where job_name like '%engagement_reminder%' order by started_at desc limit 1"));
} else { console.error("usage: job.mjs settle|reminder"); process.exit(1); }
