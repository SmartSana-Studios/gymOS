-- ============================================================================
-- 0163: Page names -- claim, hold, rename, redirect (Epic 24, Story 24.7; FR-202, FR-203, AD-45).
--
-- The database half of the page name. A gym claims one name for `{name}.gymosapps.com`; the name is refused, held for
-- Super Admin approval, or active at once. Nothing here is a screen for an Owner (24.9), a public view or route (24.8, 24.10),
-- a takedown (24.11) or a publish (24.8). No public_site view or grant changes.
--
--   page_names               one row per name with a lifecycle: held | active | reserved | redirect | released.
--                            RLS on, no policy, no client grant: read and written only by the functions below.
--   page_name_words          the Super Admin-maintained lists: reserved | brand | generic | place | zone. Seeded from addendum J
--                            and from every label in packages/types/src/constants/reservedLabels.json (kind zone, which the
--                            maintenance function cannot remove). `is_prefix` marks "any name starting with" entries (gymos).
--   claim_page_name()        Owner of that gym (current gym) or a live Super Admin. Refuses, holds or activates.
--   list_held_page_names()   live Super Admin: the review queue with due date and overdue flag.
--   decide_held_page_name()  live Super Admin: approve or reject with a reason; notifies the Owner.
--   get_gym_page_name()      Owner, Supervisor, live-assigned support, Super Admin: the gym's name state. No held_reason.
--   add_/remove_/list_page_name_words()   live Super Admin; audited. Zone words cannot be removed.
--   private.set_page_name_idle()          the one setter of reserved_until for an idle gym (24.8 calls it on publish/unpublish;
--                                         a trigger on gyms.status calls it on suspension and reactivation).
--   private.page_names_sweep()            daily: releases idle names and expired redirects, reminds Super Admins of overdue holds.
--
-- Design choices worth knowing before editing this file:
--
--  * Rows, not columns on gyms. A redirect row carries no target: it resolves through its gym_id to the gym's one `active` row,
--    so a redirect is always one hop however many renames happen. At most one active and one held row per gym (partial unique
--    indexes); one live row per lower(name) across gyms (partial unique index over state <> 'released').
--
--  * "Completed rename" (the limit of two per rolling 12 months) is derived, not stored: origin 'rename', counted from
--    coalesce(decided_at, created_at), and not a row that never reached active. A row that never reached active is a held row
--    that was rejected or withdrawn; it is released with reserved_until still NULL. Every path that releases a row that HAD been
--    active or redirect stamps reserved_until (coalesce(reserved_until, now())), so the two cases stay apart. Keep that rule
--    if you add a releasing path (24.11).
--
--  * Folding for near-match (addendum J): lowercase, strip hyphens, 0->o 1->l 3->e 5->s, vv->w, rn->m. A folded name is held
--    when it is equal to, or one insert/delete/substitution away from, the folded name of another gym's non-released name, a
--    reserved or zone word, or a brand word. Hardening beyond the spec text: a folded name that STARTS with a folded reserved or
--    zone prefix (gym0s-fit) is held too, otherwise a homoglyph walks around the gymos prefix.
--
--  * One held word holds the name (owner decision 2026-11-08): any hyphen-separated part equal to a generic or place word.
--    `x-fitness` is held, `gymnast` is not. A Super Admin claim on behalf of a gym skips the hold, never the refusals.
--
--  * held_reason may name ANOTHER gym's name (near_match_name:<name>). It is read only by list_held_page_names() (Super Admin)
--    and never copied into an audit row (the Owner can read their gym's audit log) or into get_gym_page_name().
--
--  * The reserved-name trigger covers the reserved and zone lists (exact and prefix) on every INSERT of an active row and every
--    UPDATE that makes a row active or renames it. Brand words are checked by claim and approve only: a word added to the brand
--    list later must not make an unrelated UPDATE (the idle clock) of an existing name fail.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- Grammar (FR-202): 3-30 chars of a-z0-9-, no leading/trailing hyphen, no `--`, no `xn--`, not digits only.
-- One function, used by the CHECK and by claim_page_name().
-- ----------------------------------------------------------------------------
create function private.page_name_valid(p_name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_name is not null
     and p_name ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
     and p_name !~ '--'
     and p_name !~ '^xn--'
     and p_name !~ '^[0-9]+$';
$$;

revoke execute on function private.page_name_valid(text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table public.page_names (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null,
  state text not null,
  origin text not null,
  held_reason text,
  held_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decision_reason text,
  reminded_at timestamptz,
  reserved_until timestamptz,
  taken_down_at timestamptz,
  created_at timestamptz not null default now(),
  constraint page_names_name_grammar check (private.page_name_valid(name)),
  constraint page_names_state check (state in ('held', 'active', 'reserved', 'redirect', 'released')),
  constraint page_names_origin check (origin in ('claim', 'rename', 'forced_rename')),
  constraint page_names_held_has_reason check (state <> 'held' or (held_at is not null and held_reason is not null)),
  constraint page_names_decision_reason_bounds check (decision_reason is null or char_length(decision_reason) between 3 and 500)
);

-- One live row per name, whatever its case or its gym.
create unique index page_names_name_live on public.page_names (lower(name)) where state <> 'released';
-- At most one active and one held row per gym.
create unique index page_names_one_active on public.page_names (gym_id) where state = 'active';
create unique index page_names_one_held on public.page_names (gym_id) where state = 'held';
create index page_names_gym_idx on public.page_names (gym_id, state);
create index page_names_sweep_idx on public.page_names (reserved_until) where state in ('active', 'redirect') and reserved_until is not null;

alter table public.page_names enable row level security;
-- Deliberately no policy: client roles see nothing. Every read and write goes through the functions below.
revoke all on table public.page_names from public, anon, authenticated, service_role;

comment on table public.page_names is
  'Page names (24.7, AD-45). Written only by claim_page_name, decide_held_page_name and the private lifecycle functions. A redirect row has no target: it resolves through gym_id to the gym''s active row.';

create table public.page_name_words (
  kind text not null,
  word text not null,
  is_prefix boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (kind, word, is_prefix),
  constraint page_name_words_kind check (kind in ('reserved', 'brand', 'generic', 'place', 'zone')),
  constraint page_name_words_word check (word ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' and char_length(word) between 1 and 30),
  constraint page_name_words_prefix_kind check (not is_prefix or kind in ('reserved', 'zone'))
);

alter table public.page_name_words enable row level security;
revoke all on table public.page_name_words from public, anon, authenticated, service_role;

comment on table public.page_name_words is
  'Super Admin-maintained word lists for page names (24.7). Changed only through add_/remove_page_name_word(); kind zone cannot be removed.';

-- Seeds. reserved, brand, generic and place: addendum J. zone: every label (and prefix) in reservedLabels.json; a node test
-- (scripts/__tests__/reserved-labels.test.mjs) fails if this list drifts from the JSON.
insert into public.page_name_words (kind, word, is_prefix) values
  ('reserved', 'owner', false), ('reserved', 'portal', false), ('reserved', 'www', false), ('reserved', 'api', false),
  ('reserved', 'app', false), ('reserved', 'admin', false), ('reserved', 'support', false), ('reserved', 'mail', false),
  ('reserved', 'staging', false), ('reserved', 'dev', false), ('reserved', 'gymos', false), ('reserved', 'gym-os', false),
  ('reserved', 'auth', false), ('reserved', 'cdn', false), ('reserved', 'status', false), ('reserved', 'docs', false),
  ('reserved', 'help', false), ('reserved', 'login', false), ('reserved', 'signin', false), ('reserved', 'account', false),
  ('reserved', 'billing', false), ('reserved', 'pay', false), ('reserved', 'payment', false), ('reserved', 'tara', false),
  ('reserved', 'taramoney', false), ('reserved', 'gymos', true),
  ('brand', 'login', false), ('brand', 'signin', false), ('brand', 'password', false), ('brand', 'secure', false),
  ('brand', 'verify', false), ('brand', 'official', false), ('brand', 'payment', false), ('brand', 'billing', false),
  ('brand', 'wallet', false), ('brand', 'tara', false), ('brand', 'momo', false), ('brand', 'mtn', false),
  ('brand', 'orange', false), ('brand', 'whatsapp', false), ('brand', 'google', false), ('brand', 'facebook', false),
  ('brand', 'gymos', false),
  ('generic', 'gym', false), ('generic', 'gyms', false), ('generic', 'fitness', false), ('generic', 'fit', false),
  ('generic', 'yoga', false), ('generic', 'pilates', false), ('generic', 'sport', false), ('generic', 'sports', false),
  ('generic', 'club', false), ('generic', 'best', false), ('generic', 'top', false),
  ('place', 'cameroon', false), ('place', 'cameroun', false), ('place', 'douala', false), ('place', 'yaounde', false);

insert into public.page_name_words (kind, word, is_prefix) values
  ('zone', 'account', false),
  ('zone', 'admin', false),
  ('zone', 'api', false),
  ('zone', 'app', false),
  ('zone', 'auth', false),
  ('zone', 'autoconfig', false),
  ('zone', 'autodiscover', false),
  ('zone', 'billing', false),
  ('zone', 'cdn', false),
  ('zone', 'cpanel', false),
  ('zone', 'cpcalendars', false),
  ('zone', 'cpcontacts', false),
  ('zone', 'dev', false),
  ('zone', 'docs', false),
  ('zone', 'ftp', false),
  ('zone', 'gym-os', false),
  ('zone', 'gymos', false),
  ('zone', 'help', false),
  ('zone', 'imap', false),
  ('zone', 'login', false),
  ('zone', 'mail', false),
  ('zone', 'owner', false),
  ('zone', 'pay', false),
  ('zone', 'payment', false),
  ('zone', 'pop', false),
  ('zone', 'portal', false),
  ('zone', 'rsend', false),
  ('zone', 'send', false),
  ('zone', 'signin', false),
  ('zone', 'smtp', false),
  ('zone', 'staging', false),
  ('zone', 'status', false),
  ('zone', 'support', false),
  ('zone', 'tara', false),
  ('zone', 'taramoney', false),
  ('zone', 'test', false),
  ('zone', 'webdisk', false),
  ('zone', 'webmail', false),
  ('zone', 'whm', false),
  ('zone', 'www', false),
  ('zone', 'gymos', true)
;

-- ----------------------------------------------------------------------------
-- Pure helpers. Private; nothing here is granted to a client role.
-- ----------------------------------------------------------------------------

-- Addendum J folding: lowercase; strip hyphens; 0->o 1->l 3->e 5->s; vv->w; rn->m.
create function private.page_name_fold(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(replace(translate(replace(lower(p_text), '-', ''), '0135', 'oles'), 'vv', 'w'), 'rn', 'm');
$$;

-- Edit distance <= 1: equal, or one insert, delete or substitution. Linear, no extension; names are at most 30 characters.
create function private.page_name_within_one_edit(p_a text, p_b text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  la integer;
  lb integer;
  i integer := 1;
begin
  if p_a is null or p_b is null then
    return false;
  end if;
  if p_a = p_b then
    return true;
  end if;
  la := char_length(p_a);
  lb := char_length(p_b);
  if abs(la - lb) > 1 then
    return false;
  end if;
  while i <= la and i <= lb and substr(p_a, i, 1) = substr(p_b, i, 1) loop
    i := i + 1;
  end loop;
  if la = lb then
    return substr(p_a, i + 1) = substr(p_b, i + 1);
  elsif la > lb then
    return substr(p_a, i + 1) = substr(p_b, i);
  else
    return substr(p_a, i) = substr(p_b, i + 1);
  end if;
end;
$$;

-- Exact reserved or zone word, or a name starting with a reserved or zone prefix (gymos).
create function private.page_name_is_reserved(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.page_name_words w
     where w.kind in ('reserved', 'zone')
       and ((not w.is_prefix and w.word = p_name)
            or (w.is_prefix and left(p_name, char_length(w.word)) = w.word)));
$$;

-- A name containing a brand word anywhere.
create function private.page_name_has_brand_word(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.page_name_words w where w.kind = 'brand' and position(w.word in p_name) > 0);
$$;

-- Why a name must be held for review, or NULL when it may go active at once. The detail after ':' may be another gym's name:
-- it is for the Super Admin queue only.
create function private.page_name_hold_reason(p_name text, p_gym_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fold text := private.page_name_fold(p_name);
  v_hit text;
begin
  -- one generic or place word as a whole hyphen-separated part holds the name
  select w.kind || '_word:' || w.word into v_hit
    from public.page_name_words w
   where w.kind in ('generic', 'place') and not w.is_prefix
     and (w.word = any (string_to_array(p_name, '-')) or w.word = p_name)
   order by w.kind, w.word
   limit 1;
  if v_hit is not null then
    return v_hit;
  end if;

  select 'near_match_name:' || pn.name into v_hit
    from public.page_names pn
   where pn.state <> 'released' and pn.gym_id <> p_gym_id
     and abs(char_length(private.page_name_fold(pn.name)) - char_length(v_fold)) <= 1
     and private.page_name_within_one_edit(private.page_name_fold(pn.name), v_fold)
   order by pn.name
   limit 1;
  if v_hit is not null then
    return v_hit;
  end if;

  select 'near_match_reserved:' || w.word into v_hit
    from public.page_name_words w
   where w.kind in ('reserved', 'zone')
     and ((not w.is_prefix and private.page_name_within_one_edit(private.page_name_fold(w.word), v_fold))
          or (w.is_prefix and left(v_fold, char_length(private.page_name_fold(w.word))) = private.page_name_fold(w.word)))
   order by w.word
   limit 1;
  if v_hit is not null then
    return v_hit;
  end if;

  select 'near_match_brand:' || w.word into v_hit
    from public.page_name_words w
   where w.kind = 'brand' and private.page_name_within_one_edit(private.page_name_fold(w.word), v_fold)
   order by w.word
   limit 1;
  return v_hit;
end;
$$;

-- Completed renames in the rolling 12 months: origin 'rename' (forced renames never count), not still waiting, and not a row that
-- never reached active (rejected or withdrawn: released with reserved_until still NULL). Counted from the activation time, which is
-- the decision time of an approved hold and the creation time of an immediate rename. See the header.
create function private.page_name_completed_renames(p_gym_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.page_names pn
   where pn.gym_id = p_gym_id
     and pn.origin = 'rename'
     and pn.state <> 'held'
     and not (pn.state = 'released' and pn.reserved_until is null)
     and coalesce(pn.decided_at, pn.created_at) > now() - interval '12 months';
$$;

-- A published page: published, not unpublished, not taken down.
create function private.page_name_has_published_page(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_pages gp
     where gp.gym_id = p_gym_id and gp.published_at is not null and gp.unpublished_at is null and gp.taken_down_at is null);
$$;

-- Idle = the page is not published, or the gym is not active (FR-203: reserved while unpublished or suspended).
create function private.page_name_gym_idle(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not (coalesce((select g.status = 'active' from public.gyms g where g.id = p_gym_id), false)
              and private.page_name_has_published_page(p_gym_id));
$$;

revoke execute on function private.page_name_fold(text) from public, anon, authenticated, service_role;
revoke execute on function private.page_name_within_one_edit(text, text) from public, anon, authenticated, service_role;
revoke execute on function private.page_name_is_reserved(text) from public, anon, authenticated, service_role;
revoke execute on function private.page_name_has_brand_word(text) from public, anon, authenticated, service_role;
revoke execute on function private.page_name_hold_reason(text, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.page_name_completed_renames(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.page_name_has_published_page(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.page_name_gym_idle(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- A trigger refuses any active row matching the reserved list, whichever path writes it.
-- ----------------------------------------------------------------------------
create function private.page_names_refuse_reserved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state = 'active'
     and (tg_op = 'INSERT' or old.state is distinct from 'active' or old.name is distinct from new.name)
     and private.page_name_is_reserved(new.name) then
    raise exception 'page_names: reserved_name' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.page_names_refuse_reserved() from public, anon, authenticated, service_role;

create trigger page_names_refuse_reserved
  before insert or update on public.page_names
  for each row execute function private.page_names_refuse_reserved();

-- ----------------------------------------------------------------------------
-- Notices (copy of the 0143 owner-plus-Super-Admin loop shape). Texts name no individual.
-- ----------------------------------------------------------------------------
create function private.notify_page_name_decision(p_gym_id uuid, p_name text, p_approved boolean, p_reason text)
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
    values (
      r.uid, p_gym_id, 'page_name_decision',
      case when p_approved then 'Your page name was approved' else 'Your page name was not approved' end,
      case when p_approved then 'Le nom de votre page a été approuvé' else 'Le nom de votre page n''a pas été approuvé' end,
      'The name "' || p_name || '" for your gym page ' || case when p_approved then 'was approved.' else 'was not approved.' end
        || ' Reason: ' || p_reason,
      'Le nom « ' || p_name || ' » pour la page de votre salle ' || case when p_approved then 'a été approuvé.' else 'n''a pas été approuvé.' end
        || ' Motif : ' || p_reason)
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

-- One reminder per Super Admin for one overdue held name.
create function private.notify_page_name_overdue(p_gym_id uuid, p_name text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_gym_name text;
  v_notice_id uuid;
  v_email text;
  r record;
begin
  select g.name into v_gym_name from gyms g where g.id = p_gym_id;

  for r in select u.id as uid from users u where u.is_super_admin and not u.is_support_proxy loop
    insert into staff_notices (user_id, gym_id, notice_type, title_en, title_fr, body_en, body_fr)
    values (
      r.uid, p_gym_id, 'page_name_overdue',
      'A page name is waiting for review',
      'Un nom de page attend une décision',
      'The name "' || p_name || '" claimed for ' || coalesce(v_gym_name, 'a gym') || ' has waited more than 2 business days for a decision.',
      'Le nom « ' || p_name || ' » demandé pour ' || coalesce(v_gym_name, 'une salle') || ' attend une décision depuis plus de 2 jours ouvrables.')
    returning id into v_notice_id;

    select nullif(btrim(au.email), '') into v_email from auth.users au where au.id = r.uid;
    if v_email is not null then
      insert into email_outbox (notice_id, recipient_email, subject, body)
      select v_notice_id, v_email, n.title_en || ' / ' || n.title_fr, n.body_en || E'\n\n' || n.body_fr
        from staff_notices n where n.id = v_notice_id;
    end if;
  end loop;
end;
$$;

revoke execute on function private.notify_page_name_decision(uuid, text, boolean, text) from public, anon, authenticated, service_role;
revoke execute on function private.notify_page_name_overdue(uuid, text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Lifecycle writers (private). Every function below that writes page_names is on the allowlist in
-- supabase/tests/page_names.test.sql; a new writer fails that test until it is added deliberately.
-- ----------------------------------------------------------------------------

-- Puts a name in service. p_existing_id is a held row to activate, or NULL to insert a new active row. The gym's current active
-- name steps aside: it becomes a redirect for 12 months, or (forced) is released together with all of the gym's redirects.
create function private.page_name_promote(p_gym_id uuid, p_name text, p_origin text, p_existing_id uuid, p_forced boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_idle boolean := private.page_name_gym_idle(p_gym_id);
  v_id uuid;
begin
  if p_forced then
    update page_names
       set state = 'released', reserved_until = coalesce(reserved_until, now())
     where gym_id = p_gym_id and state in ('active', 'redirect') and id is distinct from p_existing_id;
  else
    update page_names
       set state = 'redirect', reserved_until = now() + interval '12 months'
     where gym_id = p_gym_id and state = 'active' and id is distinct from p_existing_id;
  end if;

  if p_existing_id is null then
    insert into page_names (gym_id, name, state, origin, reserved_until)
    values (p_gym_id, p_name, 'active', p_origin, case when v_idle then now() + interval '12 months' end)
    returning id into v_id;
  else
    update page_names
       set state = 'active', reserved_until = case when v_idle then now() + interval '12 months' end
     where id = p_existing_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- The one setter of the idle clock. An active name carries reserved_until while its gym is idle (page unpublished or gym not
-- active): set to 12 months from the idle start (never extended by a repeat call), cleared when idle ends.
create function private.set_page_name_idle(p_gym_id uuid, p_idle boolean)
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

revoke execute on function private.page_name_promote(uuid, text, text, uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.set_page_name_idle(uuid, boolean) from public, anon, authenticated, service_role;

-- Suspension / reactivation. Fires only when status actually changes (a bare UPDATE that the gyms pin trigger reverts changes
-- nothing and does not fire this).
create function private.page_names_gym_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.set_page_name_idle(new.id, private.page_name_gym_idle(new.id));
  return null;
end;
$$;

revoke execute on function private.page_names_gym_status_changed() from public, anon, authenticated, service_role;

create trigger zz_page_names_gym_status
  after update of status on public.gyms
  for each row
  when (old.status is distinct from new.status)
  execute function private.page_names_gym_status_changed();

-- ----------------------------------------------------------------------------
-- claim_page_name(): the one claim and rename path.
-- Returns {id, name, state: held|active, origin, previous_name}. Typed errors (message suffix): invalid_name, reserved_name,
-- name_taken, rename_limit.
-- ----------------------------------------------------------------------------
create function public.claim_page_name(p_gym_id uuid, p_name text)
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

-- ----------------------------------------------------------------------------
-- Super Admin review queue and decision
-- ----------------------------------------------------------------------------
create function public.list_held_page_names()
returns table (
  id uuid, gym_id uuid, gym_name text, name text, origin text, held_reason text,
  held_at timestamptz, due_at timestamptz, overdue boolean, current_name text
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
    select pn.id, pn.gym_id, g.name::text, pn.name, pn.origin, pn.held_reason, pn.held_at,
           private.add_business_days(pn.held_at, 2),
           private.add_business_days(pn.held_at, 2) < now(),
           (select a.name from page_names a where a.gym_id = pn.gym_id and a.state = 'active')
      from page_names pn
      join gyms g on g.id = pn.gym_id
     where pn.state = 'held'
     order by pn.held_at, pn.id;
end;
$$;

create function public.decide_held_page_name(p_id uuid, p_approve boolean, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row page_names%rowtype;
  v_reason text;
  v_previous text;
  v_actor uuid;
  v_gym_id uuid;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;

  if p_approve is null then
    raise exception 'decide_held_page_name: invalid_decision';
  end if;

  v_reason := regexp_replace(coalesce(p_reason, ''),
    '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g');
  if char_length(v_reason) not between 3 and 500 then
    raise exception 'decide_held_page_name: reason_required';
  end if;

  -- lock order is gym row, then the claim lock, then the held row: the same order as claim_page_name() and the gyms.status
  -- trigger, so a decision and a concurrent re-claim or suspension cannot deadlock. The held row is read without a lock first
  -- only to learn its gym, and re-checked after the locks.
  select pn.gym_id into v_gym_id from page_names pn where pn.id = p_id and pn.state = 'held';
  if not found then
    raise exception 'decide_held_page_name: not_held';
  end if;

  perform 1 from gyms g where g.id = v_gym_id for update;
  if p_approve then
    -- the same global claim lock as claim_page_name(): the taken and reserved re-checks below cannot miss a claim in flight
    perform pg_advisory_xact_lock(hashtext('page_names_claim'));
  end if;

  select * into v_row from page_names pn where pn.id = p_id and pn.state = 'held' for update;
  if not found then
    raise exception 'decide_held_page_name: not_held';
  end if;

  v_actor := private.actor_id();

  if p_approve then
    if private.page_name_is_reserved(v_row.name) or private.page_name_has_brand_word(v_row.name) then
      raise exception 'decide_held_page_name: reserved_name';
    end if;
    if exists (select 1 from page_names pn
                where lower(pn.name) = lower(v_row.name) and pn.state <> 'released' and pn.id <> v_row.id) then
      raise exception 'decide_held_page_name: name_taken';
    end if;

    select pn.name into v_previous from page_names pn where pn.gym_id = v_row.gym_id and pn.state = 'active';

    perform private.page_name_promote(v_row.gym_id, v_row.name, v_row.origin, v_row.id, false);
    update page_names set decided_at = now(), decided_by = v_actor, decision_reason = v_reason where id = v_row.id;
  else
    update page_names
       set state = 'released', decided_at = now(), decided_by = v_actor, decision_reason = v_reason
     where id = v_row.id;
  end if;

  perform private.notify_page_name_decision(v_row.gym_id, v_row.name, p_approve, v_reason);

  perform log_audit_event(
    p_action_type => case when p_approve then 'page_name_approved' else 'page_name_rejected' end,
    p_gym_id => v_row.gym_id,
    p_target_entity_id => v_row.id::text,
    p_target_entity_type => 'page_name',
    p_metadata => jsonb_build_object('name', v_row.name, 'origin', v_row.origin, 'reason', v_reason, 'previous_name', v_previous)
  );

  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'state', case when p_approve then 'active' else 'released' end);
end;
$$;

revoke execute on function public.list_held_page_names() from public, anon;
revoke execute on function public.decide_held_page_name(uuid, boolean, text) from public, anon;
grant execute on function public.list_held_page_names() to authenticated;
grant execute on function public.decide_held_page_name(uuid, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- get_gym_page_name(): the gym's name state. No held_reason, no other gym's name.
-- {name, state: none|active|reserved|held, pending_name, completed_renames, redirects: [{name, expires_at}]}
-- ----------------------------------------------------------------------------
create function public.get_gym_page_name(p_gym_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current page_names%rowtype;
  v_held page_names%rowtype;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    if p_gym_id is null
       or p_gym_id is distinct from private.support_rpc_gym_id('get_gym_page_name')
       or not coalesce(private.support_rpc_role('get_gym_page_name') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  if p_gym_id is null or not exists (select 1 from gyms g where g.id = p_gym_id) then
    raise exception 'get_gym_page_name: gym not found';
  end if;

  select * into v_current from page_names pn
   where pn.gym_id = p_gym_id and pn.state in ('active', 'reserved')
   order by (pn.state = 'active') desc, pn.created_at desc
   limit 1;
  select * into v_held from page_names pn where pn.gym_id = p_gym_id and pn.state = 'held';

  return jsonb_build_object(
    'name', v_current.name,
    'state', case when v_current.id is not null then v_current.state when v_held.id is not null then 'held' else 'none' end,
    'pending_name', v_held.name,
    'completed_renames', private.page_name_completed_renames(p_gym_id),
    'redirects', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'expires_at', r.reserved_until) order by r.name)
                             from page_names r where r.gym_id = p_gym_id and r.state = 'redirect'), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_gym_page_name(uuid) from public, anon;
grant execute on function public.get_gym_page_name(uuid) to authenticated;

insert into private.support_capabilities (capability, kind, object_name) values
  ('gym_page', 'rpc', 'get_gym_page_name');

-- ----------------------------------------------------------------------------
-- Word maintenance (live Super Admin, audited). No capability row: support stays denied.
-- ----------------------------------------------------------------------------
create function public.add_page_name_word(p_kind text, p_word text, p_prefix boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_word text;
  v_n integer;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;
  v_word := lower(btrim(coalesce(p_word, '')));
  if p_kind is null or p_kind not in ('reserved', 'brand', 'generic', 'place', 'zone')
     or v_word !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' or char_length(v_word) > 30
     or p_prefix is null or (p_prefix and p_kind not in ('reserved', 'zone')) then
    raise exception 'add_page_name_word: invalid_word';
  end if;

  insert into page_name_words (kind, word, is_prefix, created_by) values (p_kind, v_word, p_prefix, private.actor_id())
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return;
  end if;

  perform log_audit_event(
    p_action_type => 'page_name_word_added',
    p_target_entity_id => p_kind || ':' || v_word,
    p_target_entity_type => 'page_name_word',
    p_metadata => jsonb_build_object('kind', p_kind, 'word', v_word, 'prefix', p_prefix)
  );
end;
$$;

create function public.remove_page_name_word(p_kind text, p_word text, p_prefix boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_word text;
  v_n integer;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;
  v_word := lower(btrim(coalesce(p_word, '')));
  if p_kind is null or p_kind not in ('reserved', 'brand', 'generic', 'place', 'zone') or p_prefix is null then
    raise exception 'remove_page_name_word: invalid_word';
  end if;
  -- zone words are the DNS zone and the reserved-label JSON: they are removed by a migration, never by this function
  if p_kind = 'zone' then
    raise exception 'remove_page_name_word: zone_word_protected';
  end if;

  delete from page_name_words where kind = p_kind and word = v_word and is_prefix = p_prefix;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'remove_page_name_word: not_found';
  end if;

  perform log_audit_event(
    p_action_type => 'page_name_word_removed',
    p_target_entity_id => p_kind || ':' || v_word,
    p_target_entity_type => 'page_name_word',
    p_metadata => jsonb_build_object('kind', p_kind, 'word', v_word, 'prefix', p_prefix)
  );
end;
$$;

create function public.list_page_name_words()
returns table (kind text, word text, is_prefix boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;
  return query select w.kind, w.word, w.is_prefix, w.created_at from page_name_words w order by w.kind, w.word, w.is_prefix;
end;
$$;

revoke execute on function public.add_page_name_word(text, text, boolean) from public, anon;
revoke execute on function public.remove_page_name_word(text, text, boolean) from public, anon;
revoke execute on function public.list_page_name_words() from public, anon;
grant execute on function public.add_page_name_word(text, text, boolean) to authenticated;
grant execute on function public.remove_page_name_word(text, text, boolean) to authenticated;
grant execute on function public.list_page_name_words() to authenticated;

-- ----------------------------------------------------------------------------
-- Daily sweep: releases idle names past their 12 months (only with no published page) and expired redirects, never a taken-down
-- or reserved row; reminds every Super Admin once per overdue held name. Logs to job_runs.
-- ----------------------------------------------------------------------------
create function private.page_names_sweep()
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
  v_error text;
begin
  for r in
    select pn.id, pn.gym_id, pn.name
      from page_names pn
     where pn.state = 'active' and pn.taken_down_at is null
       and pn.reserved_until is not null and pn.reserved_until < now()
       and not private.page_name_has_published_page(pn.gym_id)
     order by pn.reserved_until, pn.id
  loop
    begin
      update page_names set state = 'released' where id = r.id and state = 'active';
      -- the gym's redirects would point at nothing: release them with the name they pointed at
      update page_names set state = 'released', reserved_until = coalesce(reserved_until, now())
       where gym_id = r.gym_id and state = 'redirect' and taken_down_at is null;
      perform log_audit_event(
        p_action_type => 'page_name_released', p_gym_id => r.gym_id, p_target_entity_id => r.id::text,
        p_target_entity_type => 'page_name', p_system_actor_label => 'system:page_names_sweep',
        p_metadata => jsonb_build_object('name', r.name, 'from_state', 'active'));
      v_released := v_released + 1;
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

-- 04:20 UTC daily; cron.schedule() upserts by name
select cron.schedule('page_names_sweep', '20 4 * * *', $$ select private.page_names_sweep(); $$);

-- ----------------------------------------------------------------------------
-- gym_pages.page_name_id: foreign key and uniqueness (deferred from 24.4)
-- ----------------------------------------------------------------------------
alter table public.gym_pages
  add constraint gym_pages_page_name_id_fkey foreign key (page_name_id) references public.page_names(id);
create unique index gym_pages_page_name_id_key on public.gym_pages (page_name_id);

-- ----------------------------------------------------------------------------
-- The migration proves its own result.
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_fn text;
begin
  if (select relrowsecurity from pg_class where oid = 'public.page_names'::regclass) is distinct from true
     or (select relrowsecurity from pg_class where oid = 'public.page_name_words'::regclass) is distinct from true then
    raise exception '0163: a page name table has no row level security';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('page_names', 'page_name_words')) then
    raise exception '0163: a page name table has a policy';
  end if;
  if exists (
    select 1 from unnest(array['public', 'anon', 'authenticated', 'service_role']) g,
                  unnest(array['public.page_names', 'public.page_name_words']) t,
                  unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     where has_table_privilege(g, t, p)) then
    raise exception '0163: a page name table is reachable by a client role';
  end if;
  if has_table_privilege('public_site_reader', 'public.page_names', 'select') or has_table_privilege('public_site_reader', 'public.page_name_words', 'select') then
    raise exception '0163: public_site_reader can read a page name table';
  end if;
  if (select count(*) from pg_indexes where schemaname = 'public' and indexname in
        ('page_names_name_live', 'page_names_one_active', 'page_names_one_held', 'gym_pages_page_name_id_key')) <> 4 then
    raise exception '0163: a unique index is missing';
  end if;
  if not exists (select 1 from page_name_words where kind = 'zone' and word = 'www' and not is_prefix)
     or not exists (select 1 from page_name_words where kind = 'zone' and word = 'gymos' and is_prefix)
     or (select count(*) from page_name_words where kind = 'brand') <> 17
     or (select count(*) from page_name_words where kind in ('generic', 'place')) <> 15 then
    raise exception '0163: word seeds are missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gym_pages_page_name_id_fkey') then
    raise exception '0163: gym_pages.page_name_id has no foreign key';
  end if;
  if not exists (select 1 from cron.job where jobname = 'page_names_sweep') then
    raise exception '0163: the sweep is not scheduled';
  end if;
  if (select count(*) from pg_trigger where tgname in ('page_names_refuse_reserved', 'zz_page_names_gym_status') and not tgisinternal) <> 2 then
    raise exception '0163: a trigger is missing';
  end if;

  -- every function in this file: never executable by PUBLIC or anon; the private ones by no client role at all
  for v_fn in
    select p.oid::regprocedure::text
      from pg_proc p
     where p.proname in ('claim_page_name', 'list_held_page_names', 'decide_held_page_name', 'get_gym_page_name',
                         'add_page_name_word', 'remove_page_name_word', 'list_page_name_words')
       and p.pronamespace = 'public'::regnamespace
  loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('public', v_fn, 'execute') then
      raise exception '0163: % is callable by anon or PUBLIC', v_fn;
    end if;
  end loop;
  for v_fn in
    select p.oid::regprocedure::text
      from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and (p.proname like 'page\_name%' or p.proname like 'notify\_page\_name%' or p.proname = 'set_page_name_idle')
  loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('public', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0163: % is callable by a client role', v_fn;
    end if;
  end loop;
  if (select count(*) from private.support_capabilities where capability = 'gym_page' and kind = 'rpc' and object_name = 'get_gym_page_name') <> 1
     or exists (select 1 from private.support_capabilities where object_name in
        ('claim_page_name', 'decide_held_page_name', 'list_held_page_names', 'add_page_name_word', 'remove_page_name_word', 'list_page_name_words')) then
    raise exception '0163: support capability rows are wrong (only get_gym_page_name is admitted)';
  end if;
end
$verify$;
