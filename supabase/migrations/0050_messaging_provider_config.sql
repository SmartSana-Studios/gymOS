-- Story 1.13: Super Admin Evolution API instance configuration. Adopting a
-- self-hosted Evolution API WhatsApp gateway (sprint-change-proposal
-- 2026-08-08, sections 4.3/4.3b) -- lets a Super Admin repoint the platform
-- at a working instance ID with no redeploy when a connected WhatsApp
-- number disconnects. This story only stores the string; the Epic 2
-- spike/chain story and the Story 2.5 revision are the ones that read it to
-- actually call Evolution API.

-- Singleton table, same posture as payment_providers
-- (0029_payment_provider_registry.sql) but with only ever one row, not a
-- multi-row "exactly one active" shape -- no partial-unique-index needed.
-- instance_id is nullable: represents "not yet configured" (AC #1's
-- fallback state); there is no real placeholder value to seed since
-- Evolution API is a self-hosted service outside this migration's control.
create table messaging_provider_config (
  id uuid primary key default gen_random_uuid(),
  instance_id text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

-- Seed exactly one row. No INSERT policy is ever granted to any role below,
-- so the row count is structurally fixed at 1 forever -- update_messaging_instance()
-- is the only sanctioned write path and it only ever UPDATEs.
--
-- Guarded with WHERE NOT EXISTS (review finding: make the seed re-run-safe)
-- rather than `ON CONFLICT DO NOTHING` -- `id` defaults to a fresh
-- gen_random_uuid() on every insert and instance_id carries no unique
-- constraint, so a plain ON CONFLICT clause would never actually trigger on
-- a re-run and a second row would still be inserted silently, breaking the
-- singleton invariant this table depends on. NOT EXISTS is the form that
-- actually makes this a no-op past the first run.
insert into messaging_provider_config (instance_id)
select null
where not exists (select 1 from messaging_provider_config);

alter table messaging_provider_config enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
grant select, insert, update, delete on messaging_provider_config to authenticated, service_role;

-- Deny-all default (0002's baseline discipline). The only sanctioned
-- mutation path is update_messaging_instance() below (security definer) --
-- no INSERT/UPDATE/DELETE policy is added for any role, matching
-- payment_providers/audit_log's "single blessed write path" posture.
create policy "super_admin_read_messaging_config" on messaging_provider_config
  for select
  using (private.is_super_admin());

-- ----------------------------------------------------------------------------
-- update_messaging_instance(): the only sanctioned write path into
-- messaging_provider_config. Mirrors activate_payment_provider()'s shape
-- (0029_payment_provider_registry.sql) -- validates, locks the singleton row,
-- updates, and audit-logs, all in one atomic transaction.
-- ----------------------------------------------------------------------------
create function update_messaging_instance(p_instance_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous text;
  v_row_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  if p_instance_id is null or btrim(p_instance_id) = '' then
    raise exception 'update_messaging_instance: instance_id must not be empty';
  end if;

  -- Lock the singleton row before reading it, for the identical race-safety
  -- reason documented in activate_payment_provider()'s comment (concurrent
  -- callers must not both log a stale previous_instance_id).
  select id, instance_id into v_row_id, v_previous from messaging_provider_config for update;

  update messaging_provider_config
  set instance_id = p_instance_id, updated_by = auth.uid(), updated_at = now()
  where id = v_row_id;

  -- Saving the same value twice is still a legitimate, intentional Super
  -- Admin action worth its own audit trail entry (unlike
  -- activate_payment_provider's idempotent reactivate case) -- no no-op
  -- short-circuit here.
  --
  -- The audit write is wrapped in its own exception block (review finding):
  -- without it, an audit_log failure would roll back the instance_id update
  -- above via plpgsql's default whole-transaction rollback, blocking AC #2's
  -- "takes effect with no redeploy" guarantee on an unrelated subsystem
  -- failure. A failed audit write is logged and swallowed rather than
  -- re-raised, so the instance change still lands.
  begin
    perform log_audit_event(
      p_action_type => 'messaging_instance_updated',
      p_target_entity_id => v_row_id::text,
      p_target_entity_type => 'messaging_provider_config',
      p_metadata => jsonb_build_object(
        'previous_instance_id', v_previous,
        'new_instance_id', p_instance_id
      )
    );
  exception when others then
    raise warning 'update_messaging_instance: audit log write failed, instance update still applied: %', sqlerrm;
  end;
end;
$$;

revoke execute on function update_messaging_instance from public;
grant execute on function update_messaging_instance to authenticated;
