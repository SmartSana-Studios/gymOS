-- Story 6.7 negative privilege contract: public.notifications is
-- read-mostly for members -- select + only the read_at column is
-- updatable, no insert/delete at all (rows are written only by the
-- service_role-executed, security definer send functions).

begin;
select plan(9);

select ok(not has_table_privilege('anon', 'public.notifications', 'SELECT'), 'anon has no select on notifications');
select ok(not has_table_privilege('anon', 'public.notifications', 'INSERT'), 'anon has no insert on notifications');
select ok(not has_table_privilege('anon', 'public.notifications', 'UPDATE'), 'anon has no update on notifications');
select ok(not has_table_privilege('anon', 'public.notifications', 'DELETE'), 'anon has no delete on notifications');

select ok(has_table_privilege('authenticated', 'public.notifications', 'SELECT'), 'authenticated can select notifications (RLS still scopes rows to their own)');
select ok(not has_table_privilege('authenticated', 'public.notifications', 'INSERT'), 'authenticated has no insert privilege on notifications at all');
select ok(not has_table_privilege('authenticated', 'public.notifications', 'DELETE'), 'authenticated has no delete privilege on notifications at all');
select ok(has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE'), 'authenticated can update the read_at column');
select ok(
  not has_column_privilege('authenticated', 'public.notifications', 'title', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.notifications', 'body', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.notifications', 'type', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.notifications', 'member_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.notifications', 'gym_id', 'UPDATE'),
  'authenticated cannot update any column besides read_at -- content integrity of a member''s own past notifications'
);

select * from finish();
rollback;
