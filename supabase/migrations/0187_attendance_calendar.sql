-- ============================================================================
-- 0187: The attendance calendar's two reads (Epic 30, Story 30.5; FR-224, FR-225, NFR-027, NFR-028, NFR-029; AD-53, AD-56).
--
-- A member has no way to see the days they came. member_visit_days already holds every counted day (0173); nothing returns them to a member.
--   public.my_visit_days(p_month date)  -> (visit_day date, milestone smallint): the caller's distinct counted visit days of one gym-local month.
--                                          `milestone` is NULL on every row here; Story 30.7 fills it without changing the signature.
--   public.my_first_visit_day()         -> date: the caller's earliest counted visit day, or NULL. Bounds the previous-month chevron when a month
--                                          has no rows.
--
-- Both follow my_engagement() (0186): STABLE, SECURITY DEFINER, search_path pinned, no member id parameter, the caller resolved live (role
-- member, own non-deactivated member row, active gym) with an empty result at every failed step, and EXECUTE for `authenticated` only. They read
-- the view member_visit_days, never attendance_events, so a voided check-in and class-only attendance (class_bookings.attended_at) light
-- nothing, and a staff check-in or a late offline visit lights its own stored visit_day. The month filter is a date comparison against
-- p_month and p_month + 1 month: no timezone arithmetic, so a later gyms.timezone change never moves a day.
--
-- p_month that is not the first of a month, or is after the gym's current gym-local month, raises invalid_month (22023, the style of
-- set_weekly_goal's invalid_goal). Neither function is a support capability. Nothing here changes a member's screen while
-- platform_engagement_config.release_week_start is NULL: the mobile calendar is reached only from the ring card and a Profile row that are
-- themselves gated on `enabled`.
--
-- Rollback: scripts/rollback-0187-attendance-calendar.sql
-- ============================================================================
set local lock_timeout = '5s';

create function public.my_visit_days(p_month date)
returns table (visit_day date, milestone smallint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_member_id uuid;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    return;
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  select m.id into v_member_id
  from members m
  where m.user_id = auth.uid() and m.gym_id = v_gym_id and m.deactivated_at is null
  order by m.created_at desc, m.id desc
  limit 1;

  if v_member_id is null then
    return;
  end if;

  -- A read that returns no row (see my_engagement): written without the `is distinct from` guard text on purpose.
  if coalesce(private.current_gym_status()::text, '') <> 'active' then
    return;
  end if;

  -- Checked after the caller is known to be a live member, so a wrong caller learns nothing about months.
  if p_month is null
     or p_month <> date_trunc('month', p_month)::date
     or p_month > date_trunc('month', private.gym_today(v_gym_id))::date then
    raise exception 'invalid_month' using errcode = '22023';
  end if;

  return query
    select d.visit_day, null::smallint
    from public.member_visit_days d
    where d.member_id = v_member_id
      and d.gym_id = v_gym_id
      and d.visit_day >= p_month
      and d.visit_day < (p_month + interval '1 month')::date
    order by d.visit_day;
end;
$function$;

create function public.my_first_visit_day()
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_first date;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    return null;
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return null;
  end if;

  select m.id into v_member_id
  from members m
  where m.user_id = auth.uid() and m.gym_id = v_gym_id and m.deactivated_at is null
  order by m.created_at desc, m.id desc
  limit 1;

  if v_member_id is null then
    return null;
  end if;

  if coalesce(private.current_gym_status()::text, '') <> 'active' then
    return null;
  end if;

  select min(d.visit_day) into v_first
  from public.member_visit_days d
  where d.member_id = v_member_id and d.gym_id = v_gym_id;

  return v_first;
end;
$function$;

-- New functions are anon-executable by default: revoke explicitly, then grant the one role.
revoke execute on function public.my_visit_days(date) from public, anon, service_role;
revoke execute on function public.my_first_visit_day() from public, anon, service_role;
grant execute on function public.my_visit_days(date) to authenticated;
grant execute on function public.my_first_visit_day() to authenticated;
