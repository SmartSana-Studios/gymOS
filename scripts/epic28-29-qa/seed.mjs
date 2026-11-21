// Epics 28 and 29 local QA seed (browser QA at the end of Epic 29). LOCAL Supabase only. Idempotent: wipes and recreates "Epic19 QA Gym"
// (the Epic 19 world: owner@ supervisor@ manager@ receptionist@ coach@ + epic19qa.test, password Epic19Pass!), then adds
//   Epic 28: pay-per-session guests with recorded session payments (single-use visits, class attendance, the setting flip) and a blocked guest;
//   Epic 29: a recurring class with ONE time (to turn into per-day times), a class that already has per-day times, a second coach, a deactivated
//            coach, assigned members with session notes and a workout plan, and body/progress data that the coach picker must never show.
//   node scripts/epic28-29-qa/seed.mjs
import { buildWorld, must, admin, daysFromNow, PW } from "../epic19-qa/lib.mjs";

const w = await buildWorld();
const rows = [];
const add = (who, state, use) => rows.push({ who, state, use });

// ---------------------------------------------------------------------------------------------- Epic 28
const pay = async (m, n = 1) => {
  for (let i = 0; i < n; i += 1) {
    must(await w.clients.receptionist.rpc("record_session_payment", { p_member_id: m.id, p_method: "cash", p_reason: "QA seed receipt" }), `session payment ${m.name} ${i + 1}`);
  }
};

const vic = await w.member("Visit Vic");
await pay(vic, 2);
add("Visit Vic", "pay-per-session, TWO unused paid sessions", "Single use: check in (admitted), scan again (already checked in, free), check out, check in again (second session)");

const wanda = await w.member("Wholeday Wanda");
await pay(wanda, 1);
add("Wholeday Wanda", "pay-per-session, ONE unused paid session", "Check in while the gym is Whole day, THEN switch to Single use: her session still covers the day, a return costs nothing");

const cleo = await w.member("Class Cleo");
await pay(cleo, 1);
must(await admin.from("class_bookings").insert({ gym_id: w.gym.id, class_session_id: w.classSessionId, member_id: cleo.id }), "book Cleo into QA Boxing");
add("Class Cleo", "one paid session, booked into QA Boxing (today, in one hour)", "Single use: mark her attended with NO open visit (consumes her session); with an open visit it costs nothing");

await w.member("Blocked Bea");
add("Blocked Bea", "pay-per-session, no session", "Check in -> refused (session required), Blocked tab shows a 'Desk check-in' row");

// ---------------------------------------------------------------------------------------------- Epic 29
const owner = w.clients.owner;
const today = daysFromNow(0);

