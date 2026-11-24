// Shared helpers for the Epics 30 + 31 QA kit (engagement: weekly ring, calendar, leaderboard, milestones, Shields, comeback, reminder, badges).
// LOCAL Supabase only. Builds on the Epic 19 world (scripts/epic19-qa): the gym "Epic19 QA Gym", staff + phone members, password Epic19Pass!.
//
// Personas rewrite ONE member's attendance and engagement facts, then run the real settle, so the app reads the same state a real member
// with that history would have. The wipe runs with session_replication_role = replica (like scripts/epic19-qa/reset.sql) because
// engagement_facts is append-only and member_weekly_goals refuses writes to the current week. Nothing here is a path real users have.
import { admin, psql, signIn, must, PW } from "../epic19-qa/lib.mjs";

export { admin, psql, signIn, must, PW };
export const GYM_NAME = "Epic19 QA Gym";
export const TZ_OFFSET_H = 1; // Africa/Douala (the gym default) is UTC+1, no DST.

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const at = (s) => new Date(`${s}T12:00:00Z`);
export const addDays = (s, n) => iso(new Date(at(s).getTime() + n * DAY));
export const gymToday = () => iso(new Date(Date.now() + TZ_OFFSET_H * 3600e3));
export const weekStart = (s) => { const dow = (at(s).getUTCDay() + 6) % 7; return addDays(s, -dow); }; // Monday
export const gymHour = () => new Date(Date.now() + TZ_OFFSET_H * 3600e3).getUTCHours();

/** The epoch Monday the kit uses: 14 weeks before this week's Monday (room for 8 met weeks, a break, and a comeback). */
export const epochMonday = () => addDays(weekStart(gymToday()), -14 * 7);

export function gymId() {
  const id = psql(`select id from public.gyms where upper(name) = upper('${GYM_NAME}')`);
  if (!id) throw new Error(`"${GYM_NAME}" not found: run node scripts/epic30-31-qa/seed.mjs first`);
  return id;
}

export function setEpoch(date) {
  psql(`begin; set local session_replication_role = replica;
        update public.platform_engagement_config set release_week_start = ${date ? `date '${date}'` : "null"}; commit;`);
}

/**
 * Persona = a visit history relative to today. Fields (all optional):
 *   weeks: { k: n }  n visit days in the closed week k weeks ago (k = 1 is last week), on its first n days (Mon, Tue, ...)
 *   cur:   n         n visit days earlier THIS week (before today), on the week's first days
 *   today: true      a visit today
 *   days:  [offsets] explicit visit days, as offsets from today (negative)
 *   pre:   n         n visit days just BEFORE the epoch (count for totals and milestones, not for weeks)
 *   goalNow: n | 'atrisk'   the goal in force this week ('atrisk' = the days left incl. today, so the week is at risk)
 */
export const PERSONAS = {
  new: { about: "no history at all: empty ring, default goal hint, no streak, no badges" },
  halfway: { today: true, goalNow: 4, about: "this week 1 of 4 (visited today), no streak" },
  ringfull: { today: true, goalNow: 1, about: "this week's goal (1) already met today: full ring" },
  atrisk: { goalNow: "atrisk", about: "no visit today and the week can only be met by visiting today: at-risk hint, 'hours left' on today's calendar cell" },
  streak3: { pre: 7, weeks: { 3: 3, 2: 3, 1: 3 }, cur: 1, about: "3-week streak, no Shield yet, next Shield in 1 week" },
  streak4: { pre: 7, weeks: { 4: 3, 3: 3, 2: 3, 1: 3 }, about: "4-week streak: first Shield earned (chip, 'Shield earned' notice, four_weeks badge)" },
  shield2: { pre: 31, weeks: { 8: 3, 7: 3, 6: 3, 5: 3, 4: 3, 3: 3, 2: 3, 1: 3 }, about: "8-week streak: 2 Shields held (the cap), muted 'max Shields' line" },
  saved: { pre: 7, weeks: { 6: 3, 5: 3, 4: 3, 3: 3, 2: 3, 1: 1 }, about: "5 met weeks, then a missed week that a Shield saved: streak kept, Shield spent, 'Shield saved' + 'Shield earned' notices, saved-week glyph on the calendar" },
  shieldrisk: { pre: 7, weeks: { 4: 3, 3: 3, 2: 3, 1: 3 }, goalNow: "atrisk", about: "1 Shield held AND the week at risk: the at-risk hint gets the 'Shield is ready' second line" },
  broken: { pre: 7, weeks: { 7: 3, 6: 3 }, about: "a 2-week run then nothing: run ended, comeback card with 3 empty stamp segments (no '0 / 3')" },
  comeback1: { pre: 7, weeks: { 7: 3, 6: 3 }, days: [-6], about: "run ended, comeback 1 of 3 (window open)" },
  comeback2: { pre: 7, weeks: { 7: 3, 6: 3 }, days: [-6, -4], about: "run ended, comeback 2 of 3 (window open): one more visit restores" },
  comebackdone: { pre: 7, weeks: { 7: 3, 6: 3 }, wdays: [-9, -6, -2], about: "run ended, 3 visit days inside the window: restored, one-time 'you're back' card, chip reads 'Best: n weeks'" },
  comebacklapsed: { pre: 7, weeks: { 7: 3, 6: 3 }, days: [-14], about: "run ended, one visit 14 days ago and nothing since: window lapsed, calm restart wording" },
  milestone6: { pre: 6, about: "6 visit days before the epoch: the NEXT visit (checkin.mjs) is the 7th and celebrates" },
  milestone29: { pre: 29, about: "29 visit days before the epoch (7 already silent): the next visit is the 30th and celebrates" },
  milestone99: { pre: 99, about: "99 visit days before the epoch (7 and 30 silent): the next visit is the 100th and celebrates" },
  veteran: { pre: 104, weeks: { 8: 3, 7: 3, 6: 3, 5: 3, 4: 3, 3: 3, 2: 3, 1: 3 }, about: "all five badges earned, 2 Shields, 8-week streak: full Badge Shelf, share from a badge" },
};

