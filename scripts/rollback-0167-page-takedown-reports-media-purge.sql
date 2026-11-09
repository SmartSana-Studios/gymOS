-- Rollback for migration 0167 (takedown, reports, appeals and media purge, Story 24.11).
-- ABORTS when any takedown, report or appeal row exists, when any page or name row is still flagged taken down, or when a live image
-- row has had its derivative purged (those objects are gone; only the 24.11 publish path can rebuild them). Nothing is deleted before
-- those checks pass. Then: unschedules the purge job, drops the takedown/report/appeal/purge functions and tables, the purge and
-- reason columns, and restores the 0163 claim_page_name and set_page_name_idle, the 0164 refresh_gym_page and page_names_sweep, the 0165
-- get_gym_page_status and the 0145 stepup_issue as they were. Job rows (job_runs), audit rows and staff notices stay.
-- Roll back the 24.11 app code first (landing report/sitemap/robots, the dashboard banner and the Super Admin /pages screen call these).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0167-page-takedown-reports-media-purge.sql

set local lock_timeout = '5s';

do $guard$
begin
  if exists (select 1 from private.page_takedowns) or exists (select 1 from private.page_reports) or exists (select 1 from private.page_appeals) then
    raise exception 'rollback-0167: refused, a takedown, report or appeal row exists (this would destroy moderation records)';
  end if;
  if exists (select 1 from public.gym_pages where taken_down_at is not null) or exists (select 1 from public.page_names where taken_down_at is not null) then
    raise exception 'rollback-0167: refused, a page or page name is still taken down';
  end if;
  if exists (select 1 from public.gym_page_media where deleted_at is null and purged_at is not null) then
    raise exception 'rollback-0167: refused, a live image has had its derivative purged (the object is gone; republish with the 24.11 code first)';
  end if;
end
$guard$;

select cron.unschedule('page_media_purge') where exists (select 1 from cron.job where jobname = 'page_media_purge');

drop function if exists private.page_media_purge_tick();
drop function if exists public.page_media_rederive_done(uuid, uuid[]);
drop function if exists public.page_media_rederive_list(uuid);
drop function if exists public.record_page_media_purge_run(timestamptz, boolean, text);
drop function if exists public.page_media_purge_orphans(integer);
drop function if exists public.page_media_purge_mark(uuid, boolean, boolean);
drop function if exists public.page_media_purge_candidates(integer);
drop function if exists private.page_media_derivative_due(uuid, boolean, timestamptz);
drop function if exists public.decide_page_appeal(uuid, text, text);
drop function if exists public.list_page_appeals();
drop function if exists public.submit_page_appeal(text);
drop function if exists public.close_page_report(uuid, text, text);
drop function if exists public.list_page_reports();
drop function if exists public_site.submit_page_report(text, text, text, text);
drop function if exists public.lift_gym_page_takedown(uuid, text);
drop function if exists public.take_down_gym_page(uuid, text, text);

drop table if exists private.page_appeals;
drop table if exists private.page_reports;
drop table if exists private.page_takedowns;

drop index if exists public.gym_page_media_purge_derivative;
drop index if exists public.gym_page_media_purge_original;
alter table public.gym_page_media drop column if exists purged_at, drop column if exists original_purged_at;
alter table public.gym_pages
  drop constraint if exists gym_pages_taken_down_reason_code,
  drop constraint if exists gym_pages_taken_down_note_len,
  drop column if exists taken_down_reason,
  drop column if exists taken_down_note;

