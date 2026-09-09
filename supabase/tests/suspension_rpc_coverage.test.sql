-- Story 11.8 (Task 4, AC #6): the guardrail that stops this story's audit
-- from rotting.
--
-- tenant_suspension_enforcement.test.sql proves 0090's original 18 RPCs are
-- gated, and workout_plan_suspension_enforcement.test.sql proves the three
-- 0091 added -- 21 between them. Neither can prove anything about the 22nd. A
-- SECURITY DEFINER function executes as the table owner, and RLS does not
-- apply to the owner unless the table sets FORCE ROW LEVEL SECURITY -- which
-- no table in this schema does -- so any new write-RPC bypasses
-- tenant_active_gate silently, by default, with nothing failing to signal it.
-- That is exactly how the hole this story closes came to exist.
--
-- This file introspects pg_proc instead of hard-coding a list: it finds every
-- SECURITY DEFINER function whose body writes one of the 18 gated tables, and
-- requires each to either call private.current_gym_status() or appear in the
-- explicit, per-entry-justified exclusion array below. Add a gated write-RPC
-- without a status guard and this test fails, naming the function.
--
-- AD-3 proposed a CI grep-lint gate for this class of problem and it was never
-- built (check:i18n is the only such gate that exists). A pgTAP meta-test is
-- the equivalent that fits the tooling actually in place: it runs in the same
-- suite as everything else, against the real schema rather than the source
-- text, so it sees the CURRENT definition of a function even when a later
-- migration redefined it.
--
-- WHEN THIS TEST FAILS, the fix is almost always to add the guard from
-- 0090's header to the new function. Add to the exclusion array ONLY if the
-- function is genuinely a recovery, webhook, cron or auth path that must keep
-- working while a gym is suspended -- and write the reason inline, because
-- gating a recovery path locks a paying customer out permanently, while
-- wrongly excluding one silently reopens this story's vulnerability.

begin;
select plan(7);

-- ============================================================================
-- The 21 tables carrying tenant_active_gate. Derived from pg_policies rather
-- than hard-coded, so a table gaining the policy later is picked up here
-- automatically -- 0084 added public.notifications to 0073's original 17
-- exactly that way, and every prior write-up of this gate still said "17".
-- Story 11.9's 0091 then added the three Epic 13 tables (workout_plans,
-- workout_plan_exercises, workout_plan_completions) that assertion 5 below had
-- pinned as the known gap, taking 18 to 21.
-- ============================================================================
create temp view gated_tables as
select distinct tablename::text as t
from pg_policies
where policyname = 'tenant_active_gate';

select is(
  (select count(*)::int from gated_tables),
  21,
  'tenant_active_gate covers 21 tables (0073''s 17 + public.notifications from 0084 + the three workout-plan tables from 0091) -- if this changes, the exclusion reasoning below needs re-reading, not just the number'
);

