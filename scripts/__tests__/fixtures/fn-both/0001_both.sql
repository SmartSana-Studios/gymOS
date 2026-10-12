create function private.a() returns int language sql as $$ select 1 $$;
revoke execute on function private.a() from public, anon;
create function public.b(x int) returns int language sql as $$ select 1 $$;
revoke execute on function b(int) from public;
-- a comment
revoke all on function public.b(int) from anon;
