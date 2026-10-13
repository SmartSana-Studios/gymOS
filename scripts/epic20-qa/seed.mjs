// Epic 20 (loyalty) local QA seed. LOCAL Supabase only. Idempotent: wipes + recreates the QA gym.
//   node scripts/epic20-qa/seed.mjs
// Program is switched ON through the real owner RPC with N=4 guest sessions, K=3 renewals, R=10 days.
import { admin, psql, signIn, must, resetDb, daysFromNow, localToday, addDays, seedStamps, deskPay, scan, checkout, renew, setProgram, PW, PHONE_A, PHONE_B, N, K, R, SESSION_PRICE } from "./lib.mjs";

resetDb();
const tier = must(await admin.from("tiers").select("id").eq("name", "Grind").single(), "tier");
const gym = must(await admin.from("gyms").insert({ name: "Epic20 QA Gym", tier_id: tier.id, status: "active", default_language: "en" }).select("id, gym_token, charge_guests_per_session").single(), "gym");
const plan = async (row) => must(await admin.from("plans").insert({ gym_id: gym.id, currency: "XAF", ...row }).select("id").single(), row.name).id;
const plans = {
  session: await plan({ name: "Pay per session", plan_type: "pay_per_session", price: SESSION_PRICE, billing_interval: "monthly" }),
  monthly: await plan({ name: "Monthly Standard", plan_type: "class_only", price: 15000, billing_interval: "monthly", duration_days: 30 }),
  annual: await plan({ name: "Annual Standard", plan_type: "class_only", price: 150000, billing_interval: "annual", annual_discount_percent: 10, duration_days: 365 }),
};

async function user({ phone, email }) {
  const r = await admin.auth.admin.createUser({ phone, email, password: PW, phone_confirm: !!phone, email_confirm: !!email });
  if (r.error) throw new Error(`createUser ${phone ?? email}: ${r.error.message}`);
  must(await admin.from("users").update({ must_change_password: false }).eq("id", r.data.user.id), "must_change_password");
  return r.data.user.id;
}
const staff = {};
let s = 0;
for (const role of ["owner", "supervisor", "manager", "receptionist", "coach"]) {
  s += 1;
  const phone = `23767200000${s}`, email = `${role}@epic20qa.test`;
  const uid = await user({ phone, email });
  must(await admin.from("members").insert({ gym_id: gym.id, user_id: uid, role, name: `QA ${role[0].toUpperCase()}${role.slice(1)}`, phone: `+${phone}` }), role);
  staff[role] = email;
}

// Real owner RPC, like production.
await setProgram(true);
const today = localToday(gym.id);

let seq = 100;
const rows = [];
async function member(name, { phone, plan: planKey = "session", expiry, status = "active", start } = {}) {
  seq += 1;
  const ph = phone ?? `237672000${seq}`;
  const uid = await user({ phone: ph });
  const m = must(await admin.from("members").insert({ gym_id: gym.id, user_id: uid, role: "member", name, phone: `+${ph}` }).select("id").single(), name);
  must(await admin.from("subscriptions").insert({
    gym_id: gym.id, member_id: m.id, plan_id: plans[planKey], status,
    start_date: start ?? (planKey === "session" ? today : addDays(expiry ?? today, planKey === "annual" ? -365 : -30)),
    expiry_date: planKey === "session" ? null : (expiry ?? today),
  }), `sub ${name}`);
  return { id: m.id, phone: ph, name };
}
const note = (name, m, state, use) => rows.push({ name, phone: `+${m.phone}`, state, "try it": use });

// ---- Guests (Pay per session) ----
note("Guest Fresh", await member("Guest Fresh"), "0 / 4, nothing held", "pay at desk + scan -> 1 / 4 on the card");
const mid = await member("Guest Mid"); seedStamps(gym.id, mid.id, "guest", 2, 3);
note("Guest Mid", mid, "2 / 4", "modal Rewards shows Guest progress 2 / 4");
const almost = await member("Guest Almost"); seedStamps(gym.id, almost.id, "guest", N - 1, 2); await deskPay(almost.id);
note("Guest Almost", almost, "3 / 4 + 1 unused paid session", "scan (or Attended in a class) -> 4th stamp -> FREE SESSION granted, 0 / 4");
const rewarded = await member("Guest Rewarded"); seedStamps(gym.id, rewarded.id, "guest", N - 1, 5); await deskPay(rewarded.id);
await scan(rewarded.phone); checkout(rewarded.id);
note("Guest Rewarded", rewarded, "0 / 4 + 1 free session (granted)", "modal lists the free session + expiry; scan next day uses it, no payment");
const stale = await member("Guest Stale"); seedStamps(gym.id, stale.id, "guest", 2, 100);
note("Guest Stale", stale, "2 stamps, last 100 days ago", "reads 0 / 4 (idle window); run `program.mjs sweep` to persist the reset + audit");
const lapse = await member("Guest Lapse"); await deskPay(lapse.id);
psql(`update guest_sessions set usable_until = now() - interval '2 days' where member_id = '${lapse.id}'`);
note("Guest Lapse", lapse, "paid session lapsed 2 days ago", "`program.mjs sweep` writes the lapse event + audit row");
const refund = await member("Guest Refund"); seedStamps(gym.id, refund.id, "guest", 1, 3); await deskPay(refund.id);
await scan(refund.phone); checkout(refund.id);
note("Guest Refund", refund, "2 / 4 (one just earned)", "Payments -> refund that session payment -> back to 1 / 4, audit 'stamp reversed'");

