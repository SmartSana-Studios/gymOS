// Put a phone member into a known loyalty state (LOCAL QA). Usage: node scripts/epic20-qa/state.mjs <state> [A|B]
//   A = +237699000001 (guest, Pay per session), B = +237670000001 (subscriber, Monthly Standard). Default: A.
// Guest states (A):
//   fresh     0 / N, nothing held              almost    N-1 stamps + one unused paid session (scan -> reward)
//   mid       2 / N                            rewarded  reward already granted: 0 / N + one free session held
//   stale     2 stamps, last one 100 days ago (reads 0 / N)         lapsed  paid session lapsed yesterday
//   checkout  close the open check-in so you can scan again today
// Subscriber states (B):
//   sub-due        K-1 stamps, subscription expires today (renew in dashboard -> reward)
//   sub-fresh      0 stamps, expires today        sub-early  1 stamp, expires in 20 days (renew -> no stamp)
//   sub-late       1 stamp, expired 5 days ago    sub-rewarded  K-1 stamps then renewed on time (reward granted)
import { psql, admin, must, gymId, localToday, addDays, wipeMember, seedStamps, deskPay, scan, checkout, renew, PHONE_A, PHONE_B, N, K } from "./lib.mjs";

const [state, which = "A"] = process.argv.slice(2);
const phone = which.toUpperCase() === "B" ? PHONE_B : PHONE_A;
const usage = "usage: state.mjs <fresh|mid|almost|rewarded|stale|lapsed|checkout|sub-due|sub-fresh|sub-early|sub-late|sub-rewarded> [A|B]";
if (!state) { console.error(usage); process.exit(2); }

const gid = gymId();
const m = must(await admin.from("members").select("id").eq("phone", `+${phone}`).eq("gym_id", gid).single(), "member (run seed.mjs first)");
const planId = (name) => psql(`select id from plans where gym_id = '${gid}' and name = '${name}'`);
const today = localToday(gid);
const guestSub = () => psql(`insert into subscriptions (gym_id, member_id, plan_id, status, start_date) values ('${gid}', '${m.id}', '${planId("Pay per session")}', 'active', '${today}')`);
const monthlySub = (expiry, status = "active") => psql(`insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values ('${gid}', '${m.id}', '${planId("Monthly Standard")}', '${status === "active" && expiry <= addDays(today, 7) ? "expiring_soon" : status}', '${addDays(expiry, -30)}', '${expiry}')`);

if (state === "checkout") { checkout(m.id); }
else if (["fresh", "mid", "almost", "rewarded", "stale", "lapsed"].includes(state)) {
  wipeMember(m.id); guestSub();
  if (state === "mid") seedStamps(gid, m.id, "guest", 2, 3);
  if (state === "stale") seedStamps(gid, m.id, "guest", 2, 100);
  if (state === "almost" || state === "rewarded") { seedStamps(gid, m.id, "guest", N - 1, 2); await deskPay(m.id); }
  if (state === "rewarded") { await scan(phone); checkout(m.id); }
  if (state === "lapsed") { await deskPay(m.id); psql(`update guest_sessions set usable_until = now() - interval '1 day' where member_id = '${m.id}'`); }
} else if (state.startsWith("sub-")) {
  wipeMember(m.id);
  if (state === "sub-early") { monthlySub(addDays(today, 20)); seedStamps(gid, m.id, "subscriber", 1, 10); }
  else if (state === "sub-late") { monthlySub(addDays(today, -5), "expired"); seedStamps(gid, m.id, "subscriber", 1, 35); }
  else if (state === "sub-fresh") { monthlySub(today); }
  else if (state === "sub-due" || state === "sub-rewarded") {
    monthlySub(today); seedStamps(gid, m.id, "subscriber", K - 1, 25);
    if (state === "sub-rewarded") await renew(m.id);
  } else { console.error(usage); process.exit(2); }
} else { console.error(usage); process.exit(2); }
console.log(`phone ${which.toUpperCase()} (+${phone}) -> ${state}  (pull to refresh / revisit Home)`);
