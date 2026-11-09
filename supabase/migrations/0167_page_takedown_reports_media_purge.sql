-- ============================================================================
-- 0167: Takedown, reports, appeals, sitemap support and media purge (Epic 24, Story 24.11; FR-203, FR-204, FR-205, FR-207,
-- AD-44, AD-45, AD-46, AD-47, AD-50, AD-52).
--
-- Until now `gym_pages.taken_down_at` was read by every consumer and written by nobody; a bad page could not be removed, a visitor could
-- not report one, and unpublished or deleted images stayed fetchable (originals keep their EXIF) because nothing deleted a Storage object.
--
--   take_down_gym_page(gym, reason, note)       live Super Admin. Hides the page (it stays published but hidden), flags every non-released
--                                               name row of the gym, writes the takedown record, tells every active Owner (EN/FR).
--   lift_gym_page_takedown(gym, reason)         live Super Admin. Clears the page flag and the active name's flag (old-name redirects stay
--                                               dropped), leaves the page UNPUBLISHED (the Owner republishes through the gate), tells the Owner.
--   public_site.submit_page_report(...)         the ONE function public_site_reader may execute. Resolves the visible page itself, writes
--                                               nothing for an invisible one, rate-limits per source hash and per gym.
--   list_page_reports / close_page_report       live Super Admin: the queue (due in 5 business days) and its closure.
--   submit_page_appeal / list_page_appeals / decide_page_appeal   Owner appeals once per takedown; Super Admin decides (lift runs the lift).
--   page_media_purge_* , page_media_rederive_*  service_role only: the candidates/mark/orphan/record calls of the `page-media-purge` edge
--                                               function and the re-derive calls of the dashboard publish path.
--   claim_page_name (replaced)                  0163's, plus: an Owner cannot rename while the page is taken down (`page_taken_down`, so a flagged
--                                               name can never be turned into a redirect and released, AD-45); a Super Admin claim that replaces an
--                                               existing name tells the Owner (EN/FR).
--   private.page_media_purge_tick()             pg_cron job `page_media_purge` (every 5 minutes): pg_net call to the edge function with a
--                                               bearer secret kept in Vault. Nothing is deleted in SQL; objects go through the Storage API.
--
-- Design choices worth knowing before editing this file:
--
--  * Takedown HIDES, it does not unpublish. gym_pages keeps published_at; every consumer of the visibility predicate stays correct and the
--    page cannot be republished (publish_gym_page raises `taken_down`). The active name stays reserved to the gym forever (the sweep and
--    set_page_name_idle skip a gym whose page row is taken down).
--  * Lift leaves the page UNPUBLISHED. The Owner publishes again and the gate re-runs. Reactivating a suspended gym never lifts anything.
--  * Purge never deletes a gym_page_media row: the rows are the tombstones that keep the 30-per-24-hours count in register_page_media.
--    A derivative is a purge candidate when its row is deleted OR the gym's page row exists and is offline (unpublished or taken down).
--    A SUSPENDED gym's live page is deliberately not a candidate: reactivation restores that page without a publish, so the objects must
--    survive it. A never-published draft has no page row and its derivatives are not public, so the editor keeps its thumbnails.
--  * Purge lists candidates WITHOUT stamping anything, the edge function deletes through the Storage API (an object that is already gone is not
--    an error), and only AFTER a confirmed delete does it mark the row purged; the mark re-checks the candidate rule. There is no claim and no
--    release: a run that is killed or times out is simply retried on the next tick. The remaining window: if the page is republished between the
--    delete and the mark, the mark is refused (the page is live again) and the image stays missing until it is uploaded or re-registered; the
--    window is a few seconds and nothing rebuilds it by itself.
--  * The dashboard re-derive clears `purged_at` only AFTER publish_gym_page has succeeded (and removes the derivatives it uploaded when a step fails).
--  * The reader role stays default_transaction_read_only. The landing app runs submit_page_report as `begin read write; select ...; commit`.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- Columns
-- ----------------------------------------------------------------------------
alter table public.gym_pages
  add column taken_down_reason text,
  add column taken_down_note text,
  add constraint gym_pages_taken_down_reason_code check (
    taken_down_reason is null
    or taken_down_reason in ('impersonation', 'illegal_content', 'trademark', 'misleading_content', 'privacy', 'other')),
  add constraint gym_pages_taken_down_note_len check (taken_down_note is null or char_length(taken_down_note) <= 500);

comment on column public.gym_pages.taken_down_reason is
  'Why Super Admin took the page down (24.11): one of six codes. Set with taken_down_at by take_down_gym_page only. Never in the snapshot.';
comment on column public.gym_pages.taken_down_note is
  'Super Admin''s internal note on a takedown (24.11). Never shown to the Owner, never in an audit row, never in the snapshot.';

alter table public.gym_page_media
  add column purged_at timestamptz,
  add column original_purged_at timestamptz;

comment on column public.gym_page_media.purged_at is
  'The derivative object was removed from Storage (24.11 purge; set only after a confirmed delete); cleared again when the publish path re-derived it and the republish succeeded. The row is never deleted: it keeps the upload count.';
comment on column public.gym_page_media.original_purged_at is
  'The private original was removed from Storage (24.11 purge; set only after a confirmed delete), only for a deleted row.';

create index gym_page_media_purge_derivative on public.gym_page_media (gym_id) where purged_at is null;
create index gym_page_media_purge_original on public.gym_page_media (gym_id) where original_purged_at is null and deleted_at is not null;

-- ----------------------------------------------------------------------------
-- Tables (private schema, RLS on, no grant, no policy: read and written only by the functions below)
-- ----------------------------------------------------------------------------
create table private.page_takedowns (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  page_name text,
  reason text not null,
  note text,
  taken_down_at timestamptz not null default now(),
  taken_down_by uuid references auth.users(id) on delete set null,
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id) on delete set null,
  lift_reason text,
  constraint page_takedowns_reason check (reason in ('impersonation', 'illegal_content', 'trademark', 'misleading_content', 'privacy', 'other')),
  constraint page_takedowns_note_len check (note is null or char_length(note) <= 500),
  constraint page_takedowns_lift_reason check (lift_reason is null or char_length(lift_reason) between 3 and 500),
  constraint page_takedowns_lift_consistent check ((lifted_at is null) = (lift_reason is null))
);
create unique index page_takedowns_one_open on private.page_takedowns (gym_id) where lifted_at is null;
create index page_takedowns_gym on private.page_takedowns (gym_id, taken_down_at desc);

