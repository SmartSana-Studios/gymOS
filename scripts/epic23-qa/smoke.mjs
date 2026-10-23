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

// ---- 23-6c: refund, fee waiver and staff creation need a single-use grant from a fresh code (what the dashboard dialogs do) ----
// The dashboard verifies the code on the caller's own session, then the service role records the grant (stepup_issue); the write consumes it.
const activeEmail = "qa23-active@gymosapps.com";
let lastCode = null;
async function stepUp(s, email, action, subject) {
  const f = (await s.c.auth.mfa.listFactors()).data.totp[0];
  let code;
  do { code = await freshTotp(st.secrets[email]); if (code === lastCode) await new Promise((r) => setTimeout(r, 1500)); } while (code === lastCode);
  lastCode = code;
  const v = await s.c.auth.mfa.challengeAndVerify({ factorId: f.id, code });
  if (v.error) return { verified: false, error: v.error.message };
  const g = await admin.rpc("stepup_issue", { p_user: s.claims.sub, p_action: action, p_subject: subject });
  return { verified: true, grant: !g.error && !!g.data, error: g.error?.message };
}
const one = async (sql) => psql(sql).trim();
const memberIds = (await admin.from("members").select("id").eq("gym_id", st.gyms.A).eq("role", "member").order("created_at")).data.map((m) => m.id);
const paymentOf = async (member) => (await admin.from("payments").insert({ gym_id: st.gyms.A, member_id: member, amount: 5000, method: "cash", status: "verified", reason: "QA refund target" }).select("id").single()).data.id;
const payA = await paymentOf(memberIds[0]);
const refund = (payment) => active.c.from("refunds").insert({ gym_id: st.gyms.A, payment_id: payment, amount: 1000, reason: "QA refund by support" });
check("refund: no grant, the write is refused with the step-up error", /step_up_required/.test((await refund(payA)).error?.message ?? ""));
const su1 = await stepUp(active, activeEmail, "support_refund", payA);
check("refund: a valid code issues the grant", su1.verified && su1.grant, su1.error ?? "");
check("refund: with the grant the refund is recorded", !(await refund(payA)).error);
const refundAudit = (await admin.from("audit_log").select("id, action_type, actor_id").eq("action_type", "refund_recorded").eq("gym_id", st.gyms.A)).data ?? [];
check("refund: a support refund writes one refund_recorded audit row, under the gym proxy", refundAudit.length === 1 && !!refundAudit[0].actor_id, JSON.stringify(refundAudit));
const refundIdentity = refundAudit.length ? psql(`select real_user_id from support_action_identity where subject_table = 'audit_log' and subject_id = '${refundAudit[0].id}'`).split("\n").filter(Boolean) : [];
check("refund: that audit row has the real person behind it (what the Super Admin reader shows)", refundIdentity.length === 1, JSON.stringify(refundIdentity));
const payB = await paymentOf(memberIds[1]);
check("refund: the grant is single-use and bound to its payment (another payment is refused)", /step_up_required/.test((await refund(payB)).error?.message ?? ""));

// the seed members are settled on insert; put one back to "awaiting the fee" so there is something to waive
psql(`update public.members set registration_fee_settled_at = null where id = '${memberIds[2]}'`);
const waive = (member) => active.c.rpc("waive_registration_fee", { p_member_id: member, p_reason: "QA waiver by support" });
check("waive: no grant, refused with the step-up error", /step_up_required/.test((await waive(memberIds[2])).error?.message ?? ""));
const su2 = await stepUp(active, activeEmail, "support_waive_registration_fee", memberIds[2]);
check("waive: a valid code issues the grant", su2.verified && su2.grant, su2.error ?? "");
check("waive: with the grant the fee is waived", !(await waive(memberIds[2])).error);
check("waive: replaying the same grant is refused by the database", /step_up_required/.test((await waive(memberIds[2])).error?.message ?? ""));

const staffPhone = `2376990${String(Date.now()).slice(-5)}`;
const newStaff = await admin.auth.admin.createUser({ phone: `+${staffPhone}`, password: "Epic23Staff!1", phone_confirm: true });
const createStaff = () => active.c.rpc("create_staff_member", { p_user_id: newStaff.data.user.id, p_name: "QA Support Hire", p_phone: `+${staffPhone}`, p_role: "coach" });
check("staff: no grant, refused with the step-up error", /step_up_required/.test((await createStaff()).error?.message ?? ""));
const su3 = await stepUp(active, activeEmail, "support_create_staff", newStaff.data.user.id);
check("staff: a valid code issues the grant bound to the new user id", su3.verified && su3.grant, su3.error ?? "");
const created = await createStaff();
check("staff: with the grant the staff member is created", !created.error, created.error?.message ?? "");

// ---- wrong codes are counted in one per-user counter and lock the account (sign-in and dialogs share it) ----
const lockSession = await afterCodeStep("second");
await pickGym(lockSession, st.gyms.A);
const wrong = await lockSession.c.auth.mfa.challengeAndVerify({ factorId: (await lockSession.c.auth.mfa.listFactors()).data.totp[0].id, code: "000000" });
check("lock: a wrong code is rejected by the provider with the rejected-code error", ["mfa_verification_failed", "mfa_verification_rejected"].includes(wrong.error?.code), wrong.error?.code ?? "");
let counted = (await admin.rpc("stepup_record_failure", { p_user: lockSession.claims.sub })).data?.[0];
check("lock: the first wrong code is counted and does not lock", counted && counted.locked === false && counted.attempts === 1);
for (let i = 1; i < (counted?.threshold ?? 5); i++) counted = (await admin.rpc("stepup_record_failure", { p_user: lockSession.claims.sub })).data?.[0];
check("lock: the threshold locks the account", counted?.locked === true);
check("lock: the gate then answers locked and nothing is readable", (await gate(lockSession)).ok === false && (await members(lockSession, st.gyms.A)) === 0);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
