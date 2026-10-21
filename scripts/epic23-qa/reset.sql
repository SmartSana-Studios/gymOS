-- Epic 23 local QA: wipes the "Epic23 QA ..." gyms and the QA accounts. LOCAL DB ONLY.
begin;
set local session_replication_role = replica;  -- bypass FKs/append-only triggers
do $$
declare g uuid; t text; u uuid[];
begin
  select coalesce(array_agg(id), '{}') into u from auth.users
   where email like '%@epic23qa.test' or email like 'qa23-%@gymosapps.com' or phone like '237673%';
  for g in select id from public.gyms where name like 'Epic23 QA%' loop
    for t in select c.conrelid::regclass::text from pg_constraint c
             join pg_attribute a on a.attrelid=c.conrelid and a.attname='gym_id'
             where c.contype='f' and c.confrelid='public.gyms'::regclass loop
      execute format('delete from %s where gym_id = $1', t) using g;
    end loop;
    delete from public.gyms where id = g;
  end loop;
end $$;
commit;

begin;
set local session_replication_role = replica;
create temp table qa_users on commit drop as
  select id from auth.users where email like '%@epic23qa.test' or email like 'qa23-%@gymosapps.com' or phone like '237673%';
delete from public.support_assignments where support_user_id in (select id from qa_users);
delete from private.support_invites where user_id in (select id from qa_users);
delete from private.support_factor_resets where user_id in (select id from qa_users);
delete from private.support_session_state where user_id in (select id from qa_users);
delete from private.support_stepup where user_id in (select id from qa_users);
delete from private.support_last_active where user_id in (select id from qa_users);
delete from private.support_accounts where user_id in (select id from qa_users);
delete from public.members where user_id in (select id from qa_users);
delete from public.users where id in (select id from qa_users);
delete from auth.mfa_factors where user_id in (select id from qa_users);
delete from auth.users where id in (select id from qa_users);
delete from auth.identities where user_id not in (select id from auth.users);
commit;
