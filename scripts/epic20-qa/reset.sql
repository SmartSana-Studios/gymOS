-- Epic 20 local QA: wipes the "Epic20 QA Gym" and its accounts. LOCAL DB ONLY.
begin;
set local session_replication_role = replica;  -- bypass FKs/append-only triggers
do $$
declare g uuid; t text;
begin
  for g in select id from public.gyms where name = 'Epic20 QA Gym' loop
    for t in select c.conrelid::regclass::text from pg_constraint c
             join pg_attribute a on a.attrelid=c.conrelid and a.attname='gym_id'
             where c.contype='f' and c.confrelid='public.gyms'::regclass loop
      execute format('delete from %s where gym_id = $1', t) using g;
    end loop;
    delete from public.gyms where id = g;
  end loop;
  -- The two phone-testable numbers are shared with the Epic 18/19 QA seeds: drop any member row
  -- (any gym) that points at them so the user rows below can go.
  delete from public.members where user_id in (
    select id from auth.users where phone in ('237699000001', '237670000001'));
end $$;
commit;

begin;
delete from public.users where id in (select id from auth.users
  where email like '%@epic20qa.test' or phone like '237672000%'
     or phone in ('237699000001', '237670000001'));
delete from auth.users
  where email like '%@epic20qa.test' or phone like '237672000%'
     or phone in ('237699000001', '237670000001');
delete from auth.identities where user_id not in (select id from auth.users);
commit;
