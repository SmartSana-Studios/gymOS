-- ============================================================================
-- 0123: Gym category (Epic 21, Story 21.1).
--
-- Every gym is classified for V1.7's directory and landing pages. The value is
-- descriptive only: nothing in the product reads it to change behavior
-- (FR-172), and no UI surface other than the Super Admin screens (21.1) and
-- Settings (21.2) shows it.
--
--   gyms.category   text NOT NULL DEFAULT 'gym', CHECK on five stable codes:
--                   gym, pilates_studio, yoga_studio, fitness_center, other.
--                   Labels live in packages/types (GYM_CATEGORIES), never here.
--
-- Existing gyms read 'gym' in the same ADD COLUMN statement (FR-171 release
-- default); a metadata-only change on a table this small.
--
-- Design choices worth knowing before editing this file:
--
--  * The pin is its OWN trigger function (AD-32), not a branch of
--    protect_super_admin_only_gym_columns(), and not 0107's charging pin or
--    0117's loyalty pin. It has no super-admin or service_role exemption: only
--    the GUC set inside set_gym_category() opens it. gyms already grants UPDATE
--    on the whole table to authenticated (0002) and owner_update_own_gym lets an
--    Owner UPDATE their own row, so without the pin any Owner (and Manager via
--    other paths) could write the column directly. UPDATE only: an INSERT pin
--    could not tell the column default from an explicit value, and createGym
--    (Super Admin) sets the category on insert.
--
--  * set_gym_category() takes the gym id as an argument because a Super Admin
--    has no gym in their JWT. Authority is one of:
--      - private.is_super_admin_live() (users.is_super_admin, a live read; the
--        same check log_audit_event() uses for its cross-tenant exemption), or
--      - the caller is Owner or Supervisor of THAT gym: private.gym_id() = the
--        argument and private.current_member_role() in ('owner','supervisor').
--    Never the JWT app_role claim (19.1 lint). Role is NULL for a missing or
--    deactivated membership and fails closed.
--
--  * Suspension: a gym's own Owner/Supervisor is refused while the gym is not
--    active (0090's fail-closed `is distinct from` form, same as
--    set_guest_charging). A Super Admin is not: classifying a suspended gym is
--    an operator task.
--
--  * An unchanged value writes and logs nothing.
-- ============================================================================

alter table gyms
  add column category text not null default 'gym'
    constraint gyms_category_valid
      check (category in ('gym', 'pilates_studio', 'yoga_studio', 'fitness_center', 'other'));

comment on column gyms.category is
  'Descriptive gym category, a stable code (gym, pilates_studio, yoga_studio, fitness_center, other). Labels live in packages/types. Written only by set_gym_category() or at gym creation.';

-- ----------------------------------------------------------------------------
-- Pin trigger: reverts every UPDATE of the column unless set_gym_category()
-- holds the GUC. SECURITY INVOKER on purpose; fires for super admin and
-- service_role too.
-- ----------------------------------------------------------------------------
create function private.pin_gym_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.gym_category_update_bypass', true), 'false') <> 'true' then
    new.category := old.category;
  end if;
  return new;
end;
$$;

revoke execute on function private.pin_gym_category() from public, anon, authenticated;

create trigger pin_gym_category
  before update of category on gyms
  for each row execute function private.pin_gym_category();

-- ----------------------------------------------------------------------------
-- set_gym_category(): the only write path after creation.
-- ----------------------------------------------------------------------------
create function set_gym_category(p_gym_id uuid, p_category text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super_admin boolean;
  v_old text;
  v_status gym_status;
begin
  v_is_super_admin := coalesce(private.is_super_admin_live(), false);

  if not v_is_super_admin then
    if p_gym_id is null
       or p_gym_id is distinct from private.gym_id()
       or not coalesce(private.current_member_role() in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  if p_gym_id is null then
    raise exception 'set_gym_category: gym not found';
  end if;

  if p_category is null
     or p_category not in ('gym', 'pilates_studio', 'yoga_studio', 'fitness_center', 'other') then
    raise exception 'set_gym_category: invalid_category';
  end if;

  select g.category, g.status into v_old, v_status
  from gyms g where g.id = p_gym_id for update;

  if not found then
    raise exception 'set_gym_category: gym not found';
  end if;

  if not v_is_super_admin and v_status is distinct from 'active' then
    raise exception 'set_gym_category: gym % is not active', p_gym_id;
  end if;

  if v_old is not distinct from p_category then
    return;
  end if;

  perform set_config('app.gym_category_update_bypass', 'true', true);

  update gyms set category = p_category where id = p_gym_id;

  perform set_config('app.gym_category_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'gym_category_changed',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old_category', v_old, 'new_category', p_category)
  );
end;
$$;

revoke execute on function set_gym_category(uuid, text) from public, anon;
grant execute on function set_gym_category(uuid, text) to authenticated;
