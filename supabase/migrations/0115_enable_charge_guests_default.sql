-- Story 19.12: V1.6 session guests enablement (migration 0115).
--
-- FR-157: charging per session is on by default for gyms created AFTER V1.6.
-- Catalog-only: gyms.charge_guests_per_session keeps NOT NULL and every
-- existing row keeps whatever value it has (off, unless an owner enabled it
-- through set_guest_charging since 0107). Ships last, only once the release
-- gates in docs/decisions.md "V1.6 release runbook" are closed.
--
-- Safe under autocommit: the before/after comparison lives in one DO block,
-- so nothing depends on the file being wrapped in a transaction.
--
-- Rollback: scripts/rollback-0115-enable-charge-guests-default.sql.

do $apply$
declare
  v_before text;
  v_after text;
begin
  -- Fail fast rather than queue every gyms query behind a long transaction.
  set local lock_timeout = '5s';

  -- Same lock the ALTER takes, so no gym can change between snapshot and check.
  lock table gyms in access exclusive mode;

  select md5(coalesce(string_agg(id::text || ':' || charge_guests_per_session::text, ',' order by id), ''))
    into v_before from gyms;

  alter table gyms alter column charge_guests_per_session set default true;

  select md5(coalesce(string_agg(id::text || ':' || charge_guests_per_session::text, ',' order by id), ''))
    into v_after from gyms;

  if v_before is distinct from v_after then
    raise exception '0115: an existing gym''s charge_guests_per_session changed';
  end if;
end;
$apply$;

do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gyms'
      and column_name = 'charge_guests_per_session'
      and is_nullable = 'NO' and column_default = 'true'
  ) then
    raise exception '0115: gyms.charge_guests_per_session must be NOT NULL DEFAULT true';
  end if;
end;
$verify$;
