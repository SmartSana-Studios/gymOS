// Put a phone-testable member into a known state (LOCAL QA). Usage:
//   node scripts/epic19-qa/state.mjs <state> [A|B]        (default A = +237699000001, B = +237670000001)
// States:
//   none      no session, no attempts, no alerts, active per-session plan  (scan -> "Pay for your session")
//   paid      one unused paid session recorded at the desk                 (scan -> allowed, session consumed)
//   used      paid session already consumed today                          (scan again -> still allowed, "covered")
//   lapsed    paid session that lapsed yesterday                           (scan -> blocked)
//   exempt    switched to the price-0 per-session plan                     (scan always allowed)
//   expired   subscription expired                                         (old expired-subscription screen)
//   checkout  close the member's open check-in                             (so you can scan again today)
import { admin, psql, signIn, must } from "./lib.mjs";
import { PHONE_A, PHONE_B } from "./constants.mjs";

const [state, which = "A"] = process.argv.slice(2);
const phone = which.toUpperCase() === "B" ? PHONE_B : PHONE_A;
if (!state) { console.error(__usage()); process.exit(2); }
function __usage() { return "usage: state.mjs <none|paid|used|lapsed|exempt|expired|checkout> [A|B]"; }

const m = must(await admin.from("members").select("id, gym_id").eq("phone", `+${phone}`).single(), "member (run seed.mjs first)");
const planId = (name) => psql(`select id from plans where gym_id = '${m.gym_id}' and name = '${name}'`);

function wipe() {
  psql(`begin; set local session_replication_role = replica;
    delete from guest_sessions where member_id = '${m.id}';
    delete from session_attempts where member_id = '${m.id}';
    delete from front_desk_alerts where member_id = '${m.id}';
    delete from attendance_events where member_id = '${m.id}';
    delete from refunds where payment_id in (select id from payments where member_id = '${m.id}' and purpose = 'session');
    delete from payments where member_id = '${m.id}' and purpose = 'session';
    update subscriptions set plan_id = '${planId("Pay per session")}', status = 'active', expiry_date = null where member_id = '${m.id}';
  commit;`);
}
async function deskPay() {
  const rec = await signIn("receptionist@epic19qa.test");
  must(await rec.rpc("record_session_payment", { p_member_id: m.id, p_method: "cash", p_reason: "QA state.mjs" }), "record_session_payment");
}
async function scanAsMember() {
  const c = await signIn(phone);
  must(await c.rpc("check_in", { p_client_scan_id: crypto.randomUUID() }), "check_in");
}

switch (state) {
  case "none": wipe(); break;
  case "paid": wipe(); await deskPay(); break;
  case "used": wipe(); await deskPay(); await scanAsMember(); psql(`update attendance_events set checked_out_at = now() where member_id = '${m.id}' and checked_out_at is null`); break;
  case "lapsed": wipe(); await deskPay(); psql(`update guest_sessions set usable_until = now() - interval '1 day' where member_id = '${m.id}'`); break;
  case "exempt": wipe(); psql(`update subscriptions set plan_id = '${planId("Free-entry session plan")}' where member_id = '${m.id}'`); break;
  case "expired": wipe(); psql(`update subscriptions set status = 'expired' where member_id = '${m.id}'`); break;
  case "checkout": psql(`update attendance_events set checked_out_at = now() where member_id = '${m.id}' and checked_out_at is null`); break;
  default: console.error(__usage()); process.exit(2);
}
console.log(`phone ${which.toUpperCase()} (+${phone}) -> ${state}`);
