create function private.c() returns int language sql as $$ select 1 $$;
revoke execute on function private.c() from public, anon cascade;