-- The functions as they were before 0167. get_gym_page_status first: it is the only one whose result shape changed.
create or replace function public.get_gym_page_status(p_gym_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym gyms%rowtype;
  v_gp gym_pages%rowtype;
  v_has_page boolean;
  v_missing text[];
  v_reasons text[] := '{}';
  v_live boolean;
  v_taken boolean;
  v_has_name boolean;
  v_started boolean;
  v_state text;
  v_json jsonb;
  v_lang text;
  v_langs jsonb := '[]'::jsonb;
  v_chars integer;
  v_media jsonb;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    if p_gym_id is null
       or p_gym_id is distinct from private.support_rpc_gym_id('get_gym_page_status')
       or not coalesce(private.support_rpc_role('get_gym_page_status') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  select * into v_gym from gyms g where g.id = p_gym_id;
  if not found then
    raise exception 'get_gym_page_status: gym not found';
  end if;

  select * into v_gp from gym_pages gp where gp.gym_id = p_gym_id;
  v_has_page := found;

  v_missing := private.gym_page_gate_missing(p_gym_id);
  v_json := to_jsonb(v_gym);

  if v_has_page and v_gp.unpublished_reason is not null then
    v_reasons := string_to_array(v_gp.unpublished_reason, ',');
  end if;

  v_live := v_has_page and v_gp.published_at is not null and v_gp.unpublished_at is null;
  v_taken := (v_has_page and v_gp.taken_down_at is not null)
             or exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.taken_down_at is not null and pn.state <> 'released');
  v_has_name := exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.state = 'active' and pn.taken_down_at is null);

  v_started := v_gym.page_about_en is not null or v_gym.page_about_fr is not null
               or v_gym.page_services_en is not null or v_gym.page_services_fr is not null
               or v_gym.page_address is not null or v_gym.page_city is not null
               or v_gym.page_lat is not null or v_gym.page_lng is not null or v_gym.page_hours is not null
               or v_gym.page_contact_phone is not null or v_gym.page_contact_whatsapp is not null
               or v_has_page
               or exists (select 1 from plans p where p.gym_id = p_gym_id and p.is_public)
               or exists (select 1 from gym_page_media m where m.gym_id = p_gym_id and m.deleted_at is null)
               or exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.state in ('held', 'active', 'reserved'));

  v_state := case
    when v_taken then 'taken_down'
    when v_live and v_gym.status = 'active' then 'published'
    when v_live then 'offline_suspended'
    when v_has_page and v_gp.published_at is not null and v_gp.unpublished_at is not null
         and v_reasons = array['name_released'] and not v_has_name then 'offline_name_released'
    when v_has_page and v_gp.published_at is not null and v_gp.unpublished_at is not null
         and v_reasons <> array['owner'] and v_reasons <> array['name_released'] and v_reasons && v_missing then 'offline_gate'
    when not v_started then 'not_started'
    when cardinality(v_missing) = 0 then 'ready'
    else 'in_progress'
  end;

  foreach v_lang in array private.gym_page_languages() loop
    v_chars := private.gym_page_trimmed_length(v_json ->> ('page_about_' || v_lang));
    v_langs := v_langs || jsonb_build_object(
      'code', v_lang,
      'complete', private.gym_page_lang_complete(v_json ->> ('page_about_' || v_lang)),
      'characters', v_chars,
      'needed', greatest(0, 100 - v_chars));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'derivative_key', m.derivative_key, 'sort_order', m.sort_order)
                            order by m.kind, m.sort_order, m.created_at, m.id), '[]'::jsonb)
    into v_media
    from gym_page_media m
   where m.gym_id = p_gym_id and m.deleted_at is null;

  return jsonb_build_object(
    'state', v_state,
    'template', case when v_has_page then v_gp.template end,
    'published_at', case when v_live then v_gp.published_at end,
    'unpublished_reasons', to_jsonb(v_reasons),
    'missing', to_jsonb(v_missing),
    'bad_text_fields', private.gym_page_bad_text_fields(p_gym_id),
    'about_min_chars', 100,
    'languages', v_langs,
    'media', v_media,
    'snapshot', private.gym_page_snapshot(p_gym_id)
  );
end;
$$;

revoke execute on function public.get_gym_page_status(uuid) from public, anon;
grant execute on function public.get_gym_page_status(uuid) to authenticated;