export function personaDates(p) {
  const today = gymToday();
  const ws = weekStart(today);
  const epoch = epochMonday();
  const out = new Set();
  for (const [k, n] of Object.entries(p.weeks ?? {})) for (let i = 0; i < n; i += 1) out.add(addDays(ws, -7 * Number(k) + i));
  const avail = Math.max(0, (new Date(`${today}T00:00:00Z`) - new Date(`${ws}T00:00:00Z`)) / DAY); // days of this week before today
  if (p.cur) {
    if (p.cur > avail) console.warn(`note: only ${avail} earlier day(s) exist this week (today is gym-local ${today}); using ${avail}`);
    for (let i = 0; i < Math.min(p.cur, avail); i += 1) out.add(addDays(ws, i));
  }
  for (const o of p.days ?? []) out.add(addDays(today, o));
  for (const o of p.wdays ?? []) out.add(addDays(ws, o));
  for (let i = 0; i < (p.pre ?? 0); i += 1) out.add(addDays(epoch, -2 - i));
  const todayVisit = !!p.today;
  out.delete(today);
  return { days: [...out].sort(), todayVisit, today, ws, epoch };
}

/** Wipes one member's engagement state and attendance, writes the persona's days, then runs the real settle. */
export function applyPersona(memberId, name) {
  const p = PERSONAS[name];
  if (!p) throw new Error(`unknown persona "${name}". Known: ${Object.keys(PERSONAS).join(", ")}`);
  const g = gymId();
  const { days, todayVisit, today, ws } = personaDates(p);
  const rows = days.map((d) => `('${g}', '${memberId}', timestamptz '${d} 10:00:00+01', timestamptz '${d} 11:00:00+01', 'manual', date '${d}')`);
  if (todayVisit) rows.push(`('${g}', '${memberId}', now() - interval '2 minutes', now() - interval '1 minute', 'manual', date '${today}')`);
  const daysLeft = Math.round((new Date(`${ws}T00:00:00Z`).getTime() + 6 * DAY - new Date(`${today}T00:00:00Z`).getTime()) / DAY) + 1;
  const goal = p.goalNow === "atrisk" ? Math.min(7, daysLeft) : p.goalNow;
  psql(`begin;
set local session_replication_role = replica;
delete from public.engagement_facts where member_id = '${memberId}';
delete from public.engagement_state where member_id = '${memberId}';
delete from public.member_weekly_goals where member_id = '${memberId}';
delete from public.attendance_events where member_id = '${memberId}';
delete from public.member_preferences where member_id = '${memberId}';
delete from private.engagement_reminder_dispatches where member_id = '${memberId}';
${rows.length ? `insert into public.attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day) values\n${rows.join(",\n")};` : ""}
${goal ? `insert into public.member_weekly_goals (member_id, gym_id, effective_week, goal) values ('${memberId}', '${g}', date '${ws}', ${goal});` : ""}
commit;
select private.settle_engagement('${memberId}', '${g}', date '${today}');`);
  return { p, days, todayVisit, goal };
}

export async function memberByPhone(letter) {
  const phone = letter === "B" ? "+237670000001" : "+237699000001";
  const id = psql(`select id from public.members where phone = '${phone}' and gym_id = '${gymId()}'`);
  if (!id) throw new Error(`phone member ${letter} not found: run seed.mjs`);
  return { id, phone, client: await signIn(phone.slice(1)) };
}

