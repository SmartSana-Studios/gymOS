// Adds session history to the EXISTING QA gym (no wipe, logins stay valid), so the dashboard has
// something to show: paid / consumed / blocked / refunded sessions across today and recent days.
//   node scripts/epic19-qa/demo-data.mjs
import { admin, psql, signIn, must } from "./lib.mjs";
import { randomUUID } from "node:crypto";
import { PW } from "./constants.mjs";

const gymId = psql(`select id from gyms where name = 'Epic19 QA Gym'`);
if (!gymId) throw new Error("run seed.mjs first");
const planId = psql(`select id from plans where gym_id = '${gymId}' and name = 'Pay per session'`);
const rec = await signIn("receptionist@epic19qa.test");
const mgr = await signIn("manager@epic19qa.test");
const owner = await signIn("owner@epic19qa.test");
const ownerUser = psql(`select user_id from members where gym_id = '${gymId}' and role = 'owner'`);

let n = psql(`select count(*) from members where gym_id = '${gymId}' and phone like '+23767190_1%'`) * 1 + 200;
async function member(name) {
  n += 1;
  const phone = `23767190${String(1000 + n).slice(-4)}`;
  const u = await admin.auth.admin.createUser({ phone, password: PW, phone_confirm: true });
  if (u.error) throw u.error;
  await admin.from("users").update({ must_change_password: false }).eq("id", u.data.user.id);
  const m = must(await admin.from("members").insert({ gym_id: gymId, user_id: u.data.user.id, role: "member", name, phone: `+${phone}` }).select("id").single(), name);
  must(await admin.from("subscriptions").insert({ gym_id: gymId, member_id: m.id, plan_id: planId, status: "active", start_date: new Date().toISOString().slice(0, 10) }), "sub");
  return { id: m.id, phone };
}
const pay = async (m, c = rec, method = "cash") => must(await c.rpc("record_session_payment", { p_member_id: m.id, p_method: method, p_reason: "demo" }), "pay");
const scan = async (m) => (await signIn(m.phone)).rpc("check_in", { p_client_scan_id: randomUUID() });
const refund = async (m) => {
  const p = psql(`select payment_id from guest_sessions where member_id = '${m.id}' order by created_at desc limit 1`);
  must(await owner.from("refunds").insert({ gym_id: gymId, payment_id: p, amount: 5000, reason: "demo refund", actor_id: ownerUser }), "refund");
};

const paidUnused = await member("Demo Paid Unused"); await pay(paidUnused);
const used1 = await member("Demo Used Today"); await pay(used1, mgr); await scan(used1);
const used2 = await member("Demo Used Transfer"); await pay(used2, mgr, "bank_transfer"); await scan(used2);
const blocked1 = await member("Demo Blocked One"); await scan(blocked1); await scan(blocked1);
const blocked2 = await member("Demo Blocked Two"); await scan(blocked2);
const refUnused = await member("Demo Refunded Unused"); await pay(refUnused); await refund(refUnused);
const refUsed = await member("Demo Refunded Used"); await pay(refUsed); await scan(refUsed); await refund(refUsed);
const lapsed = await member("Demo Lapsed"); await pay(lapsed);
psql(`update guest_sessions set usable_until = now() - interval '2 days' where member_id = '${lapsed.id}'`);

console.log("Added: 2 consumed (cash/transfer), 1 paid unused, 1 lapsed, 2 blocked members (3 attempts), 2 refunds (unused voided, used kept).");
