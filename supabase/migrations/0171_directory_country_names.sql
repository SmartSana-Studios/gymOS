-- ============================================================================
-- 0171: Directory country names (Epic 25, Story 25.3).
--
-- 0169 seeded public.countries from Intl.DisplayNames, whose short forms ("Congo - Kinshasa", "St. Lucia", "Hong Kong SAR China",
-- "Antigua & Barbuda") would become public headings on the directory pages. This corrects those rows to the full names. Data only: one
-- update of public.countries, no schema change. No re-snapshot: gym pages store the country CODE and the directory views read the names
-- live, so a name change reaches the pages at once.
--
-- Provisional number: the next free one at merge time.
-- Rollback: scripts/rollback-0171-directory-country-names.sql (restores the 0169 values).
-- ============================================================================

set local lock_timeout = '5s';

update public.countries c
   set name_en = v.name_en,
       name_fr = v.name_fr
  from (values
    ('AG', 'Antigua and Barbuda',                       'Antigua-et-Barbuda'),
    ('BA', 'Bosnia and Herzegovina',                    'Bosnie-Herzégovine'),
    ('BL', 'Saint Barthélemy',                          'Saint-Barthélemy'),
    ('CC', 'Cocos (Keeling) Islands',                   'Îles Cocos (Keeling)'),
    ('CD', 'Democratic Republic of the Congo',          'République démocratique du Congo'),
    ('CG', 'Republic of the Congo',                     'République du Congo'),
    ('GS', 'South Georgia and South Sandwich Islands',  'Géorgie du Sud et îles Sandwich du Sud'),
    ('HK', 'Hong Kong',                                 'Hong Kong'),
    ('HM', 'Heard and McDonald Islands',                'Îles Heard-et-MacDonald'),
    ('KN', 'Saint Kitts and Nevis',                     'Saint-Christophe-et-Niévès'),
    ('LC', 'Saint Lucia',                               'Sainte-Lucie'),
    ('MF', 'Saint Martin',                              'Saint-Martin'),
    ('MM', 'Myanmar',                                   'Myanmar'),
    ('MO', 'Macao',                                     'Macao'),
    ('PM', 'Saint Pierre and Miquelon',                 'Saint-Pierre-et-Miquelon'),
    ('SH', 'Saint Helena',                              'Sainte-Hélène'),
    ('SJ', 'Svalbard and Jan Mayen',                    'Svalbard et Jan Mayen'),
    ('ST', 'São Tomé and Príncipe',                     'São Tomé-et-Príncipe'),
    ('TC', 'Turks and Caicos Islands',                  'Îles Turques-et-Caïques'),
    ('TT', 'Trinidad and Tobago',                       'Trinité-et-Tobago'),
    ('VC', 'Saint Vincent and the Grenadines',          'Saint-Vincent-et-les-Grenadines'),
    ('WF', 'Wallis and Futuna',                         'Wallis-et-Futuna')
  ) as v (code, name_en, name_fr)
 where c.code = v.code;

-- The migration proves its own result.
do $verify$
begin
  if (select count(*) from public.countries) <> 249 then
    raise exception '0171: the number of countries changed';
  end if;
  if exists (select 1 from public.countries where name_en ~ '&| - |St\. |SAR' or name_fr ~ '&| - |St\. |SAR') then
    raise exception '0171: a country name still carries an ICU short form';
  end if;
  if not exists (select 1 from public.countries where code = 'CD' and name_en = 'Democratic Republic of the Congo' and name_fr = 'République démocratique du Congo')
     or not exists (select 1 from public.countries where code = 'CM' and name_en = 'Cameroon' and name_fr = 'Cameroun') then
    raise exception '0171: the corrected names are not in place';
  end if;
end
$verify$;
