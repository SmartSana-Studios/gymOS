-- Story 2.3: Manager/Owner -- Create, Edit & Deactivate Members. Closes the
-- gaps this story's own Scope Note documents in detail (see the story file):
-- `subscriptions.expiry_date` becomes nullable (pay_per_session has no fixed
-- expiry), a member-cap enforcement trigger (FR-086: active AND deactivated
-- members both count), a subscription/plan-type consistency trigger, and the
-- first real business RLS on `members`/`subscriptions` beyond Story 1.5/1.8's
-- narrowly-scoped policies.

-- ----------------------------------------------------------------------------
-- subscriptions.expiry_date: nullable, valid only for pay_per_session plans
-- (0004_subscriptions_and_plans.sql originally shipped this `not null` --
-- AD-05's mockup hides the Expiry Date field entirely for Pay-per-session,
-- same "no fixed duration" concept Story 2.2 already resolved for
-- `plans.duration_days`).
-- ----------------------------------------------------------------------------
alter table subscriptions alter column expiry_date drop not null;

-- Cross-table invariant (subscriptions.expiry_date <-> plans.plan_type) --
-- cannot be a CHECK constraint (single-table only), so a BEFORE INSERT OR
-- UPDATE trigger instead. Explicit `is not null`/`is null` guards throughout
-- (Story 2.2's Review Round 2 found a real three-valued-logic CHECK bug from
-- an implicit-NULL comparison -- avoided here in trigger form too). Not
-- SECURITY DEFINER: reading `plans` needs no elevated privilege -- any
-- gym-staff role can already read `plans` via `gym_staff_read_own_plans`
-- (0017), and the inserting/updating session is always gym-staff for its own
-- gym by the time this trigger fires.
create function public.enforce_subscription_expiry_matches_plan_type()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_plan_type plan_type;
begin
  select p.plan_type into v_plan_type
  from plans p
  where p.id = new.plan_id;

  if v_plan_type is null then
    raise exception 'enforce_subscription_expiry_matches_plan_type: plan % not found', new.plan_id;
  end if;

  if v_plan_type = 'pay_per_session' and new.expiry_date is not null then
    raise exception 'a pay-per-session subscription must not have an expiry_date';
  end if;

  if v_plan_type <> 'pay_per_session' and new.expiry_date is null then
    raise exception 'a % subscription requires an expiry_date', v_plan_type;
  end if;

  return new;
end;
$$;

create trigger enforce_subscription_expiry_matches_plan_type
  before insert or update on subscriptions
  for each row execute function public.enforce_subscription_expiry_matches_plan_type();

-- ----------------------------------------------------------------------------
-- Member cap enforcement (FR-086, architecture.md Gap 2): "Active and
-- deactivated members both count toward the cap" -- deactivating a member
-- does NOT free a slot, so this counts every `members` row for the gym, no
-- `deactivated_at is null` filter. SECURITY DEFINER is required: a
-- Manager/Owner session has no SELECT policy on `tiers` at all (only
-- `super_admin_read_tiers` exists, 0010/0011) -- an invoker-rights trigger
-- would silently read 0 rows for `tiers.member_cap` under RLS and either
-- mis-block every insert or, worse, silently treat every gym as uncapped.
-- Mirrors `platform_metrics()`/`gym_member_count()`'s SECURITY DEFINER
-- pattern (0011).
create function public.enforce_member_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap integer;
  v_count bigint;
begin
  -- Serializes concurrent INSERTs for the same gym -- without this, two
  -- simultaneous requests both read the same pre-insert count under
  -- READ COMMITTED and both pass the check below, exceeding the cap. This
  -- trigger is the cap's real enforcement backstop (the app-layer
  -- memberCountForGym check is only a friendly fast-fail), so it must not
  -- itself be racy. Released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtext(new.gym_id::text));

  select coalesce(g.member_cap_override, t.member_cap) into v_cap
  from gyms g
  left join tiers t on t.id = g.tier_id
  where g.id = new.gym_id;

  -- null cap = unlimited (both gyms.member_cap_override and
  -- tiers.member_cap are nullable-means-unlimited, Story 1.6) -- no
  -- enforcement in that case.
  if v_cap is not null then
    -- role = 'member' only -- a gym's own owner/manager/receptionist/coach
    -- rows share this same table but are staff, not paying clients; the cap
    -- exists to limit paying membership headcount, not staff headcount.
    select count(*) into v_count from members where gym_id = new.gym_id and role = 'member';

    if v_count >= v_cap then
      raise exception 'member cap reached for gym %: % / %', new.gym_id, v_count, v_cap;
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_member_cap
  before insert on members
  for each row execute function public.enforce_member_cap();

