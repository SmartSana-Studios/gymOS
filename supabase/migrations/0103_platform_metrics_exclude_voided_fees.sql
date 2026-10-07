-- ============================================================================
-- 0103: platform_metrics() stops counting voided payments.
--
-- A voided registration fee keeps status = 'verified' (0101: the row is kept
-- for audit, voided_at is set). The platform-wide "payments processed" sum in
-- platform_metrics() (0011) filtered on status alone, so a fee that staff
-- voided as recorded-in-error still inflated the number. gym_revenue_mtd()
-- already excludes voided rows (0101); this brings the platform total in line.
--
-- CREATE OR REPLACE with the identical signature, so grants are preserved.
-- Nothing else in the body changes.
-- ============================================================================

create or replace function public.platform_metrics()
returns table(total_gyms bigint, total_members bigint, total_payments_processed bigint, active_gyms bigint, suspended_gyms bigint, deactivated_gyms bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  return query
  select
    (select count(*) from gyms)::bigint,
    (select count(*) from members)::bigint,
    -- 'verified' is the only payment_status meaning confirmed/reconciled
    -- money; voided_at marks a record kept for audit that never counted.
    (select coalesce(sum(amount), 0) from payments where status = 'verified' and voided_at is null)::bigint,
    (select count(*) from gyms where status = 'active')::bigint,
    (select count(*) from gyms where status = 'suspended')::bigint,
    (select count(*) from gyms where status = 'deactivated')::bigint;
end;
$function$;

do $verify$
begin
  if pg_get_functiondef('public.platform_metrics()'::regprocedure) not like '%voided_at is null%' then
    raise exception '0103 verify: platform_metrics does not exclude voided payments';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.platform_metrics()'::regprocedure) then
    raise exception '0103 verify: platform_metrics lost SECURITY DEFINER';
  end if;
end
$verify$;
