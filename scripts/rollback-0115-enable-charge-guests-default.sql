-- Rollback for migration 0115 (charge-guests default on for new gyms).
-- Forward fix only: restores the 0107 default. Gyms created while the default
-- was true keep their value (true); turn those off via set_charge_guests_per_session
-- if needed.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0115-enable-charge-guests-default.sql

alter table gyms alter column charge_guests_per_session set default false;

do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gyms'
      and column_name = 'charge_guests_per_session'
      and is_nullable = 'NO' and column_default = 'false'
  ) then
    raise exception 'rollback-0115: default is not false';
  end if;
end;
$verify$;
