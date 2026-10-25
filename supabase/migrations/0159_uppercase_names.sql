-- ============================================================================
-- 0159: Typed names and short labels are SAVED IN CAPITALS.
--
-- Owner decision (2026-10-25): names and short labels are always upper case on every screen, in exports and in
-- WhatsApp messages. A trigger on each column keeps every write path honest at once (dashboard, Super Admin, the CSV
-- import, RPCs, the member app), instead of trusting each form to remember:
--
--   members          name, profession, neighborhood, emergency_contact
--   users            display_name
--   gyms             name
--   plans            name
--   classes          name
--   tiers            name
--   workout_plans    name
--
-- NOT touched: emails, passwords, links, codes and phone numbers, and long free text (session notes, payment and audit
-- reasons, descriptions). The unique-name indexes already compare lower(name), so upper-casing can never create a
-- duplicate. Existing rows are converted once, below (the triggers are idempotent, so they are simply left on; this
-- was rehearsed on a populated local database without tripping any guard); audit_log is append-only and keeps what
-- it recorded.
-- Rollback: scripts/rollback-0159-uppercase-names.sql (drops the triggers; converted rows stay in capitals).
-- ============================================================================
set local lock_timeout = '5s';

create function private.uppercase_member_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := upper(new.name);
  new.profession := upper(new.profession);
  new.neighborhood := upper(new.neighborhood);
  new.emergency_contact := upper(new.emergency_contact);
  return new;
end;
$$;

create function private.uppercase_user_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.display_name := upper(new.display_name);
  return new;
end;
$$;

-- gyms, plans, classes, tiers and workout_plans all keep the label in a column called "name".
create function private.uppercase_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := upper(new.name);
  return new;
end;
$$;

revoke execute on function private.uppercase_member_text() from public, anon, authenticated;
revoke execute on function private.uppercase_user_text() from public, anon, authenticated;
revoke execute on function private.uppercase_name() from public, anon, authenticated;

create trigger uppercase_member_text
  before insert or update of name, profession, neighborhood, emergency_contact on members
  for each row execute function private.uppercase_member_text();

create trigger uppercase_user_text
  before insert or update of display_name on users
  for each row execute function private.uppercase_user_text();

create trigger uppercase_name before insert or update of name on gyms for each row execute function private.uppercase_name();
create trigger uppercase_name before insert or update of name on plans for each row execute function private.uppercase_name();
create trigger uppercase_name before insert or update of name on classes for each row execute function private.uppercase_name();
create trigger uppercase_name before insert or update of name on tiers for each row execute function private.uppercase_name();
create trigger uppercase_name before insert or update of name on workout_plans for each row execute function private.uppercase_name();

-- One-time conversion of the rows that already exist.
update members
   set name = upper(name),
       profession = upper(profession),
       neighborhood = upper(neighborhood),
       emergency_contact = upper(emergency_contact)
 where name is distinct from upper(name)
    or profession is distinct from upper(profession)
    or neighborhood is distinct from upper(neighborhood)
    or emergency_contact is distinct from upper(emergency_contact);

update users set display_name = upper(display_name) where display_name is distinct from upper(display_name);
update gyms set name = upper(name) where name is distinct from upper(name);
update plans set name = upper(name) where name is distinct from upper(name);
update classes set name = upper(name) where name is distinct from upper(name);
update tiers set name = upper(name) where name is distinct from upper(name);
update workout_plans set name = upper(name) where name is distinct from upper(name);