-- ============================================================================
-- Every SECURITY DEFINER function whose body writes a gated table.
--
-- Matching is on prosrc, the same technique the story's own audit used. Its
-- one blind spot is dynamic SQL, so the third assertion below separately
-- guards against a gated table being written through EXECUTE.
-- ============================================================================
create temp view secdef_gated_writers as
select
  n.nspname::text as schema_name,
  p.proname::text as function_name,
  -- Code review 2026-09-09: this was `prosrc like '%current_gym_status%'`, a
  -- bare substring match that could not see the OPERATOR. A function written
  -- with `current_gym_status() <> 'active'` -- the exact fail-open trap 0090's
  -- header spends thirteen lines warning about, because NULL <> 'active' is
  -- NULL, the `if` never fires and the function PROCEEDS TO WRITE -- counted
  -- as guarded and passed this test. It now matches the fail-closed predicate
  -- itself, so a regression to `<>` fails here instead of shipping silently.
  p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''' as has_status_guard
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname in ('public', 'private')
  and exists (
    select 1 from gated_tables g
    where p.prosrc ~* ('(insert\s+into\s+(public\.)?' || g.t || '\M'
                    || '|update\s+(public\.)?' || g.t || '\M'
                    || '|delete\s+from\s+(public\.)?' || g.t || '\M)')
  );

-- ============================================================================
-- The exclusion list. Every entry MUST keep working while a gym is suspended;
-- gating any of them is a worse bug than the one this story fixed, because a
-- suspended gym would become permanently unrecoverable rather than merely
-- over-permissive. Reasons are inline and per-entry by design -- a bare list
-- would be indistinguishable from an oversight the next time someone reads it.
-- ============================================================================
-- Code review 2026-09-09: entries are schema-qualified. The two joins below
-- previously matched on bare function_name while secdef_gated_writers spans
-- both public and private, so a future private.log_audit_event (or any
-- same-named pair across the two schemas) would auto-excuse itself.
create temp view suspension_gate_exclusions (schema_name, function_name, reason) as
values
  -- Owner escape valves: the Owner must be able to fix the billing-notice
  -- address and pay, from inside a suspended gym, or nothing can un-suspend it.
  ('public', 'update_own_owner_notification_email', 'Owner escape valve: writes the gated members table, but must stay callable while suspended (0073:73-77)'),
  ('public', 'initiate_saas_billing_payment',       'The "Pay Now" path itself. Already rejects deactivated and deliberately permits suspended'),

  -- The RPCs that actually lift a suspension.
  ('public', 'complete_verified_saas_billing_payment', 'Un-suspends the gym -- gating it would make suspension irreversible'),
  ('public', 'record_out_of_band_saas_billing_payment', 'Super Admin records an offline payment; un-suspends'),
  ('public', 'apply_saas_billing_credit',              'Super Admin credit; un-suspends'),

  -- Super Admin support access is needed BECAUSE a gym is suspended.
  ('public', 'escalate_gym_data_access', 'Super Admin support access into a suspended gym is the whole point of the escalation path'),
  ('public', 'revoke_gym_data_access',   'The matching revocation must work wherever the grant does'),

  -- Session/auth plumbing. 0074 exists precisely because tenant_active_gate
  -- broke the multi-gym switcher; gating these re-breaks Story 11.4's own fix.
  ('public', 'list_own_active_gym_memberships', 'The multi-gym switcher must still list a suspended gym so the Owner can leave it (0074)'),
  ('public', 'switch_active_gym',               'Same: switching away from a suspended gym must work'),
  ('public', 'custom_access_token_hook',        'Must keep minting claims for a suspended gym, or the Owner cannot log in to pay (0073:71-73)'),

  -- The single highest-risk entry on this list.
  ('public', 'log_audit_event', 'Writes the gated audit_log and is called BY many other RPCs including every recovery path above -- gating it would cascade and break all of them. It already validates gym IDENTITY (p_gym_id vs private.gym_id()); status is deliberately not its concern'),

  -- service_role webhook completions. Both resolve their gym from the payment
  -- row, never from a caller claim -- a member's payment landing after
  -- suspension must still reconcile.
  ('public', 'complete_verified_payment', 'service_role webhook; resolves gym from the payment row, not a caller claim'),
  ('public', 'complete_flagged_payment',  'service_role webhook; same reasoning'),

  -- Triggers and internal helpers, reachable by `authenticated` only behind
  -- functions this story already gates.
  ('private', 'create_default_member_preferences', 'after-insert trigger on members, reachable only behind create_staff_member() which IS gated; gating it here would also fire on Super-Admin-driven inserts'),
  ('private', 'materialize_sessions_for_class',    'service_role internal helper reachable by authenticated only via create_class/update_class/materialize_class_sessions, all gated; also called directly by run_class_session_materializer_job()'),

  -- Cron-owned notification senders. They write the now-gated notifications
  -- table but run under service_role from run_*_job(); the quiet-gym and
  -- class-reminder jobs already filter `gyms.status = 'active'` at source
  -- (0056:498, 0059:441).
  ('private', 'send_push_notification',         'cron-owned, service_role, writes notifications'),
  ('private', 'send_payment_push_notification', 'cron-owned, service_role, writes notifications'),
  ('private', 'send_quiet_gym_alert',           'cron-owned, service_role; job already filters on gyms.status = active'),
  ('private', 'send_class_reminder',            'cron-owned, service_role; job already filters on gyms.status = active');

-- ============================================================================
-- The assertion that matters. Any SECURITY DEFINER function writing a gated
-- table must carry the status guard or be explicitly excused above.
-- ============================================================================
select is(
  (
    select coalesce(string_agg(w.schema_name || '.' || w.function_name, ', ' order by w.function_name), '')
    from secdef_gated_writers w
    where not w.has_status_guard
      and not exists (
        select 1 from suspension_gate_exclusions e
        where e.function_name = w.function_name and e.schema_name = w.schema_name
      )
  ),
  '',
  'every SECURITY DEFINER function writing a tenant_active_gate table either calls private.current_gym_status() or is on the documented exclusion list (Story 11.8 AC #6)'
);

-- The mirror of the assertion above: an exclusion that has quietly acquired a
-- status guard means the exclusion list and the code now disagree, and one of
-- the two is wrong. Catching that is as valuable as catching a missing guard,
-- because an accidentally-gated recovery path is the permanent-lockout bug.
select is(
  (
    select coalesce(string_agg(w.schema_name || '.' || w.function_name, ', ' order by w.function_name), '')
    from secdef_gated_writers w
    join suspension_gate_exclusions e
      on e.function_name = w.function_name and e.schema_name = w.schema_name
    where w.has_status_guard
  ),
  '',
  'no function on the exclusion list has acquired a status guard -- gating a recovery path makes a suspended gym permanently unrecoverable'
);

-- prosrc matching cannot see a write hidden behind EXECUTE. Today the only
-- SECURITY DEFINER function in this schema using dynamic SQL is
-- private.process_notification_deliveries(), and every statement it builds
-- targets a private.* delivery table, never a gated one. If a function ever
-- starts writing a gated table through EXECUTE, the two assertions above would
-- silently stop covering it -- so pin the set of dynamic-SQL functions here
-- and make any addition a deliberate, reviewed act.
select is(
  (
    select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'private')
      -- Code review 2026-09-09: was '\mexecute\M', which fires on the word
      -- "execute" appearing in any comment and reports it as a dynamic-SQL
      -- change -- a failure message that sends the reader hunting for a
      -- non-existent EXECUTE. Anchored to an actual dynamic-SQL statement.
      and p.prosrc ~* '\mexecute\s+(format\s*\(|''|\$|v_|_sql\M)'
  ),
  'private.process_notification_deliveries',
  'the set of SECURITY DEFINER functions using dynamic SQL is unchanged -- prosrc matching above cannot see writes built with EXECUTE, so a new one needs manual review against the gated-table list'
);

-- ============================================================================
-- Code review 2026-09-09. The sweep above derives its gated-table set from
-- pg_policies, so a gym_id-bearing table that NEVER received tenant_active_gate
-- is invisible to it by construction -- functions writing such a table are not
-- in secdef_gated_writers at all, and nothing here or in 0090 notices. That is
-- not hypothetical: Epic 13 shipped workout_plans, workout_plan_exercises and
-- workout_plan_completions after 0073 and none of them picked up the policy, so
-- a coach at a suspended gym could still author and hand off plans. This
-- assertion is what caught it. Story 11.9 (0091) closed it, and the three names
-- have moved out of the expected value below.
--
-- Pinning the ungated set turns that silence into a failing test the next time
-- it happens. Adding a gym_id table without the gate is now a deliberate act
-- that must be justified here, exactly as excluding a function must be above.
-- ============================================================================
select is(
  (
    select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'gym_id'
                       and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
          and p.policyname = 'tenant_active_gate'
      )
  ),
  -- Deliberately ungated, and why:
  --   exercise_library        - shared reference data; a suspended gym reading
  --                             exercise names harms nothing (0079)
  --   gym_data_escalations    - Super Admin support access is needed BECAUSE
  --                             the gym is suspended
  --   gym_payment_credentials - RLS enabled but ZERO permissive policies, so a
  --                             restrictive policy would be a structural no-op;
  --                             recorded in docs/decisions.md, 2026-08-28 entry
  --   saas_billing_notices    - the suspension notice itself must stay readable
  --   saas_billing_payments   - the Pay Now escape valve writes here
  --
  -- exercise_library is the one that needs re-reading rather than re-deriving:
  -- its gym_id is NULLABLE and all 15 seeded rows are platform defaults
  -- (gym_id is null), so gating it would block a suspended gym from reading
  -- PLATFORM data that was never the tenant's (Story 11.9 §B). If a future story
  -- ever needs to close its coach INSERT, add a SEPARATE, narrower
  -- RESTRICTIVE ... FOR INSERT policy under a DIFFERENT name -- reusing
  -- `tenant_active_gate` would silently change assertion 1's count above.
  'exercise_library, gym_data_escalations, gym_payment_credentials, saas_billing_notices, saas_billing_payments',
  'the set of gym_id-bearing tables WITHOUT tenant_active_gate is unchanged -- a new one is invisible to the guardrail above, so it must be justified here (Story 11.8 code review)'
);

-- ============================================================================
-- The SQL half of the raise-text contract. 0090's header calls the phrase
-- `is not active` load-bearing: isGymSuspendedError() in
-- packages/types/src/errors.ts matches on it, and that predicate is what makes
-- the neutral member-facing copy appear on mobile (AC #4). Nothing pinned it,
-- so a reworded raise would silently degrade every member's error message to a
-- generic failure with all tests still green. This is the SQL side of that
-- contract; apps/dashboard/lib/errors.gymSuspended.test.ts is the TS side.
-- ============================================================================
select is(
  (
    select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
      and p.prosrc not like '%is not active%'
  ),
  '',
  'every status-guarded function raises a message containing the load-bearing `is not active` phrase that isGymSuspendedError() and the throws_like assertions both match on'
);

-- ============================================================================
-- Code review 2026-09-09: guard PLACEMENT was previously untested. Section G of
-- tenant_suspension_enforcement.test.sql claimed its throwaway arguments proved
-- it -- "if a guard were ever moved below a validation step, the error text
-- would change" -- but 16 of its 18 calls pass real fixture ids that survive
-- every downstream validation, so moving a guard to the last line before the
-- write leaves that file entirely green. This matters concretely: check_in()
-- and mark_class_attendance() both have non-raising `return null` paths that
-- COMMIT a front_desk_alerts insert, so a guard below them would leak writes on
-- a suspended gym undetected.
--
-- position() on prosrc is a coarse instrument, but it answers the one question
-- that matters -- does the gate come before the first thing that mutates state?
-- ============================================================================
select is(
  (
    select coalesce(string_agg(x.proname, ', ' order by x.proname), '')
    from (
      select
        p.proname,
        position('current_gym_status' in p.prosrc) as guard_at,
        coalesce(
          nullif(
            least(
              coalesce(nullif(position('insert into' in lower(p.prosrc)), 0), 2147483647),
              coalesce(nullif(position('update members' in lower(p.prosrc)), 0), 2147483647),
              coalesce(nullif(position('update subscriptions' in lower(p.prosrc)), 0), 2147483647),
              coalesce(nullif(position('update payments' in lower(p.prosrc)), 0), 2147483647),
              coalesce(nullif(position('update classes' in lower(p.prosrc)), 0), 2147483647),
              coalesce(nullif(position('update class_sessions' in lower(p.prosrc)), 0), 2147483647),
              coalesce(nullif(position('update class_bookings' in lower(p.prosrc)), 0), 2147483647),
              coalesce(nullif(position('update session_notes' in lower(p.prosrc)), 0), 2147483647),
              coalesce(nullif(position('update attendance_events' in lower(p.prosrc)), 0), 2147483647),
              -- Story 11.9: without this entry take_ownership_of_workout_plan()
              -- is SILENTLY UNCHECKED by this assertion. Its only write is
              -- `update workout_plans`, so least() resolved to 2147483647,
              -- nullif turned that into 0, and the `where x.write_at > 0` filter
              -- below dropped the row entirely -- guard placement never verified.
              -- Safe to add: no other currently-guarded function contains this
              -- string, and for update_workout_plan() least() still resolves to
              -- its earlier `delete from`.
              coalesce(nullif(position('update workout_plans' in lower(p.prosrc)), 0), 2147483647),
              -- Added by the 11.9 code review for the same reason: 0091 gated
              -- three tables and only one of them was represented above. A
              -- future writer whose sole write is an UPDATE on either of these
              -- two would be dropped by the write_at > 0 filter exactly as
              -- take_ownership_of_workout_plan was. Neither string appears in
              -- any currently-guarded body, so adding them changes no result
              -- today -- which is the point: the list must not lag the gate.
              coalesce(nullif(position('update workout_plan_exercises' in lower(p.prosrc)), 0), 2147483647),
              coalesce(nullif(position('update workout_plan_completions' in lower(p.prosrc)), 0), 2147483647),
              coalesce(nullif(position('delete from' in lower(p.prosrc)), 0), 2147483647)
            ),
            2147483647
          ),
          0
        ) as write_at
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
    ) x
    where x.write_at > 0 and x.guard_at > x.write_at
  ),
  '',
  'in every status-guarded function the suspension gate precedes the first write statement -- a guard below a write would let a suspended gym mutate state before raising (Story 11.8 code review)'
);

select * from finish();
rollback;
