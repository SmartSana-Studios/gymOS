-- ============================================================================
-- 0102: receptionists can register members and assign their first plan.
--
-- Until now only manager / supervisor / owner could INSERT into members and
-- subscriptions (0018, widened for supervisor in 0093). Product decision
-- (post Epic 18 manual QA): the front desk registers walk-ins, so a
-- receptionist now gets exactly those two INSERTs and nothing else.
--
--   * members INSERT:       still role = 'member' only (a receptionist cannot
--                           create staff rows).
--   * subscriptions INSERT: unchanged otherwise. The Epic 18 gate
--                           (registration_fee_not_settled trigger) still
--                           applies to every role.
--   * UPDATE policies, DELETE, CSV import, deactivate, plan CRUD and waive
--     stay manager-plus; they are NOT touched here.
-- Policy names keep their historical "manager_or_owner_" prefix (renaming
-- would break every migration/test that references them by name).
-- ============================================================================

alter policy "manager_or_owner_insert_own_members" on public.members
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['receptionist'::text, 'manager'::text, 'supervisor'::text, 'owner'::text])) AND (role = 'member'::member_role)))
;

alter policy "manager_or_owner_insert_own_subscriptions" on public.subscriptions
  with check (((gym_id = private.gym_id()) AND ((auth.jwt() ->> 'app_role'::text) = ANY (ARRAY['receptionist'::text, 'manager'::text, 'supervisor'::text, 'owner'::text]))))
;

do $verify$
begin
  if not exists (select 1 from pg_policies where policyname = 'manager_or_owner_insert_own_members'
                 and with_check like '%receptionist%' and with_check like '%member_role%') then
    raise exception '0102 verify: members insert policy missing receptionist';
  end if;
  if not exists (select 1 from pg_policies where policyname = 'manager_or_owner_insert_own_subscriptions'
                 and with_check like '%receptionist%') then
    raise exception '0102 verify: subscriptions insert policy missing receptionist';
  end if;
  if exists (select 1 from pg_policies where policyname in
             ('manager_or_owner_update_own_members','manager_or_owner_update_own_subscriptions')
             and (qual like '%receptionist%' or with_check like '%receptionist%')) then
    raise exception '0102 verify: an UPDATE policy was widened by mistake';
  end if;
end
$verify$;
