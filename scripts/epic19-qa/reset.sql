-- Epic 19 local QA: wipes the "Epic19 QA Gym" (+ its second tenant) and their accounts. LOCAL DB ONLY.
begin;
set local session_replication_role = replica;  -- bypass FKs/append-only triggers
do $$
declare g uuid; t text;
begin
  for g in select id from public.gyms where name in ('Epic19 QA Gym', 'Epic19 QA Other Gym') loop
    for t in select c.conrelid::regclass::text from pg_constraint c
             join pg_attribute a on a.attrelid=c.conrelid and a.attname='gym_id'
             where c.contype='f' and c.confrelid='public.gyms'::regclass loop
      execute format('delete from %s where gym_id = $1', t) using g;
    end loop;
    delete from public.gyms where id = g;
  end loop;
  -- The two phone-testable numbers are shared with the Epic 18 QA seed: drop any member row
  -- (any gym) that points at them so the user rows below can go.
  delete from public.members where user_id in (
    select id from auth.users where phone in ('237699000001', '237670000001'));
end $$;
commit;

begin;
delete from public.users where id in (select id from auth.users
  where email like '%@epic19qa.test' or phone like '237671900%' or phone like '237671901%'
     or phone in ('237699000001', '237670000001'));
delete from auth.users
  where email like '%@epic19qa.test' or phone like '237671900%' or phone like '237671901%'
     or phone in ('237699000001', '237670000001');
delete from auth.identities where user_id not in (select id from auth.users);
commit;
