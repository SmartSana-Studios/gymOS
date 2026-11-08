-- ============================================================================
-- 0162: Gym page media -- private originals, re-encoded derivatives (Epic 24, Story 24.6; FR-205, AD-47).
--
-- Storage and bookkeeping only. A gym can register images for its future public page. Nothing here publishes, snapshots
-- or serves a page (24.8), purges objects (24.11) or has a UI (24.9).
--
--   storage bucket gym-page-media-src   PRIVATE. The original upload, key {gym_id}/{uuid}. No policy for any client role:
--                                       only the service-role client held by the dashboard server function can touch it.
--   storage bucket gym-page-media       PUBLIC reads. The re-encoded WebP derivative, key {random uuid}.webp, with no
--                                       gym_id anywhere in it. No client write policy either: writes are server-side only.
--   gym_page_media                      one row per image: gym, kind (logo|banner|gallery), both keys, uploader, the
--                                       attestation (time and text version), deleted_at. RLS on, no policy, no client grant.
--   register_page_media()               the audited write path. Admission is the same as set_gym_page_content(): Owner,
--                                       Supervisor, live-assigned support, super admin. It also enforces the attestation,
--                                       the key shapes and the limits (12 live gallery images, one live banner, one live
--                                       logo; a new banner or logo marks the previous row deleted). p_dry_run does every
--                                       check and writes nothing, so the server function can be admitted BEFORE it writes
--                                       a single storage object.
--   delete_page_media()                 sets deleted_at only. Object removal is 24.11.
--   public_site.page_media              derivative key, kind and sort order only; no gym_id; deleted media, unpublished
--                                       pages and non-active gyms excluded. SELECT for public_site_reader only.
--
-- Design choices worth knowing before editing this file:
--  * Why a dry run instead of a third RPC: the spec names two RPCs. The dry run reuses the one admission code path, so a
--    new admitted role cannot be added to the check-then-write path and forgotten in a separate check function.
--  * The derivative key shape is enforced here (^[0-9a-f-]{36}\.webp$) and the original key must be {p_gym_id}/{uuid}, so a
--    buggy or hostile caller cannot register a derivative key that carries the gym id or points outside the buckets.
--  * Limits are counted under a row lock on the gym, so two concurrent uploads cannot both take the 12th slot.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- Buckets. No storage.objects policy names either bucket: with RLS on, that is deny-all for anon and authenticated.
-- The public bucket serves reads through the Storage HTTP API without RLS (as gym-logos does), by derivative key only.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('gym-page-media-src', 'gym-page-media-src', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('gym-page-media',     'gym-page-media',     true,  5242880, array['image/webp'])
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Table
-- ----------------------------------------------------------------------------
create table public.gym_page_media (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  kind text not null,
  original_key text not null,
  derivative_key text not null,
  sort_order integer not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null,
  attested_at timestamptz not null,
  attestation_version text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint gym_page_media_kind check (kind in ('logo', 'banner', 'gallery')),
  constraint gym_page_media_original_key check (original_key = gym_id::text || '/' || substring(original_key from '[^/]+$') and original_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  constraint gym_page_media_derivative_key check (derivative_key ~ '^[0-9a-f-]{36}\.webp$' and position(gym_id::text in derivative_key) = 0),
  constraint gym_page_media_attestation_version check (length(attestation_version) between 1 and 40),
  constraint gym_page_media_derivative_key_unique unique (derivative_key)
);

create index gym_page_media_gym_live on public.gym_page_media (gym_id, kind) where deleted_at is null;
-- At most one live banner and one live logo per gym, enforced by the database as well as the RPC.
create unique index gym_page_media_one_live_single on public.gym_page_media (gym_id, kind)
  where deleted_at is null and kind in ('logo', 'banner');

alter table public.gym_page_media enable row level security;
-- Deliberately no policy: client roles see nothing. Every read and write goes through the RPCs below or the migration-owner view.
revoke all on table public.gym_page_media from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- register_page_media()
-- ----------------------------------------------------------------------------
create function register_page_media(
  p_gym_id uuid,
  p_kind text,
  p_original_key text,
  p_derivative_key text,
  p_attested boolean,
  p_attestation_version text,
  p_dry_run boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super_admin boolean;
  v_id uuid;
  v_replaced uuid[];
  v_live integer;
begin
  v_is_super_admin := coalesce(private.is_super_admin_live(), false);

  if not v_is_super_admin then
    if p_gym_id is null
       or p_gym_id is distinct from private.support_rpc_gym_id('register_page_media')
       or not coalesce(private.support_rpc_role('register_page_media') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  if p_gym_id is null then
    raise exception 'register_page_media: gym not found';
  end if;

  perform 1 from gyms g where g.id = p_gym_id for update;
  if not found then
    raise exception 'register_page_media: gym not found';
  end if;

  if not v_is_super_admin and private.current_gym_status() is distinct from 'active' then
    raise exception 'register_page_media: gym % is not active', p_gym_id;
  end if;

  if p_attested is distinct from true then
    raise exception 'register_page_media: attestation_required';
  end if;
  if p_attestation_version is null or length(p_attestation_version) not between 1 and 40 then
    raise exception 'register_page_media: attestation_required';
  end if;
  if p_kind is null or p_kind not in ('logo', 'banner', 'gallery') then
    raise exception 'register_page_media: invalid_kind';
  end if;
  if p_derivative_key is null or p_derivative_key !~ '^[0-9a-f-]{36}\.webp$' or position(p_gym_id::text in p_derivative_key) > 0 then
    raise exception 'register_page_media: invalid_derivative_key';
  end if;
  if p_original_key is null or p_original_key !~ ('^' || p_gym_id::text || '/[0-9a-f-]{36}$') then
    raise exception 'register_page_media: invalid_original_key';
  end if;

  if p_kind = 'gallery' then
    select count(*) into v_live from gym_page_media where gym_id = p_gym_id and kind = 'gallery' and deleted_at is null;
    if v_live >= 12 then
      raise exception 'register_page_media: limit_reached';
    end if;
  end if;

  if p_dry_run then
    return null;
  end if;

  if p_kind in ('logo', 'banner') then
    select coalesce(array_agg(id), '{}') into v_replaced
      from gym_page_media where gym_id = p_gym_id and kind = p_kind and deleted_at is null;
    update gym_page_media set deleted_at = now() where id = any (v_replaced);
  else
    v_replaced := '{}';
  end if;

  insert into gym_page_media (gym_id, kind, original_key, derivative_key, sort_order, uploaded_by, attested_at, attestation_version)
  values (
    p_gym_id, p_kind, p_original_key, p_derivative_key,
    case when p_kind = 'gallery'
         then coalesce((select max(m.sort_order) from gym_page_media m where m.gym_id = p_gym_id and m.kind = 'gallery'), 0) + 1
         else 0 end,
    private.actor_id(), now(), p_attestation_version)
  returning id into v_id;

  -- uploaded_by holds the proxy actor for a live support caller. The real person is recorded by the audit_log identity trigger
  -- on the audit row below (target_entity_id = this media id).
  perform log_audit_event(
    p_action_type => 'gym_page_media_registered',
    p_gym_id => p_gym_id,
    p_target_entity_id => v_id::text,
    p_target_entity_type => 'gym_page_media',
    p_metadata => jsonb_build_object('kind', p_kind, 'attestation_version', p_attestation_version, 'replaced', to_jsonb(v_replaced))
  );

  return v_id;
end;
$$;

revoke execute on function register_page_media(uuid, text, text, text, boolean, text, boolean) from public, anon;
grant execute on function register_page_media(uuid, text, text, text, boolean, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- delete_page_media(): sets deleted_at only. The object removal is the 24.11 purge.
-- ----------------------------------------------------------------------------
create function delete_page_media(p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super_admin boolean;
  v_gym_id uuid;
  v_kind text;
begin
  v_is_super_admin := coalesce(private.is_super_admin_live(), false);

  select m.gym_id, m.kind into v_gym_id, v_kind from gym_page_media m where m.id = p_media_id;

  -- Same answer for "no such row" and "another gym's row": a caller learns nothing about other gyms.
  if not v_is_super_admin then
    if v_gym_id is null
       or v_gym_id is distinct from private.support_rpc_gym_id('delete_page_media')
       or not coalesce(private.support_rpc_role('delete_page_media') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  elsif v_gym_id is null then
    raise exception 'delete_page_media: not found';
  end if;

  perform 1 from gyms g where g.id = v_gym_id for update;

  if not v_is_super_admin and private.current_gym_status() is distinct from 'active' then
    raise exception 'delete_page_media: gym % is not active', v_gym_id;
  end if;

  update gym_page_media set deleted_at = now() where id = p_media_id and deleted_at is null;
  if not found then
    raise exception 'delete_page_media: not found';
  end if;

  perform log_audit_event(
    p_action_type => 'gym_page_media_deleted',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_media_id::text,
    p_target_entity_type => 'gym_page_media',
    p_metadata => jsonb_build_object('kind', v_kind)
  );
end;
$$;

revoke execute on function delete_page_media(uuid) from public, anon;
grant execute on function delete_page_media(uuid) to authenticated;

insert into private.support_capabilities (capability, kind, object_name) values
  ('gym_page', 'rpc', 'register_page_media'),
  ('gym_page', 'rpc', 'delete_page_media');

-- A live support caller may write only the audit action types its allow-listed capabilities produce (23.10).
insert into private.support_audit_actions (action_type) values
  ('gym_page_media_registered'), ('gym_page_media_deleted')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- public_site.page_media: derivative key, kind, sort order. `gym_id` is deliberately not a column.
-- Joins gym_pages like public_site.pages, so media of an unpublished, taken-down or suspended page is not exposed.
-- 24.8 ties media to the snapshot and updates the pinned column list deliberately.
-- ----------------------------------------------------------------------------
create view public_site.page_media with (security_barrier = true) as
select
  m.derivative_key,
  m.kind,
  m.sort_order
from public.gym_page_media m
join public.gym_pages gp on gp.gym_id = m.gym_id
join public.gyms g on g.id = m.gym_id
where m.deleted_at is null
  and gp.published_at is not null
  and gp.unpublished_at is null
  and gp.taken_down_at is null
  and g.status = 'active';

revoke all on public_site.page_media from public, anon, authenticated, service_role;
grant select on public_site.page_media to public_site_reader;

-- ----------------------------------------------------------------------------
-- The migration proves its own result.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if (select count(*) from storage.buckets where id in ('gym-page-media-src', 'gym-page-media')) <> 2 then
    raise exception '0162: a page media bucket is missing';
  end if;
  if (select public from storage.buckets where id = 'gym-page-media-src') is distinct from false
     or (select public from storage.buckets where id = 'gym-page-media') is distinct from true then
    raise exception '0162: bucket visibility is wrong (src must be private, derivatives public)';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and (coalesce(qual, '') || coalesce(with_check, '')) like '%gym-page-media%') then
    raise exception '0162: a storage policy names a page media bucket';
  end if;
  if has_table_privilege('anon', 'public.gym_page_media', 'select') or has_table_privilege('authenticated', 'public.gym_page_media', 'select')
     or has_table_privilege('service_role', 'public.gym_page_media', 'select') then
    raise exception '0162: gym_page_media is readable by a client role';
  end if;
  if has_function_privilege('anon', 'public.register_page_media(uuid,text,text,text,boolean,text,boolean)', 'execute')
     or has_function_privilege('public', 'public.register_page_media(uuid,text,text,text,boolean,text,boolean)', 'execute')
     or has_function_privilege('anon', 'public.delete_page_media(uuid)', 'execute')
     or has_function_privilege('public', 'public.delete_page_media(uuid)', 'execute') then
    raise exception '0162: a page media RPC is callable by anon or PUBLIC';
  end if;
  if not has_table_privilege('public_site_reader', 'public_site.page_media', 'select')
     or has_table_privilege('anon', 'public_site.page_media', 'select')
     or has_table_privilege('authenticated', 'public_site.page_media', 'select') then
    raise exception '0162: public_site.page_media grants are wrong';
  end if;
  if (select count(*) from private.support_capabilities where capability = 'gym_page' and kind = 'rpc'
        and object_name in ('register_page_media', 'delete_page_media')) <> 2 then
    raise exception '0162: capability rows missing';
  end if;
end
$verify$;
