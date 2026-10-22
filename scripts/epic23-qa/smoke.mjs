// Epic 23 QA smoke at the database level, with real JWTs. node scripts/epic23-qa/smoke.mjs
// Plays the dashboard request path for support (story 23-6b) end to end with the same calls the dashboard makes:
//   password -> authenticator code -> support_begin_session -> refresh (no gym yet) -> list_own_support_gyms -> switch_active_gym
//   -> refresh (the explicit gym is in the JWT) -> session_gate_touch (what the request proxy calls) -> reads / authorize_action.
import { admin, psql, signInPw, readState, freshTotp, SUPPORT_PW, must } from "./lib.mjs";

const st = readState();
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };
const jwtOf = async (c) => claims((await c.auth.getSession()).data.session.access_token);

/** Sign in and pass the second factor: an aal2 session with NO gym chosen yet. */
async function afterCodeStep(handle) {
  const email = `qa23-${handle}@gymosapps.com`;
  const c = await signInPw(email, SUPPORT_PW);
  const aal1 = await jwtOf(c);
  const f = (await c.auth.mfa.listFactors()).data?.totp?.[0];
  must(await c.auth.mfa.challengeAndVerify({ factorId: f.id, code: await freshTotp(st.secrets[email]) }), "aal2");
  must(await c.rpc("support_begin_session"), "support_begin_session");
  must(await c.auth.refreshSession(), "refresh after the code step");
  return { c, aal1, afterCode: await jwtOf(c) };
}
const pickGym = async (s, gym) => {
  const r = await s.c.rpc("switch_active_gym", { p_gym_id: gym });
  if (r.error) return r.error.message;
  must(await s.c.auth.refreshSession(), "refresh after the picker");
  s.claims = await jwtOf(s.c);
  return null;
};
const gate = async (s) => {
  const r = await admin.rpc("session_gate_touch", { p_user: s.claims.sub, p_session: s.claims.session_id });
  return r.data?.[0] ?? { ok: false, reason: r.error?.message };
};
const authorize = async (s, cap, gym, withSession = true) =>
  (await admin.rpc("authorize_action", { p_actor: s.claims.sub, p_gym_id: gym, p_capability: cap, p_session: withSession ? s.claims.session_id : null })).data?.[0];
const members = async (s, gym) => (await s.c.from("members").select("id").eq("gym_id", gym)).data?.length ?? 0;
const gymsVisible = async (s) => ((await s.c.from("gyms").select("id")).data ?? []).map((g) => g.id).sort();

// ---- the active person: A active, B pending ----
const active = await afterCodeStep("active");
check("active: the password session carries no gym or role", !active.aal1.gym_id && !active.aal1.app_role && active.aal1.aal === "aal1");
check("active: after the code step the JWT is aal2 and carries NO gym (no default gym)", active.afterCode.aal === "aal2" && !active.afterCode.gym_id && !active.afterCode.app_role);
const picker = (await active.c.rpc("list_own_support_gyms")).data ?? [];
check("active: the picker lists Gym A only (B is pending)", picker.length === 1 && picker[0].gym_id === st.gyms.A);
check("active: switching to Gym B (pending assignment) is refused", (await pickGym(active, st.gyms.B)) !== null);
check("active: switching to the suspended gym (no assignment) is refused", (await pickGym(active, st.gyms.S)) !== null);
check("active: picking Gym A puts exactly that gym in the JWT as role support", (await pickGym(active, st.gyms.A)) === null && active.claims.gym_id === st.gyms.A && active.claims.app_role === "support");
check("active: before the gate has run, nothing is readable (no heartbeat yet)", (await members(active, st.gyms.A)) === 0 && (await gymsVisible(active)).length === 0);
check("active: the gate answers ok", (await gate(active)).ok === true);
check("active: sees Gym A members through the live gate", (await members(active, st.gyms.A)) > 0);
check("active: reads exactly Gym A's gym row", JSON.stringify(await gymsVisible(active)) === JSON.stringify([st.gyms.A]));
check("active: sees nothing in Gym B or the suspended gym", (await members(active, st.gyms.B)) === 0 && (await members(active, st.gyms.S)) === 0);
for (const cap of ["staff.create", "member.provision", "member.registration_fee_state", "payment.initiate_staff"]) {
  const d = await authorize(active, cap, st.gyms.A);
  check(`active: authorize_action ${cap} allowed as support`, d?.allowed === true && d.actor_role === "support");
}
check("active: authorize_action without the session id is denied", (await authorize(active, "member.provision", st.gyms.A, false))?.allowed === false);
check("active: authorize_action billing.saas_pay is denied", (await authorize(active, "billing.saas_pay", st.gyms.A))?.allowed === false);
check("active: authorize_action for a gym with no assignment is denied", (await authorize(active, "member.provision", st.gyms.B))?.allowed === false);

// ---- locked and overdue recertification: the gate or the live check refuses ----
const locked = await afterCodeStep("locked");
check("locked: can still pick Gym A (the lock is the gate's job)", (await pickGym(locked, st.gyms.A)) === null);
const lockedGate = await gate(locked);
check("locked: the gate answers locked", lockedGate.ok === false && lockedGate.reason === "locked");
check("locked: sees nothing in Gym A", (await members(locked, st.gyms.A)) === 0);

const recert = await afterCodeStep("recert");
check("recert: can pick Gym A", (await pickGym(recert, st.gyms.A)) === null);
check("recert: the gate itself is ok (recertification is a live-check leg)", (await gate(recert)).ok === true);
check("recert: sees nothing in Gym A (recertification overdue)", (await members(recert, st.gyms.A)) === 0);
check("recert: authorize_action is denied (support_not_live)", (await authorize(recert, "member.provision", st.gyms.A))?.reason === "support_not_live");

// ---- revoked mid-session: the JWT still carries the gym, the next request must not ----
const second = await afterCodeStep("second");
check("second: picks Gym A and reads members", (await pickGym(second, st.gyms.A)) === null && (await gate(second)).ok === true && (await members(second, st.gyms.A)) > 0);
check("second: the picker list still names Gym A", ((await second.c.rpc("list_own_support_gyms")).data ?? []).some((g) => g.gym_id === st.gyms.A));
const assignmentSql = (state) => `update public.support_assignments set state = '${state}' where gym_id = '${st.gyms.A}' and support_user_id = '${second.claims.sub}' and state <> 'ended'`;
psql(`${assignmentSql("suspended")};`);
try {
  check("second: JWT still carries the gym after the revoke (the stale-claim window)", (await jwtOf(second.c)).gym_id === st.gyms.A);
  check("second: the picker list is empty, so the proxy sends the request back to the picker", ((await second.c.rpc("list_own_support_gyms")).data ?? []).length === 0);
  check("second: reads nothing in Gym A at once", (await members(second, st.gyms.A)) === 0 && (await gymsVisible(second)).length === 0);
  check("second: authorize_action is denied", (await authorize(second, "member.provision", st.gyms.A))?.allowed === false);
} finally {
  psql(`${assignmentSql("active")};`);
}
check("second: with the assignment active again the same session is live", (await members(second, st.gyms.A)) > 0);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
