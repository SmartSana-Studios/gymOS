-- Epic 24 retro D2: private.page_name_valid (migration 0163) against the shared case list in
-- packages/types/src/constants/pageNameCases.json. The TypeScript isValidPageName is tested against the same JSON, and
-- scripts/__tests__/page-name-grammar-cases.test.mjs fails if the rows below differ from the JSON, so the two grammars cannot
-- drift apart unseen. Add a case to the JSON AND here.
begin;
select plan(30);

create temp table cases(name text, expected boolean) on commit drop;
insert into cases (name, expected) values
-- CASES BEGIN
  ('abc', true),
  ('gym-os', true),
  ('a1b', true),
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', true),
  ('1a2', true),
  ('a-b-c', true),
  ('0ab', true),
  ('ab0', true),
  ('xn-abc', true),
  ('smartsana-fitness', true),
  ('ab', false),
  ('-abc', false),
  ('abc-', false),
  ('a--b', false),
  ('xn--abc', false),
  ('xn--a', false),
  ('123', false),
  ('12345', false),
  ('_dmarc', false),
  ('ab_c', false),
  ('ABC', false),
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', false),
  ('a.b', false),
  ('', false),
  ('a b', false),
  ('é-é-é', false),
  ('-x-', false),
  (E'abc\n', false),
  (E'\nabc', false)
-- CASES END
;

select is((select count(*)::int from cases), 29, 'the case table is loaded');
select is(private.page_name_valid(name), expected, 'page_name_valid(' || replace(format('%L', name), E'\n', '\n') || ') is ' || expected)
  from cases;

select * from finish();
rollback;
