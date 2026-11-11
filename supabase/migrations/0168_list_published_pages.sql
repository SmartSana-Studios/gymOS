-- ============================================================================
-- 0168: list_published_pages(), the Super Admin list of published pages and their domains (Epic 24 follow-up to 24.11).
--
-- After the SmartSana smoke test the owner asked for a list of the pages and domains that are live. This is one read-only function in the
-- shape of list_page_reports (0167): security definer, stable, search_path pinned, a live Super Admin or `permission denied`.
--
--   A page is LISTED when it has a published snapshot: gym_pages.published_at is set and unpublished_at is null.
--   Its status is
--     taken_down  the page row or its name row carries taken_down_at (takedown wins over a pause),
--     paused      published but not served right now and not taken down: the gym is not active (suspended or deactivated; the page returns by
--                 itself when the gym is reactivated) or its name is no longer the active one (released, redirect, held, reserved, or gone),
--     live        none of the above, i.e. the page is exactly what private.gym_page_visible serves (a test pins the two sets as equal).
--   page_name is the subdomain label (the domain is `<page_name>.gymosapps.com`); it is null only if the name row is gone.
--   The result is capped at 1000 rows, newest published first. No write path, no public exposure (execute: authenticated only).
-- ============================================================================

set local lock_timeout = '5s';

create function public.list_published_pages()
returns table (
  gym_id uuid, gym_name text, page_name text, template text, published_at timestamptz, status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;

  return query
    select gp.gym_id,
           g.name::text,
           pn.name,
           gp.template,
           gp.published_at,
           case
             when gp.taken_down_at is not null or pn.taken_down_at is not null then 'taken_down'
             when g.status is distinct from 'active' or pn.id is null or pn.state is distinct from 'active' then 'paused'
             else 'live'
           end
      from gym_pages gp
      join gyms g on g.id = gp.gym_id
      left join page_names pn on pn.id = gp.page_name_id and pn.gym_id = gp.gym_id
     where gp.published_at is not null
       and gp.unpublished_at is null
     order by gp.published_at desc, gp.gym_id
     limit 1000;
end;
$$;

comment on function public.list_published_pages() is
  'Super Admin only (live): every published page with its gym, name (the subdomain), template, publish date and status live / taken_down / paused. Read-only, newest first, capped at 1000.';

revoke execute on function public.list_published_pages() from public, anon;
grant execute on function public.list_published_pages() to authenticated;

do $verify$
declare
  v_def text;
begin
  select p.prosrc into v_def from pg_proc p where p.oid = 'public.list_published_pages()'::regprocedure;
  if v_def is null or v_def !~ 'is_super_admin_live' then
    raise exception '0168: list_published_pages is missing its Super Admin guard';
  end if;
  if not (select p.provolatile = 's' and p.prosecdef and p.proconfig = array['search_path=public'] from pg_proc p where p.oid = 'public.list_published_pages()'::regprocedure) then
    raise exception '0168: list_published_pages must be stable, security definer, with search_path = public';
  end if;
  if has_function_privilege('anon', 'public.list_published_pages()', 'execute') or has_function_privilege('public_site_reader', 'public.list_published_pages()', 'execute') then
    raise exception '0168: list_published_pages must not be executable by anon or the public site reader';
  end if;
  if not has_function_privilege('authenticated', 'public.list_published_pages()', 'execute') then
    raise exception '0168: list_published_pages must be executable by authenticated';
  end if;
end;
$verify$;
