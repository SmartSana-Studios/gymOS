-- Rollback for migration 0171 (directory country names, Story 25.3).
-- Restores the 0169 seed values (Intl.DisplayNames short forms) of the 22 rows 0171 touched. Data only. Roll back the 25.3 directory pages first
-- (they show these names as headings); nothing else reads them by value.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0171-directory-country-names.sql

set local lock_timeout = '5s';

update public.countries c
   set name_en = v.name_en,
       name_fr = v.name_fr
  from (values
    ('AG', 'Antigua & Barbuda',                        'Antigua-et-Barbuda'),
    ('BA', 'Bosnia & Herzegovina',                     'Bosnie-Herzégovine'),
    ('BL', 'St. Barthélemy',                           'Saint-Barthélemy'),
    ('CC', 'Cocos (Keeling) Islands',                  'Îles Cocos'),
    ('CD', 'Congo - Kinshasa',                         'Congo-Kinshasa'),
    ('CG', 'Congo - Brazzaville',                      'Congo-Brazzaville'),
    ('GS', 'South Georgia & South Sandwich Islands',   'Géorgie du Sud-et-les Îles Sandwich du Sud'),
    ('HK', 'Hong Kong SAR China',                      'R.A.S. chinoise de Hong Kong'),
    ('HM', 'Heard & McDonald Islands',                 'Îles Heard-et-MacDonald'),
    ('KN', 'St. Kitts & Nevis',                        'Saint-Christophe-et-Niévès'),
    ('LC', 'St. Lucia',                                'Sainte-Lucie'),
    ('MF', 'St. Martin',                               'Saint-Martin'),
    ('MM', 'Myanmar (Burma)',                          'Myanmar (Birmanie)'),
    ('MO', 'Macao SAR China',                          'R.A.S. chinoise de Macao'),
    ('PM', 'St. Pierre & Miquelon',                    'Saint-Pierre-et-Miquelon'),
    ('SH', 'St. Helena',                               'Sainte-Hélène'),
    ('SJ', 'Svalbard & Jan Mayen',                     'Svalbard et Jan Mayen'),
    ('ST', 'São Tomé & Príncipe',                      'Sao Tomé-et-Principe'),
    ('TC', 'Turks & Caicos Islands',                   'Îles Turques-et-Caïques'),
    ('TT', 'Trinidad & Tobago',                        'Trinité-et-Tobago'),
    ('VC', 'St. Vincent & Grenadines',                 'Saint-Vincent-et-les Grenadines'),
    ('WF', 'Wallis & Futuna',                          'Wallis-et-Futuna')
  ) as v (code, name_en, name_fr)
 where c.code = v.code;
