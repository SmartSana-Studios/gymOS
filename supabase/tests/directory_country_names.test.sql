-- Story 25.3: corrected country names (migration 0171). Pure catalog reads of public.countries; no fixtures, nothing written.
begin;
select plan(27);

select is((select count(*)::int from public.countries), 249, 'the country list still has 249 rows');
select is((select count(*)::int from public.countries where name_en ~ '&' or name_fr ~ '&'), 0, 'no name has an ampersand');
select is((select count(*)::int from public.countries where name_en ~ ' - ' or name_fr ~ ' - '), 0, 'no name has a spaced hyphen');
select is((select count(*)::int from public.countries where name_en ~ 'St\. ' or name_fr ~ 'St\. '), 0, 'no name has "St. "');
select is((select count(*)::int from public.countries where name_en ~ 'SAR' or name_fr ~ 'SAR'), 0, 'no name has "SAR"');

select is((select name_en || '|' || name_fr from public.countries where code = 'AG'), 'Antigua and Barbuda|Antigua-et-Barbuda', 'AG');
select is((select name_en || '|' || name_fr from public.countries where code = 'BA'), 'Bosnia and Herzegovina|Bosnie-Herzégovine', 'BA');
select is((select name_en || '|' || name_fr from public.countries where code = 'BL'), 'Saint Barthélemy|Saint-Barthélemy', 'BL');
select is((select name_en || '|' || name_fr from public.countries where code = 'CC'), 'Cocos (Keeling) Islands|Îles Cocos (Keeling)', 'CC');
select is((select name_en || '|' || name_fr from public.countries where code = 'CD'), 'Democratic Republic of the Congo|République démocratique du Congo', 'CD');
select is((select name_en || '|' || name_fr from public.countries where code = 'CG'), 'Republic of the Congo|République du Congo', 'CG');
select is((select name_en || '|' || name_fr from public.countries where code = 'GS'), 'South Georgia and South Sandwich Islands|Géorgie du Sud et îles Sandwich du Sud', 'GS');
select is((select name_en || '|' || name_fr from public.countries where code = 'HK'), 'Hong Kong|Hong Kong', 'HK');
select is((select name_en || '|' || name_fr from public.countries where code = 'HM'), 'Heard and McDonald Islands|Îles Heard-et-MacDonald', 'HM');
select is((select name_en || '|' || name_fr from public.countries where code = 'KN'), 'Saint Kitts and Nevis|Saint-Christophe-et-Niévès', 'KN');
select is((select name_en || '|' || name_fr from public.countries where code = 'LC'), 'Saint Lucia|Sainte-Lucie', 'LC');
select is((select name_en || '|' || name_fr from public.countries where code = 'MF'), 'Saint Martin|Saint-Martin', 'MF');
select is((select name_en || '|' || name_fr from public.countries where code = 'MM'), 'Myanmar|Myanmar', 'MM');
select is((select name_en || '|' || name_fr from public.countries where code = 'MO'), 'Macao|Macao', 'MO');
select is((select name_en || '|' || name_fr from public.countries where code = 'PM'), 'Saint Pierre and Miquelon|Saint-Pierre-et-Miquelon', 'PM');
select is((select name_en || '|' || name_fr from public.countries where code = 'SH'), 'Saint Helena|Sainte-Hélène', 'SH');
select is((select name_en || '|' || name_fr from public.countries where code = 'SJ'), 'Svalbard and Jan Mayen|Svalbard et Jan Mayen', 'SJ');
select is((select name_en || '|' || name_fr from public.countries where code = 'ST'), 'São Tomé and Príncipe|São Tomé-et-Príncipe', 'ST');
select is((select name_en || '|' || name_fr from public.countries where code = 'TC'), 'Turks and Caicos Islands|Îles Turques-et-Caïques', 'TC');
select is((select name_en || '|' || name_fr from public.countries where code = 'TT'), 'Trinidad and Tobago|Trinité-et-Tobago', 'TT');
select is((select name_en || '|' || name_fr from public.countries where code = 'VC'), 'Saint Vincent and the Grenadines|Saint-Vincent-et-les-Grenadines', 'VC');
select is((select string_agg(name_en || '|' || name_fr, ';' order by code) from public.countries where code in ('CM', 'WF')),
          'Cameroon|Cameroun;Wallis and Futuna|Wallis-et-Futuna', 'CM unchanged, WF corrected');

select * from finish();
rollback;
