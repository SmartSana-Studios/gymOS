-- Story 1.10: Bilingual (EN/FR) Platform Foundation. `users` has had RLS
-- enabled with zero policies since 0003_members_and_users.sql (deny-all) --
-- only a table-wide `grant select, insert, update, delete on users to
-- authenticated, service_role` exists, never exercised by any policy. This
-- migration is the first to let a regular authenticated session read/write
-- its own `users` row, specifically to persist FR-015's per-account language
-- preference ("persists per account across devices").

create policy "self_read_own_user" on users
  for select
  using (id = auth.uid());

create policy "self_update_own_language" on users
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- RLS is row-level, not column-level (same lesson as 0014's
-- protect_super_admin_only_gym_columns): the policy above lets a session
-- UPDATE its own row, full stop -- nothing in USING/WITH CHECK can say
-- "except this column." Left alone, a session could self-elevate
-- is_super_admin, or change its own phone (FR-023 requires admin
-- intervention for phone changes), via a raw UPDATE bypassing the app's
-- updateLanguagePreference column allow-list. A BEFORE UPDATE trigger is the
-- only mechanism that can key off row identity per-statement: for any
-- self-update (auth.uid() = the row being written), pin every column except
-- preferred_language back to its prior value. No security definer needed --
-- unlike 0014's trigger, this one only reads auth.uid() and the row already
-- in scope, no elevated privilege required (0014's own review flagged an
-- unnecessary security definer on its sibling trigger for exactly this
-- reason).
create function private.protect_self_managed_user_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() = new.id then
    new.phone := old.phone;
    new.is_super_admin := old.is_super_admin;
    new.display_name := old.display_name;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger protect_self_managed_user_columns
  before update on users
  for each row execute function private.protect_self_managed_user_columns();

-- No CHECK constraint on preferred_language's values -- mirrors the
-- existing gyms.default_language precedent (validated only by
-- gymSettingsSchema's z.enum(["en","fr"]) at the app layer, no DB-level
-- constraint). Keeps FR-018 ("supports additional languages without
-- rework") true without a migration when a third language is ever added.
