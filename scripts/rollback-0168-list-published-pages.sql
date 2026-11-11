-- Rollback of 0168: drops the Super Admin list of published pages. Nothing else changed in 0168.
drop function if exists public.list_published_pages();

do $verify$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'list_published_pages') then
    raise exception 'rollback-0168: list_published_pages is still present';
  end if;
end;
$verify$;
