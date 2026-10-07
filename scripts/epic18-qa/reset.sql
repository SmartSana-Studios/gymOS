-- Epic 18 local QA: wipes the "Epic18 QA Gym" and its accounts. LOCAL DB ONLY.
begin;
set local session_replication_role = replica;  -- bypass FKs/append-only triggers
do $$
declare g uuid; t text; uids uuid[];
begin
  select id into g from public.gyms where name = 'Epic18 QA Gym';
  select coalesce(array_agg(distinct user_id), '{}') into uids from public.members where gym_id = g;
  if g is not null then
    for t in select c.conrelid::regclass::text from pg_constraint c
             join pg_attribute a on a.attrelid=c.conrelid and a.attname='gym_id'
             where c.contype='f' and c.confrelid='public.gyms'::regclass loop
      execute format('delete from %s where gym_id = $1', t) using g;
    end loop;
    delete from public.gyms where id = g;
  end if;
end $$;
commit;

-- Outside replica mode so auth.users cascades (identities, sessions) fire.
begin;
delete from public.users where id in (select id from auth.users
  where email like '%@epic18qa.test' or phone like '237671800%' or phone = '237699000001');
delete from auth.users
  where email like '%@epic18qa.test' or phone like '237671800%' or phone = '237699000001';
-- orphans left by an earlier partial run
delete from auth.identities where user_id not in (select id from auth.users);
commit;
