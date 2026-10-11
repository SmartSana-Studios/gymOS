create or replace function public.do_thing(a int) returns int language sql as $$ select a $$;