// Class with ONE time on three days: open Edit and give each day its own time (29.2).
must(await owner.rpc("create_class", {
  p_name: "QA Spin", p_description: "Same time every class day", p_coach_id: w.staff.coach.memberId, p_capacity: 12, p_schedule_type: "recurring",
  p_one_off_session_at: null, p_recurrence_days: [1, 3, 5], p_recurrence_time: "18:00", p_recurrence_start_date: today,
}), "create QA Spin");
const spin = must(await admin.from("classes").select("id").eq("gym_id", w.gym.id).eq("name", "QA SPIN").single(), "QA Spin id").id;
const spinSession = must(await admin.from("class_sessions").select("id, scheduled_at").eq("class_id", spin).gt("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(1), "QA Spin session")[0];
for (const m of [vic, cleo]) {
  must(await admin.from("class_bookings").insert({ gym_id: w.gym.id, class_session_id: spinSession.id, member_id: m.id }), `book ${m.name} into QA Spin`);
}
add("QA Spin (class, QA Coach)", "Mon, Wed, Fri 18:00, two members booked into the next session", "Edit -> weekly times per day; Cancel class -> the dialog counts 2 bookings; coach@ sees it in My Classes and can edit or cancel it");

// A coach (second) and a class that already has a different time each day. QA Coach cannot edit it; the Owner can.
const coach2Email = "coach2@epic19qa.test";
const coach2User = await admin.auth.admin.createUser({ email: coach2Email, password: PW, email_confirm: true });
if (coach2User.error) throw new Error(`coach2 user: ${coach2User.error.message}`);
must(await admin.from("users").update({ must_change_password: false }).eq("id", coach2User.data.user.id), "coach2 must_change_password");
const coach2 = must(await admin.from("members").insert({ gym_id: w.gym.id, user_id: coach2User.data.user.id, role: "coach", name: "QA Coach Two" }).select("id").single(), "coach2");

must(await owner.rpc("create_class", {
  p_name: "QA Yoga", p_description: "A different time each day", p_coach_id: coach2.id, p_capacity: 10, p_schedule_type: "recurring",
  p_one_off_session_at: null, p_recurrence_days: null, p_recurrence_time: null, p_recurrence_start_date: today,
  p_slots: [{ weekday: 1, start_time: "07:00" }, { weekday: 3, start_time: "18:30" }, { weekday: 6, start_time: "09:00" }],
}), "create QA Yoga");
add("QA Yoga (class, QA Coach Two)", "Mon 07:00, Wed 18:30, Sat 09:00 (per-day times)", "Owner: per-day editor shows three rows; coach@ does NOT see it in My Classes (not theirs)");

// A deactivated coach: a stale link says 'no longer a coach'.
const retired = must(await admin.from("members").insert({ gym_id: w.gym.id, role: "coach", name: "QA Coach Retired", deactivated_at: new Date().toISOString(), user_id: (await (async () => {
  const u = await admin.auth.admin.createUser({ email: "coach-retired@epic19qa.test", password: PW, email_confirm: true });
  if (u.error) throw new Error(`retired user: ${u.error.message}`);
  must(await admin.from("users").update({ must_change_password: false }).eq("id", u.data.user.id), "retired must_change_password");
  return u.data.user.id;
})()) }).select("id").single(), "retired coach");

// Assigned members, notes, a plan, and body data the picker must never show.
const squat = must(await admin.from("exercise_library").select("id").is("gym_id", null).eq("name", "Squat").single(), "Squat").id;
const assign = async (m, coachId, ended = false) => must(await admin.from("coach_assignments").insert({
  gym_id: w.gym.id, member_id: m.id, coach_id: coachId, started_at: new Date(Date.now() - 20 * 86400000).toISOString(),
  ...(ended ? { ended_at: new Date(Date.now() - 2 * 86400000).toISOString() } : {}),
}), `assign ${m.name}`);

const pia = await w.member("Pick Pia", { plan: "monthly" });
const pete = await w.member("Pick Pete", { plan: "monthly" });
const dora = await w.member("Pick Dora", { plan: "monthly" });
const ned = await w.member("Ended Ned", { plan: "monthly" });
await assign(pia, w.staff.coach.memberId);
await assign(pete, w.staff.coach.memberId);
await assign(dora, coach2.id);
await assign(ned, w.staff.coach.memberId, true);

const coachClient = w.clients.coach;
must(await coachClient.rpc("add_session_note", { p_member_id: pia.id, p_note_text: "Pia: squat form improving, add 2.5 kg next week and film the top set from the side so we can review it." }), "note Pia");
must(await coachClient.rpc("add_session_note", { p_member_id: pete.id, p_note_text: "Pete: knee is fine, keep the tempo slow." }), "note Pete");
must(await coachClient.rpc("create_workout_plan", { p_member_id: pia.id, p_name: "Pia strength block", p_exercises: [{ exercise_id: squat, sets: 4, reps: 8, note: "pause at the bottom" }] }), "plan Pia");

for (const m of [pia, pete]) {
  must(await admin.from("members").update({ starting_weight_kg: 77.7712, height_cm: 183.3312 }).eq("id", m.id), `body data ${m.name}`);
}
const entry = must(await admin.from("progress_entries").insert({
  gym_id: w.gym.id, member_id: pia.id, weight_kg: 83.7712, waist_cm: 91.3312, chest_cm: 101.7712, note: "zq-progress-note-text",
}).select("id").single(), "progress entry");
must(await admin.from("progress_photos").insert({ gym_id: w.gym.id, member_id: pia.id, progress_entry_id: entry.id, photo_path: "zq/zq-shared-photo.jpg", shared_with_coach: true }), "progress photo");

add("Pick Pia", "assigned to QA Coach: a session note, a workout plan, body measurements, a progress note and a shared photo", "Picker (Owner, Supervisor, Manager): note and plan show; NO weight 83.7712, waist 91.3312, chest 101.7712, starting weight 77.7712, height 183.3312, 'zq-progress-note-text', photo, Progress tab");
add("Pick Pete", "assigned to QA Coach: a session note, no plan", "Picker: Members tab row with the note snippet; member page notes only; Workout Plan tab empty state");
add("Pick Dora", "assigned to QA Coach Two", "Picker with QA Coach Two chosen; also try her URL with QA Coach chosen -> 'isn't assigned'");
add("Ended Ned", "assignment to QA Coach ENDED two days ago", "Not in QA Coach's Members tab; his member URL with QA Coach chosen -> 'isn't assigned'");

console.log(`\nEpics 28/29 QA ready on "Epic19 QA Gym" (id ${w.gym.id}). Dashboard logins, password ${PW}: owner@ supervisor@ manager@ receptionist@ coach@ coach2@ + epic19qa.test`);
console.log(`Coach ids for the picker (?coach=): QA Coach ${w.staff.coach.memberId} | QA Coach Two ${coach2.id} | QA Coach Retired (deactivated) ${retired.id}`);
console.table(rows);