// ---- Subscribers (Monthly Standard, expiry = today = renew-on-time day) ----
const due = await member("Sub Due", { plan: "monthly" }); seedStamps(gym.id, due.id, "subscriber", K - 1, 25);
note("Sub Due", due, "2 / 3, expires TODAY", "Members -> Renew (cash) -> 3rd stamp -> +10 days on expiry, counter 0");
const fresh = await member("Sub Fresh", { plan: "monthly" });
note("Sub Fresh", fresh, "0 / 3, expires TODAY", "renew -> 1 / 3");
const early = await member("Sub Early", { plan: "monthly", expiry: addDays(today, 20) }); seedStamps(gym.id, early.id, "subscriber", 1, 10);
note("Sub Early", early, "1 / 3, expires in 20 days", "renew now -> NO stamp (early)");
const late = await member("Sub Late", { plan: "monthly", expiry: addDays(today, -5), status: "expired" }); seedStamps(gym.id, late.id, "subscriber", 1, 35);
note("Sub Late", late, "1 / 3, expired 5 days ago", "renew now -> NO stamp (late)");
const annual = await member("Sub Annual", { plan: "annual" }); seedStamps(gym.id, annual.id, "subscriber", K - 1, 300);
note("Sub Annual", annual, "2 / 3, annual plan, expires TODAY", "renew -> stamp + reward (window = plan duration, not 90 d)");
const got = await member("Sub Rewarded", { plan: "monthly" }); seedStamps(gym.id, got.id, "subscriber", K - 1, 25);
await renew(got.id);
note("Sub Rewarded", got, "reward just granted (expiry +10 d)", "app card: '10 free days added — your new renewal date is …'");
const dormant = await member("Sub Dormant Free", { plan: "monthly", expiry: addDays(today, 15) });
{ // a free session held while on a monthly plan: earn it on pay-per-session, then switch plan
  seedStamps(gym.id, dormant.id, "guest", N - 1, 4);
  psql(`update subscriptions set plan_id = '${plans.session}', expiry_date = null where member_id = '${dormant.id}'`);
  await deskPay(dormant.id); await scan(dormant.phone); checkout(dormant.id);
  psql(`update subscriptions set plan_id = '${plans.monthly}', expiry_date = '${addDays(today, 15)}' where member_id = '${dormant.id}'`);
}
note("Sub Dormant Free", dormant, "monthly plan, holds a free session", "app: neutral row 'Usable when you're back on Pay-per-session'");

// ---- Phone members (OTP 123456) ----
const a = await member("Phone Guest A", { phone: PHONE_A });
seedStamps(gym.id, a.id, "guest", N - 1, 2); await deskPay(a.id);
note("Phone Guest A", a, "3 / 4 + unused paid session", "your phone: card 3 / 4 -> scan -> free session headline; reset with state.mjs");
const b = await member("Phone Sub B", { phone: PHONE_B, plan: "monthly" });
seedStamps(gym.id, b.id, "subscriber", K - 1, 25);
note("Phone Sub B", b, "2 / 3, expires TODAY", "your phone: subscriber card 2 / 3 -> renew from dashboard -> free-days line; reset with state.mjs");

console.log(`\nEpic20 QA Gym ready (id ${gym.id}). Loyalty ON: N=${N} guest sessions, K=${K} renewals, R=${R} days. Charging guests: ${gym.charge_guests_per_session ? "ON" : "OFF"}.`);
console.log(`Gym QR token: ${gym.gym_token}`);
console.log(`Dashboard accounts (password ${PW}): ${Object.values(staff).join(" · ")}`);
console.log(`Phone members: +${PHONE_A} (guest) and +${PHONE_B} (subscriber), OTP 123456\n`);
console.table(rows);
