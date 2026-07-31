-- Story 4.1: multi-gateway payment-provider registry (user-directed scope
-- expansion, not FR/story-sourced -- see the story file's Scope Note).
-- Lets a Super Admin switch the platform's active payment gateway at
-- runtime, with no deploy required -- deliberately NOT the OTP_PROVIDER
-- env-var pattern (Story 2.1), which requires a redeploy to change.
-- Recorded in docs/decisions.md.

create table payment_providers (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  display_name text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index idx_payment_providers_key_unique on payment_providers (provider_key);

-- DB-enforced "exactly one active provider" (AC #5) -- same partial-unique-index
-- technique as idx_attendance_events_one_open_per_member (Story 3.4,
-- 0023_member_check_in_one_open_session_enforcement.sql).
create unique index idx_payment_providers_one_active on payment_providers (is_active) where is_active;

alter table payment_providers enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
grant select, insert, update, delete on payment_providers to authenticated, service_role;

-- Deny-all default (0002's baseline discipline). The only sanctioned mutation
-- path is activate_payment_provider() below (security definer) -- no
-- INSERT/UPDATE/DELETE policy is added for any role, matching audit_log's
-- "single blessed write path" posture (log_audit_event()). platform_metrics()-
-- style aggregate reads aren't needed here; this is a tiny table every
-- super_admin session can just SELECT directly.
create policy "super_admin_read_payment_providers" on payment_providers
  for select
  using (private.is_super_admin());

-- ----------------------------------------------------------------------------
-- payments.provider: forward-compatible nullable column for Story 4.2 to
-- populate -- this story does not write to it. Nullable since cash/
-- bank_transfer/manual_momo payments have no provider, matching
-- provider_transaction_ref's existing nullable reasoning (0005_payments.sql).
-- ----------------------------------------------------------------------------
alter table payments add column provider text references payment_providers(provider_key);

-- ----------------------------------------------------------------------------
-- activate_payment_provider(): the only sanctioned write path into
-- payment_providers. Deactivates whichever row is currently active,
-- activates the target, and audit-logs -- all in one atomic transaction
-- (AC #7), not two separate audit-then-update calls a caller could split.
-- ----------------------------------------------------------------------------
create function activate_payment_provider(p_provider_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_key text;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  if not exists (select 1 from payment_providers where provider_key = p_provider_key) then
    raise exception 'activate_payment_provider: unknown provider_key %', p_provider_key;
  end if;

  -- Lock the currently-active row (if any) before reading it, so a concurrent
  -- activate_payment_provider() call can't read the same stale previous_key
  -- and log an incorrect previous_provider_key in the audit trail -- the
  -- exactly-one-active invariant itself is still DB-enforced by the partial
  -- unique index regardless, this closes the audit-log race specifically.
  select provider_key into v_previous_key from payment_providers where is_active limit 1 for update;

  if v_previous_key is distinct from p_provider_key then
    update payment_providers set is_active = false where is_active;
    update payment_providers set is_active = true where provider_key = p_provider_key;

    perform log_audit_event(
      p_action_type => 'payment_provider_activated',
      p_target_entity_id => p_provider_key,
      p_target_entity_type => 'payment_provider',
      p_metadata => jsonb_build_object(
        'previous_provider_key', v_previous_key,
        'new_provider_key', p_provider_key
      )
    );
  end if;
end;
$$;

revoke execute on function activate_payment_provider from public;
grant execute on function activate_payment_provider to authenticated;

-- ----------------------------------------------------------------------------
-- active_payment_provider(): the one narrow read path every gym-scoped
-- session needs (AC #9) -- Story 4.2 uses this to know which concrete
-- provider to instantiate. Does not expose the full payment_providers table.
-- ----------------------------------------------------------------------------
create function active_payment_provider()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select provider_key from payment_providers where is_active limit 1;
$$;

revoke execute on function active_payment_provider from public;
grant execute on function active_payment_provider to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Seed: TaraMoney is registered and active (AC #3). Task 9's first real-spike
-- attempt (2026-07-31, GYM OS business 9FmIZg9GBB) got
-- BUSINESS_NOT_ACTIVATED_PLEASE_CONTACT_SUPPORT -- an account-provisioning
-- gap on TaraMoney's side, not a code defect. Task 9 was re-run the same day
-- against a separate, already-activated "Temporal" TaraMoney business
-- (wxND8vZv5v, user-supplied stand-in while 9FmIZg9GBB awaits activation)
-- and PASSED in full: real auth, a real 100 XAF Orange Money collection,
-- a real webhook delivery (confirming the signature mechanism and payload
-- shape), and a replay-idempotency check (duplicate delivery -> no duplicate
-- payments row). Full evidence in docs/decisions.md. Swap supabase/.env's
-- TARAMONEY_* credentials back to the GYM OS business once TaraMoney support
-- activates 9FmIZg9GBB -- this registry row/seed does not need to change
-- when that happens, only the credentials do.
-- ----------------------------------------------------------------------------
insert into payment_providers (provider_key, display_name, is_active)
values ('taramoney', 'TaraMoney', true);
