// Loyalty program switch + sweep for the QA gym (LOCAL). Usage:
//   node scripts/epic20-qa/program.mjs on [N K R]   default 4 3 10
//   node scripts/epic20-qa/program.mjs off          off keeps the stored N/K/R and every balance
//   node scripts/epic20-qa/program.mjs never        never-configured: enabled false + N/K/R null (first-time setup form)
//   node scripts/epic20-qa/program.mjs charging on|off   Charge guests per session (info line under Guests)
//   node scripts/epic20-qa/program.mjs sweep        run the daily loyalty_sweep job now (lapses + idle resets)
//   node scripts/epic20-qa/program.mjs status
import { psql, gymId, setProgram, N, K, R } from "./lib.mjs";
const [cmd, ...args] = process.argv.slice(2);
const gid = gymId();
const gymRow = () => psql(`select loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days, charge_guests_per_session from gyms where id = '${gid}'`);
switch (cmd) {
  case "on": { const [n = N, k = K, r = R] = args.map(Number); await setProgram(true, n, k, r); break; }
  case "off": await setProgram(false); break;
  case "never":
    psql(`begin; set local session_replication_role = replica;
      update gyms set loyalty_enabled = false, loyalty_guest_threshold = null, loyalty_renewal_threshold = null, loyalty_reward_days = null where id = '${gid}'; commit;`);
    break;
  case "charging":
    psql(`begin; set local session_replication_role = replica;
      update gyms set charge_guests_per_session = ${args[0] === "on"} where id = '${gid}'; commit;`);
    break;
  case "sweep": console.log(psql(`select run_loyalty_sweep_job()`)); console.log(psql(`select event_type, counter, count(*) from loyalty_events where gym_id = '${gid}' group by 1,2 order by 1,2`)); break;
  case "status": break;
  default: console.error("usage: program.mjs <on [N K R]|off|never|charging on|off|sweep|status>"); process.exit(2);
}
console.log("gym (enabled | N | K | R | charging):", gymRow());