create table private.page_reports (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  page_name text not null,
  reason text not null,
  details text not null,
  -- HMAC-SHA256(PUBLIC_SITE_REPORT_KEY, client ip), hex. The keyed hash only; the address itself never reaches the database.
  source_hash text not null,
  created_at timestamptz not null default now(),
  due_at timestamptz not null,
  status text not null default 'open',
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  closed_note text,
  takedown_id uuid references private.page_takedowns(id) on delete set null,
  constraint page_reports_reason check (reason in ('impersonation', 'illegal_content', 'trademark', 'misleading_content', 'privacy', 'other')),
  constraint page_reports_details_len check (char_length(details) between 1 and 1000),
  constraint page_reports_source_hash check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint page_reports_status check (status in ('open', 'taken_down', 'dismissed')),
  constraint page_reports_closed_note_len check (closed_note is null or char_length(closed_note) <= 500),
  constraint page_reports_closed_consistent check ((status = 'open') = (closed_at is null))
);
create index page_reports_open_due on private.page_reports (due_at, id) where status = 'open';
create index page_reports_source on private.page_reports (source_hash, created_at);
create index page_reports_gym on private.page_reports (gym_id, created_at);

create table private.page_appeals (
  id uuid primary key default gen_random_uuid(),
  takedown_id uuid not null references private.page_takedowns(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  decision text,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decision_reason text,
  constraint page_appeals_reason_len check (char_length(reason) between 1 and 500),
  constraint page_appeals_decision check (decision is null or decision in ('lift', 'uphold')),
  constraint page_appeals_decision_reason check (decision_reason is null or char_length(decision_reason) between 3 and 500),
  constraint page_appeals_decided_consistent check ((decision is null) = (decided_at is null) and (decision is null) = (decision_reason is null))
);
-- One appeal per takedown, ever: open, upheld or lifted. A second appeal is refused (typed appeal_open / appeal_decided).
create unique index page_appeals_one_per_takedown on private.page_appeals (takedown_id);
create index page_appeals_gym on private.page_appeals (gym_id, created_at);

alter table private.page_takedowns enable row level security;
alter table private.page_reports enable row level security;
alter table private.page_appeals enable row level security;
revoke all on private.page_takedowns from public, anon, authenticated, service_role;
revoke all on private.page_reports from public, anon, authenticated, service_role;
revoke all on private.page_appeals from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Small private helpers
-- ----------------------------------------------------------------------------

-- Unicode-aware trim (the same class the page content setter trims with), written with escapes.
create function private.page_text_trim(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(p_text,
    '^[\s   -​    　﻿]+|[\s   -​    　﻿]+$',
    '', 'g');
$$;

-- The visitor-safe and admin labels of the six reason codes. Admin labels (AD-27): Impersonation, Illegal content, Trademark, Misleading
-- content, Privacy, Other; the French pair is the same table. packages/types holds the same codes and labels (one source for the apps).
create function private.page_takedown_label(p_code text, p_lang text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_lang
    when 'en' then case p_code
      when 'impersonation' then 'Impersonation'
      when 'illegal_content' then 'Illegal content'
      when 'trademark' then 'Trademark'
      when 'misleading_content' then 'Misleading content'
      when 'privacy' then 'Privacy'
      when 'other' then 'Other'
    end
    when 'fr' then case p_code
      when 'impersonation' then 'Usurpation d''identité'
      when 'illegal_content' then 'Contenu illicite'
      when 'trademark' then 'Marque déposée'
      when 'misleading_content' then 'Contenu trompeur'
      when 'privacy' then 'Vie privée'
      when 'other' then 'Autre'
    end
  end;
$$;

-- The takedown predicate for a gym, read from the page row (the one the publish path and the sweeps honour).
create function private.gym_page_taken_down(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.gym_pages gp where gp.gym_id = p_gym_id and gp.taken_down_at is not null);
$$;

-- Owner notice (the shape of notify_page_unpublished: staff_notices plus email_outbox for every active Owner). Texts name no individual.
create function private.notify_page_moderation(
  p_gym_id uuid, p_notice_type text, p_title_en text, p_title_fr text, p_body_en text, p_body_fr text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_notice_id uuid;
  v_email text;
  r record;
begin
  for r in
    select distinct m.user_id as uid
      from members m
     where m.gym_id = p_gym_id and m.role = 'owner' and m.deactivated_at is null and m.user_id is not null
  loop
    insert into staff_notices (user_id, gym_id, notice_type, title_en, title_fr, body_en, body_fr)
    values (r.uid, p_gym_id, p_notice_type, p_title_en, p_title_fr, p_body_en, p_body_fr)
    returning id into v_notice_id;

    select coalesce(
             (select nullif(btrim(au.email), '') from auth.users au where au.id = r.uid),
             (select nullif(btrim(m2.email), '') from members m2 where m2.user_id = r.uid and m2.gym_id = p_gym_id limit 1))
      into v_email;

    if v_email is not null then
      insert into email_outbox (notice_id, recipient_email, subject, body)
      select v_notice_id, v_email, n.title_en || ' / ' || n.title_fr, n.body_en || E'\n\n' || n.body_fr
        from staff_notices n where n.id = v_notice_id;
    end if;
  end loop;
end;
$$;

revoke execute on function private.page_text_trim(text) from public, anon, authenticated, service_role;
revoke execute on function private.page_takedown_label(text, text) from public, anon, authenticated, service_role;
revoke execute on function private.gym_page_taken_down(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.notify_page_moderation(uuid, text, text, text, text, text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- take_down_gym_page(): see the header. Typed errors (message suffix): invalid_reason, note_required, note_invalid, no_page,
-- already_taken_down; `permission denied` for anyone but a live Super Admin.
-- ----------------------------------------------------------------------------
create function public.take_down_gym_page(p_gym_id uuid, p_reason text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_note text;
  v_page gym_pages%rowtype;
  v_name text;
  v_takedown_id uuid;
  v_label_en text;
  v_label_fr text;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;
  if p_gym_id is null then
    raise exception 'take_down_gym_page: gym not found';
  end if;
  if p_reason is null or p_reason not in ('impersonation', 'illegal_content', 'trademark', 'misleading_content', 'privacy', 'other') then
    raise exception 'take_down_gym_page: invalid_reason';
  end if;
  v_note := nullif(private.page_text_trim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'take_down_gym_page: note_invalid';
  end if;
  if p_reason = 'other' and char_length(coalesce(v_note, '')) < 3 then
    raise exception 'take_down_gym_page: note_required';
  end if;

  -- the gym row first (the lock order of claim, publish and the sweep), then the page row
  perform 1 from gyms g where g.id = p_gym_id for update;
  if not found then
    raise exception 'take_down_gym_page: gym not found';
  end if;
  select * into v_page from gym_pages gp where gp.gym_id = p_gym_id for update;
  if not found then
    raise exception 'take_down_gym_page: no_page';
  end if;
  if v_page.taken_down_at is not null then
    raise exception 'take_down_gym_page: already_taken_down';
  end if;

  select pn.name into v_name from page_names pn where pn.gym_id = p_gym_id and pn.state = 'active';

  update gym_pages
     set taken_down_at = now(), taken_down_reason = p_reason, taken_down_note = v_note, updated_at = now()
   where gym_id = p_gym_id;

  -- Every name row of the gym that is not released: the redirects drop at once (FR-203), the active name stays reserved to the gym (AD-45).
  update page_names set taken_down_at = now()
   where gym_id = p_gym_id and state <> 'released' and taken_down_at is null;

  insert into private.page_takedowns (gym_id, page_name, reason, note, taken_down_by)
  values (p_gym_id, v_name, p_reason, v_note, private.actor_id())
  returning id into v_takedown_id;

  v_label_en := private.page_takedown_label(p_reason, 'en');
  v_label_fr := private.page_takedown_label(p_reason, 'fr');
  perform private.notify_page_moderation(
    p_gym_id, 'page_taken_down',
    'GymOS took your page down',
    'GymOS a retiré votre page',
    'GymOS took your page down: ' || v_label_en || '. Your page name stays reserved for you. You can appeal from your page settings.',
    'GymOS a retiré votre page : ' || v_label_fr || '. Le nom de votre page reste réservé pour vous. Vous pouvez faire appel depuis les paramètres de votre page.');

  -- The note is the Super Admin's own; the Owner can read their gym's audit log, so only the code and a flag go in.
  perform log_audit_event(
    p_action_type => 'gym_page_taken_down',
    p_gym_id => p_gym_id,
    p_target_entity_id => v_takedown_id::text,
    p_target_entity_type => 'gym_page_takedown',
    p_metadata => jsonb_build_object('reason', p_reason, 'has_note', v_note is not null, 'name', v_name));

  return jsonb_build_object('taken_down', true, 'takedown_id', v_takedown_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- lift_gym_page_takedown(): see the header. Typed errors: reason_required, not_taken_down.
-- ----------------------------------------------------------------------------
create function public.lift_gym_page_takedown(p_gym_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_page gym_pages%rowtype;
  v_was_live boolean;
  v_had_appeal boolean;
  v_actor uuid;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;
  if p_gym_id is null then
    raise exception 'lift_gym_page_takedown: gym not found';
  end if;
  v_reason := private.page_text_trim(coalesce(p_reason, ''));
  if char_length(v_reason) not between 3 and 500 then
    raise exception 'lift_gym_page_takedown: reason_required';
  end if;

  perform 1 from gyms g where g.id = p_gym_id for update;
  if not found then
    raise exception 'lift_gym_page_takedown: gym not found';
  end if;
  select * into v_page from gym_pages gp where gp.gym_id = p_gym_id for update;
  if not found or v_page.taken_down_at is null then
    raise exception 'lift_gym_page_takedown: not_taken_down';
  end if;

  v_actor := private.actor_id();
  v_was_live := v_page.published_at is not null and v_page.unpublished_at is null;

  -- The page comes back UNPUBLISHED: the Owner publishes again and the gate re-runs (SA-18).
  update gym_pages
     set taken_down_at = null, taken_down_reason = null, taken_down_note = null,
         unpublished_at = coalesce(unpublished_at, now()),
         unpublished_reason = case when v_was_live then 'takedown_lifted' else unpublished_reason end,
         updated_at = now()
   where gym_id = p_gym_id;

  -- The active name (and a pending or reserved one) is unflagged; the old-name redirects stay dropped. The page is idle again, so the
  -- 12-month clock starts now (a clock that ran out during a long takedown must not release the name on the next sweep).
  update page_names
     set taken_down_at = null, reserved_until = case when state = 'active' then now() + interval '12 months' else reserved_until end
   where gym_id = p_gym_id and state in ('active', 'held', 'reserved') and taken_down_at is not null;

  select exists (select 1 from private.page_appeals a
                   join private.page_takedowns t on t.id = a.takedown_id
                  where t.gym_id = p_gym_id and t.lifted_at is null and a.decision is null)
    into v_had_appeal;

  update private.page_appeals a
     set decision = 'lift', decided_at = now(), decided_by = v_actor, decision_reason = v_reason
   where a.decision is null
     and a.takedown_id in (select t.id from private.page_takedowns t where t.gym_id = p_gym_id and t.lifted_at is null);

  update private.page_takedowns
     set lifted_at = now(), lifted_by = v_actor, lift_reason = v_reason
   where gym_id = p_gym_id and lifted_at is null;

  perform private.notify_page_moderation(
    p_gym_id, 'page_takedown_lifted',
    case when v_had_appeal then 'Your appeal was accepted' else 'The takedown of your page was lifted' end,
    case when v_had_appeal then 'Votre appel a été accepté' else 'Le retrait de votre page a été levé' end,
    case when v_had_appeal then 'GymOS accepted your appeal and lifted the takedown.' else 'GymOS lifted the takedown of your page.' end
      || ' Reason: ' || v_reason || '. Your page is not public yet: check it in your page settings and publish it again.',
    case when v_had_appeal then 'GymOS a accepté votre appel et levé le retrait.' else 'GymOS a levé le retrait de votre page.' end
      || ' Motif : ' || v_reason || '. Votre page n''est pas encore publique : vérifiez-la dans les paramètres de votre page puis publiez-la à nouveau.');

  perform log_audit_event(
    p_action_type => 'gym_page_takedown_lifted',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym_page_takedown',
    p_metadata => jsonb_build_object('reason', v_reason, 'had_appeal', v_had_appeal));

  return jsonb_build_object('lifted', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- claim_page_name: 0163's, plus the page_taken_down refusal (Owner path) and the Owner notice for a Super Admin replacement.
-- ----------------------------------------------------------------------------
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

  -- Story 24.11 (AD-45): while the page is taken down the Owner cannot rename. A rename would turn the flagged active name into a redirect,
  -- and the sweep would release it once the takedown is lifted: a taken-down name is never released.
  if not v_is_super_admin and private.gym_page_taken_down(p_gym_id) then
    raise exception 'claim_page_name: page_taken_down';
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

  -- Story 24.11 (EXPERIENCE.md AD-28 "Owner notices for names"): a Super Admin claim that replaces the gym's name tells the Owner. A Super Admin
  -- claim releases the old name and its redirects at once, so the second sentence says the old address stops (the AD-28 text promised a forward).
  if v_is_super_admin and v_state = 'active' and v_active.id is not null and v_active.name is distinct from v_name then
    perform private.notify_page_moderation(
      p_gym_id, 'page_name_replaced',
      'GymOS changed your page name',
      'GymOS a changé le nom de votre page',
      'GymOS changed your page name to ' || v_name || '. Your old address no longer works.',
      'GymOS a changé le nom de votre page en ' || v_name || '. Votre ancienne adresse ne fonctionne plus.');
  end if;

  return jsonb_build_object('id', v_id, 'name', v_name, 'state', v_state,
                            'origin', case when v_state = 'held' and v_is_rename then 'rename' else v_origin end,
                            'previous_name', v_active.name);
end;
$$;

revoke execute on function public.claim_page_name(uuid, text) from public, anon;
grant execute on function public.claim_page_name(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Reports
-- ----------------------------------------------------------------------------

-- The ONLY function public_site_reader may execute. Returns ok | rate_limited | not_found | invalid. It resolves the visible page itself
-- (a hidden page answers not_found and nothing is written), validates, rate-limits (5 per source hash per hour, 30 per gym per day;
-- a limited report is not stored) and stores the keyed hash, never an address.
create function public_site.submit_page_report(p_name text, p_reason text, p_details text, p_source_hash text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_name text := lower(btrim(coalesce(p_name, '')));
  v_gym uuid;
  v_page_name text;
  v_details text;
begin
  select pn.gym_id, v.name into v_gym, v_page_name
    from private.gym_page_visible v
    join public.page_names pn on pn.id = v.page_name_id
   where lower(v.name) = v_name;
  if v_gym is null then
    return 'not_found';
  end if;

  if p_reason is null or p_reason not in ('impersonation', 'illegal_content', 'trademark', 'misleading_content', 'privacy', 'other') then
    return 'invalid';
  end if;
  if p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$' then
    return 'invalid';
  end if;
  v_details := private.page_text_trim(coalesce(p_details, ''));
  if char_length(v_details) not between 1 and 1000
     or v_details ~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]' then
    return 'invalid';
  end if;

  -- One lock per source, then one per gym (always in this order), so two concurrent reports cannot both take the last slot.
  perform pg_advisory_xact_lock(hashtextextended('page_report_source:' || p_source_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('page_report_gym:' || v_gym::text, 0));

  if (select count(*) from private.page_reports r where r.source_hash = p_source_hash and r.created_at > now() - interval '1 hour') >= 5
     or (select count(*) from private.page_reports r where r.gym_id = v_gym and r.created_at > now() - interval '1 day') >= 30 then
    return 'rate_limited';
  end if;

  insert into private.page_reports (gym_id, page_name, reason, details, source_hash, due_at)
  values (v_gym, v_page_name, p_reason, v_details, p_source_hash, private.add_business_days(now(), 5));
  return 'ok';
end;
$$;

revoke execute on function public_site.submit_page_report(text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public_site.submit_page_report(text, text, text, text) to public_site_reader;

-- The queue: open reports, the soonest due first. Overdue = past the 5 business days [ASSUMPTION]. Super Admin only.
create function public.list_page_reports()
returns table (
  id uuid, gym_id uuid, gym_name text, page_name text, reason text, details text,
  created_at timestamptz, due_at timestamptz, overdue boolean, status text, page_taken_down boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;

  return query
    select r.id, r.gym_id, g.name::text, r.page_name, r.reason, r.details, r.created_at, r.due_at,
           r.due_at < now(), r.status,
           private.gym_page_taken_down(r.gym_id)
      from private.page_reports r
      join gyms g on g.id = r.gym_id
     where r.status = 'open'
     order by r.due_at, r.id;
end;
$$;

-- Closes one report. `dismissed` needs a note of 3 to 500 characters; `taken_down` needs the gym's page to be taken down now and records
-- the link to that takedown. Typed errors: invalid_outcome, note_required, note_invalid (over 500), not_found, not_open, not_taken_down.
create function public.close_page_report(p_id uuid, p_outcome text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_note text;
  v_report private.page_reports%rowtype;
  v_takedown_id uuid;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;
  if p_outcome is null or p_outcome not in ('taken_down', 'dismissed') then
    raise exception 'close_page_report: invalid_outcome';
  end if;
  v_note := nullif(private.page_text_trim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'close_page_report: note_invalid';
  end if;
  if p_outcome = 'dismissed' and char_length(coalesce(v_note, '')) < 3 then
    raise exception 'close_page_report: note_required';
  end if;

  select * into v_report from private.page_reports r where r.id = p_id;
  if not found then
    raise exception 'close_page_report: not_found';
  end if;
  perform 1 from gyms g where g.id = v_report.gym_id for update;
  select * into v_report from private.page_reports r where r.id = p_id for update;
  if v_report.status <> 'open' then
    raise exception 'close_page_report: not_open';
  end if;

  if p_outcome = 'taken_down' then
    select t.id into v_takedown_id from private.page_takedowns t where t.gym_id = v_report.gym_id and t.lifted_at is null;
    if v_takedown_id is null then
      raise exception 'close_page_report: not_taken_down';
    end if;
  end if;

  update private.page_reports
     set status = p_outcome, closed_at = now(), closed_by = private.actor_id(), closed_note = v_note, takedown_id = v_takedown_id
   where id = p_id;

  perform log_audit_event(
    p_action_type => 'page_report_closed',
    p_gym_id => v_report.gym_id,
    p_target_entity_id => p_id::text,
    p_target_entity_type => 'page_report',
    p_metadata => jsonb_build_object('outcome', p_outcome, 'takedown_id', v_takedown_id));

  return jsonb_build_object('id', p_id, 'status', p_outcome, 'takedown_id', v_takedown_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- Appeals
-- ----------------------------------------------------------------------------

-- Owner only, for the Owner's own gym (support has no owner role here, so it is refused). One appeal per takedown, ever.
-- Typed errors: reason_required, not_taken_down, appeal_open, appeal_decided.
create function public.submit_page_appeal(p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_gym uuid := private.gym_id();
  v_reason text;
  v_takedown private.page_takedowns%rowtype;
  v_existing private.page_appeals%rowtype;
  v_id uuid;
begin
  if v_gym is null or private.current_member_role() is distinct from 'owner' then
    raise exception 'permission denied';
  end if;
  v_reason := private.page_text_trim(coalesce(p_reason, ''));
  if char_length(v_reason) not between 1 and 500 then
    raise exception 'submit_page_appeal: reason_required';
  end if;

  perform 1 from gyms g where g.id = v_gym for update;
  select * into v_takedown from private.page_takedowns t where t.gym_id = v_gym and t.lifted_at is null;
  if not found or not private.gym_page_taken_down(v_gym) then
    raise exception 'submit_page_appeal: not_taken_down';
  end if;

  select * into v_existing from private.page_appeals a where a.takedown_id = v_takedown.id;
  if found then
    if v_existing.decision is null then
      raise exception 'submit_page_appeal: appeal_open';
    end if;
    raise exception 'submit_page_appeal: appeal_decided';
  end if;

  insert into private.page_appeals (takedown_id, gym_id, reason, created_by)
  values (v_takedown.id, v_gym, v_reason, private.actor_id())
  returning id into v_id;

  perform log_audit_event(
    p_action_type => 'gym_page_appeal_submitted',
    p_gym_id => v_gym,
    p_target_entity_id => v_id::text,
    p_target_entity_type => 'gym_page_appeal',
    p_metadata => jsonb_build_object('takedown_id', v_takedown.id));

  return jsonb_build_object('id', v_id, 'state', 'open');
end;
$$;

-- Every appeal, the undecided first, then the newest. Super Admin only.
create function public.list_page_appeals()
returns table (
  id uuid, gym_id uuid, gym_name text, page_name text, takedown_reason text, takedown_note text, taken_down_at timestamptz,
  appeal_reason text, appealed_at timestamptz, decision text, decision_reason text, decided_at timestamptz, takedown_lifted boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;

  return query
    select a.id, a.gym_id, g.name::text, t.page_name, t.reason, t.note, t.taken_down_at,
           a.reason, a.created_at, a.decision, a.decision_reason, a.decided_at, t.lifted_at is not null
      from private.page_appeals a
      join private.page_takedowns t on t.id = a.takedown_id
      join gyms g on g.id = a.gym_id
     order by (a.decision is null) desc, a.created_at desc, a.id
     limit 200;
end;
$$;

-- decision `lift` runs lift_gym_page_takedown (the page comes back unpublished); `uphold` keeps the takedown and ends the appeal. The reason
-- reaches the Owner either way. Typed errors: invalid_decision, reason_required, not_found, not_open, plus the lift's own.
create function public.decide_page_appeal(p_id uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_appeal private.page_appeals%rowtype;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;
  if p_decision is null or p_decision not in ('lift', 'uphold') then
    raise exception 'decide_page_appeal: invalid_decision';
  end if;
  v_reason := private.page_text_trim(coalesce(p_reason, ''));
  if char_length(v_reason) not between 3 and 500 then
    raise exception 'decide_page_appeal: reason_required';
  end if;

  select * into v_appeal from private.page_appeals a where a.id = p_id;
  if not found then
    raise exception 'decide_page_appeal: not_found';
  end if;
  perform 1 from gyms g where g.id = v_appeal.gym_id for update;
  select * into v_appeal from private.page_appeals a where a.id = p_id for update;
  if v_appeal.decision is not null then
    raise exception 'decide_page_appeal: not_open';
  end if;

  if p_decision = 'lift' then
    -- the lift closes this appeal with the same reason, tells the Owner and writes the audit rows
    perform public.lift_gym_page_takedown(v_appeal.gym_id, v_reason);
  else
    update private.page_appeals
       set decision = 'uphold', decided_at = now(), decided_by = private.actor_id(), decision_reason = v_reason
     where id = p_id;
    perform private.notify_page_moderation(
      v_appeal.gym_id, 'page_appeal_decided',
      'Your appeal was decided',
      'Votre appel a été examiné',
      'GymOS reviewed your appeal and upheld the takedown of your page. Reason: ' || v_reason || '.',
      'GymOS a examiné votre appel et maintient le retrait de votre page. Motif : ' || v_reason || '.');
  end if;

  perform log_audit_event(
    p_action_type => 'gym_page_appeal_decided',
    p_gym_id => v_appeal.gym_id,
    p_target_entity_id => p_id::text,
    p_target_entity_type => 'gym_page_appeal',
    p_metadata => jsonb_build_object('decision', p_decision, 'reason', v_reason));

  return jsonb_build_object('id', p_id, 'decision', p_decision);
end;
$$;

revoke execute on function public.take_down_gym_page(uuid, text, text) from public, anon;
revoke execute on function public.lift_gym_page_takedown(uuid, text) from public, anon;
revoke execute on function public.list_page_reports() from public, anon;
revoke execute on function public.close_page_report(uuid, text, text) from public, anon;
revoke execute on function public.submit_page_appeal(text) from public, anon;
revoke execute on function public.list_page_appeals() from public, anon;
revoke execute on function public.decide_page_appeal(uuid, text, text) from public, anon;
grant execute on function public.take_down_gym_page(uuid, text, text) to authenticated;
grant execute on function public.lift_gym_page_takedown(uuid, text) to authenticated;
grant execute on function public.list_page_reports() to authenticated;
grant execute on function public.close_page_report(uuid, text, text) to authenticated;
grant execute on function public.submit_page_appeal(text) to authenticated;
grant execute on function public.list_page_appeals() to authenticated;
grant execute on function public.decide_page_appeal(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Step-up: taking a page down and lifting a takedown need a fresh authenticator code (SA-17, SA-21). 0145's list plus the two actions.
-- ----------------------------------------------------------------------------
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
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email', 'support_refund', 'support_waive_registration_fee', 'support_create_staff', 'support_payment_connection', 'start_support_factor_reset', 'take_down_gym_page', 'lift_gym_page_takedown') then
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

-- ----------------------------------------------------------------------------
-- Consumers of the takedown predicate that were silent about it
-- ----------------------------------------------------------------------------

-- refresh_gym_page: 0164's, but a taken-down page is left alone. No gate-reason write, no "fix it and publish again" notice: publish refuses
-- `taken_down` whatever the gate says, so a takedown is never rewritten as a gate failure.
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
  -- Lock first, with no unlocked early exit (0164, review pass 2): an edit whose trigger runs while a publish is still in flight must wait
  -- for that publish, then see the page it made live and re-judge it.
  perform 1 from gyms g where g.id = p_gym_id for no key update;
  if not found then
    return;
  end if;

  select * into v_page from gym_pages gp where gp.gym_id = p_gym_id for update;
  if not found or v_page.published_at is null or v_page.unpublished_at is not null or v_page.taken_down_at is not null then
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

-- set_page_name_idle: 0163's, plus the page-row predicate. The clock of a name whose page is taken down neither starts nor stops.
create or replace function private.set_page_name_idle(p_gym_id uuid, p_idle boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if private.gym_page_taken_down(p_gym_id) then
    return;
  end if;
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

-- page_names_sweep: 0164's, plus the page-row predicate (a name is never released while its gym's page is taken down, whatever the name
-- row says) and the release of a flagged redirect once the takedown is lifted and its 12 months are over.
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
    select pn.id, pn.gym_id, pn.name, g.status::text as gym_status
      from page_names pn
      join gyms g on g.id = pn.gym_id
     where pn.state = 'active' and pn.taken_down_at is null
       and not private.gym_page_taken_down(pn.gym_id)
       and pn.reserved_until is not null and pn.reserved_until < now()
       and (g.status <> 'active' or not private.page_name_has_published_page(pn.gym_id))
     order by pn.reserved_until, pn.id
  loop
    begin
      -- same lock order as claim_page_name() (gym row first), then re-check inside the lock: a claim, a rename, a publish or a takedown
      -- that committed after the select above must not lose its name to this loop
      perform 1 from gyms g where g.id = r.gym_id for update;

      -- a live page of a gym that is not active goes offline with its name
      update gym_pages gp
         set unpublished_at = now(), unpublished_reason = 'name_released', updated_at = now()
       where gp.gym_id = r.gym_id and gp.published_at is not null and gp.unpublished_at is null and gp.taken_down_at is null
         and exists (select 1 from gyms g where g.id = r.gym_id and g.status <> 'active')
         and exists (select 1 from page_names a
                      where a.id = r.id and a.state = 'active' and a.taken_down_at is null
                        and a.reserved_until is not null and a.reserved_until < now());
      get diagnostics v_pages = row_count;

      update page_names set state = 'released'
       where id = r.id and state = 'active' and taken_down_at is null
         and not private.gym_page_taken_down(r.gym_id)
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
        else
          -- the page was not live, so notify_page_unpublished said nothing: tell the Owner the name is gone (EXPERIENCE.md AD-28, no double notice)
          perform private.notify_page_moderation(
            r.gym_id, 'page_name_released',
            'Your page name was released',
            'Le nom de votre page a été libéré',
            case when r.gym_status <> 'active'
                 then 'Your page name ' || r.name || ' was released because your gym has been inactive for 12 months. Claim a name to publish again.'
                 else 'Your page name ' || r.name || ' was released because your page has been offline for 12 months. Claim a name to publish again.' end,
            case when r.gym_status <> 'active'
                 then 'Le nom de votre page ' || r.name || ' a été libéré car votre salle est inactive depuis 12 mois. Choisissez un nom pour publier à nouveau.'
                 else 'Le nom de votre page ' || r.name || ' a été libéré car votre page est hors ligne depuis 12 mois. Choisissez un nom pour publier à nouveau.' end);
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
     where pn.state = 'redirect'
       and (pn.taken_down_at is null or not private.gym_page_taken_down(pn.gym_id))
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

-- ----------------------------------------------------------------------------
-- get_gym_page_status: 0165's, plus the takedown reason code (note-free) and the appeal state. Read-only, as before.
-- ----------------------------------------------------------------------------
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
  v_td private.page_takedowns%rowtype;
  v_ap private.page_appeals%rowtype;
  v_reason_code text;
  v_appeal jsonb := null;
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
             or exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.taken_down_at is not null and pn.state in ('active', 'held', 'reserved'));
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

  if v_taken then
    v_reason_code := v_gp.taken_down_reason;
    select * into v_td from private.page_takedowns t where t.gym_id = p_gym_id and t.lifted_at is null;
    if found then
      v_reason_code := coalesce(v_reason_code, v_td.reason);
      select * into v_ap from private.page_appeals a where a.takedown_id = v_td.id;
      v_appeal := jsonb_build_object(
        'state', case when v_ap.id is null then 'none' when v_ap.decision is null then 'open' else v_ap.decision end,
        'submitted_at', v_ap.created_at,
        'decided_at', v_ap.decided_at,
        'decision_reason', v_ap.decision_reason);
    else
      v_appeal := jsonb_build_object('state', 'none', 'submitted_at', null, 'decided_at', null, 'decision_reason', null);
    end if;
  end if;

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
    'snapshot', private.gym_page_snapshot(p_gym_id),
    'taken_down_reason', case when v_taken then v_reason_code end,
    'appeal', v_appeal
  );
end;
$$;

revoke execute on function public.get_gym_page_status(uuid) from public, anon;
grant execute on function public.get_gym_page_status(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Media purge: the calls of the `page-media-purge` edge function (service_role only) and of the dashboard publish path.
-- Nothing here deletes a Storage object or a gym_page_media row.
-- ----------------------------------------------------------------------------

-- The candidate rule, in ONE place (the list and the mark both use it). A derivative is due when it has not been purged and its row is deleted or
-- the gym's page ROW exists and is offline (unpublished or taken down). A suspended gym's live page and a gym with no page row are not due.
create function private.page_media_derivative_due(p_gym_id uuid, p_row_deleted boolean, p_purged_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_purged_at is null
     and (coalesce(p_row_deleted, false)
          or exists (select 1 from gym_pages gp
                      where gp.gym_id = p_gym_id
                        and (gp.published_at is null or gp.unpublished_at is not null or gp.taken_down_at is not null)));
$$;

-- Lists up to p_limit rows with something to delete, oldest first, and stamps NOTHING. A derivative is listed when it is due (above); an
-- original only when its row is deleted and it has not been purged.
create function public.page_media_purge_candidates(p_limit integer default 100)
returns table (id uuid, original_key text, derivative_key text, purge_derivative boolean, purge_original boolean)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.original_key, m.derivative_key,
         private.page_media_derivative_due(m.gym_id, m.deleted_at is not null, m.purged_at),
         (m.original_purged_at is null and m.deleted_at is not null)
    from gym_page_media m
   where private.page_media_derivative_due(m.gym_id, m.deleted_at is not null, m.purged_at)
      or (m.original_purged_at is null and m.deleted_at is not null)
   order by m.created_at, m.id
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- Marks what the caller has CONFIRMED deleted. The derivative is marked only while it is still due (re-checked here: a page republished since
-- the list keeps a live row); the original only for a deleted row. Returns whether every part asked for is now marked.
create function public.page_media_purge_mark(p_id uuid, p_derivative boolean, p_original boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update gym_page_media m
     set purged_at = case when coalesce(p_derivative, false) and private.page_media_derivative_due(m.gym_id, m.deleted_at is not null, m.purged_at)
                          then now() else m.purged_at end,
         original_purged_at = case when coalesce(p_original, false) and m.original_purged_at is null and m.deleted_at is not null
                                   then now() else m.original_purged_at end
   where m.id = p_id;

  select (not coalesce(p_derivative, false) or m.purged_at is not null) and (not coalesce(p_original, false) or m.original_purged_at is not null)
    into v_ok
    from gym_page_media m where m.id = p_id;
  return coalesce(v_ok, false);
end;
$$;

-- Objects with no row, older than one hour (an upload writes its objects before it registers the row), oldest first, one bounded page.
-- A gym's deletion cascades its rows away and leaves its objects here. Reads storage.objects; the removal is the caller's, through the
-- Storage API.
create function public.page_media_purge_orphans(p_limit integer default 50)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select x.b, x.n
    from (
      select o.bucket_id::text as b, o.name::text as n, o.created_at as c
        from storage.objects o
       where o.bucket_id = 'gym-page-media'
         and o.created_at < now() - interval '1 hour'
         and o.name !~ '\.emptyFolderPlaceholder$'
         and not exists (select 1 from public.gym_page_media m where m.derivative_key = o.name)
      union all
      select o.bucket_id::text, o.name::text, o.created_at
        from storage.objects o
       where o.bucket_id = 'gym-page-media-src'
         and o.created_at < now() - interval '1 hour'
         and o.name !~ '\.emptyFolderPlaceholder$'
         and not exists (select 1 from public.gym_page_media m where m.original_key = o.name)
    ) x
   order by x.c, x.b, x.n
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- One job_runs row per run (the edge function calls this once at the end).
create function public.record_page_media_purge_run(p_started_at timestamptz, p_ok boolean, p_summary text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into job_runs (job_name, started_at, finished_at, status, error)
  values ('page_media_purge', coalesce(p_started_at, now()), now(),
          case when coalesce(p_ok, false) then 'success'::job_status else 'failure'::job_status end,
          left(p_summary, 500));
$$;

-- The dashboard publish path: the live rows whose derivative was purged (page was offline), to be rebuilt from the retained original.
create function public.page_media_rederive_list(p_gym_id uuid)
returns table (id uuid, kind text, original_key text, derivative_key text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.kind, m.original_key, m.derivative_key
    from gym_page_media m
   where m.gym_id = p_gym_id and m.deleted_at is null and m.purged_at is not null
   order by m.created_at, m.id;
$$;

create function public.page_media_rederive_done(p_gym_id uuid, p_ids uuid[])
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with u as (
    update gym_page_media m set purged_at = null
     where m.gym_id = p_gym_id and m.deleted_at is null and m.id = any (p_ids) and m.purged_at is not null
    returning 1)
  select count(*)::integer from u;
$$;

revoke execute on function private.page_media_derivative_due(uuid, boolean, timestamptz) from public, anon, authenticated, service_role;
revoke execute on function public.page_media_purge_candidates(integer) from public, anon, authenticated;
revoke execute on function public.page_media_purge_mark(uuid, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.page_media_purge_orphans(integer) from public, anon, authenticated;
revoke execute on function public.record_page_media_purge_run(timestamptz, boolean, text) from public, anon, authenticated;
revoke execute on function public.page_media_rederive_list(uuid) from public, anon, authenticated;
revoke execute on function public.page_media_rederive_done(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.page_media_purge_candidates(integer) to service_role;
grant execute on function public.page_media_purge_mark(uuid, boolean, boolean) to service_role;
grant execute on function public.page_media_purge_orphans(integer) to service_role;
grant execute on function public.record_page_media_purge_run(timestamptz, boolean, text) to service_role;
grant execute on function public.page_media_rederive_list(uuid) to service_role;
grant execute on function public.page_media_rederive_done(uuid, uuid[]) to service_role;

-- ----------------------------------------------------------------------------
-- The schedule: every 5 minutes pg_net posts to the edge function with a bearer secret kept in Vault. Without both Vault secrets the tick
-- does nothing (a fresh local database, or a project where the owner has not deployed the function yet).
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/page-media-purge', 'page_media_purge_url');
--   select vault.create_secret('<the same value as the function secret PAGE_MEDIA_PURGE_SECRET>', 'page_media_purge_secret');
-- ----------------------------------------------------------------------------
create function private.page_media_purge_tick()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'page_media_purge_url' order by ds.created_at desc limit 1;
  select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds where ds.name = 'page_media_purge_secret' order by ds.created_at desc limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 50000);
end;
$$;

revoke execute on function private.page_media_purge_tick() from public, anon, authenticated, service_role;

-- every 5 minutes; cron.schedule() upserts by name
select cron.schedule('page_media_purge', '*/5 * * * *', $$ select private.page_media_purge_tick(); $$);

-- ----------------------------------------------------------------------------
-- The migration proves its own result.
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_fn text;
begin
  if exists (select 1 from unnest(array['private.page_takedowns', 'private.page_reports', 'private.page_appeals']) t
              where (select relrowsecurity from pg_class where oid = t::regclass) is distinct from true) then
    raise exception '0167: a takedown table has no row level security';
  end if;
  if exists (
    select 1 from unnest(array['public', 'anon', 'authenticated', 'service_role', 'public_site_reader']) g,
                  unnest(array['private.page_takedowns', 'private.page_reports', 'private.page_appeals']) t,
                  unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     where has_table_privilege(g, t, p)) then
    raise exception '0167: a takedown table is reachable by a client role';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'private' and tablename in ('page_takedowns', 'page_reports', 'page_appeals')) then
    raise exception '0167: a takedown table has a policy';
  end if;

  -- the reader may execute exactly one function, and it is in public_site (the schema holds nothing else)
  if (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p
       where p.pronamespace = 'public_site'::regnamespace and has_function_privilege('public_site_reader', p.oid, 'execute'))
     is distinct from array['public_site.submit_page_report(text,text,text,text)']
     or (select count(*) from pg_proc p where p.pronamespace = 'public_site'::regnamespace) <> 1 then
    raise exception '0167: public_site_reader can execute something other than submit_page_report';
  end if;
  if exists (select 1 from unnest(array['public', 'anon', 'authenticated', 'service_role']) g
              where has_function_privilege(g, 'public_site.submit_page_report(text,text,text,text)', 'execute')) then
    raise exception '0167: submit_page_report is executable by a client role';
  end if;

  for v_fn in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('take_down_gym_page', 'lift_gym_page_takedown', 'list_page_reports', 'close_page_report', 'submit_page_appeal',
                         'list_page_appeals', 'decide_page_appeal', 'get_gym_page_status')
  loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('public', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0167: % has the wrong execute grants', v_fn;
    end if;
  end loop;
  for v_fn in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('page_media_purge_candidates', 'page_media_purge_mark', 'page_media_purge_orphans', 'record_page_media_purge_run',
                         'page_media_rederive_list', 'page_media_rederive_done')
  loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('public', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') or not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0167: % must be executable by service_role only', v_fn;
    end if;
  end loop;
  for v_fn in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and p.proname in ('page_text_trim', 'page_takedown_label', 'gym_page_taken_down', 'notify_page_moderation', 'page_media_purge_tick', 'page_media_derivative_due',
                         'refresh_gym_page', 'set_page_name_idle', 'page_names_sweep')
  loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('public', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0167: % is callable by a client role', v_fn;
    end if;
  end loop;

  if not exists (select 1 from cron.job where jobname = 'page_media_purge' and schedule = '*/5 * * * *')
     or not exists (select 1 from cron.job where jobname = 'page_names_sweep') then
    raise exception '0167: a cron job is missing';
  end if;
  if (select prosrc from pg_proc where proname = 'refresh_gym_page' and pronamespace = 'private'::regnamespace) !~ 'taken_down_at is not null' then
    raise exception '0167: refresh_gym_page does not skip a taken-down page';
  end if;
  if (select count(*) from pg_proc where proname = 'get_gym_page_status' and pronamespace = 'public'::regnamespace
        and prosecdef and provolatile = 's' and proconfig = array['search_path=public']) <> 1
     or exists (select 1 from pg_proc where proname = 'get_gym_page_status' and pronamespace = 'public'::regnamespace
                 and prosrc ~* '(insert\s+into|update\s+\w|delete\s+from|log_audit_event)') then
    raise exception '0167: get_gym_page_status is not a read-only stable security definer function';
  end if;
  if exists (select 1 from private.support_capabilities where object_name in
        ('take_down_gym_page', 'lift_gym_page_takedown', 'submit_page_report', 'submit_page_appeal', 'decide_page_appeal', 'list_page_reports',
         'close_page_report', 'list_page_appeals', 'page_media_purge_candidates', 'page_media_rederive_list')) then
    raise exception '0167: a takedown function admits support';
  end if;
end
$verify$;
