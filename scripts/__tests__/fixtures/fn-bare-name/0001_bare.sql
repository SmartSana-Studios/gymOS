create function private.g() returns int language sql as $$ select 1 $$;
revoke execute on function private.g from public, anon;
create function public.h(a int, b numeric(10,2)) returns int language sql as $$ select 1 $$;
revoke execute on function public.h(int, numeric(10,2)), private.g from public, anon;
