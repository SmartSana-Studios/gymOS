-- Migration 0044: trigger to keep updated_at current on device_push_tokens
-- Adds a simple BEFORE UPDATE trigger to maintain updated_at = now()

create or replace function set_device_push_tokens_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Unlike every other `create trigger` in this codebase's migration history
-- (forward-only, run exactly once), this one is guarded by an existence
-- check scoped to both trigger name *and* target relation (tgrelid) --
-- rerun-safety cheaply avoids a duplicate-trigger error if this migration
-- is ever replayed against a database that already has it.
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_device_push_tokens_set_updated_at'
      and tgrelid = 'device_push_tokens'::regclass
  ) then
    execute 'create trigger trg_device_push_tokens_set_updated_at
      before update on device_push_tokens
      for each row
      execute function set_device_push_tokens_updated_at()';
  end if;
end;
$$;
