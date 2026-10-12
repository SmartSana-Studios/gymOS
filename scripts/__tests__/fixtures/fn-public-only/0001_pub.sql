create function private.only_pub() returns trigger language plpgsql as $$ begin return new; end $$;
revoke execute on function private.only_pub() from public;
