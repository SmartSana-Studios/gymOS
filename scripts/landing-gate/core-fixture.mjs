#!/usr/bin/env node
// Local-only: one throwaway gym with an Owner (email) and a member (phone) holding an active subscription, for the core-product probes of load.mjs.
//
//   SUPABASE_API_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/landing-gate/core-fixture.mjs up > core.env
//   node scripts/landing-gate/core-fixture.mjs down
//
// `up` prints `export GATE_CORE_...` lines; `down` removes every row it made. Refuses a non-local database or API URL.
import { loadPg } from "./lib/resolve.mjs";
import { config } from "./lib/config.mjs";
import { assertLocal } from "./seed.mjs";

const apiUrl = process.env.SUPABASE_API_URL ?? "http://127.0.0.1:54321";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSWORD = "GateProbe!2026";
const OWNER = { email: "gate-core-owner@fixture.gymos.test", phone: "+237699000091" };
const MEMBER = { phone: "+237699000092" };
const GYM = "00000000-0000-0000-0000-0000000024e1";

async function admin(path, init = {}) {
  const r = await fetch(`${apiUrl}/auth/v1/admin${path}`, { ...init, headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", ...init.headers } });
  if (!r.ok && r.status !== 404) throw new Error(`auth admin ${path}: ${r.status} ${await r.text()}`);
  return r.status === 404 ? null : r.json();
}

async function findUserIds(client) {
  const { rows } = await client.query("select id from auth.users where email = $1 or phone = any($2)", [OWNER.email, [OWNER.phone.slice(1), MEMBER.phone.slice(1)]]);
  return rows.map((r) => r.id);
}

async function down(client) {
  const ids = await findUserIds(client);
  await client.query("delete from attendance_events where gym_id = $1", [GYM]);
  await client.query("delete from subscriptions where gym_id = $1", [GYM]);
  await client.query("delete from members where gym_id = $1", [GYM]);
  await client.query("delete from plans where gym_id = $1", [GYM]);
  await client.query("delete from gyms where id = $1", [GYM]);
  for (const id of ids) await admin(`/users/${id}`, { method: "DELETE" });
}

async function up(client) {
  await down(client);
  const owner = await admin("/users", { method: "POST", body: JSON.stringify({ email: OWNER.email, phone: OWNER.phone, password: PASSWORD, email_confirm: true, phone_confirm: true }) });
  if (!owner?.id) throw new Error("core fixture: the Owner auth user was not created (is SUPABASE_SERVICE_ROLE_KEY the service-role key of this project?)");
  const member = await admin("/users", { method: "POST", body: JSON.stringify({ phone: MEMBER.phone, password: PASSWORD, phone_confirm: true }) });
  if (!member?.id) throw new Error("core fixture: the member auth user was not created");
  const { rows: tiers } = await client.query("select id from tiers order by created_at limit 1");
  await client.query("insert into gyms (id, name, tier_id, status) values ($1, 'Gate Core Probe Gym', $2, 'active')", [GYM, tiers[0].id]);
  const { rows: plan } = await client.query(
    "insert into plans (gym_id, name, plan_type, price, currency, billing_interval, duration_days) values ($1, 'Gate Monthly', 'monthly', 15000, 'XAF', 'monthly', 30) returning id",
    [GYM],
  );
  const { rows: m } = await client.query(
    "insert into members (gym_id, user_id, role, name, phone) values ($1, $2, 'member', 'Gate Probe Member', $3) returning id",
    [GYM, member.id, MEMBER.phone],
  );
  await client.query("insert into members (gym_id, user_id, role, name, phone) values ($1, $2, 'owner', 'Gate Probe Owner', $3)", [GYM, owner.id, OWNER.phone]);
  await client.query("update users set must_change_password = false where id = $1", [owner.id]);
  await client.query(
    "insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values ($1, $2, $3, 'active', current_date, current_date + 30)",
    [GYM, m[0].id, plan[0].id],
  );
}

assertLocal(config.adminDbUrl);
assertLocal(apiUrl); // the service-role key below writes auth users: it must point at the local stack too, not only the database URL
const { Client } = loadPg();
const client = new Client({ connectionString: config.adminDbUrl });
await client.connect();
try {
  const cmd = process.argv[2];
  if (cmd === "up") {
    if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
    await up(client);
    const out = {
      GATE_CORE_API_URL: apiUrl,
      GATE_CORE_OWNER_EMAIL: OWNER.email,
      GATE_CORE_OWNER_PASSWORD: PASSWORD,
      GATE_CORE_MEMBER_PHONE: MEMBER.phone,
      GATE_CORE_MEMBER_PASSWORD: PASSWORD,
    };
    for (const [k, v] of Object.entries(out)) console.log(`export ${k}='${v}'`);
  } else if (cmd === "down") {
    await down(client);
    console.error("core fixture removed");
  } else throw new Error("usage: core-fixture.mjs up|down");
} finally {
  await client.end();
}
