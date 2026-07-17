-- Story 2.2: Membership Plan Configuration (FR-024/025/026). Closes two gaps
-- left by 0004_subscriptions_and_plans.sql: `plans` had no `duration_days`
-- column (FR-025 explicitly requires a per-plan configurable duration) and
-- carried RLS-enabled/deny-all with no policies at all (expected at the
-- time, per 0009's own comment -- "until their owning feature stories add
-- real business policies"). "Access type" (also named in FR-025) is
-- deliberately NOT a new column here -- the PRD's own Plan Type table
-- (prd.md#6.6) already describes each `plan_type` value as a distinct
-- access scope (e.g. "Class-only -- Access to scheduled classes only; no
-- general floor access"), so `plan_type` itself is the access-type
-- discriminator the AC's UI exposes via the type selector. See this
-- story's Dev Notes / Scope Note for the full rationale (matches story
-- 1-6's own "Open Question" precedent for a similar PRD-wording-vs-schema
-- gap).

alter table plans add column duration_days integer;

-- Backfill: every plan row created before this migration has
-- duration_days = null. The app-layer Zod schema (planSchema) now requires
-- a positive duration_days for every plan_type except pay_per_session, so
-- any pre-existing monthly/coach_inclusive/class_only row would otherwise
-- fail validation the moment it's next edited. 30 days is an arbitrary but
-- reasonable default (matches the "Monthly" plan type's own name) -- flagged
-- for whoever owns real plan data to review/adjust per gym.
update plans set duration_days = 30
  where plan_type <> 'pay_per_session' and duration_days is null;

-- Enforces the same plan_type <-> duration_days invariant planSchema's
-- .refine() already checks at the app layer, but at the DB level too --
-- Zod alone can't stop a direct SQL/service-role write from creating an
-- invalid row (Review finding). NOTE (Review Round 2, empirically verified
-- against live Postgres): the original form of this constraint used
-- `duration_days > 0` alone for the non-pay_per_session branch, which is a
-- no-op -- SQL's three-valued logic makes `NULL > 0` evaluate to `NULL`, and
-- Postgres treats a NULL CHECK result as satisfied (only FALSE violates a
-- CHECK). An explicit `is not null` is required to actually reject a null
-- duration_days on this branch.
alter table plans add constraint plans_duration_days_matches_plan_type check (
  (plan_type = 'pay_per_session' and duration_days is null)
  or (plan_type <> 'pay_per_session' and duration_days is not null and duration_days > 0)
);

-- Mirrors planSchema's other two .refine()s at the DB level, same
-- direct-SQL/service-role-write rationale as above (Review finding). Written
-- with the explicit `is not null`/`is null` guards the duration_days
-- constraint above was missing, to avoid repeating the same NULL-defeats-
-- CHECK trap for this constraint's own nullability branches.
alter table plans add constraint plans_discount_matches_billing_interval check (
  (billing_interval = 'annual' and annual_discount_percent is not null
    and annual_discount_percent >= 0 and annual_discount_percent <= 100)
  or (billing_interval = 'monthly' and annual_discount_percent is null)
);

alter table plans add constraint plans_pay_per_session_is_monthly check (
  plan_type <> 'pay_per_session' or billing_interval = 'monthly'
);

-- Plan names only need to be unique within a gym (planNameExists' own
-- scoping), case-insensitive to match its ilike pre-check. Backstops the
-- app-layer check-then-insert race the same way idx_gyms_name_unique/
-- idx_tiers_name_unique backstop their own name checks (mapped in
-- packages/types/src/errors.ts). Trims via btrim (Review Round 2 fix) so
-- "Gold" and "Gold " (trailing space) collide as intended -- the app's own
-- planSchema.name already trims before this index is ever hit.
create unique index idx_plans_gym_name_unique on plans (gym_id, lower(btrim(name)));

-- SELECT: any authenticated gym staff role (member excluded structurally --
-- members never reach apps/dashboard, see (dashboard)/layout.tsx) can read
-- their own gym's plans -- Story 2.3 (member creation) and Story 2.6/2.7
-- (member app plan display) both need broad read access, not just
-- manager/owner. Mirrors "read own gym"'s ungated-by-role shape (0009), not
-- 0014's owner-only shape.
create policy "gym_staff_read_own_plans" on plans
  for select
  using (gym_id = private.gym_id());

-- INSERT/UPDATE/DELETE: Manager or Owner only (FR-025's literal "As a
-- Manager or Owner"). First RLS policy in this project needing a multi-role
-- check -- `= any(array[...])`, not a single-value equality like every
-- prior role-gated policy (0014's owner-only `= 'owner'`).
create policy "manager_or_owner_insert_own_plans" on plans
  for insert
  with check (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  );

create policy "manager_or_owner_update_own_plans" on plans
  for update
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  )
  with check (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  );

create policy "manager_or_owner_delete_own_plans" on plans
  for delete
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  );
