-- Super Admin tier management & gym lifecycle (Story 1.6): tier CRUD, gym
-- suspend/deactivate/reinstate/tier-reassignment/cap-override, and the
-- Platform Metrics aggregates. Follows directly on 0010's own migration
-- comments, which explicitly deferred all of this to "Story 1.6's job".

-- ----------------------------------------------------------------------------
-- tiers: explicit per-action RLS (never FOR ALL), matching 0010's discipline.
-- The existing super_admin_read_tiers SELECT policy (0010) is untouched.
-- ----------------------------------------------------------------------------
create policy "super_admin_insert_tiers" on tiers
  for insert
  with check (private.is_super_admin());

create policy "super_admin_update_tiers" on tiers
  for update
  using (private.is_super_admin())
  with check (private.is_super_admin());

create policy "super_admin_delete_tiers" on tiers
  for delete
  using (private.is_super_admin());

-- AC #2 / SA-06: tier names need a real DB-level case-insensitive uniqueness
-- guarantee ("This name is already in use"), same reasoning as
-- idx_gyms_name_unique (Story 1.5) -- an app-side pre-check alone leaves a
-- race window between two concurrent Super Admin sessions.
create unique index idx_tiers_name_unique on tiers (lower(name));

-- ----------------------------------------------------------------------------
-- gyms: one UPDATE policy for super_admin covers every mutation this story
-- needs (status change, tier reassignment, cap override) -- RLS authorizes by
-- role, not by which columns a given UPDATE touches. No other role gets a
-- gyms UPDATE policy here; owner/manager gym-settings edits (FR-069) are
-- Story 1.9's job on a different table scope.
-- ----------------------------------------------------------------------------
create policy "super_admin_update_gyms" on gyms
  for update
  using (private.is_super_admin())
  with check (private.is_super_admin());

-- ----------------------------------------------------------------------------
-- Resolves Story 1.5's Open Question 1: tiers.member_cap becomes nullable,
-- NULL meaning "no cap" (unlimited), replacing the provisional 1,000,000
-- sentinel. Matches SA-06's own field-validation table ("Member cap (max):
-- Optional (blank = unlimited)") -- confirming nullable is the correct
-- representation, not just a stopgap. No trigger/enforcement logic reads
-- member_cap yet (Epic 2's job, FR-086) -- this is a schema-shape fix only,
-- with no consumer to break.
-- ----------------------------------------------------------------------------
alter table tiers alter column member_cap drop not null;

update tiers set member_cap = null
where id = '00000000-0000-4000-8000-000000000103'; -- seeded Elite row (0010)

-- FR-071's "gym tier assignment/cap override" -- the per-gym override column
-- SA-03's mockup exposes ("Override cap"). NULL means "use the tier's own
-- cap". Epic 2 owns *reading* this column in the member-cap-enforcement
-- trigger (FR-086); this story only adds the column and the Super Admin UI
-- to set it -- matching Story 1.5's own precedent of building configuration
-- surfaces ahead of the epic that enforces them (gym_status existed since
-- 0002, unused by any enforcement until now). No CHECK constraint beyond
-- nullability, matching this project's established "no CHECK constraints on
-- business-numeric columns yet, deferred to the enforcing epic" pattern
-- (Story 1.3's deferred-work list).
alter table gyms add column member_cap_override integer;

-- ----------------------------------------------------------------------------
-- Aggregate-only SECURITY DEFINER functions for Platform Metrics (AC #4) and
-- SA-03's member-count display. SECURITY DEFINER bypasses RLS entirely, so
-- each function MUST self-enforce is_super_admin() in its own body -- that
-- check is the only gate standing between "aggregate count" and "everyone's
-- data", mirroring log_audit_event()'s pattern of internal authorization
-- checks. This is deliberately preferred over broadening the members/payments
-- SELECT policies: Story 1.5 scoped Super Admin's members visibility to
-- role='owner' rows only, and FR-072 requires an explicit, audit-logged
-- escalation (Story 1.7) before Super Admin can see a gym's general
-- member/payment data. An aggregate-only, non-row-returning function does not
-- violate that boundary; a broad SELECT policy would.
-- ----------------------------------------------------------------------------
create function platform_metrics()
returns table (
  total_gyms bigint,
  total_members bigint,
  total_payments_processed bigint,
  active_gyms bigint,
  suspended_gyms bigint,
  deactivated_gyms bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  return query
  select
    (select count(*) from gyms)::bigint,
    (select count(*) from members)::bigint,
    -- 'verified' is the only payment_status meaning confirmed/reconciled
    -- money (pending/processing/flagged are not yet "processed"); this
    -- correctly returns 0 until Epic 4 ships any payment flow.
    (select coalesce(sum(amount), 0) from payments where status = 'verified')::bigint,
    (select count(*) from gyms where status = 'active')::bigint,
    (select count(*) from gyms where status = 'suspended')::bigint,
    (select count(*) from gyms where status = 'deactivated')::bigint;
end;
$$;

-- Same self-enforced guard as platform_metrics(), scoped to one gym instead
-- of the whole platform -- backs SA-03's "Member count: X / cap" display
-- without a new members SELECT policy (the only one today is
-- role='owner'-scoped, Story 1.5).
create function gym_member_count(p_gym_id uuid)
returns bigint
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_count bigint;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  select count(*) into v_count from members where gym_id = p_gym_id;
  return v_count;
end;
$$;
