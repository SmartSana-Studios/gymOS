import { test } from "node:test";
import assert from "node:assert/strict";
import { scanRepo, scanSql, scanSources } from "../check-credentials-id.mjs";

const mig = (file, text) => ({ file, text });

test("the real tree passes: every initiator and credential lookup goes through credentials_id (23.9)", () => {
  assert.deepEqual(scanRepo(), []);
});

test("an initiator that inserts a payment without credentials_id is caught", () => {
  const bad = scanSql([
    mig("0001.sql", "create function initiate_session_payment() returns void as $$ begin insert into payments (gym_id, provider) values (1, 'x'); end $$;"),
  ]);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /initiate_session_payment/);
});

test("only the LATEST definition counts: a later fix clears an earlier miss", () => {
  const ok = scanSql([
    mig("0001.sql", "create function initiate_session_payment() returns void as $$ begin insert into payments (gym_id) values (1); end $$;"),
    mig("0002.sql", "create or replace function public.initiate_session_payment() returns void as $$ begin insert into payments (gym_id, credentials_id) values (1, 2); end $$;"),
  ]);
  assert.deepEqual(ok, []);
});

test("a comment that mentions credentials_id does not count", () => {
  const bad = scanSql([
    mig("0001.sql", "create function initiate_member_payment() returns void as $$ begin -- credentials_id\n insert into payments (gym_id) values (1); end $$;"),
  ]);
  assert.equal(bad.length, 1);
});

test("a reconciliation job that joins on the active row is caught", () => {
  const bad = scanSql([
    mig("0001.sql", "create function run_payment_reconciliation_job() returns void as $$ begin select 1 from payments p join gym_payment_credentials g on g.gym_id = p.gym_id; end $$;"),
  ]);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /reconciliation/);
});

test("an edge function lookup without p_credentials_id is caught; with it, it passes", () => {
  const path = "supabase/functions/payment-webhook/_shared/x.ts";
  const bad = scanSources([{ path, text: 'await sb.rpc("get_gym_payment_credentials_for_service", { p_gym_id: g, p_provider_key: k });' }]);
  assert.equal(bad.length, 1);
  const ok = scanSources([{ path, text: 'await sb.rpc("get_gym_payment_credentials_for_service", { p_gym_id: g, p_provider_key: k, p_credentials_id: c });' }]);
  assert.deepEqual(ok, []);
});

test("the business-id lookup must say which payment the delivery is for", () => {
  const path = "supabase/functions/payment-webhook/_shared/x.ts";
  assert.equal(scanSources([{ path, text: 'sb.rpc("get_gym_payment_credentials_by_business_id", { p_business_id: b, p_provider_key: k });' }]).length, 1);
});

test("a client app calling a service-only lookup is caught", () => {
  const bad = scanSources([{ path: "apps/dashboard/services/x.ts", text: 'supabase.rpc("get_gym_payment_credentials_for_service", { p_gym_id: g })' }]);
  assert.equal(bad.length, 1);
});

test("a payments read in the webhook that feeds verification must select credentials_id", () => {
  const path = "supabase/functions/payment-webhook/index.ts";
  const bad = scanSources([{ path, text: 'credentialsId; supabase.from("payments").select("id, gym_id, status, provider_transaction_ref")' }]);
  assert.equal(bad.length, 1);
});
