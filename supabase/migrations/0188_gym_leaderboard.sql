-- ============================================================================
-- 0188: The gym leaderboard and the member's choice to appear as Anonymous (Epic 30, Story 30.6; FR-226, FR-227, FR-228, NFR-001, NFR-027,
-- NFR-029; AD-1, AD-34, AD-54, AD-56).
--
-- A member cannot see where they stand among their gym's members, and nothing yet protects a member from being named on a board before they
-- agreed to it. This migration adds:
--   * member_preferences.leaderboard_hidden             boolean not null default false
--   * member_preferences.leaderboard_notice_seen_at     timestamptz, NULL for every existing and every new row, so nobody is named before seeing
--                                                       the first-open notice (FR-227). Both sit on the per-gym member row: a member of two gyms
--                                                       sees the notice once at each.
--   * the existing trigger private.protect_self_managed_member_preferences_columns, re-created: it keeps its three pins and leaves the two
--     notification opt-outs writable, and it now REFUSES (leaderboard_columns_write_protected, 42501; not a silent pin-back) any change of
--     the two new columns unless the transaction-local flag app.leaderboard_write is 'on'. The flag is set only inside the two writers below
--     (the pattern of app.engagement_acknowledge, 0185).
--   * public.set_leaderboard_visibility(p_hidden boolean)  writes leaderboard_hidden on the caller's own row, never the notice column.
--   * public.mark_leaderboard_notice_seen()                sets leaderboard_notice_seen_at = now() only while it is NULL (idempotent).
--   * public.gym_leaderboard(p_month date)                 the board of the caller's gym for the current or the previous gym-local month.
--   * public.my_leaderboard_settings()                     (hidden, notice_seen, own_label) of the caller, for the notice and the Profile row.
--
-- The server alone decides who is "Anonymous" and builds every label, rank, tie and total; the device only draws what it is sent.
--   * Ranking. visits = the distinct visit_day values of the member inside the month, read from attendance_counted (a voided check-in and
--     class-only attendance count for nothing). Eligible members have deactivated_at NULL and a role that is not support (null-safe). A member
--     with no visit is not ranked. Order: visits descending, then the time the member reached that count (the earliest check-in of the
--     member's Nth, that is last, distinct visit day), then the member id (never returned). rank is the competition rank over visits alone
--     (1, 2, 2, 4); is_tied is true for each member sharing a rank; position is the 1-based place in the full order. A staff row with counted
--     visits ranks like any other eligible row: the eligibility rule is the epic's literal one (recorded in docs/decisions.md).
--   * Rows. Positions 1 to 10, then (when the caller is not in them) the neighbour above, the caller and the neighbour below; at position 10
--     the neighbour below; at 1 to 9 nothing more. visits_behind is set on the caller's row only (the visits of the position above minus the
--     caller's, 0 when level, NULL when first). ranked_total and self_ranked are on every row.
--   * Fewer than 3 ranked: exactly one row with position, rank, label and visits NULL, so nobody is identified by elimination.
--   * Label. The first space-separated token of the name, a space, the first letter of the last token and a period ("CHANTAL N."); a
--     one-token name stands alone. Capitals are the ones stored. The literal 'Anonymous' (is_anonymous true) when leaderboard_hidden is true or
--     the notice has not been seen. The caller's own row carries the label as OTHERS see it.
--   * p_month other than the first day of the gym's current month or of the previous one raises invalid_month (22023), decided from
--     private.gym_today(gym), never from the device. The check runs after the caller is known to be a live member.
--
-- All four follow my_engagement() / set_weekly_goal(): SECURITY DEFINER, search_path pinned, no member id parameter, the caller resolved live
-- (role member, own non-deactivated member row, active gym). The reads return nothing at every failed step; the writes raise 42501 before any
-- write. EXECUTE for `authenticated` only. None is a support capability. Nothing is stored or cached: a hide never leaves a name behind.
-- Nothing here changes a member's screen while platform_engagement_config.release_week_start is NULL: the mobile screens that call these are
-- themselves gated on `enabled`.
--
-- The migration number is provisional until merge. Rollback: scripts/rollback-0188-gym-leaderboard.sql
-- ============================================================================
set local lock_timeout = '5s';

alter table public.member_preferences
  add column leaderboard_hidden boolean not null default false,
  add column leaderboard_notice_seen_at timestamptz;

-- ----------------------------------------------------------------------------
-- The trigger: the 0047 body with the new refusal. Same name, same signature, so the trigger keeps pointing at it.
-- ----------------------------------------------------------------------------
create or replace function private.protect_self_managed_member_preferences_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from members where id = old.member_id and user_id = auth.uid()) then
    new.member_id := old.member_id;
    new.gym_id := old.gym_id;
    new.created_at := old.created_at;
  end if;

  -- Not a pin-back: a direct write that tries to move either leaderboard column is an error, so a client that tries it learns it. Only the
  -- two writers (set_leaderboard_visibility, mark_leaderboard_notice_seen) switch the flag on, for their own statement.
  if (new.leaderboard_hidden is distinct from old.leaderboard_hidden
      or new.leaderboard_notice_seen_at is distinct from old.leaderboard_notice_seen_at)
     and coalesce(current_setting('app.leaderboard_write', true), '') <> 'on' then
    raise exception 'leaderboard_columns_write_protected' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- The trigger function is never called directly: revoke the default EXECUTE (a trigger needs no EXECUTE grant to fire).
