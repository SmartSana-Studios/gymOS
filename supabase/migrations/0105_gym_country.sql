-- ============================================================================
-- 0105: gyms.country -- the gym's own ISO 3166-1 alpha-2 country.
--
-- Why: phone numbers are stored E.164, and a CSV import cell written in local
-- format ("670123456") has no country to be read against. The gym's country is
-- that default. It only decides how a number WITHOUT a "+" is interpreted; it
-- never rewrites a number that already carries one.
--
-- Shape: NOT NULL with a default of 'CM' (every existing gym is a Cameroon
-- pilot gym, and "CM" matches the default of every phone field in the product),
-- so the ADD COLUMN backfills existing rows in the same statement. A CHECK
-- keeps it to two upper-case letters; membership in the real ISO list is
-- enforced at write time by the Zod schema (gymSettingsSchema).
--
-- Not pinned: like timezone and default_language, an owner may change it from
-- Settings. gyms already grants UPDATE on the whole table to authenticated
-- (0002), so no grant or trigger change is needed.
-- ============================================================================

alter table gyms
  add column country text not null default 'CM'
    constraint gyms_country_iso2 check (country ~ '^[A-Z]{2}$');

comment on column gyms.country is
  'ISO 3166-1 alpha-2 country of the gym. Default region for reading phone numbers entered without a country code (CSV import).';
