// Epic 27 local QA seed. LOCAL Supabase only. Idempotent: wipes and recreates "Epic19 QA Gym" (the Epic 19 world), then adds the
// members Epic 27 needs: every staff check-in outcome (R1-R8), the Void flow, and Correct plan (F1-F12).
//   node scripts/epic27-qa/seed.mjs
import { buildWorld, psql, must, admin, daysFromNow, PW } from "../epic19-qa/lib.mjs";
import { SESSION_PRICE } from "../epic19-qa/constants.mjs";

const w = await buildWorld();
// A gym-access monthly plan (the Epic 19 one is class-only): used by the check-in members and as the Correct plan target.
const monthlyPlus = must(await admin.from("plans").insert({
  gym_id: w.gym.id, name: "Monthly Plus", plan_type: "monthly", price: 25000, currency: "XAF", billing_interval: "monthly", duration_days: 30,
}).select("id").single(), "monthly plan").id;
const rows = [];
const add = (name, state, use) => rows.push({ name, state, use });

// Pay-per-session members (Epic 19 plans).
const base = async (label, name, opts, use) => { await w.member(name, opts); add(name, label, use); };
await base("pay-per-session, no session", "Blocked Bea", {}, "Check in -> R5 'session required' (5,000 XAF)");
const pat = await w.member("Paid Pat", {});
must(await w.clients.receptionist.rpc("record_session_payment", { p_member_id: pat.id, p_method: "cash", p_reason: "QA seed receipt" }), "pat session");
add("Paid Pat", "pay-per-session, one unused PAID session", "Check in -> R1; then Void as Manager -> the session is given back");

// Annual plan like the e2e one (250,000 XAF, 365 days, annual interval).
const annual = must(await admin.from("plans").insert({
  gym_id: w.gym.id, name: "Annual Standard", plan_type: "monthly", price: 250000, currency: "XAF",
  billing_interval: "annual", annual_discount_percent: 15, duration_days: 365,
}).select("id").single(), "annual plan").id;

const custom = async (name, { planId = monthlyPlus, status = "active", startOffset = 0, expiryOffset = 30 } = {}) => {
  const m = await w.member(name, { sub: null });
  if (planId) {
    must(await admin.from("subscriptions").insert({
      gym_id: w.gym.id, member_id: m.id, plan_id: planId, status,
      start_date: daysFromNow(startOffset), expiry_date: expiryOffset === null ? null : daysFromNow(expiryOffset),
    }), `sub ${name}`);
  }
  return m;
};
const subId = (m) => psql(`select id from subscriptions where member_id = '${m.id}' order by created_at desc limit 1`);
const pay = async (m, status, amount = 250000) => must(await admin.from("payments").insert({
  gym_id: w.gym.id, member_id: m.id, subscription_id: subId(m), amount, currency: "XAF", method: "cash", status, purpose: "subscription",
}), `payment ${m.name}`);

await custom("Monthly Mo");
add("Monthly Mo", "Monthly Plus, active", "Check in -> R1; check in again -> R7 'already checked in'");
await custom("Expired Eve", { status: "expired", startOffset: -60, expiryOffset: -30 });
add("Expired Eve", "Monthly Plus, expired 30 days ago", "Check in -> R4 expired, then Renew inside the modal -> R6");
await custom("Expiring Ed", { status: "expiring_soon", expiryOffset: 3 });
add("Expiring Ed", "monthly, expires in 3 days", "Check in -> R2 (admitted with an expiry warning)");
await custom("Grace Gus", { status: "grace_period", startOffset: -32, expiryOffset: -2 });
add("Grace Gus", "monthly, expired 2 days ago, in grace", "Check in -> R3 (admitted, grace ends on ...)");
const dan = await custom("Deactivated Dan");
psql(`update members set deactivated_at = now() where id = '${dan.id}'`);
add("Deactivated Dan", "deactivated", "Check in -> R8 refused (deactivated); NO [Correct plan] button on his row or View modal");
await custom("No-plan Nora", { planId: null });
add("No-plan Nora", "no subscription", "Check in -> R8 refused (no plan)");

const ann = await custom("Annual Ann", { planId: annual, expiryOffset: 365 });
add("Annual Ann", "Annual plan, NO payment", "Correct plan -> Monthly: allowed, new expiry counted from the start date");
const paula = await custom("Paid Paula", { planId: annual, expiryOffset: 365 });
await pay(paula, "verified");
add("Paid Paula", "Annual plan, VERIFIED payment", "Correct plan -> F1 block with [Open payments]");
const pia = await custom("Pending Pia", { planId: annual, expiryOffset: 365 });
await pay(pia, "pending");
add("Pending Pia", "Annual plan, PENDING payment", "Correct plan -> a block (a payment is still waiting), no form");
const sam = await custom("Session Sam", { planId: annual, expiryOffset: 365 });
add("Session Sam", "Annual plan, NO payment (spare)", "Correct plan -> 'Pay per session' target; also the reason-too-short / same-plan checks");

console.log(`\nEpic 27 QA ready on "Epic19 QA Gym" (id ${w.gym.id}). Plans: Pay per session ${SESSION_PRICE} XAF, Free-entry session plan, Monthly Plus 25,000 XAF/30 d (gym access), Annual Standard 250,000 XAF/365 d.`);
console.log(`Dashboard logins, password ${PW}: owner@ supervisor@ manager@ receptionist@ coach@ + epic19qa.test`);
console.table(rows);