revoke execute on function private.protect_self_managed_member_preferences_columns() from public, anon;

-- ----------------------------------------------------------------------------
-- Writers
-- ----------------------------------------------------------------------------

create function public.set_leaderboard_visibility(p_hidden boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_member_id uuid;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select m.id into v_member_id
  from members m
  where m.user_id = auth.uid() and m.gym_id = v_gym_id and m.deactivated_at is null
  order by m.created_at desc, m.id desc
  limit 1;

  if v_member_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- `is distinct from`, never `<>`: the helper returns NULL for a session with no resolvable gym, and a NULL must refuse.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'permission denied: gym % is not active', v_gym_id using errcode = '42501';
  end if;

  if p_hidden is null then
    raise exception 'invalid_hidden' using errcode = '22023';
  end if;

  -- The flag lives for this transaction only and is switched off again as soon as the one statement has run.
  perform set_config('app.leaderboard_write', 'on', true);
  insert into member_preferences (member_id, gym_id, leaderboard_hidden)
  values (v_member_id, v_gym_id, p_hidden)
  on conflict (member_id) do update set leaderboard_hidden = excluded.leaderboard_hidden;
  perform set_config('app.leaderboard_write', 'off', true);
end;
$function$;

create function public.mark_leaderboard_notice_seen()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_member_id uuid;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select m.id into v_member_id
  from members m
  where m.user_id = auth.uid() and m.gym_id = v_gym_id and m.deactivated_at is null
  order by m.created_at desc, m.id desc
  limit 1;

  if v_member_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'permission denied: gym % is not active', v_gym_id using errcode = '42501';
  end if;

  perform set_config('app.leaderboard_write', 'on', true);
  insert into member_preferences (member_id, gym_id, leaderboard_notice_seen_at)
  values (v_member_id, v_gym_id, now())
  on conflict (member_id) do update set leaderboard_notice_seen_at = excluded.leaderboard_notice_seen_at
    where member_preferences.leaderboard_notice_seen_at is null;
  perform set_config('app.leaderboard_write', 'off', true);
end;
$function$;

-- ----------------------------------------------------------------------------
-- Reads
-- ----------------------------------------------------------------------------

create function public.my_leaderboard_settings()
returns table (hidden boolean, notice_seen boolean, own_label text)
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

  -- own_label: the label the server would show this caller if visible (the caller's own name, on the caller's own device).
  return query
    select coalesce(mp.leaderboard_hidden, false),
           mp.leaderboard_notice_seen_at is not null,
           (select case
                     when cardinality(t.parts) <= 1 then coalesce(t.parts[1], '')
                     else t.parts[1] || ' ' || left(t.parts[cardinality(t.parts)], 1) || '.'
                   end
              from (select regexp_split_to_array(btrim(m.name), '\s+') as parts) t)
    from members m
    left join member_preferences mp on mp.member_id = m.id
    where m.id = v_member_id;
end;
$function$;

create function public.gym_leaderboard(p_month date)
returns table (
  "position" integer,
  rank integer,
  label text,
  is_anonymous boolean,
  visits integer,
  is_self boolean,
  is_tied boolean,
  visits_behind integer,
  ranked_total integer,
  self_ranked boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_current date;
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

  if coalesce(private.current_gym_status()::text, '') <> 'active' then
    return;
  end if;

  -- Checked after the caller is known to be a live member, so a wrong caller learns nothing about months. The gym decides which month is
  -- current (never the device).
  v_current := date_trunc('month', private.gym_today(v_gym_id))::date;
  if p_month is null or p_month not in (v_current, (v_current - interval '1 month')::date) then
    raise exception 'invalid_month' using errcode = '22023';
  end if;

  return query
  with per_day as (
    -- One row per member and visit day of the month: the earliest check-in of that day. attendance_counted holds no voided row.
    select c.member_id as mid, c.visit_day as vday, min(c.checked_in_at) as first_in
    from attendance_counted c
    where c.gym_id = v_gym_id
      and c.visit_day >= p_month
      and c.visit_day < (p_month + interval '1 month')::date
    group by c.member_id, c.visit_day
  ),
  per_member as (
    -- visits = distinct days; reached_at = the earliest check-in of the member's last (Nth) distinct day, the moment the count was reached.
    select d.mid,
           count(*)::int as vcount,
           (array_agg(d.first_in order by d.vday desc))[1] as reached_at
    from per_day d
    group by d.mid
  ),
  eligible as (
    select pm.mid, pm.vcount, pm.reached_at,
           (coalesce(mp.leaderboard_hidden, false) or mp.leaderboard_notice_seen_at is null) as anon,
           regexp_split_to_array(btrim(m.name), '\s+') as parts
    from per_member pm
    join members m on m.id = pm.mid and m.gym_id = v_gym_id
    left join member_preferences mp on mp.member_id = m.id
    where m.deactivated_at is null and m.role is distinct from 'support'
  ),
  ordered as (
    select e.mid, e.vcount, e.anon, e.parts,
           (row_number() over (order by e.vcount desc, e.reached_at asc, e.mid))::int as pos,
           (rank() over (order by e.vcount desc))::int as rnk,
           (count(*) over (partition by e.vcount))::int as same_count,
           (count(*) over ())::int as total,
           lag(e.vcount) over (order by e.vcount desc, e.reached_at asc, e.mid) as above_count
    from eligible e
  ),
  me as (
    select o.pos as self_pos from ordered o where o.mid = v_member_id
  ),
  summary as (
    select (select count(*) from ordered)::int as total, exists (select 1 from me) as self_ranked
  ),
  board as (
    select o.pos, o.rnk,
           case when o.anon then 'Anonymous'
                when cardinality(o.parts) <= 1 then coalesce(o.parts[1], '')
                else o.parts[1] || ' ' || left(o.parts[cardinality(o.parts)], 1) || '.'
           end as lbl,
           o.anon, o.vcount, (o.mid = v_member_id) as self_row, (o.same_count > 1) as tied,
           case when o.mid = v_member_id and o.above_count is not null then (o.above_count - o.vcount)::int end as behind,
           s.total, s.self_ranked
    from ordered o
    cross join summary s
    where s.total >= 3
      and (o.pos <= 10
           or exists (select 1 from me where o.pos between me.self_pos - 1 and me.self_pos + 1))
    union all
    -- Fewer than 3 ranked: one row, no name and no number a person could be told apart by.
    select null::int, null::int, null::text, false, null::int, false, false, null::int, s.total, s.self_ranked
    from summary s
    where s.total < 3
  )
  select b.pos, b.rnk, b.lbl, b.anon, b.vcount, b.self_row, b.tied, b.behind, b.total, b.self_ranked
  from board b
  order by b.pos;
end;
$function$;

-- New functions are anon-executable by default: revoke explicitly, then grant the one role.
revoke execute on function public.set_leaderboard_visibility(boolean) from public, anon, service_role;
revoke execute on function public.mark_leaderboard_notice_seen() from public, anon, service_role;
revoke execute on function public.my_leaderboard_settings() from public, anon, service_role;
revoke execute on function public.gym_leaderboard(date) from public, anon, service_role;
grant execute on function public.set_leaderboard_visibility(boolean) to authenticated;
grant execute on function public.mark_leaderboard_notice_seen() to authenticated;
grant execute on function public.my_leaderboard_settings() to authenticated;
grant execute on function public.gym_leaderboard(date) to authenticated;