-- ----------------------------------------------------------------------------
-- gym_effective_member_cap(): the RLS-crossing read `memberCountForGym`'s
-- fast-fail app-layer check (AC #2) needs, since no Manager/Owner SELECT
-- policy on `tiers` exists or should be added (a broad `tiers` policy would
-- leak platform-wide tier pricing to every gym's staff -- disproportionate to
-- what this check needs). No arguments -- unlike `gym_member_count(p_gym_id)`
-- (0011, `is_super_admin()`-gated, takes an arbitrary gym), this one is
-- scoped to "my own gym" by construction via `private.gym_id()`, so it needs
-- no internal role check. Returns null (unlimited) if the caller has no
-- gym-scoped session at all.
create function public.gym_effective_member_cap()
returns integer
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_cap integer;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return null;
  end if;

  select coalesce(g.member_cap_override, t.member_cap) into v_cap
  from gyms g
  left join tiers t on t.id = g.tier_id
  where g.id = v_gym_id;

  return v_cap;
end;
$$;

-- ----------------------------------------------------------------------------
-- members RLS: explicit per-action policies, never FOR ALL.
-- ----------------------------------------------------------------------------

-- Gated to staff roles only (Receptionist needs read/search/export too, AC
-- #5) -- NOT ungated-by-role like "gym_staff_read_own_plans" (0017), because
-- unlike plans, this table now holds real member PII and this story is the
-- first to create real `role = 'member'` rows with a working phone-OTP login
-- path (Story 2.1). Without the role check below, any authenticated member
-- session (app_role = 'member') would read the entire gym's roster via this
-- policy, since it coexists with the narrower "self_read_own_membership"
-- (0013) and same-table SELECT policies are OR'd together (same shape as
-- gyms' two SELECT policies, 0009/0010) -- the broad one would silently win.
-- Still a known, temporary over-broadening relative to FR-022's "Coach sees
-- only assigned members" (harmless today since coach_assignments doesn't
-- exist yet, Epic 5; revisit when Epic 5 ships Coach logins), but scoped to
-- staff, never to the member being read about.
create policy "gym_staff_read_own_members" on members
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist', 'coach'])
  );

-- Role-pinned to 'member' in the with check -- a Manager/Owner creating a
-- member through this path may only ever insert role = 'member', never an
-- arbitrary staff role -- mirrors 0010's `super_admin_insert_owner_member`
-- role-pinning shape.
create policy "manager_or_owner_insert_own_members" on members
  for insert
  with check (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
    and role = 'member'
  );

-- RLS authorizes by role, not by which columns a given UPDATE touches (same
-- discipline as every other UPDATE policy in this codebase) -- both edit
-- (identity fields) and deactivate (deactivated_at) go through this policy.
-- The `with check`'s `role = 'member'` pin (code review fix) is the one
-- deliberate exception to that column-agnostic discipline: without it, any
-- Manager/Owner could raw-UPDATE a member row's `role` to 'owner'/'manager'
-- via a direct API call -- a real privilege-escalation gap the app's own
-- editMemberSchema (which never includes `role`) never intended to allow.
-- Mirrors the sibling INSERT policy's identical pin.
create policy "manager_or_owner_update_own_members" on members
  for update
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  )
  with check (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
    and role = 'member'
  );

-- No DELETE policy: soft-delete only (FR-019, deactivated_at).

-- ----------------------------------------------------------------------------
-- subscriptions RLS: this story is the first real feature to write to
-- `subscriptions` -- Story 2.2 explicitly deferred all of it to "Story
-- 3.1/3.2's job," but that deferral doesn't hold once member creation needs
-- to INSERT a subscriptions row and deactivation needs to UPDATE one to
-- 'expired'. Story 3.1/3.2 still own the lifecycle policies (cron-driven
-- status transitions, renewal) -- not added here.
-- ----------------------------------------------------------------------------

-- Gated to staff roles, plus self-access to the caller's own subscription --
-- same PII-leak reasoning as "gym_staff_read_own_members" above (a
-- subscription row reveals plan, status, and expiry for a specific member; a
-- member's own session must not read every other member's subscription via
-- this policy), but unlike `members` there is no pre-existing narrow
-- self-read policy on `subscriptions` to fall back on (this story is the
-- first to add any RLS here), so the `exists` clause below is this table's
-- only path to a member seeing their own subscription (needed ahead of the
-- member app's own Plan Details screens, Story 2.7/3.10).
create policy "gym_staff_read_own_subscriptions" on subscriptions
  for select
  using (
    gym_id = private.gym_id()
    and (
      (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist', 'coach'])
      or exists (
        select 1 from members m
        where m.id = subscriptions.member_id and m.user_id = auth.uid()
      )
    )
  );

create policy "manager_or_owner_insert_own_subscriptions" on subscriptions
  for insert
  with check (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  );

create policy "manager_or_owner_update_own_subscriptions" on subscriptions
  for update
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  )
  with check (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  );