-- 0164 refresh_gym_page
create or replace function private.refresh_gym_page(p_gym_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_page gym_pages%rowtype;
  v_missing text[];
  v_reason text;
  v_snapshot jsonb;
  v_name_id uuid;
begin
  -- Lock first, with no unlocked early exit: an edit whose trigger runs while a publish is still in flight must wait for that
  -- publish, then see the page it made live and re-judge it (READ COMMITTED re-reads after the wait). Review pass 2 restored this
  -- after pass 1 added an unlocked "no live page" exit, which let a page go live on a gate read just before such an edit committed.
  perform 1 from gyms g where g.id = p_gym_id for no key update;
  if not found then
    return;
  end if;

  select * into v_page from gym_pages gp where gp.gym_id = p_gym_id for update;
  if not found or v_page.published_at is null or v_page.unpublished_at is not null then
    return;
  end if;

  v_missing := private.gym_page_gate_missing(p_gym_id);

  if cardinality(v_missing) = 0 then
    v_snapshot := private.gym_page_snapshot(p_gym_id);
    select pn.id into v_name_id from page_names pn where pn.gym_id = p_gym_id and pn.state = 'active' and pn.taken_down_at is null;
    update gym_pages
       set content = v_snapshot, page_name_id = v_name_id, updated_at = now()
     where gym_id = p_gym_id
       and (content is distinct from v_snapshot or page_name_id is distinct from v_name_id);
    return;
  end if;

  v_reason := array_to_string(v_missing, ',');
  update gym_pages
     set unpublished_at = now(), unpublished_reason = v_reason, updated_at = now()
   where gym_id = p_gym_id;

  perform private.set_page_name_idle(p_gym_id, private.page_name_gym_idle(p_gym_id));
  perform private.notify_page_unpublished(p_gym_id, v_reason);

  perform log_audit_event(
    p_action_type => 'gym_page_unpublished',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym_page',
    p_system_actor_label => 'system:gym_page_refresh',
    p_metadata => jsonb_build_object('reason', 'gate', 'missing', to_jsonb(v_missing))
  );
end;
$$;
revoke execute on function private.refresh_gym_page(uuid) from public, anon, authenticated, service_role;

-- 0163 set_page_name_idle
create or replace function private.set_page_name_idle(p_gym_id uuid, p_idle boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_idle then
    update page_names set reserved_until = now() + interval '12 months'
     where gym_id = p_gym_id and state = 'active' and taken_down_at is null and reserved_until is null;
  else
    update page_names set reserved_until = null
     where gym_id = p_gym_id and state = 'active' and taken_down_at is null and reserved_until is not null;
  end if;
end;
$$;
revoke execute on function private.set_page_name_idle(uuid, boolean) from public, anon, authenticated, service_role;

-- 0164 page_names_sweep
create or replace function private.page_names_sweep()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_started timestamptz := now();
  r record;
  v_released integer := 0;
  v_expired integer := 0;
  v_reminded integer := 0;
  v_failed integer := 0;
  v_rows integer;
  v_pages integer;
  v_error text;
begin
  for r in
    select pn.id, pn.gym_id, pn.name
      from page_names pn
      join gyms g on g.id = pn.gym_id
     where pn.state = 'active' and pn.taken_down_at is null
       and pn.reserved_until is not null and pn.reserved_until < now()
       and (g.status <> 'active' or not private.page_name_has_published_page(pn.gym_id))
     order by pn.reserved_until, pn.id
  loop
    begin
      -- same lock order as claim_page_name() (gym row first), then re-check inside the lock: a claim, a rename or a publish
      -- that committed after the select above must not lose its name to this loop
      perform 1 from gyms g where g.id = r.gym_id for update;

      -- a live page of a gym that is not active goes offline with its name
      update gym_pages gp
         set unpublished_at = now(), unpublished_reason = 'name_released', updated_at = now()
       where gp.gym_id = r.gym_id and gp.published_at is not null and gp.unpublished_at is null
         and exists (select 1 from gyms g where g.id = r.gym_id and g.status <> 'active')
         and exists (select 1 from page_names a
                      where a.id = r.id and a.state = 'active' and a.taken_down_at is null
                        and a.reserved_until is not null and a.reserved_until < now());
      get diagnostics v_pages = row_count;

      update page_names set state = 'released'
       where id = r.id and state = 'active' and taken_down_at is null
         and reserved_until is not null and reserved_until < now()
         and not private.page_name_has_published_page(r.gym_id);
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        -- the gym's redirects would point at nothing: release them with the name they pointed at
        update page_names set state = 'released', reserved_until = coalesce(reserved_until, now())
         where gym_id = r.gym_id and state = 'redirect' and taken_down_at is null;
        perform log_audit_event(
          p_action_type => 'page_name_released', p_gym_id => r.gym_id, p_target_entity_id => r.id::text,
          p_target_entity_type => 'page_name', p_system_actor_label => 'system:page_names_sweep',
          p_metadata => jsonb_build_object('name', r.name, 'from_state', 'active'));
        if v_pages > 0 then
          perform private.notify_page_unpublished(r.gym_id, 'name_released');
          perform log_audit_event(
            p_action_type => 'gym_page_unpublished', p_gym_id => r.gym_id, p_target_entity_id => r.gym_id::text,
            p_target_entity_type => 'gym_page', p_system_actor_label => 'system:page_names_sweep',
            p_metadata => jsonb_build_object('reason', 'name_released', 'name', r.name));
        end if;
        v_released := v_released + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_error := left(sqlerrm, 200);
    end;
  end loop;

  for r in
    select pn.id, pn.gym_id, pn.name
      from page_names pn
     where pn.state = 'redirect' and pn.taken_down_at is null
       and pn.reserved_until is not null and pn.reserved_until < now()
     order by pn.reserved_until, pn.id
  loop
    begin
      update page_names set state = 'released' where id = r.id and state = 'redirect';
      perform log_audit_event(
        p_action_type => 'page_name_released', p_gym_id => r.gym_id, p_target_entity_id => r.id::text,
        p_target_entity_type => 'page_name', p_system_actor_label => 'system:page_names_sweep',
        p_metadata => jsonb_build_object('name', r.name, 'from_state', 'redirect'));
      v_expired := v_expired + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_error := left(sqlerrm, 200);
    end;
  end loop;

  for r in
    select pn.id, pn.gym_id, pn.name
      from page_names pn
     where pn.state = 'held' and pn.reminded_at is null and private.add_business_days(pn.held_at, 2) < now()
     order by pn.held_at, pn.id
  loop
    begin
      perform private.notify_page_name_overdue(r.gym_id, r.name);
      update page_names set reminded_at = now() where id = r.id;
      v_reminded := v_reminded + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_error := left(sqlerrm, 200);
    end;
  end loop;

  insert into job_runs (job_name, started_at, finished_at, status, error)
  values ('page_names_sweep', v_started, now(),
          case when v_failed > 0 then 'failure'::job_status else 'success'::job_status end,
          case when v_failed > 0 then v_failed || ' failed, ' || v_released || ' released, ' || v_expired || ' redirects expired, ' || v_reminded || ' reminded: ' || v_error
               when v_released + v_expired + v_reminded > 0 then v_released || ' released, ' || v_expired || ' redirects expired, ' || v_reminded || ' reminded' end);
end;
$$;
revoke execute on function private.page_names_sweep() from public, anon, authenticated, service_role;

-- 0145 stepup_issue
create or replace function private.stepup_issue(p_user uuid, p_action text, p_subject text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_expires timestamptz;
begin
  if p_user is null or p_subject is null or p_action is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email', 'support_refund', 'support_waive_registration_fee', 'support_create_staff', 'support_payment_connection', 'start_support_factor_reset') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action like 'support\_%' then
    -- Story 23.6: a support grant goes to an activated, unlocked, non-deactivated support account, whatever the Super Admin flag says.
    if not exists (select 1 from private.support_accounts sa
                    where sa.user_id = p_user and sa.activated_at is not null and sa.locked_at is null
                      and sa.reset_pending_at is null and sa.deactivated_at is null) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
  else
    if not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    if not private.super_admin_aal2_required() or private.super_admin_locked(p_user) then
      return null;
    end if;
  end if;

  delete from private.support_stepup
   where user_id = p_user and (consumed_at is not null or expires_at <= now());
  delete from private.support_stepup
   where user_id = p_user and action = p_action and subject_id = p_subject and consumed_at is null;
  v_expires := now() + make_interval(mins => private.session_limit('stepup_ttl_minutes'));
  insert into private.support_stepup (user_id, action, subject_id, expires_at)
  values (p_user, p_action, p_subject, v_expires);

  update private.super_admin_lockout set failed_count = 0 where user_id = p_user and locked_at is null;
  return v_expires;
end;
$$;
revoke all on function private.stepup_issue(uuid, text, text) from public, anon, authenticated;
grant execute on function private.stepup_issue(uuid, text, text) to service_role;

-- 0163 claim_page_name (no page_taken_down refusal, no replacement notice)
create or replace function public.claim_page_name(p_gym_id uuid, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_is_super_admin boolean;
  v_name text;
  v_active page_names%rowtype;
  v_held page_names%rowtype;
  v_is_rename boolean;
  v_origin text;
  v_reason text;
  v_id uuid;
  v_state text;
begin
  v_is_super_admin := coalesce(private.is_super_admin_live(), false);

  if not v_is_super_admin then
    if p_gym_id is null
       or p_gym_id is distinct from private.gym_id()
       or private.current_member_role() is distinct from 'owner' then
      raise exception 'permission denied';
    end if;
  end if;

  if p_gym_id is null then
    raise exception 'claim_page_name: gym not found';
  end if;

  perform 1 from gyms g where g.id = p_gym_id for update;
  if not found then
    raise exception 'claim_page_name: gym not found';
  end if;

  -- One claim at a time across all gyms (after the gym row, never before: decide_held_page_name() and the gyms.status trigger take
  -- the gym row first too). Without it two gyms claiming near-match names each miss the other's uncommitted row and both go active.
  perform pg_advisory_xact_lock(hashtext('page_names_claim'));

  if not v_is_super_admin and private.current_gym_status() is distinct from 'active' then
    raise exception 'claim_page_name: gym % is not active', p_gym_id;
  end if;

  -- trimmed (Unicode-aware, as the page content setter) and lowercased, then checked in order
  v_name := lower(regexp_replace(coalesce(p_name, ''),
    '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g'));

  if not private.page_name_valid(v_name) then
    raise exception 'claim_page_name: invalid_name';
  end if;
  if private.page_name_is_reserved(v_name) or private.page_name_has_brand_word(v_name) then
    raise exception 'claim_page_name: reserved_name';
  end if;

  select * into v_active from page_names pn where pn.gym_id = p_gym_id and pn.state = 'active';
  select * into v_held from page_names pn where pn.gym_id = p_gym_id and pn.state = 'held';

  -- asking again for what the gym already has (cancels a pending change) or already waits for
  if v_active.id is not null and v_active.name = v_name then
    if v_held.id is not null then
      update page_names set state = 'released' where id = v_held.id;
      perform log_audit_event(
        p_action_type => 'page_name_withdrawn', p_gym_id => p_gym_id, p_target_entity_id => v_held.id::text,
        p_target_entity_type => 'page_name', p_metadata => jsonb_build_object('name', v_held.name));
    end if;
    return jsonb_build_object('id', v_active.id, 'name', v_active.name, 'state', 'active', 'origin', v_active.origin, 'previous_name', null);
  end if;
  -- (a Super Admin on behalf skips the hold: for them this falls through, withdraws the held row and promotes the name)
  if v_held.id is not null and v_held.name = v_name and not v_is_super_admin then
    return jsonb_build_object('id', v_held.id, 'name', v_held.name, 'state', 'held', 'origin', v_held.origin,
                              'previous_name', v_active.name);
  end if;

  -- taken by any non-released row of another gym (or by this gym's own taken-down name)
  if exists (select 1 from page_names pn
              where lower(pn.name) = v_name and pn.state <> 'released' and (pn.gym_id <> p_gym_id or pn.state = 'reserved')) then
    raise exception 'claim_page_name: name_taken';
  end if;

  v_is_rename := v_active.id is not null;
  if v_is_rename and not v_is_super_admin and private.page_name_completed_renames(p_gym_id) >= 2 then
    raise exception 'claim_page_name: rename_limit';
  end if;

  v_origin := case when not v_is_rename then 'claim' when v_is_super_admin then 'forced_rename' else 'rename' end;

  if not v_is_super_admin then
    v_reason := private.page_name_hold_reason(v_name, p_gym_id);
  end if;

  -- the gym's own pending held row is released first (not counted)
  if v_held.id is not null then
    update page_names set state = 'released' where id = v_held.id;
    perform log_audit_event(
      p_action_type => 'page_name_withdrawn', p_gym_id => p_gym_id, p_target_entity_id => v_held.id::text,
      p_target_entity_type => 'page_name', p_metadata => jsonb_build_object('name', v_held.name));
  end if;

  -- going back to a name the gym itself redirected frees that name first
  update page_names set state = 'released', reserved_until = coalesce(reserved_until, now())
   where gym_id = p_gym_id and state = 'redirect' and lower(name) = v_name;

  begin
    if v_reason is not null then
      insert into page_names (gym_id, name, state, origin, held_reason, held_at)
      values (p_gym_id, v_name, 'held', case when v_is_rename then 'rename' else 'claim' end, v_reason, now())
      returning id into v_id;
      v_state := 'held';
    else
      v_id := private.page_name_promote(p_gym_id, v_name, v_origin, null, v_is_super_admin);
      v_state := 'active';
    end if;
  exception when unique_violation then
    -- lost a race for the same name with another gym
    raise exception 'claim_page_name: name_taken';
  end;

  perform log_audit_event(
    p_action_type => case when v_state = 'held' then 'page_name_held'
                          when v_is_rename then 'page_name_renamed' else 'page_name_claimed' end,
    p_gym_id => p_gym_id,
    p_target_entity_id => v_id::text,
    p_target_entity_type => 'page_name',
    p_metadata => jsonb_build_object('name', v_name, 'origin', v_origin, 'state', v_state, 'previous_name', v_active.name)
  );

  return jsonb_build_object('id', v_id, 'name', v_name, 'state', v_state,
                            'origin', case when v_state = 'held' and v_is_rename then 'rename' else v_origin end,
                            'previous_name', v_active.name);
end;
$$;

revoke execute on function public.claim_page_name(uuid, text) from public, anon;
grant execute on function public.claim_page_name(uuid, text) to authenticated;

-- helpers last: nothing above depends on them any more
drop function if exists private.notify_page_moderation(uuid, text, text, text, text, text);
drop function if exists private.gym_page_taken_down(uuid);
drop function if exists private.page_takedown_label(text, text);
drop function if exists private.page_text_trim(text);

do $verify$
begin
  if exists (select 1 from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'public_site'::regnamespace)
              and proname in ('take_down_gym_page', 'lift_gym_page_takedown', 'submit_page_report', 'list_page_reports', 'close_page_report',
                              'submit_page_appeal', 'list_page_appeals', 'decide_page_appeal', 'page_media_purge_candidates', 'page_media_purge_mark', 'page_media_derivative_due',
                              'page_media_purge_orphans', 'record_page_media_purge_run', 'page_media_rederive_list', 'page_media_rederive_done',
                              'page_media_purge_tick', 'gym_page_taken_down', 'notify_page_moderation', 'page_takedown_label', 'page_text_trim')) then
    raise exception 'rollback-0167: a 0167 function is still present';
  end if;
  if to_regclass('private.page_takedowns') is not null or to_regclass('private.page_reports') is not null or to_regclass('private.page_appeals') is not null then
    raise exception 'rollback-0167: a takedown table is still present';
  end if;
  if exists (select 1 from cron.job where jobname = 'page_media_purge') or not exists (select 1 from cron.job where jobname = 'page_names_sweep') then
    raise exception 'rollback-0167: the cron jobs are not as before';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gym_pages' and column_name in ('taken_down_reason', 'taken_down_note'))
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gym_page_media' and column_name in ('purged_at', 'original_purged_at')) then
    raise exception 'rollback-0167: a 0167 column is still present';
  end if;
  if (select prosrc from pg_proc where proname = 'refresh_gym_page' and pronamespace = 'private'::regnamespace) ~ 'v_page.taken_down_at' then
    raise exception 'rollback-0167: refresh_gym_page is still the 0167 one';
  end if;
  if exists (select 1 from pg_proc where proname = 'stepup_issue' and pronamespace = 'private'::regnamespace and prosrc ~ 'take_down_gym_page') then
    raise exception 'rollback-0167: stepup_issue still allows the takedown actions';
  end if;
end;
$verify$;
