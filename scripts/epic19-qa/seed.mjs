// Epic 19 local QA seed. LOCAL Supabase only. Idempotent: wipes + recreates the QA gym.
//   node scripts/epic19-qa/seed.mjs
// Then see README.md for the scenarios (dashboard :3000, phone app via start-mobile.sh).
import { buildWorld, psql, must, signIn } from "./lib.mjs";
import { PW, PHONE_A, PHONE_B, SESSION_PRICE } from "./constants.mjs";

const w = await buildWorld();
const rows = [];
const add = async (label, name, opts, use) => { const m = await w.member(name, opts); rows.push([name, m.phone, label, use]); return m; };

await add("no session", "Blocked Bea", {}, "scan -> blocked, session-required alert, desk payment");
const paid = await add("paid, unused", "Paid Pat", {}, "scan consumes the paid session");
await add("price 0 plan", "Exempt Eli", { plan: "exempt" }, "scan always allowed (price 0 exempt)");
await add("expired subscription", "Expired Eve", { sub: "expired" }, "old expired-sub alert, not session-required");
await add("monthly plan", "Monthly Mo", { plan: "monthly" }, "not gated; class attendance free");
const lapsed = await add("paid session lapsed", "Lapsed Lena", {}, "paid session older than 7 days -> blocked");
await add("class booked", "Class Cleo", {}, "mark attended as staff -> consumes a session / alert");

// Phone-testable members (GoTrue test OTP 123456). Their state is changed with state.mjs.
const a = await add("phone A (OTP 123456)", "Phone Guest A", { phone: PHONE_A, sub: "active" }, "your phone: state.mjs sets it");
const b = await add("phone B (OTP 123456)", "Phone Guest B", { phone: PHONE_B, sub: "active" }, "your phone, second account");

// Give Paid Pat and Lapsed Lena their sessions through the real desk RPC, then age Lena's.
const find = async (name) => must(await w.clients.owner.from("members").select("id").eq("name", name).single(), name).id;
must(await w.clients.receptionist.rpc("record_session_payment", { p_member_id: paid.id, p_method: "cash", p_reason: "QA seed receipt" }), "pat session");
must(await w.clients.receptionist.rpc("record_session_payment", { p_member_id: lapsed.id, p_method: "cash", p_reason: "QA seed receipt" }), "lena session");
psql(`update guest_sessions set usable_until = now() - interval '1 day' where member_id = '${lapsed.id}'`);
const cleo = await find("Class Cleo");
psql(`insert into class_bookings (gym_id, class_session_id, member_id) values ('${w.gym.id}', '${w.classSessionId}', '${cleo}')`);

console.log(`\nEpic19 QA Gym ready (id ${w.gym.id})`);
console.log(`Charging guests per session: ${w.gym.charge_guests_per_session ? "ON (0115 default)" : "OFF"}; session price ${SESSION_PRICE} XAF; fake Tara business EP19QABIZ`);
console.log(`Gym QR token (Settings page renders it): ${w.gym.gym_token}`);
console.log(`Dashboard accounts (password ${PW}): ${Object.values(w.staff).map((s) => s.email).join(" · ")}`);
console.log(`Phone members: +${PHONE_A} and +${PHONE_B}, OTP 123456\n`);
console.table(rows.map(([name, phone, state, use]) => ({ name, phone, state, use })));
