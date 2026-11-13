-- ============================================================================
-- 0169: Country and city controlled lists, gym city selection (Epic 25, Story 25.1; AD-49).
--
-- A gym's city was free text (gyms.page_city, 0161), so one city appeared under many spellings and the directory (25.2 to 25.5) could not group gyms.
-- Places become controlled lists. A gym stores a city by id; the publish gate, the snapshot and the refresh trigger read that id (AD-49).
--
--   countries(code, name_en, name_fr)   ISO 3166-1 alpha-2, 249 rows, generated from Intl.DisplayNames en / fr.
--   cities                              id, country_code, slug, name, lat / lng (both or neither, city coordinates only, never a gym's).
--                                       A city is never deleted (a trigger refuses it).
--   city_aliases                        (country_code, alias_norm) is unique, so the database refuses two cities that answer to one typed
--                                       spelling. AD-49 wins over the epic's `aliases text[]`, which cannot enforce that. The city's own
--                                       name is one row (is_name), so a name and an alias can never collide either.
--   city_slug_history                   (country_code, old_slug, city_id, expires_at = now() + 12 months). Stored here; the 301 serving is 25.5.
--                                       A new slug equal to ANOTHER city's unexpired history slug is refused.
--   gyms.city_id                        nullable, references cities(id).
--
-- Decisions (owner, 2026-11-12, and the story):
--
--  * ONE normalizer, private.place_norm(): NFC, lower, accent fold with translate(), spaces / hyphens / apostrophes collapse to one space. Aliases
--    (alias_norm), slugs (private.place_slug) and the backfill all use it. The TypeScript twin (packages/types placeNorm) gives the same output
--    on packages/types/src/fixtures/placeNormCases.json; supabase/tests/countries_cities.test.sql embeds that file and a vitest compares.
--  * Slugs are ASCII, ^[a-z0-9]+(-[a-z0-9]+)*$, 1 to 60 characters, and not in private.city_slug_reserved() (words the directory routes use).
--  * Reads: countries, cities and city_aliases are readable by `authenticated` only (no write policy, no anon, no public_site_reader). The
--    history table is not client readable. Every city write is a SECURITY DEFINER function gated by private.is_super_admin_live() and audited
--    inside the function. Typed errors are `<function>: <code>`: slug_taken, slug_reserved, invalid_slug, alias_taken, invalid_coordinates,
--    unknown_country, name_required, not_found, plus invalid_alias (an alias too long or carrying markup; the story's list had no code for it).
--  * Owner AND Supervisor may change country and city. set_gym_location(p_gym_id, p_country, p_city_id) is the only writer of gyms.city_id
--    (pinned by a trigger and a transaction-local GUC, as 0161 pins the page columns) and an additional writer of gyms.country. It has the same
--    admission as set_gym_page_content (Super Admin, or the Owner or Supervisor of THAT gym, or a live support caller through
--    private.support_rpc_gym_id / support_rpc_role; a non-Super-Admin is refused while the gym is not active), and a support allow-list row.
--  * The Owner's Settings save still writes gyms.country directly. A before-update trigger clears gyms.city_id when the country changes and the
--    city's country no longer matches, so the gate answers no_city and the refresh trigger unpublishes (AD-46 bound). It runs AFTER the
--    city_id pin (trigger names sort pin first), or the pin would undo the clear.
--  * set_gym_page_content drops its `city` key: sending it is `unknown_key`. gym_pages.content keys do not change; the snapshot's `city`
--    becomes cities.name, so a rename re-snapshots every dependent live page (a deferred constraint trigger, like the other refresh triggers).
--  * gyms.page_city is kept, unused (the 0161 pin trigger still pins it; list_gyms_without_city() shows it for hand mapping). Not dropped.
--    No gyms.country foreign key: values from the libphonenumber era may not all be ISO.
--  * Backfill: city_id is set where lower / folded page_city equals an alias_norm of the gym's own country. A miss stays null, is listed by
--    list_gyms_without_city(), and fails the gate with no_city.
--
-- Order inside this file matters (Epic 24 lesson): all DDL first, then data. A watched UPDATE of gyms queues a deferred trigger event, and an
-- ALTER / DROP / CREATE TRIGGER after it in the same transaction fails with "pending trigger events".
--
-- Seeds: countries (generated, see the values below) and twelve Cameroon starter cities with APPROXIMATE coordinates, for map dots only; the
-- Super Admin can edit them. Nothing else assumes Cameroon.
--
-- Rollback: scripts/rollback-0169-countries-cities.sql (restores the 0161, 0164, 0165, 0166 and 0167 definitions).
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- The normalizer and the slug builder. Immutable, ASCII out. Input is composed to NFC first, so "e" + U+0301 folds like "é". The character classes are spelled out (not \s) so the TypeScript twin can
-- repeat them exactly. İ (U+0130) is deliberately outside the fixture: JavaScript and Postgres lower-case it differently.
-- ----------------------------------------------------------------------------
create function private.place_norm(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select btrim(
    regexp_replace(
      translate(
        replace(replace(replace(lower(normalize(coalesce(p_text, ''), NFC)), 'æ', 'ae'), 'œ', 'oe'), 'ß', 'ss'),
        'àáâãäåāăąçćčďđèéêëēėęěğìíîïīįıłñńňòóôõöøōőŕřśšşșťţțùúûüūůűųýÿźżžÀÁÂÃÄÅĀĂĄÇĆČĎĐÈÉÊËĒĖĘĚĞÌÍÎÏĪĮIŁÑŃŇÒÓÔÕÖØŌŐŔŘŚŠŞȘŤŢȚÙÚÛÜŪŮŰŲÝŸŹŻŽ',
        'aaaaaaaaacccddeeeeeeeegiiiiiiilnnnoooooooorrsssstttuuuuuuuuyyzzzaaaaaaaaacccddeeeeeeeegiiiiiiilnnnoooooooorrsssstttuuuuuuuuyyzzz'),
      '[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff''’‘`´‐‑‒–—―_-]+', ' ', 'g'),
    ' ');
$$;

create function private.place_slug(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select btrim(
    regexp_replace(
      regexp_replace(replace(private.place_norm(p_text), ' ', '-'), '[^a-z0-9-]', '', 'g'),
      '-+', '-', 'g'),
    '-');
$$;

-- Words the directory routes (25.3, 25.5) use as a first path segment, plus language codes. A city slug equal to one is refused.
create function private.city_slug_reserved(p_slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_slug = any (array['en', 'fr', 'gyms', 'gym', 'sitemap', 'sitemap-index', 'sitemaps', 'robots', 'llms', 'index', 'page', 'pages',
                             'category', 'categories', 'api', 'admin', 'static', 'assets', 'new']);
$$;

revoke execute on function private.place_norm(text) from public, anon, authenticated, service_role;
revoke execute on function private.place_slug(text) from public, anon, authenticated, service_role;
revoke execute on function private.city_slug_reserved(text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table public.countries (
  code    text primary key check (code ~ '^[A-Z]{2}$'),
  name_en text not null check (char_length(name_en) between 1 and 100 and name_en !~ '[<>]'),
  name_fr text not null check (char_length(name_fr) between 1 and 100 and name_fr !~ '[<>]')
);

create table public.cities (
  id           uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code),
  slug         text not null
    constraint cities_slug_shape check (char_length(slug) between 1 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text not null
    constraint cities_name_shape check (char_length(name) between 1 and 100 and name = btrim(name)
                                        and name !~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]'),
  lat          numeric(9, 6),
  lng          numeric(9, 6),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint cities_country_slug_key unique (country_code, slug),
  constraint cities_coordinates_pair check ((lat is null) = (lng is null)),
  constraint cities_coordinates_range check ((lat is null or lat between -90 and 90) and (lng is null or lng between -180 and 180))
);

create index cities_country_name on public.cities (country_code, name);

create table public.city_aliases (
  id           uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code),
  alias_norm   text not null check (alias_norm <> '' and char_length(alias_norm) <= 100),
  alias        text not null check (char_length(alias) between 1 and 100),
  city_id      uuid not null references public.cities (id),
  is_name      boolean not null default false,
  constraint city_aliases_country_alias_key unique (country_code, alias_norm)
);

create index city_aliases_city on public.city_aliases (city_id);
create unique index city_aliases_one_name on public.city_aliases (city_id) where is_name;

create table public.city_slug_history (
  id           uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code),
  old_slug     text not null,
  city_id      uuid not null references public.cities (id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index city_slug_history_lookup on public.city_slug_history (country_code, old_slug, expires_at);

comment on table public.cities is
  'Controlled city list (25.1, AD-49). Written only by add_city() / update_city() (Super Admin). A city is never deleted. lat / lng are the CITY position, never a gym''s.';
comment on column public.cities.slug is
  'ASCII url slug, unique per country. A change is recorded in city_slug_history for 12 months.';
comment on table public.city_aliases is
  'Spellings that resolve to a city. alias_norm = private.place_norm(alias), unique per country. The city''s own name is the row with is_name.';
comment on table public.city_slug_history is
  'Old city slugs, kept 12 months for the 301 (served by 25.5). Not client readable.';

-- Reads: `authenticated` only. No policy admits a write, no grant gives one, and nothing is granted to anon, service_role or public_site_reader.
alter table public.countries enable row level security;
alter table public.cities enable row level security;
alter table public.city_aliases enable row level security;
alter table public.city_slug_history enable row level security;

revoke all on public.countries from public, anon, authenticated, service_role;
revoke all on public.cities from public, anon, authenticated, service_role;
revoke all on public.city_aliases from public, anon, authenticated, service_role;
revoke all on public.city_slug_history from public, anon, authenticated, service_role;

grant select on public.countries to authenticated;
grant select on public.cities to authenticated;
grant select on public.city_aliases to authenticated;

create policy countries_read on public.countries for select to authenticated using (true);
create policy cities_read on public.cities for select to authenticated using (true);
create policy city_aliases_read on public.city_aliases for select to authenticated using (true);

-- A city is never deleted: gyms point at it, directory URLs and the 301 history depend on it.
create function private.cities_refuse_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'cities: a city is never deleted';
end;
$$;

revoke execute on function private.cities_refuse_delete() from public, anon, authenticated, service_role;

create trigger cities_no_delete
  before delete on public.cities
  for each row execute function private.cities_refuse_delete();

create trigger cities_no_truncate
  before truncate on public.cities
  for each statement execute function private.cities_refuse_delete();

-- ----------------------------------------------------------------------------
-- gyms.city_id and its two before-update triggers
-- ----------------------------------------------------------------------------
alter table public.gyms add column city_id uuid references public.cities (id);
create index gyms_city_id on public.gyms (city_id) where city_id is not null;

comment on column public.gyms.city_id is
  'The gym''s city (25.1). Written only by set_gym_location(); cleared by trigger when gyms.country changes to a country the city is not in. gyms.page_city is the legacy free text, kept and unused.';

-- Pin: only the GUC set inside set_gym_location() opens it. No Super Admin or service_role exemption (as 0161).
create function private.pin_gym_city_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.gym_location_bypass', true), 'false') <> 'true' then
    new.city_id := old.city_id;
  end if;
  return new;
end;
$$;

revoke execute on function private.pin_gym_city_id() from public, anon, authenticated, service_role;

create trigger gyms_a_pin_city_id
  before update of city_id on public.gyms
  for each row execute function private.pin_gym_city_id();

-- Country change: the city goes when it is no longer in the gym's country. Sorts AFTER the pin (a_ < z_), so it has the last word.
create function private.clear_gym_city_on_country_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.country is distinct from old.country
     and new.city_id is not null
     and not exists (select 1 from public.cities c where c.id = new.city_id and c.country_code = new.country) then
    new.city_id := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.clear_gym_city_on_country_change() from public, anon, authenticated, service_role;

create trigger gyms_z_clear_city_on_country_change
  before update of country on public.gyms
  for each row execute function private.clear_gym_city_on_country_change();

-- ----------------------------------------------------------------------------
-- Seeds. Countries: ISO 3166-1 alpha-2, names from Intl.DisplayNames (en, fr).
-- ----------------------------------------------------------------------------
insert into public.countries (code, name_en, name_fr) values
  ('AD', 'Andorra', 'Andorre'),
  ('AE', 'United Arab Emirates', 'Émirats arabes unis'),
  ('AF', 'Afghanistan', 'Afghanistan'),
  ('AG', 'Antigua & Barbuda', 'Antigua-et-Barbuda'),
  ('AI', 'Anguilla', 'Anguilla'),
  ('AL', 'Albania', 'Albanie'),
  ('AM', 'Armenia', 'Arménie'),
  ('AO', 'Angola', 'Angola'),
  ('AQ', 'Antarctica', 'Antarctique'),
  ('AR', 'Argentina', 'Argentine'),
  ('AS', 'American Samoa', 'Samoa américaines'),
  ('AT', 'Austria', 'Autriche'),
  ('AU', 'Australia', 'Australie'),
  ('AW', 'Aruba', 'Aruba'),
  ('AX', 'Åland Islands', 'Îles Åland'),
  ('AZ', 'Azerbaijan', 'Azerbaïdjan'),
  ('BA', 'Bosnia & Herzegovina', 'Bosnie-Herzégovine'),
  ('BB', 'Barbados', 'Barbade'),
  ('BD', 'Bangladesh', 'Bangladesh'),
  ('BE', 'Belgium', 'Belgique'),
  ('BF', 'Burkina Faso', 'Burkina Faso'),
  ('BG', 'Bulgaria', 'Bulgarie'),
  ('BH', 'Bahrain', 'Bahreïn'),
  ('BI', 'Burundi', 'Burundi'),
  ('BJ', 'Benin', 'Bénin'),
  ('BL', 'St. Barthélemy', 'Saint-Barthélemy'),
  ('BM', 'Bermuda', 'Bermudes'),
  ('BN', 'Brunei', 'Brunei'),
  ('BO', 'Bolivia', 'Bolivie'),
  ('BQ', 'Caribbean Netherlands', 'Pays-Bas caribéens'),
  ('BR', 'Brazil', 'Brésil'),
  ('BS', 'Bahamas', 'Bahamas'),
  ('BT', 'Bhutan', 'Bhoutan'),
  ('BV', 'Bouvet Island', 'Île Bouvet'),
  ('BW', 'Botswana', 'Botswana'),
  ('BY', 'Belarus', 'Biélorussie'),
  ('BZ', 'Belize', 'Belize'),
  ('CA', 'Canada', 'Canada'),
  ('CC', 'Cocos (Keeling) Islands', 'Îles Cocos'),
  ('CD', 'Congo - Kinshasa', 'Congo-Kinshasa'),
  ('CF', 'Central African Republic', 'République centrafricaine'),
  ('CG', 'Congo - Brazzaville', 'Congo-Brazzaville'),
  ('CH', 'Switzerland', 'Suisse'),
  ('CI', 'Côte d’Ivoire', 'Côte d’Ivoire'),
  ('CK', 'Cook Islands', 'Îles Cook'),
  ('CL', 'Chile', 'Chili'),
  ('CM', 'Cameroon', 'Cameroun'),
  ('CN', 'China', 'Chine'),
  ('CO', 'Colombia', 'Colombie'),
  ('CR', 'Costa Rica', 'Costa Rica'),
  ('CU', 'Cuba', 'Cuba'),
  ('CV', 'Cape Verde', 'Cap-Vert'),
  ('CW', 'Curaçao', 'Curaçao'),
  ('CX', 'Christmas Island', 'Île Christmas'),
  ('CY', 'Cyprus', 'Chypre'),
  ('CZ', 'Czechia', 'Tchéquie'),
  ('DE', 'Germany', 'Allemagne'),
  ('DJ', 'Djibouti', 'Djibouti'),
  ('DK', 'Denmark', 'Danemark'),
  ('DM', 'Dominica', 'Dominique'),
  ('DO', 'Dominican Republic', 'République dominicaine'),
  ('DZ', 'Algeria', 'Algérie'),
  ('EC', 'Ecuador', 'Équateur'),
  ('EE', 'Estonia', 'Estonie'),
  ('EG', 'Egypt', 'Égypte'),
  ('EH', 'Western Sahara', 'Sahara occidental'),
  ('ER', 'Eritrea', 'Érythrée'),
  ('ES', 'Spain', 'Espagne'),
  ('ET', 'Ethiopia', 'Éthiopie'),
  ('FI', 'Finland', 'Finlande'),
  ('FJ', 'Fiji', 'Fidji'),
  ('FK', 'Falkland Islands', 'Îles Malouines'),
  ('FM', 'Micronesia', 'Micronésie'),
  ('FO', 'Faroe Islands', 'Îles Féroé'),
  ('FR', 'France', 'France'),
  ('GA', 'Gabon', 'Gabon'),
  ('GB', 'United Kingdom', 'Royaume-Uni'),
  ('GD', 'Grenada', 'Grenade'),
  ('GE', 'Georgia', 'Géorgie'),
  ('GF', 'French Guiana', 'Guyane française'),
  ('GG', 'Guernsey', 'Guernesey'),
  ('GH', 'Ghana', 'Ghana'),
  ('GI', 'Gibraltar', 'Gibraltar'),
  ('GL', 'Greenland', 'Groenland'),
  ('GM', 'Gambia', 'Gambie'),
  ('GN', 'Guinea', 'Guinée'),
  ('GP', 'Guadeloupe', 'Guadeloupe'),
  ('GQ', 'Equatorial Guinea', 'Guinée équatoriale'),
  ('GR', 'Greece', 'Grèce'),
  ('GS', 'South Georgia & South Sandwich Islands', 'Géorgie du Sud-et-les Îles Sandwich du Sud'),
  ('GT', 'Guatemala', 'Guatemala'),
  ('GU', 'Guam', 'Guam'),
  ('GW', 'Guinea-Bissau', 'Guinée-Bissau'),
  ('GY', 'Guyana', 'Guyana'),
  ('HK', 'Hong Kong SAR China', 'R.A.S. chinoise de Hong Kong'),
  ('HM', 'Heard & McDonald Islands', 'Îles Heard-et-MacDonald'),
  ('HN', 'Honduras', 'Honduras'),
  ('HR', 'Croatia', 'Croatie'),
  ('HT', 'Haiti', 'Haïti'),
  ('HU', 'Hungary', 'Hongrie'),
  ('ID', 'Indonesia', 'Indonésie'),
  ('IE', 'Ireland', 'Irlande'),
  ('IL', 'Israel', 'Israël'),
  ('IM', 'Isle of Man', 'Île de Man'),
  ('IN', 'India', 'Inde'),
  ('IO', 'British Indian Ocean Territory', 'Territoire britannique de l’océan Indien'),
  ('IQ', 'Iraq', 'Irak'),
  ('IR', 'Iran', 'Iran'),
  ('IS', 'Iceland', 'Islande'),
  ('IT', 'Italy', 'Italie'),
  ('JE', 'Jersey', 'Jersey'),
  ('JM', 'Jamaica', 'Jamaïque'),
  ('JO', 'Jordan', 'Jordanie'),
  ('JP', 'Japan', 'Japon'),
  ('KE', 'Kenya', 'Kenya'),
  ('KG', 'Kyrgyzstan', 'Kirghizstan'),
  ('KH', 'Cambodia', 'Cambodge'),
  ('KI', 'Kiribati', 'Kiribati'),
  ('KM', 'Comoros', 'Comores'),
  ('KN', 'St. Kitts & Nevis', 'Saint-Christophe-et-Niévès'),
  ('KP', 'North Korea', 'Corée du Nord'),
  ('KR', 'South Korea', 'Corée du Sud'),
  ('KW', 'Kuwait', 'Koweït'),
  ('KY', 'Cayman Islands', 'Îles Caïmans'),
  ('KZ', 'Kazakhstan', 'Kazakhstan'),
  ('LA', 'Laos', 'Laos'),
  ('LB', 'Lebanon', 'Liban'),
  ('LC', 'St. Lucia', 'Sainte-Lucie'),
  ('LI', 'Liechtenstein', 'Liechtenstein'),
  ('LK', 'Sri Lanka', 'Sri Lanka'),
  ('LR', 'Liberia', 'Liberia'),
  ('LS', 'Lesotho', 'Lesotho'),
  ('LT', 'Lithuania', 'Lituanie'),
  ('LU', 'Luxembourg', 'Luxembourg'),
  ('LV', 'Latvia', 'Lettonie'),
  ('LY', 'Libya', 'Libye'),
  ('MA', 'Morocco', 'Maroc'),
  ('MC', 'Monaco', 'Monaco'),
  ('MD', 'Moldova', 'Moldavie'),
  ('ME', 'Montenegro', 'Monténégro'),
  ('MF', 'St. Martin', 'Saint-Martin'),
  ('MG', 'Madagascar', 'Madagascar'),
  ('MH', 'Marshall Islands', 'Îles Marshall'),
  ('MK', 'North Macedonia', 'Macédoine du Nord'),
  ('ML', 'Mali', 'Mali'),
  ('MM', 'Myanmar (Burma)', 'Myanmar (Birmanie)'),
  ('MN', 'Mongolia', 'Mongolie'),
  ('MO', 'Macao SAR China', 'R.A.S. chinoise de Macao'),
  ('MP', 'Northern Mariana Islands', 'Îles Mariannes du Nord'),
  ('MQ', 'Martinique', 'Martinique'),
  ('MR', 'Mauritania', 'Mauritanie'),
  ('MS', 'Montserrat', 'Montserrat'),
  ('MT', 'Malta', 'Malte'),
  ('MU', 'Mauritius', 'Maurice'),
  ('MV', 'Maldives', 'Maldives'),
  ('MW', 'Malawi', 'Malawi'),
  ('MX', 'Mexico', 'Mexique'),
  ('MY', 'Malaysia', 'Malaisie'),
  ('MZ', 'Mozambique', 'Mozambique'),
  ('NA', 'Namibia', 'Namibie'),
  ('NC', 'New Caledonia', 'Nouvelle-Calédonie'),
  ('NE', 'Niger', 'Niger'),
  ('NF', 'Norfolk Island', 'Île Norfolk'),
  ('NG', 'Nigeria', 'Nigeria'),
  ('NI', 'Nicaragua', 'Nicaragua'),
  ('NL', 'Netherlands', 'Pays-Bas'),
  ('NO', 'Norway', 'Norvège'),
  ('NP', 'Nepal', 'Népal'),
  ('NR', 'Nauru', 'Nauru'),
  ('NU', 'Niue', 'Niue'),
  ('NZ', 'New Zealand', 'Nouvelle-Zélande'),
  ('OM', 'Oman', 'Oman'),
  ('PA', 'Panama', 'Panama'),
  ('PE', 'Peru', 'Pérou'),
  ('PF', 'French Polynesia', 'Polynésie française'),
  ('PG', 'Papua New Guinea', 'Papouasie-Nouvelle-Guinée'),
  ('PH', 'Philippines', 'Philippines'),
  ('PK', 'Pakistan', 'Pakistan'),
  ('PL', 'Poland', 'Pologne'),
  ('PM', 'St. Pierre & Miquelon', 'Saint-Pierre-et-Miquelon'),
  ('PN', 'Pitcairn Islands', 'Îles Pitcairn'),
  ('PR', 'Puerto Rico', 'Porto Rico'),
  ('PS', 'Palestinian Territories', 'Territoires palestiniens'),
  ('PT', 'Portugal', 'Portugal'),
  ('PW', 'Palau', 'Palaos'),
  ('PY', 'Paraguay', 'Paraguay'),
  ('QA', 'Qatar', 'Qatar'),
  ('RE', 'Réunion', 'La Réunion'),
  ('RO', 'Romania', 'Roumanie'),
  ('RS', 'Serbia', 'Serbie'),
  ('RU', 'Russia', 'Russie'),
  ('RW', 'Rwanda', 'Rwanda'),
  ('SA', 'Saudi Arabia', 'Arabie saoudite'),
  ('SB', 'Solomon Islands', 'Îles Salomon'),
  ('SC', 'Seychelles', 'Seychelles'),
  ('SD', 'Sudan', 'Soudan'),
  ('SE', 'Sweden', 'Suède'),
  ('SG', 'Singapore', 'Singapour'),
  ('SH', 'St. Helena', 'Sainte-Hélène'),
  ('SI', 'Slovenia', 'Slovénie'),
  ('SJ', 'Svalbard & Jan Mayen', 'Svalbard et Jan Mayen'),
  ('SK', 'Slovakia', 'Slovaquie'),
  ('SL', 'Sierra Leone', 'Sierra Leone'),
  ('SM', 'San Marino', 'Saint-Marin'),
  ('SN', 'Senegal', 'Sénégal'),
  ('SO', 'Somalia', 'Somalie'),
  ('SR', 'Suriname', 'Suriname'),
  ('SS', 'South Sudan', 'Soudan du Sud'),
  ('ST', 'São Tomé & Príncipe', 'Sao Tomé-et-Principe'),
  ('SV', 'El Salvador', 'Salvador'),
  ('SX', 'Sint Maarten', 'Saint-Martin (partie néerlandaise)'),
  ('SY', 'Syria', 'Syrie'),
  ('SZ', 'Eswatini', 'Eswatini'),
  ('TC', 'Turks & Caicos Islands', 'Îles Turques-et-Caïques'),
  ('TD', 'Chad', 'Tchad'),
  ('TF', 'French Southern Territories', 'Terres australes françaises'),
  ('TG', 'Togo', 'Togo'),
  ('TH', 'Thailand', 'Thaïlande'),
  ('TJ', 'Tajikistan', 'Tadjikistan'),
  ('TK', 'Tokelau', 'Tokelau'),
  ('TL', 'Timor-Leste', 'Timor oriental'),
  ('TM', 'Turkmenistan', 'Turkménistan'),
  ('TN', 'Tunisia', 'Tunisie'),
  ('TO', 'Tonga', 'Tonga'),
  ('TR', 'Türkiye', 'Turquie'),
  ('TT', 'Trinidad & Tobago', 'Trinité-et-Tobago'),
  ('TV', 'Tuvalu', 'Tuvalu'),
  ('TW', 'Taiwan', 'Taïwan'),
  ('TZ', 'Tanzania', 'Tanzanie'),
  ('UA', 'Ukraine', 'Ukraine'),
  ('UG', 'Uganda', 'Ouganda'),
  ('UM', 'U.S. Outlying Islands', 'Îles mineures éloignées des États-Unis'),
  ('US', 'United States', 'États-Unis'),
  ('UY', 'Uruguay', 'Uruguay'),
  ('UZ', 'Uzbekistan', 'Ouzbékistan'),
  ('VA', 'Vatican City', 'État de la Cité du Vatican'),
  ('VC', 'St. Vincent & Grenadines', 'Saint-Vincent-et-les Grenadines'),
  ('VE', 'Venezuela', 'Venezuela'),
  ('VG', 'British Virgin Islands', 'Îles Vierges britanniques'),
  ('VI', 'U.S. Virgin Islands', 'Îles Vierges des États-Unis'),
  ('VN', 'Vietnam', 'Viêt Nam'),
  ('VU', 'Vanuatu', 'Vanuatu'),
  ('WF', 'Wallis & Futuna', 'Wallis-et-Futuna'),
  ('WS', 'Samoa', 'Samoa'),
  ('YE', 'Yemen', 'Yémen'),
  ('YT', 'Mayotte', 'Mayotte'),
  ('ZA', 'South Africa', 'Afrique du Sud'),
  ('ZM', 'Zambia', 'Zambie'),
  ('ZW', 'Zimbabwe', 'Zimbabwe')
;

-- Cameroon starter cities. Coordinates are approximate, for map dots only (the Super Admin can edit them).
with seed(name, slug, lat, lng) as (values
  ('Douala',     'douala',     4.0511,  9.7679),
  ('Yaoundé',    'yaounde',    3.8480, 11.5021),
  ('Bafoussam',  'bafoussam',  5.4737, 10.4179),
  ('Garoua',     'garoua',     9.3014, 13.3977),
  ('Bamenda',    'bamenda',    5.9631, 10.1591),
  ('Maroua',     'maroua',    10.5910, 14.3159),
  ('Ngaoundéré', 'ngaoundere', 7.3167, 13.5833),
  ('Bertoua',    'bertoua',    4.5772, 13.6845),
  ('Limbe',      'limbe',      4.0186,  9.2064),
  ('Kribi',      'kribi',      2.9400,  9.9100),
  ('Buea',       'buea',       4.1527,  9.2410),
  ('Ebolowa',    'ebolowa',    2.9000, 11.1500)),
ins as (
  insert into public.cities (country_code, slug, name, lat, lng)
  select 'CM', s.slug, s.name, s.lat, s.lng from seed s
  returning id, country_code, name)
insert into public.city_aliases (country_code, alias_norm, alias, city_id, is_name)
select i.country_code, private.place_norm(i.name), i.name, i.id, true from ins i;

-- ----------------------------------------------------------------------------
-- Validators shared by add_city() and update_city(). Private; typed errors carry the calling function's name.
-- ----------------------------------------------------------------------------
create function private.city_name_clean(p_fn text, p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  v := btrim(regexp_replace(coalesce(p_name, ''), '[ \t\n\r\f\v\u00a0\u2000-\u200a\u202f\u205f\u3000]+', ' ', 'g'));
  if v = '' or char_length(v) > 100 or v ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' or private.place_norm(v) = '' then
    raise exception '%: name_required', p_fn;
  end if;
  return v;
end;
$$;

create function private.city_slug_check(p_fn text, p_country text, p_city_id uuid, p_slug text)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_slug is null or char_length(p_slug) not between 1 and 60 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception '%: invalid_slug', p_fn;
  end if;
  if private.city_slug_reserved(p_slug) then
    raise exception '%: slug_reserved', p_fn;
  end if;
  -- taken: another city's slug now, or another city's slug within its 12 months after a change
  if exists (select 1 from public.cities c where c.country_code = p_country and c.slug = p_slug and c.id is distinct from p_city_id)
     or exists (select 1 from public.city_slug_history h
                 where h.country_code = p_country and h.old_slug = p_slug and h.expires_at > now() and h.city_id is distinct from p_city_id) then
    raise exception '%: slug_taken', p_fn;
  end if;
end;
$$;

create function private.city_coords_check(p_fn text, p_lat numeric, p_lng numeric)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if (p_lat is null) <> (p_lng is null)
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception '%: invalid_coordinates', p_fn;
  end if;
end;
$$;

-- The typed spellings of one call: trimmed, normalized, one row per normalized form, blanks skipped.
create function private.city_alias_rows(p_fn text, p_aliases text[])
returns table (alias text, alias_norm text)
language plpgsql
stable
set search_path = public
as $$
declare
  r record;
begin
  if coalesce(cardinality(p_aliases), 0) > 50 then
    raise exception '%: invalid_alias', p_fn;
  end if;
  for r in
    select distinct on (private.place_norm(a)) btrim(a) as a_text, private.place_norm(a) as a_norm
      from unnest(coalesce(p_aliases, '{}'::text[])) as a
     where private.place_norm(a) <> ''
     order by private.place_norm(a), btrim(a)
  loop
    if char_length(r.a_text) > 100 or char_length(r.a_norm) > 100 or r.a_text ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' then
      raise exception '%: invalid_alias', p_fn;
    end if;
    alias := r.a_text;
    alias_norm := r.a_norm;
    return next;
  end loop;
end;
$$;

-- A normalized spelling that another city of the country already answers to.
create function private.city_alias_clash(p_fn text, p_country text, p_city_id uuid, p_norms text[])
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if exists (select 1 from public.city_aliases a
              where a.country_code = p_country and a.alias_norm = any (p_norms) and a.city_id is distinct from p_city_id) then
    raise exception '%: alias_taken', p_fn;
  end if;
end;
$$;

revoke execute on function private.city_name_clean(text, text) from public, anon, authenticated, service_role;
revoke execute on function private.city_slug_check(text, text, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.city_coords_check(text, numeric, numeric) from public, anon, authenticated, service_role;
revoke execute on function private.city_alias_rows(text, text[]) from public, anon, authenticated, service_role;
revoke execute on function private.city_alias_clash(text, text, uuid, text[]) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- add_city(): Super Admin (live), audited. Returns the new id. p_slug null or blank derives the slug from the name.
-- Typed errors: unknown_country, name_required, invalid_slug, slug_reserved, slug_taken, invalid_coordinates, invalid_alias, alias_taken.
-- ----------------------------------------------------------------------------
create function public.add_city(
  p_country_code text,
  p_name text,
  p_slug text default null,
  p_aliases text[] default '{}',
  p_lat numeric default null,
  p_lng numeric default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_country text;
  v_name text;
  v_norm text;
  v_slug text;
  v_lat numeric;
  v_lng numeric;
  v_id uuid;
  v_alias_texts text[] := '{}';
  v_alias_norms text[] := '{}';
  r record;
  v_constraint text;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;

  v_country := upper(btrim(coalesce(p_country_code, '')));
  if not exists (select 1 from public.countries c where c.code = v_country) then
    raise exception 'add_city: unknown_country';
  end if;

  v_name := private.city_name_clean('add_city', p_name);
  v_norm := private.place_norm(v_name);
  v_slug := coalesce(nullif(lower(btrim(coalesce(p_slug, ''))), ''), private.place_slug(v_name));

  -- One writer per country at a time, so the checks below and the inserts cannot interleave with another call.
  perform pg_advisory_xact_lock(hashtextextended('cities:' || v_country, 0));

  perform private.city_slug_check('add_city', v_country, null, v_slug);

  v_lat := round(p_lat, 6);
  v_lng := round(p_lng, 6);
  perform private.city_coords_check('add_city', v_lat, v_lng);

  for r in select * from private.city_alias_rows('add_city', p_aliases) loop
    if r.alias_norm <> v_norm then
      v_alias_texts := v_alias_texts || r.alias;
      v_alias_norms := v_alias_norms || r.alias_norm;
    end if;
  end loop;
  perform private.city_alias_clash('add_city', v_country, null, array_append(v_alias_norms, v_norm));

  begin
    insert into public.cities (country_code, slug, name, lat, lng)
    values (v_country, v_slug, v_name, v_lat, v_lng)
    returning id into v_id;

    insert into public.city_aliases (country_code, alias_norm, alias, city_id, is_name)
    values (v_country, v_norm, v_name, v_id, true);

    insert into public.city_aliases (country_code, alias_norm, alias, city_id)
    select v_country, n, t, v_id from unnest(v_alias_norms, v_alias_texts) as u(n, t);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'cities_country_slug_key' then
      raise exception 'add_city: slug_taken';
    end if;
    raise exception 'add_city: alias_taken';
  end;

  perform log_audit_event(
    p_action_type => 'city_added',
    p_target_entity_id => v_id::text,
    p_target_entity_type => 'city',
    p_metadata => jsonb_build_object('country_code', v_country, 'name', v_name, 'slug', v_slug,
                                     'aliases', to_jsonb(v_alias_texts), 'lat', v_lat, 'lng', v_lng)
  );

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- update_city(): Super Admin (live), audited. The modal sends the whole form, so lat / lng null clear the position; a null p_slug keeps the
-- slug and a null p_aliases keeps the aliases. The country never changes. A renamed city keeps its old name as an alias. A changed slug
-- stores the old one in city_slug_history for 12 months. No gym's city_id is touched. Unchanged input returns without writing or auditing.
-- Typed errors: not_found, name_required, invalid_slug, slug_reserved, slug_taken, invalid_coordinates, invalid_alias, alias_taken.
-- ----------------------------------------------------------------------------
create function public.update_city(
  p_city_id uuid,
  p_name text,
  p_slug text default null,
  p_aliases text[] default null,
  p_lat numeric default null,
  p_lng numeric default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_country text;
  v_city public.cities%rowtype;
  v_name text;
  v_norm text;
  v_old_norm text;
  v_slug text;
  v_lat numeric;
  v_lng numeric;
  v_cur_norms text[];
  v_cur_aliases text[];
  v_d_texts text[] := '{}';
  v_d_norms text[] := '{}';
  r record;
  i integer;
  v_constraint text;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    raise exception 'permission denied';
  end if;

  select c.country_code into v_country from public.cities c where c.id = p_city_id;
  if not found then
    raise exception 'update_city: not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cities:' || v_country, 0));

  select * into v_city from public.cities c where c.id = p_city_id for update;
  if not found then
    raise exception 'update_city: not_found';
  end if;

  v_name := private.city_name_clean('update_city', p_name);
  v_norm := private.place_norm(v_name);
  select a.alias_norm into v_old_norm from public.city_aliases a where a.city_id = p_city_id and a.is_name;

  v_slug := coalesce(nullif(lower(btrim(coalesce(p_slug, ''))), ''), v_city.slug);
  if v_slug is distinct from v_city.slug then
    perform private.city_slug_check('update_city', v_country, p_city_id, v_slug);
  end if;

  v_lat := round(p_lat, 6);
  v_lng := round(p_lng, 6);
  perform private.city_coords_check('update_city', v_lat, v_lng);

  select coalesce(array_agg(a.alias_norm order by a.alias_norm), '{}'), coalesce(array_agg(a.alias order by a.alias_norm), '{}')
    into v_cur_norms, v_cur_aliases
    from public.city_aliases a where a.city_id = p_city_id and not a.is_name;

  -- the explicit aliases the city will have: the given list (or the current one), the old name after a rename, never the new name itself
  if p_aliases is null then
    for i in 1 .. coalesce(cardinality(v_cur_norms), 0) loop
      if v_cur_norms[i] <> v_norm then
        v_d_norms := v_d_norms || v_cur_norms[i];
        v_d_texts := v_d_texts || v_cur_aliases[i];
      end if;
    end loop;
  else
    for r in select * from private.city_alias_rows('update_city', p_aliases) loop
      if r.alias_norm <> v_norm then
        v_d_norms := v_d_norms || r.alias_norm;
        v_d_texts := v_d_texts || r.alias;
      end if;
    end loop;
  end if;
  if v_old_norm is distinct from v_norm and v_old_norm <> v_norm and not (v_old_norm = any (v_d_norms)) then
    v_d_norms := v_d_norms || v_old_norm;
    v_d_texts := v_d_texts || v_city.name;
  end if;
  perform private.city_alias_clash('update_city', v_country, p_city_id, array_append(v_d_norms, v_norm));

  if v_name = v_city.name
     and v_slug = v_city.slug
     and v_lat is not distinct from v_city.lat
     and v_lng is not distinct from v_city.lng
     and (select coalesce(array_agg(n order by n), '{}') from unnest(v_d_norms) n) = v_cur_norms then
    return;
  end if;

  begin
    if v_slug <> v_city.slug then
      insert into public.city_slug_history (country_code, old_slug, city_id, expires_at)
      values (v_country, v_city.slug, p_city_id, now() + interval '12 months');
      -- coming back to an old slug of its own: it is live again, so its history row goes
      delete from public.city_slug_history h where h.city_id = p_city_id and h.country_code = v_country and h.old_slug = v_slug;
    end if;

    delete from public.city_aliases a where a.city_id = p_city_id and not a.is_name and not (a.alias_norm = any (v_d_norms));
    update public.city_aliases a set alias = v_name, alias_norm = v_norm where a.city_id = p_city_id and a.is_name;
    insert into public.city_aliases (country_code, alias_norm, alias, city_id)
    select v_country, n, t, p_city_id from unnest(v_d_norms, v_d_texts) as u(n, t)
    on conflict (country_code, alias_norm) do nothing;

    update public.cities c
       set name = v_name, slug = v_slug, lat = v_lat, lng = v_lng, updated_at = now()
     where c.id = p_city_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'cities_country_slug_key' then
      raise exception 'update_city: slug_taken';
    end if;
    raise exception 'update_city: alias_taken';
  end;

  perform log_audit_event(
    p_action_type => 'city_updated',
    p_target_entity_id => p_city_id::text,
    p_target_entity_type => 'city',
    p_metadata => jsonb_build_object(
      'country_code', v_country,
      'old', jsonb_build_object('name', v_city.name, 'slug', v_city.slug, 'lat', v_city.lat, 'lng', v_city.lng, 'aliases', to_jsonb(v_cur_aliases)),
      'new', jsonb_build_object('name', v_name, 'slug', v_slug, 'lat', v_lat, 'lng', v_lng, 'aliases', to_jsonb(v_d_texts)))
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- list_gyms_without_city(): Super Admin (live). The gyms that carry legacy free text but no city, for hand mapping. Read-only, capped at 1000.
-- This is one of the two functions allowed to read gyms.page_city (a test enumerates them).
-- ----------------------------------------------------------------------------
create function public.list_gyms_without_city()
returns table (gym_id uuid, gym_name text, country text, page_city text)
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
    select g.id, g.name::text, g.country, g.page_city
      from public.gyms g
     where g.city_id is null
       and g.page_city is not null
     order by g.name, g.id
     limit 1000;
end;
$$;

-- ----------------------------------------------------------------------------
-- set_gym_location(): the only writer of gyms.city_id and an additional writer of gyms.country.
-- Admission is set_gym_page_content()'s (0161): a Super Admin, or the Owner or Supervisor of THAT gym, or a live support caller through
-- private.support_rpc_gym_id / support_rpc_role. A non-Super-Admin is refused while the gym is not active.
-- p_country must be in `countries`; p_city_id null clears the city, otherwise the city must belong to p_country.
-- Typed errors: unknown_country, invalid_city. Unchanged input returns without writing or logging.
-- ----------------------------------------------------------------------------
create function public.set_gym_location(p_gym_id uuid, p_country text, p_city_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_is_super_admin boolean;
  v_gym public.gyms%rowtype;
  v_country text;
  v_city public.cities%rowtype;
  v_old_city text;
begin
  v_is_super_admin := coalesce(private.is_super_admin_live(), false);

  if not v_is_super_admin then
    if p_gym_id is null
       or p_gym_id is distinct from private.support_rpc_gym_id('set_gym_location')
       or not coalesce(private.support_rpc_role('set_gym_location') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  if p_gym_id is null then
    raise exception 'set_gym_location: gym not found';
  end if;

  select * into v_gym from public.gyms g where g.id = p_gym_id for update;
  if not found then
    raise exception 'set_gym_location: gym not found';
  end if;

  if not v_is_super_admin and private.current_gym_status() is distinct from 'active' then
    raise exception 'set_gym_location: gym % is not active', p_gym_id;
  end if;

  v_country := upper(btrim(coalesce(p_country, '')));
  if not exists (select 1 from public.countries c where c.code = v_country) then
    raise exception 'set_gym_location: unknown_country';
  end if;

  if p_city_id is not null then
    select * into v_city from public.cities c where c.id = p_city_id;
    if not found or v_city.country_code <> v_country then
      raise exception 'set_gym_location: invalid_city';
    end if;
  end if;

  if v_gym.country is not distinct from v_country and v_gym.city_id is not distinct from p_city_id then
    return;
  end if;

  select c.name into v_old_city from public.cities c where c.id = v_gym.city_id;

  perform set_config('app.gym_location_bypass', 'true', true);
  update public.gyms set country = v_country, city_id = p_city_id where id = p_gym_id;
  perform set_config('app.gym_location_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'gym_location_updated',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object(
      'old', jsonb_build_object('country', v_gym.country, 'city_id', v_gym.city_id, 'city', v_old_city),
      'new', jsonb_build_object('country', v_country, 'city_id', p_city_id, 'city', v_city.name))
  );
end;
$$;

revoke execute on function public.add_city(text, text, text, text[], numeric, numeric) from public, anon;
revoke execute on function public.update_city(uuid, text, text, text[], numeric, numeric) from public, anon;
revoke execute on function public.list_gyms_without_city() from public, anon;
revoke execute on function public.set_gym_location(uuid, text, uuid) from public, anon;
grant execute on function public.add_city(text, text, text, text[], numeric, numeric) to authenticated;
grant execute on function public.update_city(uuid, text, text, text[], numeric, numeric) to authenticated;
grant execute on function public.list_gyms_without_city() to authenticated;
grant execute on function public.set_gym_location(uuid, text, uuid) to authenticated;

-- Support: the Owner / Supervisor ceiling, like set_gym_page_content. A live support caller may write only the audit type this produces (23.10).
insert into private.support_capabilities (capability, kind, object_name) values
  ('gym_page', 'rpc', 'set_gym_location');
insert into private.support_audit_actions (action_type) values ('gym_location_updated') on conflict do nothing;

-- ----------------------------------------------------------------------------
-- A city rename or slug change re-snapshots the pages of its gyms (a deferred constraint trigger, like the other refresh triggers).
-- refresh_gym_page() only touches a LIVE page and writes only when the snapshot really changed.
-- ----------------------------------------------------------------------------
create function private.gym_page_refresh_from_city()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select g.id from public.gyms g where g.city_id = new.id order by g.id loop
    perform private.refresh_gym_page(r.id);
  end loop;
  return null;
end;
$$;

revoke execute on function private.gym_page_refresh_from_city() from public, anon, authenticated, service_role;

create constraint trigger gym_page_refresh_city
  after update of name, slug on public.cities
  deferrable initially deferred
  for each row
  when (old.name is distinct from new.name or old.slug is distinct from new.slug)
  execute function private.gym_page_refresh_from_city();

-- ============================================================================
-- Redefinitions: the gate, the snapshot, the status reader and the setter move from page_city (text) to city_id.
-- Each is the latest definition (named below) with only the city lines changed; `create or replace` keeps the grants, which are stated again.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The snapshot builder: 0166's, with `city` = cities.name. The key list does not change.
-- ----------------------------------------------------------------------------
create or replace function private.gym_page_snapshot(p_gym_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
           'name', g.name,
           'default_language', case when g.default_language = any (private.gym_page_languages())
                                    then g.default_language else (private.gym_page_languages())[1] end,
           'about_en', case when private.gym_page_lang_complete(g.page_about_en) then g.page_about_en end,
           'about_fr', case when private.gym_page_lang_complete(g.page_about_fr) then g.page_about_fr end,
           'services_en', case when private.gym_page_lang_complete(g.page_about_en) then g.page_services_en end,
           'services_fr', case when private.gym_page_lang_complete(g.page_about_fr) then g.page_services_fr end,
           'address', g.page_address,
           'city', (select c.name from public.cities c where c.id = g.city_id),
           'country', g.country,
           'category', g.category,
           'map', case when g.page_lat is not null and g.page_lng is not null
                       then jsonb_build_object('lat', g.page_lat, 'lng', g.page_lng) end,
           'contact', case when g.page_contact_phone is not null or g.page_contact_whatsapp is not null
                           then jsonb_build_object('phone', g.page_contact_phone, 'whatsapp', g.page_contact_whatsapp) end,
           'color', case when g.primary_color ~ '^#[0-9a-fA-F]{6}$' then g.primary_color end,
           'logo', (select m.derivative_key from gym_page_media m
                     where m.gym_id = g.id and m.kind = 'logo' and m.deleted_at is null
                     order by m.created_at desc, m.id limit 1),
           'banner', (select m.derivative_key from gym_page_media m
                       where m.gym_id = g.id and m.kind = 'banner' and m.deleted_at is null
                       order by m.created_at desc, m.id limit 1),
           'gallery', (select jsonb_agg(m.derivative_key order by m.sort_order, m.created_at, m.id) from gym_page_media m
                        where m.gym_id = g.id and m.kind = 'gallery' and m.deleted_at is null),
           'plans', (select jsonb_agg(jsonb_build_object(
                              'name', p.name,
                              'label_en', coalesce(p.public_label_en, p.name),
                              'label_fr', coalesce(p.public_label_fr, p.name),
                              'type', p.plan_type::text,
                              'price', p.price,
                              'currency', p.currency,
                              'interval', p.billing_interval::text,
                              'duration_days', p.duration_days) order by p.price, p.name, p.id)
                       from plans p where p.gym_id = g.id and p.is_public)
         ))
         || case when g.page_hours is not null then jsonb_build_object('hours', g.page_hours) else '{}'::jsonb end
    from gyms g
   where g.id = p_gym_id;
$$;

revoke execute on function private.gym_page_snapshot(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The gate: 0164's. `no_city` now means "no city of the gym's country is selected". The text check (`bad_text`) reads the city's name.
-- The order of the codes and every other test are unchanged.
-- ----------------------------------------------------------------------------
create or replace function private.gym_page_gate_missing(p_gym_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym gyms%rowtype;
  v_missing text[] := '{}';
  v_text text;
begin
  select * into v_gym from gyms g where g.id = p_gym_id;
  if not found then
    raise exception 'gym_page_gate_missing: gym not found';
  end if;

  if not exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.state = 'active' and pn.taken_down_at is null) then
    v_missing := array_append(v_missing, 'no_name');
  end if;
  if nullif(btrim(v_gym.category), '') is null then
    v_missing := array_append(v_missing, 'no_category');
  end if;
  if not exists (select 1 from gym_page_media m where m.gym_id = p_gym_id and m.kind = 'logo' and m.deleted_at is null) then
    v_missing := array_append(v_missing, 'no_logo');
  end if;
  if not exists (select 1 from gym_page_media m where m.gym_id = p_gym_id and m.kind = 'banner' and m.deleted_at is null) then
    v_missing := array_append(v_missing, 'no_banner');
  end if;
  if greatest(private.gym_page_trimmed_length(v_gym.page_about_en), private.gym_page_trimmed_length(v_gym.page_about_fr)) < 100 then
    v_missing := array_append(v_missing, 'about_short');
  end if;
  if nullif(btrim(v_gym.country), '') is null then
    v_missing := array_append(v_missing, 'no_country');
  end if;
  -- 25.1: the city is the controlled one, and it must be in the gym's country (the country-change trigger keeps that true; this is the belt)
  if not exists (select 1 from public.cities c where c.id = v_gym.city_id and c.country_code = v_gym.country) then
    v_missing := array_append(v_missing, 'no_city');
  end if;
  if v_gym.page_contact_phone is null and v_gym.page_contact_whatsapp is null then
    v_missing := array_append(v_missing, 'no_contact');
  end if;
  if v_gym.page_hours is null
     or jsonb_typeof(v_gym.page_hours) <> 'object'
     or not exists (select 1 from jsonb_each(v_gym.page_hours) h where jsonb_typeof(h.value) = 'object') then
    v_missing := array_append(v_missing, 'no_hours');
  end if;
  if not exists (select 1 from plans p where p.gym_id = p_gym_id and p.is_public) then
    v_missing := array_append(v_missing, 'no_public_plan');
  end if;
  if (v_gym.page_lat is null) is distinct from (v_gym.page_lng is null) then
    v_missing := array_append(v_missing, 'map_incomplete');
  end if;

  -- every text that reaches the snapshot: no control character other than newline and tab, and no angle bracket
  v_text := concat_ws(' ', v_gym.name, v_gym.page_about_en, v_gym.page_about_fr, v_gym.page_services_en, v_gym.page_services_fr,
                      v_gym.page_address,
                      (select c.name from public.cities c where c.id = v_gym.city_id));
  if v_text ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]'
     or exists (select 1 from plans p
                 where p.gym_id = p_gym_id and p.is_public
                   and concat_ws(' ', p.name, p.public_label_en, p.public_label_fr) ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]') then
    v_missing := array_append(v_missing, 'bad_text');
  end if;

  -- the content CHECK caps the snapshot at 64 KiB; a page that would not fit is not publishable (and never raises from a trigger)
  if octet_length(private.gym_page_snapshot(p_gym_id)::text) > 65000 then
    v_missing := array_append(v_missing, 'too_large');
  end if;

  return v_missing;
end;
$$;

revoke execute on function private.gym_page_gate_missing(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Which text fields would make the gate answer `bad_text`: 0165's, with `city` read from the city's name.
-- ----------------------------------------------------------------------------
create or replace function private.gym_page_bad_text_fields(p_gym_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym gyms%rowtype;
  v_out jsonb := '[]'::jsonb;
  v_lang text;
  v_json jsonb;
  r record;
begin
  select * into v_gym from gyms g where g.id = p_gym_id;
  if not found then
    return v_out;
  end if;
  v_json := to_jsonb(v_gym);

  if v_gym.name ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' then
    v_out := v_out || jsonb_build_object('field', 'gym_name');
  end if;
  foreach v_lang in array private.gym_page_languages() loop
    if (v_json ->> ('page_about_' || v_lang)) ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' then
      v_out := v_out || jsonb_build_object('field', 'about', 'lang', v_lang);
    end if;
    if (v_json ->> ('page_services_' || v_lang)) ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' then
      v_out := v_out || jsonb_build_object('field', 'services', 'lang', v_lang);
    end if;
  end loop;
  if v_gym.page_address ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' then
    v_out := v_out || jsonb_build_object('field', 'address');
  end if;
  if (select c.name from public.cities c where c.id = v_gym.city_id) ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' then
    v_out := v_out || jsonb_build_object('field', 'city');
  end if;
  for r in
    select p.name from plans p
     where p.gym_id = p_gym_id and p.is_public
       and concat_ws(' ', p.name, p.public_label_en, p.public_label_fr) ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]'
     order by p.price, p.name, p.id
  loop
    v_out := v_out || jsonb_build_object('field', 'plan_name', 'plan_name', r.name);
  end loop;
  return v_out;
end;
$$;

revoke execute on function private.gym_page_bad_text_fields(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- get_gym_page_status(): 0167's. The only change: "the Owner has started the page" counts a selected city, not legacy text.
-- ----------------------------------------------------------------------------
create or replace function public.get_gym_page_status(p_gym_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym gyms%rowtype;
  v_gp gym_pages%rowtype;
  v_has_page boolean;
  v_missing text[];
  v_reasons text[] := '{}';
  v_live boolean;
  v_taken boolean;
  v_has_name boolean;
  v_started boolean;
  v_state text;
  v_json jsonb;
  v_lang text;
  v_langs jsonb := '[]'::jsonb;
  v_chars integer;
  v_media jsonb;
  v_td private.page_takedowns%rowtype;
  v_ap private.page_appeals%rowtype;
  v_reason_code text;
  v_appeal jsonb := null;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    if p_gym_id is null
       or p_gym_id is distinct from private.support_rpc_gym_id('get_gym_page_status')
       or not coalesce(private.support_rpc_role('get_gym_page_status') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  select * into v_gym from gyms g where g.id = p_gym_id;
  if not found then
    raise exception 'get_gym_page_status: gym not found';
  end if;

  select * into v_gp from gym_pages gp where gp.gym_id = p_gym_id;
  v_has_page := found;

  v_missing := private.gym_page_gate_missing(p_gym_id);
  v_json := to_jsonb(v_gym);

  if v_has_page and v_gp.unpublished_reason is not null then
    v_reasons := string_to_array(v_gp.unpublished_reason, ',');
  end if;

  v_live := v_has_page and v_gp.published_at is not null and v_gp.unpublished_at is null;
  v_taken := (v_has_page and v_gp.taken_down_at is not null)
             or exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.taken_down_at is not null and pn.state in ('active', 'held', 'reserved'));
  v_has_name := exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.state = 'active' and pn.taken_down_at is null);

  v_started := v_gym.page_about_en is not null or v_gym.page_about_fr is not null
               or v_gym.page_services_en is not null or v_gym.page_services_fr is not null
               or v_gym.page_address is not null or v_gym.city_id is not null
               or v_gym.page_lat is not null or v_gym.page_lng is not null or v_gym.page_hours is not null
               or v_gym.page_contact_phone is not null or v_gym.page_contact_whatsapp is not null
               or v_has_page
               or exists (select 1 from plans p where p.gym_id = p_gym_id and p.is_public)
               or exists (select 1 from gym_page_media m where m.gym_id = p_gym_id and m.deleted_at is null)
               or exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.state in ('held', 'active', 'reserved'));

  v_state := case
    when v_taken then 'taken_down'
    when v_live and v_gym.status = 'active' then 'published'
    when v_live then 'offline_suspended'
    when v_has_page and v_gp.published_at is not null and v_gp.unpublished_at is not null
         and v_reasons = array['name_released'] and not v_has_name then 'offline_name_released'
    when v_has_page and v_gp.published_at is not null and v_gp.unpublished_at is not null
         and v_reasons <> array['owner'] and v_reasons <> array['name_released'] and v_reasons && v_missing then 'offline_gate'
    when not v_started then 'not_started'
    when cardinality(v_missing) = 0 then 'ready'
    else 'in_progress'
  end;

  if v_taken then
    v_reason_code := v_gp.taken_down_reason;
    select * into v_td from private.page_takedowns t where t.gym_id = p_gym_id and t.lifted_at is null;
    if found then
      v_reason_code := coalesce(v_reason_code, v_td.reason);
      select * into v_ap from private.page_appeals a where a.takedown_id = v_td.id;
      v_appeal := jsonb_build_object(
        'state', case when v_ap.id is null then 'none' when v_ap.decision is null then 'open' else v_ap.decision end,
        'submitted_at', v_ap.created_at,
        'decided_at', v_ap.decided_at,
        'decision_reason', v_ap.decision_reason);
    else
      v_appeal := jsonb_build_object('state', 'none', 'submitted_at', null, 'decided_at', null, 'decision_reason', null);
    end if;
  end if;

  foreach v_lang in array private.gym_page_languages() loop
    v_chars := private.gym_page_trimmed_length(v_json ->> ('page_about_' || v_lang));
    v_langs := v_langs || jsonb_build_object(
      'code', v_lang,
      'complete', private.gym_page_lang_complete(v_json ->> ('page_about_' || v_lang)),
      'characters', v_chars,
      'needed', greatest(0, 100 - v_chars));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'derivative_key', m.derivative_key, 'sort_order', m.sort_order)
                            order by m.kind, m.sort_order, m.created_at, m.id), '[]'::jsonb)
    into v_media
    from gym_page_media m
   where m.gym_id = p_gym_id and m.deleted_at is null;

  return jsonb_build_object(
    'state', v_state,
    'template', case when v_has_page then v_gp.template end,
    'published_at', case when v_live then v_gp.published_at end,
    'unpublished_reasons', to_jsonb(v_reasons),
    'missing', to_jsonb(v_missing),
    'bad_text_fields', private.gym_page_bad_text_fields(p_gym_id),
    'about_min_chars', 100,
    'languages', v_langs,
    'media', v_media,
    'snapshot', private.gym_page_snapshot(p_gym_id),
    'taken_down_reason', case when v_taken then v_reason_code end,
    'appeal', v_appeal
  );
end;
$$;

revoke execute on function public.get_gym_page_status(uuid) from public, anon;
grant execute on function public.get_gym_page_status(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- set_gym_page_content(): 0161's without the `city` key (a city is chosen with set_gym_location()). `city` is now `unknown_key`.
-- ----------------------------------------------------------------------------
create or replace function set_gym_page_content(p_gym_id uuid, p_content jsonb, p_plans jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super_admin boolean;
  v_gym gyms%rowtype;
  v_key text;
  v_item jsonb;
  v_plan plans%rowtype;
  v_seen uuid[] := '{}';
  v_plan_id uuid;
  v_new_pub boolean;
  v_new_en text;
  v_new_fr text;
  v_plan_changes jsonb := '[]'::jsonb;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  -- new values, starting from the stored ones
  n_about_en text; n_about_fr text; n_services_en text; n_services_fr text;
  n_address text; n_lat numeric; n_lng numeric; n_hours jsonb;
  n_phone text; n_whatsapp text;
  v_plan_updates jsonb[] := '{}';
  v_u jsonb;
begin
  v_is_super_admin := coalesce(private.is_super_admin_live(), false);

  if not v_is_super_admin then
    if p_gym_id is null
       or p_gym_id is distinct from private.support_rpc_gym_id('set_gym_page_content')
       or not coalesce(private.support_rpc_role('set_gym_page_content') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  if p_gym_id is null then
    raise exception 'set_gym_page_content: gym not found';
  end if;

  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'set_gym_page_content: invalid_content';
  end if;
  if p_plans is not null and jsonb_typeof(p_plans) <> 'array' then
    raise exception 'set_gym_page_content: invalid_plans';
  end if;

  for v_key in select jsonb_object_keys(p_content) loop
    if v_key not in ('about_en', 'about_fr', 'services_en', 'services_fr', 'address', 'lat', 'lng',
                     'hours', 'contact_phone', 'contact_whatsapp') then
      raise exception 'set_gym_page_content: unknown_key %', v_key;
    end if;
  end loop;

  select * into v_gym from gyms g where g.id = p_gym_id for update;

  if not found then
    raise exception 'set_gym_page_content: gym not found';
  end if;

  if not v_is_super_admin and private.current_gym_status() is distinct from 'active' then
    raise exception 'set_gym_page_content: gym % is not active', p_gym_id;
  end if;

  n_about_en := v_gym.page_about_en;       n_about_fr := v_gym.page_about_fr;
  n_services_en := v_gym.page_services_en; n_services_fr := v_gym.page_services_fr;
  n_address := v_gym.page_address;         n_lat := v_gym.page_lat;       n_lng := v_gym.page_lng;
  n_hours := v_gym.page_hours;             n_phone := v_gym.page_contact_phone;
  n_whatsapp := v_gym.page_contact_whatsapp;

  if p_content ? 'about_en' then n_about_en := private.gym_page_text(p_content, 'about_en', 2000); end if;
  if p_content ? 'about_fr' then n_about_fr := private.gym_page_text(p_content, 'about_fr', 2000); end if;
  if p_content ? 'services_en' then n_services_en := private.gym_page_text(p_content, 'services_en', 2000); end if;
  if p_content ? 'services_fr' then n_services_fr := private.gym_page_text(p_content, 'services_fr', 2000); end if;
  if p_content ? 'address' then n_address := private.gym_page_text(p_content, 'address', 300); end if;
  if p_content ? 'lat' then n_lat := private.gym_page_coord(p_content, 'lat', 90); end if;
  if p_content ? 'lng' then n_lng := private.gym_page_coord(p_content, 'lng', 180); end if;
  if p_content ? 'contact_phone' then n_phone := private.gym_page_phone(p_content, 'contact_phone'); end if;
  if p_content ? 'contact_whatsapp' then n_whatsapp := private.gym_page_phone(p_content, 'contact_whatsapp'); end if;
  if p_content ? 'hours' then
    if jsonb_typeof(p_content -> 'hours') = 'null' then
      n_hours := null;
    elsif private.gym_page_hours_valid(p_content -> 'hours') then
      n_hours := p_content -> 'hours';
    else
      raise exception 'set_gym_page_content: invalid_hours';
    end if;
  end if;

  -- plans: validate everything before writing anything
  if p_plans is not null then
    for v_item in select * from jsonb_array_elements(p_plans) loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'set_gym_page_content: invalid_plans';
      end if;
      for v_key in select jsonb_object_keys(v_item) loop
        if v_key not in ('plan_id', 'is_public', 'public_label_en', 'public_label_fr') then
          raise exception 'set_gym_page_content: unknown_plan_key %', v_key;
        end if;
      end loop;
      if jsonb_typeof(v_item -> 'plan_id') is distinct from 'string'
         or (v_item ->> 'plan_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'set_gym_page_content: invalid_plan_id';
      end if;
      v_plan_id := (v_item ->> 'plan_id')::uuid;
      if v_plan_id = any (v_seen) then
        raise exception 'set_gym_page_content: duplicate_plan_id';
      end if;
      v_seen := v_seen || v_plan_id;

      select * into v_plan from plans p where p.id = v_plan_id and p.gym_id = p_gym_id for update;
      if not found then
        raise exception 'set_gym_page_content: plan_not_in_gym';
      end if;

      v_new_pub := v_plan.is_public;
      v_new_en := v_plan.public_label_en;
      v_new_fr := v_plan.public_label_fr;
      if v_item ? 'is_public' then
        if jsonb_typeof(v_item -> 'is_public') <> 'boolean' then
          raise exception 'set_gym_page_content: invalid_is_public';
        end if;
        v_new_pub := (v_item ->> 'is_public')::boolean;
      end if;
      if v_item ? 'public_label_en' then v_new_en := private.gym_page_text(v_item, 'public_label_en', 80); end if;
      if v_item ? 'public_label_fr' then v_new_fr := private.gym_page_text(v_item, 'public_label_fr', 80); end if;

      if v_new_pub is distinct from v_plan.is_public
         or v_new_en is distinct from v_plan.public_label_en
         or v_new_fr is distinct from v_plan.public_label_fr then
        v_plan_updates := v_plan_updates || jsonb_build_object(
          'plan_id', v_plan_id, 'is_public', v_new_pub, 'label_en', v_new_en, 'label_fr', v_new_fr);
        v_plan_changes := v_plan_changes || jsonb_build_object(
          'plan_id', v_plan_id,
          'old', jsonb_build_object('is_public', v_plan.is_public, 'public_label_en', v_plan.public_label_en, 'public_label_fr', v_plan.public_label_fr),
          'new', jsonb_build_object('is_public', v_new_pub, 'public_label_en', v_new_en, 'public_label_fr', v_new_fr));
      end if;
    end loop;
  end if;

  -- changed gym fields, old and new
  if n_about_en is distinct from v_gym.page_about_en then
    v_old := v_old || jsonb_build_object('about_en', v_gym.page_about_en); v_new := v_new || jsonb_build_object('about_en', n_about_en); end if;
  if n_about_fr is distinct from v_gym.page_about_fr then
    v_old := v_old || jsonb_build_object('about_fr', v_gym.page_about_fr); v_new := v_new || jsonb_build_object('about_fr', n_about_fr); end if;
  if n_services_en is distinct from v_gym.page_services_en then
    v_old := v_old || jsonb_build_object('services_en', v_gym.page_services_en); v_new := v_new || jsonb_build_object('services_en', n_services_en); end if;
  if n_services_fr is distinct from v_gym.page_services_fr then
    v_old := v_old || jsonb_build_object('services_fr', v_gym.page_services_fr); v_new := v_new || jsonb_build_object('services_fr', n_services_fr); end if;
  if n_address is distinct from v_gym.page_address then
    v_old := v_old || jsonb_build_object('address', v_gym.page_address); v_new := v_new || jsonb_build_object('address', n_address); end if;
  if n_lat is distinct from v_gym.page_lat then
    v_old := v_old || jsonb_build_object('lat', v_gym.page_lat); v_new := v_new || jsonb_build_object('lat', n_lat); end if;
  if n_lng is distinct from v_gym.page_lng then
    v_old := v_old || jsonb_build_object('lng', v_gym.page_lng); v_new := v_new || jsonb_build_object('lng', n_lng); end if;
  if n_hours is distinct from v_gym.page_hours then
    v_old := v_old || jsonb_build_object('hours', v_gym.page_hours); v_new := v_new || jsonb_build_object('hours', n_hours); end if;
  if n_phone is distinct from v_gym.page_contact_phone then
    v_old := v_old || jsonb_build_object('contact_phone', v_gym.page_contact_phone); v_new := v_new || jsonb_build_object('contact_phone', n_phone); end if;
  if n_whatsapp is distinct from v_gym.page_contact_whatsapp then
    v_old := v_old || jsonb_build_object('contact_whatsapp', v_gym.page_contact_whatsapp); v_new := v_new || jsonb_build_object('contact_whatsapp', n_whatsapp); end if;

  if v_new = '{}'::jsonb and jsonb_array_length(v_plan_changes) = 0 then
    return;
  end if;

  perform set_config('app.gym_page_content_bypass', 'true', true);

  if v_new <> '{}'::jsonb then
    update gyms set
      page_about_en = n_about_en, page_about_fr = n_about_fr,
      page_services_en = n_services_en, page_services_fr = n_services_fr,
      page_address = n_address, page_lat = n_lat, page_lng = n_lng, page_hours = n_hours,
      page_contact_phone = n_phone, page_contact_whatsapp = n_whatsapp
    where id = p_gym_id;
  end if;

  foreach v_u in array v_plan_updates loop
    update plans set
      is_public = (v_u ->> 'is_public')::boolean,
      public_label_en = v_u ->> 'label_en',
      public_label_fr = v_u ->> 'label_fr'
    where id = (v_u ->> 'plan_id')::uuid and gym_id = p_gym_id;
  end loop;

  perform set_config('app.gym_page_content_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'gym_page_content_changed',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old', v_old, 'new', v_new, 'plans', v_plan_changes)
  );
end;
$$;

revoke execute on function set_gym_page_content(uuid, jsonb, jsonb) from public, anon;
grant execute on function set_gym_page_content(uuid, jsonb, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- The gym refresh trigger: 0166's, with `city_id` in the column list and the WHEN clause, and without the legacy `page_city`.
-- A trigger's column list cannot be altered, so it is dropped and created again (before any data statement of this file; see the header).
-- ----------------------------------------------------------------------------
drop trigger gym_page_refresh on public.gyms;

create constraint trigger gym_page_refresh
  after update of name, category, country, city_id, primary_color, default_language,
                  page_about_en, page_about_fr, page_services_en, page_services_fr, page_address,
                  page_lat, page_lng, page_hours, page_contact_phone, page_contact_whatsapp
  on public.gyms
  deferrable initially deferred
  for each row
  when (old.name is distinct from new.name
        or old.category is distinct from new.category
        or old.country is distinct from new.country
        or old.city_id is distinct from new.city_id
        or old.primary_color is distinct from new.primary_color
        or old.default_language is distinct from new.default_language
        or old.page_about_en is distinct from new.page_about_en
        or old.page_about_fr is distinct from new.page_about_fr
        or old.page_services_en is distinct from new.page_services_en
        or old.page_services_fr is distinct from new.page_services_fr
        or old.page_address is distinct from new.page_address
        or old.page_lat is distinct from new.page_lat
        or old.page_lng is distinct from new.page_lng
        or old.page_hours is distinct from new.page_hours
        or old.page_contact_phone is distinct from new.page_contact_phone
        or old.page_contact_whatsapp is distinct from new.page_contact_whatsapp)
  execute function private.gym_page_refresh_from_gym();

-- ============================================================================
-- Data. Nothing below changes the schema (see the header).
-- ============================================================================

-- Backfill: the legacy text, folded, against the aliases of the gym's OWN country. A miss stays null (listed by list_gyms_without_city()).
select set_config('app.gym_location_bypass', 'true', true);

update public.gyms g
   set city_id = a.city_id
  from public.city_aliases a
 where g.city_id is null
   and g.page_city is not null
   and a.country_code = g.country
   and a.alias_norm = private.place_norm(g.page_city);

select set_config('app.gym_location_bypass', 'false', true);

-- The pages that are live now are judged again: a mapped city re-snapshots as cities.name, an unmapped one unpublishes with the usual notice.
do $refresh$
declare
  r record;
begin
  for r in select gp.gym_id from public.gym_pages gp where gp.published_at is not null and gp.unpublished_at is null order by gp.gym_id loop
    perform private.refresh_gym_page(r.gym_id);
  end loop;
end
$refresh$;

-- ----------------------------------------------------------------------------
-- The migration proves its own result.
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_fn text;
  v_tbl text;
  v_role text;
  v_priv text;
begin
  if (select count(*) from public.countries) <> 249 or not exists (select 1 from public.countries where code = 'CM' and name_en = 'Cameroon' and name_fr = 'Cameroun') then
    raise exception '0169: the country seed is wrong';
  end if;
  if (select count(*) from public.cities where country_code = 'CM') <> 12
     or (select count(*) from public.city_aliases where is_name) <> (select count(*) from public.cities) then
    raise exception '0169: the city seed is wrong';
  end if;
  if private.place_norm('  Yaoundé - Nord ') <> 'yaounde nord' or private.place_slug('Ngaoundéré') <> 'ngaoundere' then
    raise exception '0169: the normalizer is wrong';
  end if;

  for v_tbl in select unnest(array['public.countries', 'public.cities', 'public.city_aliases', 'public.city_slug_history']) loop
    if (select relrowsecurity from pg_class where oid = v_tbl::regclass) is distinct from true then
      raise exception '0169: % has no row level security', v_tbl;
    end if;
    -- nobody but `authenticated` (select, and not on the history table) reaches these tables
    for v_role in select unnest(array['public', 'anon', 'service_role', 'public_site_reader']) loop
      for v_priv in select unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) loop
        if has_table_privilege(v_role, v_tbl, v_priv) then
          raise exception '0169: % has % on %', v_role, v_priv, v_tbl;
        end if;
      end loop;
    end loop;
    for v_priv in select unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) loop
      if has_table_privilege('authenticated', v_tbl, v_priv) then
        raise exception '0169: authenticated has % on %', v_priv, v_tbl;
      end if;
    end loop;
    if (v_tbl = 'public.city_slug_history') = has_table_privilege('authenticated', v_tbl, 'SELECT') then
      raise exception '0169: authenticated read access to % is wrong', v_tbl;
    end if;
  end loop;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('countries', 'cities', 'city_aliases') and cmd = 'SELECT' and roles = '{authenticated}') <> 3
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('countries', 'cities', 'city_aliases', 'city_slug_history') and cmd <> 'SELECT')
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'city_slug_history') then
    raise exception '0169: the policies are wrong';
  end if;

  if not exists (select 1 from pg_attribute where attrelid = 'public.gyms'::regclass and attname = 'city_id' and not attnotnull)
     or not exists (select 1 from pg_constraint where conrelid = 'public.gyms'::regclass and contype = 'f' and confrelid = 'public.cities'::regclass) then
    raise exception '0169: gyms.city_id is wrong';
  end if;
  if exists (select 1 from public.gyms g join public.cities c on c.id = g.city_id where c.country_code <> g.country) then
    raise exception '0169: a gym has a city outside its country';
  end if;

  if (select count(*) from pg_trigger where not tgisinternal and tgname in
        ('gyms_a_pin_city_id', 'gyms_z_clear_city_on_country_change', 'cities_no_delete', 'cities_no_truncate', 'gym_page_refresh_city')) <> 5 then
    raise exception '0169: a trigger is missing';
  end if;
  if pg_get_triggerdef((select oid from pg_trigger where tgname = 'gym_page_refresh' and tgrelid = 'public.gyms'::regclass)) !~ 'city_id'
     or pg_get_triggerdef((select oid from pg_trigger where tgname = 'gym_page_refresh' and tgrelid = 'public.gyms'::regclass)) ~ 'page_city' then
    raise exception '0169: the gym refresh trigger does not watch city_id (or still watches page_city)';
  end if;
  if (select count(*) from pg_trigger where tgname like 'gym\_page\_refresh%' and not tgisinternal and tgconstraint <> 0) <> 9 then
    raise exception '0169: expected nine deferred refresh triggers';
  end if;

  -- the gate, the snapshot, the status reader and the setter no longer read the legacy text
  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
                and p.proname in ('gym_page_gate_missing', 'gym_page_snapshot', 'gym_page_bad_text_fields', 'get_gym_page_status', 'set_gym_page_content')
                and p.prosrc ~ 'page_city') then
    raise exception '0169: a redefined function still reads page_city';
  end if;
  if (select prosrc from pg_proc where oid = 'public.set_gym_page_content(uuid, jsonb, jsonb)'::regprocedure) ~ '''city''' then
    raise exception '0169: set_gym_page_content still knows the city key';
  end if;

  for v_fn in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('add_city', 'update_city', 'list_gyms_without_city', 'set_gym_location')
  loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('public', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0169: % has the wrong execute privileges', v_fn;
    end if;
  end loop;
  for v_fn in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and (p.proname like 'place\_%' or p.proname like 'city\_%' or p.proname like 'cities\_%' or p.proname in
            ('pin_gym_city_id', 'clear_gym_city_on_country_change', 'gym_page_refresh_from_city'))
  loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('public', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0169: % is callable by a client role', v_fn;
    end if;
  end loop;
  if (select count(*) from private.support_capabilities where capability = 'gym_page' and kind = 'rpc' and object_name = 'set_gym_location') <> 1
     or exists (select 1 from private.support_capabilities where object_name in ('add_city', 'update_city', 'list_gyms_without_city'))
     or not exists (select 1 from private.support_audit_actions where action_type = 'gym_location_updated') then
    raise exception '0169: support capability rows are wrong (only set_gym_location is admitted)';
  end if;
end
$verify$;
