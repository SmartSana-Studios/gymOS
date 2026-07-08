-- Super Admin gym provisioning (Story 1.5): the RLS/schema foundation for the
-- Super Admin Gyms page (SA-02) and Create Gym flow (SA-04). Migration numbering
-- deviates from architecture.md's illustrative sequence (which lists 0010 as
-- per-domain feature RLS driven by later epics) since Epic 1 Story 1.5 ships
-- chronologically first -- recorded in docs/decisions.md, same precedent as
-- Stories 1.3/1.4's own deviations.

-- ============================================================================
-- private.is_super_admin(): STABLE helper, mirrors private.gym_id()'s (0009)
-- shape and never-raises discipline. Reused instead of the inline
-- `(auth.jwt() ->> 'app_role') = 'super_admin'` check that log_audit_event()
-- (0007) already duplicates once -- that landed migration is not touched here.
-- No explicit GRANT/REVOKE needed: `usage on schema private` is already
-- restricted to authenticated/service_role only (0009), which blocks `anon`
-- from resolving this function regardless of the default PUBLIC EXECUTE grant,
-- the same way private.gym_id() relies on schema-level restriction alone.
-- ============================================================================
create function private.is_super_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'app_role') = 'super_admin', false);
$$;

-- AC #2: gym name uniqueness needs a real DB-level guarantee (case-insensitive:
-- "FitZone Yaoundé" and "fitzone yaoundé" must collide), not just an app-side
-- pre-check, to close the race window between two concurrent Super Admin
-- sessions. Cannot be added to 0002_gyms_and_tiers.sql (already shipped).
create unique index idx_gyms_name_unique on gyms (lower(name));

-- ----------------------------------------------------------------------------
-- RLS: explicit per-action policies, never FOR ALL (architecture's RLS
-- strategy). Scoped narrowly to exactly what this story needs -- Story 1.6
-- adds gyms UPDATE (suspend/deactivate/tier-change) and tiers INSERT/UPDATE/
-- DELETE; Story 1.7 adds the audit-logged members-SELECT escalation. None of
-- those are added here (Scope Boundary discipline established in Stories
-- 1.3/1.4: don't add the next story's policy early). The one exception is a
-- narrowly-scoped gyms DELETE, added below for createGym's own compensating
-- cleanup -- not a general gym-deletion capability, which stays Story 1.6's
-- job via the suspend/deactivate lifecycle instead.
-- ----------------------------------------------------------------------------

-- Super Admin sees every gym across every tenant (not scoped to any one
-- gym_id, since Super Admin has none) -- required for SA-02's Gym List and
-- coexists independently with 0009's "read own gym" policy (RLS policies for
-- the same command are OR'd together; a gym-scoped session matches that one,
-- a super_admin session matches this one).
create policy "super_admin_read_all_gyms" on gyms
  for select
  using (private.is_super_admin());

create policy "super_admin_insert_gyms" on gyms
  for insert
  with check (private.is_super_admin());

-- Scoped to gyms with no members at all (not a blanket delete grant): the
-- only sanctioned use is createGym's compensating cleanup when owner
-- provisioning fails partway through (Story 1.5 code review finding --
-- deleteGym() silently matched 0 rows with no DELETE policy at all,
-- permanently orphaning failed-provisioning gyms). A gym that already has a
-- member (its owner) is a real tenant and must go through Story 1.6's
-- suspend/deactivate lifecycle instead, never a raw DELETE.
create policy "super_admin_delete_orphaned_gyms" on gyms
  for delete
  using (
    private.is_super_admin()
    and not exists (select 1 from members m where m.gym_id = gyms.id)
  );

-- SELECT only: the Create Gym form's tier dropdown needs to list current
-- tiers. Tier CRUD is Story 1.6's job -- no INSERT/UPDATE/DELETE policy here.
create policy "super_admin_read_tiers" on tiers
  for select
  using (private.is_super_admin());

-- INSERT only, and only as 'owner': a Super Admin creating a gym may only
-- ever insert the owner row through this path, never an arbitrary role --
-- enforced by the `with check`, not just application code.
create policy "super_admin_insert_owner_member" on members
  for insert
  with check (private.is_super_admin() and role = 'owner');

-- SELECT scoped ONLY to role = 'owner' rows -- SA-02/SA-03 display
-- "Owner: <name> (<phone>)" for every gym the Super Admin can already see via
-- the policy above. This is basic visibility into an account Super Admin
-- itself provisions, not a browse of a gym's member roster/payment data --
-- kept deliberately narrow and distinct from Story 1.7's audit-logged
-- escalation (FR-072), which covers the rest of a gym's member/payment data.
-- A `role = 'coach'`/`'member'`/etc. row is never visible through this policy.
create policy "super_admin_read_owner_members" on members
  for select
  using (private.is_super_admin() and role = 'owner');

-- No new policy needed on `users`: handle_new_user() (0003) is already
-- SECURITY DEFINER and creates the owner's public.users row automatically
-- when auth.users gets the new row -- the calling role's own grants are
-- irrelevant to it.

-- ----------------------------------------------------------------------------
-- Default tier seed data (FR-073: "Three default tiers ... Super Admin-
-- configurable"). No prior story seeds these, and the Create Gym form's tier
-- dropdown needs at least one to exist. Numbers are SA-06's mockup values
-- (ux-gym_os-2026-07-04/EXPERIENCE.md ~line 1489-1500), the only concrete
-- source anywhere in the planning artifacts. Fixed well-known UUIDs +
-- ON CONFLICT DO NOTHING for idempotency (defensive; migrations normally run
-- once, tracked in supabase_migrations.schema_migrations).
--
-- Elite's "no cap" cannot be represented -- tiers.member_cap is `integer not
-- null` with no sentinel/nullable convention (0002_gyms_and_tiers.sql). Using
-- a large sentinel (1,000,000) as a provisional stopgap; the real schema
-- decision (e.g. making member_cap nullable = unlimited) belongs to Story 1.6,
-- which owns tier CRUD. See docs/decisions.md.
-- ----------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000000101', 'Hustle', 15000, 150000, 30),
  ('00000000-0000-0000-0000-000000000102', 'Grind', 35000, 350000, 100),
  ('00000000-0000-0000-0000-000000000103', 'Elite', 75000, 750000, 1000000)
on conflict (id) do nothing;