/** What the app will read, through the member's real JWT. */
export async function summary(client) {
  const e = must(await client.rpc("my_engagement"), "my_engagement")[0];
  const b = must(await client.rpc("get_my_badges"), "get_my_badges");
  const v = must(await client.rpc("my_visit_days", { p_month: gymToday().slice(0, 8) + "01" }), "my_visit_days");
  return {
    week: `${e.week_start} (goal ${e.goal}${e.goal_is_default ? ", default" : ""}, ${e.visits_this_week} visit(s), ${e.days_left_in_week} day(s) left incl. today)`,
    streak: `${e.streak_weeks ?? "none"} (best ${e.best_streak_weeks ?? "-"}, if met: ${e.streak_if_met ?? "-"})`,
    shields: `${e.shields_held} held, next in ${e.weeks_to_next_shield ?? "-"} week(s), saved week ${e.saved_week_start ?? "-"}, earned week ${e.shield_earned_week ?? "-"}`,
    comeback: `${e.comeback_state} (${e.comeback_visits_done ?? 0}/${e.comeback_visits_goal}, window ${e.comeback_window_start ?? "-"} to ${e.comeback_window_ends_on ?? "-"})`,
    atRisk: e.at_risk_weekly,
    visitedToday: e.visited_today,
    pendingMilestone: e.pending_milestone ?? "none",
    needsSettle: e.needs_settle,
    badges: b.map((r) => `${r.code}${r.earned ? `=${r.earned_on}${r.silent ? "(silent)" : ""}` : `(${r.visits_remaining ?? `${r.weeks_progress}/4 wks`} to go)`}`).join("  "),
    visitDaysThisMonth: Array.isArray(v) ? v.length : "?",
  };
}

// ------------------------------------------------------------------------------------------------ leaderboard
const BOARD = [
  ["Chloe", "Ndongo", 18, "visible"], ["Dieudonne", "Fotso", 17, "visible"], ["Esther", "Kamga", 15, "hidden"], ["Franck", "Tchinda", 15, "visible"],
  ["Gisele", "Mbarga", 14, "visible"], ["Hugo", "Essomba", 12, "hidden"], ["Irene", "Atangana", 11, "visible"], ["Jules", "Nkoulou", 10, "visible"],
  ["Karine", "Biya", 9, "unseen"], ["Landry", "Owona", 8, "visible"], ["Mireille", "Tagne", 7, "visible"], ["Nadine", "Fouda", 6, "visible"],
  ["Olivier", "Mvondo", 5, "visible"], ["Pauline", "Abega", 4, "visible"],
];

/** Rewrites this month's attendance of the board members. mode: full (14 ranked) | two (2 ranked) | none (0 ranked). */
export function seedBoard(mode, ids) {
  const g = gymId();
  const today = gymToday();
  const dom = Number(today.slice(8, 10));
  const month1 = `${today.slice(0, 8)}01`;
  const sel = mode === "two" ? ids.slice(0, 2) : mode === "none" ? [] : ids;
  const rows = [];
  sel.forEach((id, i) => {
    const n = Math.min(BOARD[i][2], dom); // cannot have more visit days than days elapsed this month
    for (let d = 0; d < n; d += 1) rows.push(`('${g}', '${id}', timestamptz '${addDays(month1, d)} 08:00:00+01', timestamptz '${addDays(month1, d)} 09:00:00+01', 'manual', date '${addDays(month1, d)}')`);
  });
  psql(`begin; set local session_replication_role = replica;
delete from public.attendance_events where member_id in (${ids.map((i) => `'${i}'`).join(",")});
${rows.length ? `insert into public.attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day) values\n${rows.join(",\n")};` : ""}
commit;`);
  return { dom, ranked: sel.length };
}

export async function seedBoardMembers(w) {
  const ids = [];
  const g = w.gym.id;
  for (const [first, last, , mode] of BOARD) {
    const m = await w.member(`${first} ${last}`, { plan: "monthly" });
    ids.push(m.id);
    const seen = mode === "unseen" ? "null" : "now()";
    psql(`begin; set local session_replication_role = replica; insert into public.member_preferences (member_id, gym_id, leaderboard_hidden, leaderboard_notice_seen_at) values ('${m.id}', '${g}', ${mode === "hidden"}, ${seen})
          on conflict (member_id) do update set leaderboard_hidden = excluded.leaderboard_hidden, leaderboard_notice_seen_at = excluded.leaderboard_notice_seen_at; commit;`);
  }
  return ids;
}

export function boardIds() {
  const names = BOARD.map(([f, l]) => `'${f} ${l}'`.toUpperCase()).join(",");
  return psql(`select id from public.members where gym_id = '${gymId()}' and upper(name) in (${names}) order by array_position(array[${names}], upper(name))`).split("\n").filter(Boolean);
}
