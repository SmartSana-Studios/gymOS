-- Story 1.17: repair `idx_members_active_gym_user` where it has gone missing.
--
-- NOT a new constraint. `0003_members_and_users.sql:39` already creates this
-- exact index, with this exact name and definition, and at least ten later
-- migrations name it as a load-bearing invariant they rely on -- 0023, 0027,
-- 0028, 0034, 0039, 0055, 0058 and 0064 all cite it, and
-- `create_staff_member()` (0064:59) depends on "at most one active membership
-- per (gym, user)" being true when it decides between inserting a new binding
-- and replacing one in place.
--
-- WHY THIS MIGRATION EXISTS: the deployed project (vfxezibagiznrirdwkwh) has
-- `0003` recorded as applied in `supabase_migrations.schema_migrations`, but
-- does NOT have this index -- verified 2026-09-08 via `pg_index`, which
-- returned only `members_pkey`, `idx_members_gym_id` and `idx_members_user_id`
-- for `public.members`. So an invariant the codebase treats as guaranteed was
-- not actually enforced there. Cause unknown (the index is not dropped by any
-- migration in this repo); the fix is to converge the schema regardless of how
-- it diverged.
--
-- `if not exists` makes this a no-op on every environment that already has the
-- index -- local dev and CI, which build from migrations and therefore always
-- do -- so this is safe to run everywhere and safe to re-run.
--
-- SAFE TO APPLY as of 2026-09-08: the deployed project had zero duplicate
-- active pairs. That is a point-in-time observation with a shelf life, not a
-- guarantee, so the pre-flight block below re-checks at APPLY time and names
-- the offending pairs -- without it a duplicate arriving in the meantime dies
-- as a bare `unique_violation` from the CREATE with nothing to act on.
--
-- LOCKING: this is a plain `create unique index`, NOT `concurrently` (which
-- cannot run inside a migration's transaction). It takes a SHARE lock on
-- `public.members` for the duration of the build, blocking every write to that
-- table -- check-ins, member creation, staff changes. At the current table size
-- that is milliseconds; on a large production table, build it out of band with
-- `create unique index concurrently` first, after which this migration becomes
-- the no-op it already is everywhere else.
--
-- PARTIAL on `deactivated_at is null`, matching 0003 exactly:
-- `0063_staff_edit_deactivation.sql` made deactivation a SOFT state, so a
-- total unique index would permanently block re-adding a once-deactivated
-- staff member and break 0064's rehire path.

-- Pre-flight (AC #6: "check for pre-existing violations before adding the
-- index"). Fails with the offending pairs listed, instead of an opaque
-- unique_violation from the CREATE below.
do $$
declare v_dupes text;
begin
  select string_agg(format('(gym %s, user %s) x%s', gym_id, user_id, n), '; ')
    into v_dupes
    from (
      select gym_id, user_id, count(*) as n
        from public.members
       where deactivated_at is null
       group by gym_id, user_id
      having count(*) > 1
    ) d;

  if v_dupes is not null then
    raise exception
      'cannot build idx_members_active_gym_user -- duplicate active memberships must be resolved first: %',
      v_dupes;
  end if;
end $$;

create unique index if not exists idx_members_active_gym_user
  on public.members (gym_id, user_id)
  where deactivated_at is null;

-- Code review hardening. `create unique index if not exists` matches on NAME
-- only -- Postgres gives no guarantee the existing index resembles the
-- intended one. Since the cause of the production drift is unknown, a
-- same-named but non-unique or non-partial index would make the statement
-- above a silent no-op while every reader assumes the invariant is restored.
-- Assert the shape actually present, so a divergent index fails loudly here
-- rather than surfacing later as a duplicate-membership bug.
do $$
declare
  v_is_unique boolean;
  v_pred text;
  v_usable boolean;
  v_cols text[];
  v_expr_keys int;
begin
  select i.indisunique, pg_get_expr(i.indpred, i.indrelid), i.indisvalid and i.indisready,
         (select array_agg(a.attname order by k.ord)
            from unnest(i.indkey[0:i.indnkeyatts-1]) with ordinality k(attnum, ord)
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
    into v_is_unique, v_pred, v_usable, v_cols, v_expr_keys
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
   where c.relname = 'idx_members_active_gym_user'
     and n.nspname = 'public'
     and i.indrelid = 'public.members'::regclass;

  if v_is_unique is null then
    raise exception 'idx_members_active_gym_user missing after create -- index was not built';
  end if;
  if not v_is_unique then
    raise exception 'idx_members_active_gym_user exists but is NOT UNIQUE -- drop it and re-run';
  end if;
  if v_pred is null then
    raise exception 'idx_members_active_gym_user exists but is NOT PARTIAL -- it would block the 0063 rehire path';
  end if;
  if v_pred <> '(deactivated_at IS NULL)' then
    raise exception 'idx_members_active_gym_user has predicate % -- expected (deactivated_at IS NULL)', v_pred;
  end if;
  if v_cols is distinct from array['gym_id','user_id'] then
    raise exception 'idx_members_active_gym_user covers % -- expected {gym_id,user_id}', v_cols;
  end if;
  if not v_usable then
    raise exception 'idx_members_active_gym_user exists but is INVALID or NOT READY -- drop it and re-run';
  end if;
  -- An EXPRESSION key column has attnum 0, which the join above silently drops
  -- rather than reporting -- so `lower(name), user_id` would agg to {user_id}
  -- and, without this, a divergent index could still slip through.
  if v_expr_keys > 0 then
    raise exception 'idx_members_active_gym_user has % expression key column(s) -- expected plain (gym_id, user_id)', v_expr_keys;
  end if;
end $$;
