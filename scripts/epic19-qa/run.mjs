// Epic 19 end-to-end runner. LOCAL Supabase only. Real users, real JWTs, real RLS, real RPCs, and the
// real payment-webhook edge function fed by a fake Tara (so no mobile app and no Tara sandbox needed).
//
//   scripts/epic19-qa/start-edge-functions.sh      # once: edge runtime with Tara -> fake provider
//   node scripts/epic19-qa/run.mjs                 # builds the world, runs every scenario, exit 1 on failure
//
// What it does NOT cover: camera scanning, the member app's overlays (use the phone / README), and the
// dashboard UI (README click-through). The gate itself is the check_in() RPC the app calls after a scan.
import { randomUUID } from "node:crypto";
import { buildWorld, psql, signIn, must, ANON_KEY } from "./lib.mjs";
import { startFakeTara } from "./fake-tara.mjs";
import { FAKE_TARA_URL, SESSION_PRICE, TARA, OTHER_TARA } from "./constants.mjs";

// ---------------------------------------------------------------------------- tiny harness
let pass = 0, fail = 0, current = "";
const failures = [];
function check(label, ok, detail = "") {
  if (ok) { pass += 1; console.log(`  ok    ${label}`); }
  else { fail += 1; failures.push(`${current} :: ${label}${detail ? ` -- ${detail}` : ""}`); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
}
async function scenario(name, fn) {
  current = name;
  console.log(`\n${name}`);
  try { await fn(); } catch (e) { fail += 1; failures.push(`${name} :: threw ${e.message}`); console.log(`  FAIL  threw: ${e.message}`); }
}
const rows = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const one = (sql) => rows(sql)[0] ?? null;
const sessions = (memberId) => rows(`select * from guest_sessions where member_id = '${memberId}' order by created_at`);
const attempts = (memberId) => rows(`select * from session_attempts where member_id = '${memberId}' order by created_at`);
const activeAlerts = (memberId, kind = "session_required") =>
  rows(`select * from front_desk_alerts where member_id = '${memberId}' and kind = '${kind}' and dismissed_at is null`);
const payment = (id) => one(`select * from payments where id = '${id}'`);
const audit = (action, memberId) =>
  Number(psql(`select count(*) from audit_log where action_type = '${action}'${memberId ? ` and (metadata->>'member_id' = '${memberId}' or target_entity_id = '${memberId}')` : ""}`));
const blocked = (d) => d == null || d.id == null;
const errText = (r) => (r.error ? `${r.error.message}` : "");

// ---------------------------------------------------------------------------- fake Tara
async function ensureFakeTara() {
  try { await startFakeTara({ anonKey: ANON_KEY }); console.log(`fake Tara started in-process on ${FAKE_TARA_URL}`); }
  catch (e) { if (e.code !== "EADDRINUSE") throw e; console.log(`fake Tara already running on ${FAKE_TARA_URL} (reusing it)`); }
}
const fire = async (body) => (await fetch(`${FAKE_TARA_URL}/fire`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

// ---------------------------------------------------------------------------- world
await ensureFakeTara();
const w = await buildWorld();
const { clients: C, staff } = w;
const M = {}; // member clients by id
async function newMember(name, opts) {
  const m = await w.member(name, opts);
  M[m.id] = await signIn(m.phone);
  return { ...m, c: M[m.id] };
}
const scan = (m, args = {}) => m.c.rpc("check_in", { p_client_scan_id: randomUUID(), ...args });
const deskPay = (member, method = "cash", by = "receptionist") => C[by].rpc("record_session_payment", { p_member_id: member.id, p_method: method, p_reason: "QA desk" });
async function startTara(m) {
  const init = await m.c.rpc("initiate_session_payment");
  const row = Array.isArray(init.data) ? init.data[0] : null;
  if (init.error || !row) return { init, paymentId: null };
  const inv = await m.c.functions.invoke("payment-webhook/initiate/taramoney", { body: { paymentId: row.payment_id, phoneNumber: m.phone } });
  return { init, inv, paymentId: row.payment_id };
}

// ---------------------------------------------------------------------------- scenarios
await scenario("S0 setting: default on for a new gym, owner/supervisor only, audited, impact count", async () => {
  check("0115: a gym created now has charging ON", w.gym.charge_guests_per_session === true);
  const mgr = await C.manager.rpc("set_guest_charging", { p_enabled: false });
  check("manager cannot change the setting", !!mgr.error, errText(mgr));
  const rec = await C.receptionist.rpc("set_guest_charging", { p_enabled: false });
  check("receptionist cannot change the setting", !!rec.error, errText(rec));
  const before = Number(psql(`select count(*) from audit_log where gym_id = '${w.gym.id}'`));
  check("owner turns it off", !(await C.owner.rpc("set_guest_charging", { p_enabled: false })).error);
  check("flag is off in the DB", psql(`select charge_guests_per_session from gyms where id = '${w.gym.id}'`) === "f");
  check("supervisor turns it back on", !(await C.supervisor.rpc("set_guest_charging", { p_enabled: true })).error);
  check("flag is on in the DB", psql(`select charge_guests_per_session from gyms where id = '${w.gym.id}'`) === "t");
  const after = Number(psql(`select count(*) from audit_log where gym_id = '${w.gym.id}'`));
  check("both changes were audited", after >= before + 2, `audit rows ${before} -> ${after}`);
  const direct = await C.owner.from("gyms").update({ charge_guests_per_session: false }).eq("id", w.gym.id);
  check("direct UPDATE of the flag cannot flip it", psql(`select charge_guests_per_session from gyms where id = '${w.gym.id}'`) === "t", errText(direct));
  const impact = await C.owner.rpc("guest_charging_impact");
  check("guest_charging_impact answers for the owner", !impact.error, errText(impact));
});

const bea = await newMember("S1 Bea");
await scenario("S1 blocked scan: null result, one attempt per scan id, one alert", async () => {
  const scanId = randomUUID();
  const r1 = await scan(bea, { p_client_scan_id: scanId });
  check("check_in returns null (old-app contract: never a coded row)", !r1.error && blocked(r1.data), JSON.stringify(r1.data ?? r1.error));
  check("no attendance row was written", rows(`select 1 from attendance_events where member_id = '${bea.id}'`).length === 0);
  check("one blocked attempt recorded", attempts(bea.id).length === 1);
  check("one active session_required alert", activeAlerts(bea.id).length === 1);
  const r2 = await scan(bea, { p_client_scan_id: scanId });
  check("same scan id again is still blocked", blocked(r2.data));
  check("... and is counted once", attempts(bea.id).length === 1);
  const r3 = await scan(bea);
  check("a different scan id is a second attempt", blocked(r3.data) && attempts(bea.id).length === 2);
  check("... but still one active alert", activeAlerts(bea.id).length === 1);
  check("alert is not the expired-subscription kind", activeAlerts(bea.id, "subscription_status").length === 0);
  check("blocked attempts are audited", audit("session_attempt_blocked", bea.id) >= 1 || audit("check_in_session_required", bea.id) >= 1 || Number(psql(`select count(*) from audit_log where gym_id = '${w.gym.id}' and action_type ilike '%attempt%'`)) >= 1);
});

await scenario("S1b alert cooldown: no new desk alert right after a dismissal, attempts still counted", async () => {
  const m = await newMember("S1b Repeat");
  await scan(m);
  check("first refusal raises one alert", activeAlerts(m.id).length === 1);
  psql(`update front_desk_alerts set dismissed_at = now() where member_id = '${m.id}' and kind = 'session_required' and dismissed_at is null`);
  await scan(m); await scan(m);
  check("scans after the dismissal raise no new alert", activeAlerts(m.id).length === 0);
  check("... but every scan is still a blocked attempt", attempts(m.id).length === 3);
});

await scenario("S2 desk payment: amount from the plan, role limits, then the scan consumes it", async () => {
  const bank = await deskPay(bea, "bank_transfer", "receptionist");
  check("receptionist cannot record Bank Transfer", !!bank.error, errText(bank));
  const coach = await deskPay(bea, "cash", "coach");
  check("coach cannot record a session payment", !!coach.error, errText(coach));
  const cross = await w.otherOwner.rpc("record_session_payment", { p_member_id: bea.id, p_method: "cash", p_reason: "x" });
  check("another gym's owner cannot", !!cross.error, errText(cross));
  const pay = await deskPay(bea, "cash", "receptionist");
  check("receptionist records a cash session payment", !pay.error, errText(pay));
  const s = sessions(bea.id);
  check("one usable, unconsumed paid session", s.length === 1 && s[0].consumed_at === null && s[0].payment_id !== null);
  const p = payment(s[0]?.payment_id);
  check("payment: purpose session, verified, cash, plan price", p?.purpose === "session" && p?.status === "verified" && p?.method === "cash" && p?.amount === SESSION_PRICE, JSON.stringify(p));
  const days = (new Date(s[0].usable_until) - Date.now()) / 86400000;
  check("usable for 7 days", days > 6.9 && days <= 7.01, String(days));
  const dup = await deskPay(bea, "cash", "receptionist");
  check("a second desk payment while one is unused is refused or harmless", dup.error ? true : sessions(bea.id).length <= 2);
  const ok = await scan(bea);
  check("scan now passes (attendance row returned)", !ok.error && !blocked(ok.data), JSON.stringify(ok.error ?? ok.data));
  const used = sessions(bea.id).filter((x) => x.consumed_at);
  check("exactly one session consumed, with a covered day", used.length === 1 && used[0].covered_day);
  psql(`update attendance_events set checked_out_at = now() where member_id = '${bea.id}' and checked_out_at is null`);
  const again = await scan(bea);
  check("second scan the same day is covered, no second session", !again.error && !blocked(again.data) && sessions(bea.id).filter((x) => x.consumed_at && !x.voided_at).length === 1, JSON.stringify(again.error));
  const mgrM = await newMember("S2 transfer");
  check("manager CAN record Bank Transfer", !(await deskPay(mgrM, "bank_transfer", "manager")).error);
});

await scenario("S3 in-app Tara: initiate, duplicate refused, fake webhook completes, replay is idempotent", async () => {
  const m = await newMember("S3 Tara");
  const { init, inv, paymentId } = await startTara(m);
  check("initiate_session_payment returns a payment + provider", !!paymentId, errText(init));
  const p0 = payment(paymentId);
  check("payment is processing, purpose session, plan amount", p0?.status === "processing" && p0?.purpose === "session" && p0?.amount === SESSION_PRICE, JSON.stringify(p0));
  check("edge initiate reached the fake provider (ref set)", !inv?.error && String(payment(paymentId)?.provider_transaction_ref ?? "").startsWith("FAKE-"),
    `${inv?.error?.message ?? ""} ref=${payment(paymentId)?.provider_transaction_ref} (is the edge runtime started via epic19-qa/start-edge-functions.sh?)`);
  const dup = await m.c.rpc("initiate_session_payment");
  check("a second initiate is refused: payment in progress", /session_payment_already_in_progress/.test(errText(dup)), errText(dup));
  check("no session before confirmation", sessions(m.id).length === 0);
  const f = await fire({ productId: paymentId, outcome: "success" });
  check("webhook accepted the callback (200)", f.webhookStatus === 200, JSON.stringify(f));
  const p1 = payment(paymentId);
  check("payment verified, fee captured", p1?.status === "verified" && p1?.provider_fee_amount > 0, JSON.stringify(p1));
  check("one session created for the payment", sessions(m.id).length === 1 && sessions(m.id)[0].payment_id === paymentId);
  const f2 = await fire({ productId: paymentId, outcome: "success" });
  check("duplicate delivery acknowledged", f2.webhookStatus === 200);
  check("... and creates no second session", sessions(m.id).length === 1);
  const ok = await scan(m);
  check("member scan consumes it", !blocked(ok.data) && sessions(m.id)[0].consumed_at !== null);
});

await scenario("S3b declined payment: flagged, no session, member can retry", async () => {
  const m = await newMember("S3b Declined");
  const { paymentId } = await startTara(m);
  const f = await fire({ productId: paymentId, outcome: "failed" });
  check("webhook accepted the decline", f.webhookStatus === 200);
  const p = payment(paymentId);
  check("payment flagged: provider_declined", p?.status === "flagged" && p?.flagged_reason === "provider_declined", JSON.stringify(p));
  check("no session", sessions(m.id).length === 0);
  const retry = await startTara(m);
  check("member can start a fresh attempt", !!retry.paymentId && retry.paymentId !== paymentId, errText(retry.init));
});

await scenario("S3c late confirmation: expired attempt, then success -> verified, session created, audited", async () => {
  const m = await newMember("S3c Late");
  const first = await startTara(m);
  psql(`update payments set created_at = now() - interval '11 minutes' where id = '${first.paymentId}'`);
  const second = await m.c.rpc("initiate_session_payment"); // expiry flags the stale attempt first
  check("a new attempt is allowed after expiry", !second.error, errText(second));
  check("stale attempt flagged expired_attempt", payment(first.paymentId)?.status === "flagged" && payment(first.paymentId)?.flagged_reason === "expired_attempt");
  const f = await fire({ productId: first.paymentId, outcome: "success" });
  check("late success accepted", f.webhookStatus === 200, JSON.stringify(f));
  const p = payment(first.paymentId);
  check("late payment verified with reason late_confirmation", p?.status === "verified" && p?.flagged_reason === "late_confirmation", JSON.stringify(p));
  check("the money created a session", sessions(m.id).filter((s) => s.payment_id === first.paymentId).length === 1);
  check("late payment audited", audit("session_late_payment", m.id) >= 1 || Number(psql(`select count(*) from audit_log where action_type = 'session_late_payment'`)) >= 1);
});

await scenario("S3d wrong account / forged callback never creates a session", async () => {
  const m = await newMember("S3d Wrong");
  const { paymentId } = await startTara(m);
  const forged = await fire({ productId: paymentId, outcome: "success", secret: "not-the-secret" });
  check("wrong secret -> 401", forged.webhookStatus === 401, JSON.stringify(forged));
  const other = await fire({ productId: paymentId, outcome: "success", businessId: OTHER_TARA.businessId, secret: OTHER_TARA.webhookSecret });
  check("another gym's account delivering our payment is refused", other.webhookStatus === 200, JSON.stringify(other));
  check("payment untouched (still processing)", payment(paymentId)?.status === "processing", JSON.stringify(payment(paymentId)));
  check("no session created", sessions(m.id).length === 0);
});

await scenario("S4 class attendance consumes a session; booking stays free", async () => {
  const m = await newMember("S4 Class");
  const book = await m.c.rpc("book_class_session", { p_class_session_id: w.classSessionId });
  check("booking is free (no session needed)", !book.error, errText(book));
  const bookingId = rows(`select id from class_bookings where member_id = '${m.id}'`)[0]?.id;
  const coach = await C.coach.rpc("mark_class_attendance", { p_booking_id: bookingId });
  check("coach cannot mark attendance", !!coach.error, errText(coach));
  const r = await C.manager.rpc("mark_class_attendance", { p_booking_id: bookingId });
  check("no session: attendance NOT marked", !r.error && r.data?.attended_at == null, JSON.stringify(r.data ?? r.error));
  check("blocked attempt stored with source class", attempts(m.id).filter((a) => a.source === "class").length === 1);
  check("session_required alert raised", activeAlerts(m.id).length === 1);
  await deskPay(m);
  const r2 = await C.manager.rpc("mark_class_attendance", { p_booking_id: bookingId });
  check("after payment: attendance marked", !r2.error && r2.data?.attended_at != null, JSON.stringify(r2.data ?? r2.error));
  check("session consumed", sessions(m.id)[0]?.consumed_at != null);
});

await scenario("S5 offline scans: receipt time governs, replay-safe", async () => {
  const paid = await newMember("S5 Paid");
  await deskPay(paid);
  await new Promise((r) => setTimeout(r, 1500));
  const at = new Date(Date.now() - 500);
  const ok = await scan(paid, { p_scanned_at: at.toISOString() });
  check("offline scan taken after the purchase passes", !blocked(ok.data), JSON.stringify(ok.error ?? ok.data));
  check("attendance keeps the scan time", ok.data && Math.abs(new Date(ok.data.checked_in_at) - at) < 5e3, String(ok.data?.checked_in_at));
  check("session consumed", sessions(paid.id)[0]?.consumed_at != null);
  const early = await newMember("S5 Early");
  const stale = new Date(Date.now() - 3 * 3600e3); // scanned BEFORE the session was bought
  await deskPay(early);
  const e = await scan(early, { p_scanned_at: stale.toISOString() });
  check("a scan older than the purchase is accepted at receipt time", !blocked(e.data) && Math.abs(new Date(e.data.checked_in_at) - Date.now()) < 60e3, String(e.data?.checked_in_at));
  const none = await newMember("S5 None");
  const scanId = randomUUID();
  const bat = new Date(Date.now() - 2 * 3600e3);
  const b1 = await scan(none, { p_scanned_at: bat.toISOString(), p_client_scan_id: scanId });
  check("offline scan without a session is denied on sync", blocked(b1.data));
  const b2 = await scan(none, { p_scanned_at: bat.toISOString(), p_client_scan_id: scanId });
  check("replaying the same offline scan counts once", blocked(b2.data) && attempts(none.id).length === 1);
  check("attempt keeps the scan time", Math.abs(new Date(attempts(none.id)[0]?.scanned_at) - bat) < 60e3);
});

await scenario("S6 lapse: unused paid session expires after 7 days, soonest-lapsing used first", async () => {
  const m = await newMember("S6 Lapse");
  await deskPay(m);
  psql(`update guest_sessions set usable_until = now() - interval '1 minute' where member_id = '${m.id}'`);
  check("a lapsed session does not let the member in", blocked((await scan(m)).data));
  await deskPay(m);
  const ok = await scan(m);
  check("a fresh paid session does", !blocked(ok.data), JSON.stringify(ok.error ?? ok.data));
  const s = sessions(m.id);
  check("the lapsed one stayed unconsumed; the new one was used", s.length === 2 && s[0].consumed_at === null && s[1].consumed_at !== null);
});

await scenario("S7 refunds: unused is voided, consumed stays consumed", async () => {
  const refund = (paymentId, amount) => C.owner.from("refunds").insert({ gym_id: w.gym.id, payment_id: paymentId, amount, reason: "QA refund", actor_id: staff.owner.userId });
  const u = await newMember("S7 Unused");
  await deskPay(u);
  const upay = sessions(u.id)[0].payment_id;
  const r1 = await refund(upay, SESSION_PRICE);
  check("refund of an unused session recorded", !r1.error, errText(r1));
  const us = sessions(u.id)[0];
  check("session voided", us.voided_at !== null && us.consumed_at === null);
  check("member is blocked again", blocked((await scan(u)).data));
  const c = await newMember("S7 Consumed");
  await deskPay(c);
  const cpay = sessions(c.id)[0].payment_id;
  await scan(c);
  const r2 = await refund(cpay, SESSION_PRICE);
  check("refund of a consumed session recorded", !r2.error, errText(r2));
  const cs = sessions(c.id)[0];
  check("session stays consumed and not voided", cs.consumed_at !== null && cs.voided_at === null);
  const over = await refund(cpay, 1);
  check("a second refund of the same payment is refused", !!over.error, errText(over));
});

await scenario("S8 overview figures: server aggregates, role-gated, alert dismissal does not change them", async () => {
  const sum = await C.manager.rpc("guest_sessions_summary", { p_period: "today" });
  const row = Array.isArray(sum.data) ? sum.data[0] : sum.data;
  check("manager reads the summary", !sum.error && row, errText(sum));
  check("paid and blocked counts are populated", Number(row?.paid_count) >= 5 && Number(row?.blocked_count) >= 1, JSON.stringify(row));
  const rec = await C.receptionist.rpc("guest_sessions_summary", { p_period: "today" });
  check("receptionist is refused (manager+)", !!rec.error, errText(rec));
  psql(`update front_desk_alerts set dismissed_at = now() where gym_id = '${w.gym.id}' and kind = 'session_required' and dismissed_at is null`);
  const sum2 = await C.manager.rpc("guest_sessions_summary", { p_period: "today" });
  const row2 = Array.isArray(sum2.data) ? sum2.data[0] : sum2.data;
  check("dismissing alerts leaves the figures unchanged", JSON.stringify(row2) === JSON.stringify(row), JSON.stringify([row, row2]));
  const rev = await C.owner.rpc("gym_session_revenue_mtd");
  const revV = Array.isArray(rev.data) ? rev.data[0] : rev.data;
  check("session revenue line is available", !rev.error, errText(rev));
  console.log(`        summary=${JSON.stringify(row)} revenue=${JSON.stringify(revV)}`);
  const lst = await C.manager.rpc("list_session_attempts", { p_period: "today" });
  check("blocked-attempts list answers", !lst.error, errText(lst));
});

await scenario("S9 exempt plan and kill switch", async () => {
  const eli = await newMember("S9 Exempt", { plan: "exempt" });
  const r = await scan(eli);
  check("price-0 plan passes without a session", !blocked(r.data), JSON.stringify(r.error ?? r.data));
  check("... and consumes nothing", sessions(eli.id).length === 0);
  const z = await newMember("S9 Z");
  check("owner turns charging off", !(await C.owner.rpc("set_guest_charging", { p_enabled: false })).error);
  const off = await scan(z);
  check("with charging off a session guest is let in (pre-V1.6 behaviour)", !blocked(off.data), JSON.stringify(off.error ?? off.data));
  check("... with no attempt or alert", attempts(z.id).length === 0 && activeAlerts(z.id).length === 0);
  const pay = await deskPay(z);
  check("desk payment is refused while charging is off", !!pay.error, errText(pay));
  check("owner turns charging back on", !(await C.owner.rpc("set_guest_charging", { p_enabled: true })).error);
});

await scenario("S10 plan lock: type locked once subscribed; price change never alters paid sessions", async () => {
  const m = await newMember("S10 Plan");
  await deskPay(m);
  const paidAmount = payment(sessions(m.id)[0].payment_id).amount;
  const type = await C.owner.rpc("update_plan_pricing", { p_plan_id: w.plans.session, p_plan_type: "monthly", p_price: SESSION_PRICE, p_duration_days: 30, p_billing_interval: "monthly", p_annual_discount_percent: null });
  check("plan type change is refused once subscriptions exist", !!type.error, errText(type));
  const price = await C.owner.rpc("update_plan_pricing", { p_plan_id: w.plans.session, p_plan_type: "pay_per_session", p_price: 6000, p_duration_days: null, p_billing_interval: "monthly", p_annual_discount_percent: null });
  check("price change is allowed", !price.error, errText(price));
  check("the already-paid session keeps its amount", payment(sessions(m.id)[0].payment_id).amount === paidAmount);
  must(await C.owner.rpc("update_plan_pricing", { p_plan_id: w.plans.session, p_plan_type: "pay_per_session", p_price: SESSION_PRICE, p_duration_days: null, p_billing_interval: "monthly", p_annual_discount_percent: null }), "restore price");
  const direct = await C.owner.from("plans").update({ price: 1 }).eq("id", w.plans.session);
  check("direct UPDATE of price is blocked", !!direct.error || psql(`select price from plans where id = '${w.plans.session}'`) === String(SESSION_PRICE), errText(direct));
});

await scenario("S11 registration fee gates a session payment for an awaiting member", async () => {
  check("owner sets a fee", !(await C.owner.rpc("set_registration_fee", { p_amount: 5000 })).error);
  const m = await newMember("S11 Awaiting", { sub: null }); // a subscription cannot exist before the fee is settled
  const r = await deskPay(m);
  check("desk session payment refused: registration fee not settled", /registration_fee_not_settled/.test(errText(r)), errText(r));
  const t = await m.c.rpc("initiate_session_payment");
  check("in-app session payment refused too", /registration_fee_not_settled/.test(errText(t)), errText(t));
  must(await C.owner.rpc("set_registration_fee", { p_amount: 0 }), "fee off");
});

// ---------------------------------------------------------------------------- summary
console.log(`\n${"=".repeat(60)}\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
process.exit(fail ? 1 : 0);
