// Shared helpers for the Epic 20 QA scripts. LOCAL Supabase only (the Epic 19 lib refuses anything else).
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { admin, psql, signIn, must, here as here19, PW, daysFromNow } from "../epic19-qa/lib.mjs";
import { fileURLToPath } from "node:url";

export { admin, psql, signIn, must, PW, daysFromNow };
export const here = path.dirname(fileURLToPath(import.meta.url));
export const GYM_NAME = "Epic20 QA Gym";
export const PHONE_A = "237699000001";
export const PHONE_B = "237670000001";
export const SESSION_PRICE = 5000;
// Program values used by the seed: small enough to reach by hand.
export const N = 4, K = 3, R = 10;

export function resetDb() {
  execFileSync("docker", ["exec", "-i", "supabase_db_gym_os", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
    { input: readFileSync(path.join(here, "reset.sql")), stdio: ["pipe", "inherit", "inherit"] });
}

export const gymId = () => {
  const id = psql(`select id from gyms where name = '${GYM_NAME}'`);
  if (!id) throw new Error("run seed.mjs first");
  return id;
};
export const localToday = (gid) => psql(`select (now() at time zone timezone)::date from gyms where id = '${gid}'`);
export const addDays = (isoDate, n) => psql(`select ('${isoDate}'::date + ${n})::text`);

/** Wipe one member's loyalty + session + attendance + subscription trail (QA only; FKs bypassed). */
export function wipeMember(memberId) {
  psql(`begin; set local session_replication_role = replica;
    delete from guest_sessions where member_id = '${memberId}';
    delete from loyalty_events where member_id = '${memberId}';
    delete from loyalty_progress where member_id = '${memberId}';
    delete from session_attempts where member_id = '${memberId}';
    delete from front_desk_alerts where member_id = '${memberId}';
    delete from attendance_events where member_id = '${memberId}';
    delete from refunds where payment_id in (select id from payments where member_id = '${memberId}');
    delete from payments where member_id = '${memberId}';
    delete from subscriptions where member_id = '${memberId}';
  commit;`);
}

/**
 * Put `stamps` ledger events + the matching loyalty_progress row on a member, last stamp `ageDays` old.
 * Setup only: the final steps of every scenario go through the real RPCs. Replay still equals progress.
 */
export function seedStamps(gid, memberId, counter, stamps, ageDays = 1) {
  if (!stamps) return;
  const col = counter === "guest" ? "guest" : "subscriber";
  psql(`begin; set local session_replication_role = replica;
    insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
      select '${gid}', '${memberId}', 'stamp_earned', '${counter}', gen_random_uuid(),
             now() - make_interval(days => ${ageDays} + (${stamps} - g)), jsonb_build_object('qa_seed', true, 'stamps_after', g)
      from generate_series(1, ${stamps}) g;
    insert into loyalty_progress (gym_id, member_id, ${col}_stamps, ${col}_last_event_at)
      values ('${gid}', '${memberId}', ${stamps}, now() - make_interval(days => ${ageDays}))
      on conflict (gym_id, member_id) do update set ${col}_stamps = excluded.${col}_stamps, ${col}_last_event_at = excluded.${col}_last_event_at;
  commit;`);
}

export async function deskPay(memberId, who = "receptionist@epic20qa.test") {
  const c = await signIn(who);
  must(await c.rpc("record_session_payment", { p_member_id: memberId, p_method: "cash", p_reason: "QA loyalty seed" }), "record_session_payment");
}
export async function scan(phone) {
  const c = await signIn(phone);
  must(await c.rpc("check_in", { p_client_scan_id: randomUUID() }), "check_in");
}
export const checkout = (memberId) =>
  psql(`update attendance_events set checked_out_at = now() where member_id = '${memberId}' and checked_out_at is null`);

export async function renew(memberId, who = "receptionist@epic20qa.test") {
  const c = await signIn(who);
  return must(await c.rpc("confirm_renewal", { p_member_id: memberId, p_method: "cash", p_reason: "QA loyalty seed renewal" }), "confirm_renewal");
}

export async function setProgram(enabled, n = N, k = K, r = R) {
  const owner = await signIn("owner@epic20qa.test");
  must(await owner.rpc("set_loyalty_program", { p_enabled: enabled, p_n: n, p_k: k, p_r: r }), "set_loyalty_program");
}
