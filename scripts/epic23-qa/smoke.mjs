// Epic 23 QA smoke at the database level, with real JWTs. node scripts/epic23-qa/smoke.mjs
// The dashboard request path for support (TOTP sign-in, session_gate_touch, gym picker) is story 23-6b and is NOT built yet
// (docs/decisions.md, Story 23.6), so this script plays that part: it signs in, passes the second factor, then calls
// session_gate_touch with the service role, exactly what the dashboard will do per request.
import { admin, signInPw, readState, freshTotp, SUPPORT_PW, must } from "./lib.mjs";

const st = readState();
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };

async function session(handle) {
  const email = `qa23-${handle}@gymosapps.com`;
  const c = await signInPw(email, SUPPORT_PW);
  const f = (await c.auth.mfa.listFactors()).data?.totp?.[0];
  must(await c.auth.mfa.challengeAndVerify({ factorId: f.id, code: await freshTotp(st.secrets[email]) }), "aal2");
  const jwt = (await c.auth.getSession()).data.session.access_token;
  const cl = claims(jwt);
  const touch = await admin.rpc("session_gate_touch", { p_user: cl.sub, p_session: cl.session_id });
  return { c, claims: cl, touch: touch.data?.[0] ?? touch.data ?? touch.error?.message };
}
const members = async (s, gym) => (await s.c.from("members").select("id").eq("gym_id", gym)).data?.length ?? 0;

const active = await session("active");
check("active: JWT is aal2 and carries app_role support", active.claims.aal === "aal2" && active.claims.app_role === "support");
check("active: sees Gym A members through the live gate", (await members(active, st.gyms.A)) > 0);
check("active: sees nothing in Gym B (assignment pending, switch off)", (await members(active, st.gyms.B)) === 0);
check("active: sees nothing in the suspended gym (no assignment)", (await members(active, st.gyms.S)) === 0);
for (const [handle, why] of [["locked", "velocity-locked"], ["recert", "recertification overdue"]]) {
  const s = await session(handle);
  check(`${handle}: sees nothing in Gym A (${why})`, (await members(s, st.gyms.A)) === 0);
}
console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
