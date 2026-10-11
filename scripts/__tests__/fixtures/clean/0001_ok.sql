create function private.f() returns int language sql as $$ select 1 $$;
revoke execute on function private.f() from public, anon;
select private.current_member_role();
