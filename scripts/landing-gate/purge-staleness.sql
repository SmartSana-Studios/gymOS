-- Story 24.12 (deferred-work, 24.11 review): is the media purge job alive?
--
-- The `page_media_purge` pg_cron job calls the edge function every 5 minutes and the function writes ONE job_runs row per run (success only
-- when nothing failed). A deployed job that never ran (a missing Vault secret makes the tick do nothing) or keeps failing leaves images of
-- unpublished pages in Storage with no error anywhere. Run this on STAGING and later on production, as a role that can read job_runs:
--
--   psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -At -f scripts/landing-gate/purge-staleness.sql
--
-- Output: one line, `PASS ...` or `FAIL ...`; on FAIL the script then raises an error, so psql with ON_ERROR_STOP=1 exits non-zero.
-- The window is 15 minutes: three missed ticks.
select case when exists (
         select 1 from public.job_runs
          where job_name = 'page_media_purge' and status = 'success' and finished_at > now() - interval '15 minutes')
       then 'PASS purge-staleness: a successful page_media_purge run finished in the last 15 minutes'
       else 'FAIL purge-staleness: no successful page_media_purge job_runs row in the last 15 minutes (newest: '
            || coalesce((select coalesce(status::text, 'running') || ' at ' || coalesce(finished_at, started_at)::text from public.job_runs where job_name = 'page_media_purge' order by coalesce(finished_at, started_at) desc limit 1), 'none ever')
            || ')'
       end as result,
       exists (
         select 1 from public.job_runs
          where job_name = 'page_media_purge' and status = 'success' and finished_at > now() - interval '15 minutes') as ok
\gset
\echo :result
\if :ok
\else
  do $$ begin raise exception 'purge-staleness: the media purge job is stale or never ran'; end $$;
\endif
