---
title: 'Super Admin Pages: one Actions menu per row and an Active pages list'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '979ce2d85052c2e92403f05db7d845262709f624'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After the SmartSana smoke test the owner reported two things on Super Admin > Pages: the row buttons (Approve/Reject, Show details/Dismiss/Take down/Close, Lift/Uphold) differ from every other screen, which has one "Actions" dropdown; and there is no list of the pages and domains that are live.

**Approach:** Use the existing `RowActions` dropdown on the three Pages tabs, and add a fourth tab, Pages > Active, backed by a new read-only Super Admin function (migration 0168) that lists published pages with their `name.gymosapps.com` domain.

## Boundaries & Constraints

**Always:** `RowActions` is reused as is (the Gyms list already does). Behavior of every existing action (dialogs, step-up codes, notices to Owners, `router.refresh`) stays identical; only how it is reached changes. The new function follows `list_page_reports` (0167): `security definer`, `stable`, `set search_path = public`, `private.is_super_admin_live()` guard raising `permission denied`, execute revoked from `public, anon`, granted to `authenticated`. A page is listed when it has a published snapshot (`published_at is not null`, `unpublished_at is null`). Status is `live` (visible), `taken_down` (page or its name), or `paused` (gym not active). Result is capped (1000 rows, newest first). `page.tsx` imports only components from client files; shared values live in plain modules (the 2026-11-11 /pages crash). All strings in `en.json` and `fr.json` (i18n parity check). The new tab is wired to the new function's every consumer: a test enumerates the functions the Pages screens call.

**Never:** No change to publishing, takedown, appeal or purge rules. No write path in the new function. No public exposure of the list. No production apply, push or merge without the owner's go-ahead (backup first, `scripts/deploy-migration.sh 0168`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Live page | published, name active, gym active | row with domain, template, date, status Live; menu: Open page, View gym, Take down | N/A |
| Taken down | page or name taken down | status Taken down; menu: Open page is hidden, View gym, Lift takedown | N/A |
| Paused gym | gym suspended | status Paused; menu: View gym | N/A |
| Search | text typed | filters by page name, gym or domain, case-insensitive | no match shows an empty message |
| Not Super Admin | any other caller | function raises `permission denied` | screen shows the standard load error |
| Row with no action | e.g. nothing valid | `RowActions` shows a dash | N/A |

</frozen-after-approval>

## Code Map

- `apps/super-admin/app/(admin)/support/components/RowActions.tsx` -- the dropdown to reuse (`RowAction` type, deferred open for modals); keys `support.menu.*`.
- `apps/super-admin/app/(admin)/gyms/components/GymsPageClient.tsx` -- reference use (`rowActionsFor`).
- `apps/super-admin/app/(admin)/page-names/components/HeldNamesClient.tsx` -- Approve/Reject buttons to fold into the menu.
- `apps/super-admin/app/(admin)/pages/components/ReportsPanel.tsx` -- Show/Hide, Dismiss, Take down, Close as taken down.
- `apps/super-admin/app/(admin)/pages/components/AppealsPanel.tsx` -- Lift, Uphold (only while undecided).
- `apps/super-admin/app/(admin)/pages/components/PagesClient.tsx`, `tabs.ts`, `page.tsx` -- tab list (plain module) and data loading; add `active`.
- `apps/super-admin/app/(admin)/pages/actions.ts` -- list actions; add `listActivePages` (maps rows).
- `apps/super-admin/app/(admin)/gyms/[id]/components/GymPageBlock.tsx`, `pages/components/TakedownDialog.tsx` -- take down and lift flows to reuse; domain constant `PAGE_PUBLIC_DOMAIN` is in `apps/dashboard/lib/landingPage.ts` (Super Admin gets its own plain constant).
- `supabase/migrations/0167_page_takedown_reports_media_purge.sql` -- convention source; `scripts/rollback-0167-*.sql`, `scripts/rollback-rehearsal-epic24.sh`, `packages/types/src/database.ts`, `docs/runbooks/deploy-epic-24.md`.
- Tests to update: `pages/components/PagesPanels.test.tsx`, `page-names` tests, `pages/tabs.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0168_list_published_pages.sql` -- `public.list_published_pages()` (columns: gym_id, gym_name, page_name, template, published_at, status) with the guard, grants and an in-migration verify block -- reads published pages for Super Admin
- [ ] `supabase/tests/list_published_pages.test.sql` -- pgTAP: super admin sees live, taken_down and paused rows; unpublished and draft pages are absent; non-super-admin, anon and support are denied; read-only and search_path pinned; shown able to fail -- proves the gate and the data
- [ ] `scripts/rollback-0168-list-published-pages.sql`, `scripts/rollback-rehearsal-epic24.sh` -- drop the function; add 0168 to the rehearsal -- reversible
- [ ] `packages/types/src/database.ts`, `docs/runbooks/deploy-epic-24.md` -- types entry; runbook adds 0168 to the order -- keeps records true
- [ ] `HeldNamesClient.tsx`, `ReportsPanel.tsx`, `AppealsPanel.tsx` -- replace button groups with `RowActions` (icons from lucide-react) -- owner feedback 1
- [ ] `pages/tabs.ts`, `PagesClient.tsx`, `page.tsx`, `actions.ts`, new `ActivePagesPanel.tsx` -- Active tab (search, table, Actions menu: Open page, View gym, Take down, Lift) -- owner feedback 2
- [ ] `locales/en.json`, `locales/fr.json` -- strings for the tab, columns, statuses, menu items
- [ ] tests -- update panel tests to open the menu; add ActivePagesPanel tests (rows, search, per-status menu items, empty state); a test that `page.tsx` imports no values from client files

**Acceptance Criteria:**
- Given the Names, Reports or Appeals tab with rows, when a row is shown, then it has one "Actions" button whose menu holds every action the old buttons had, and each still completes as before.
- Given published pages, when Super Admin opens Pages > Active, then each live page appears once with `name.gymosapps.com`, template, date and status, and typing narrows the list.
- Given a caller that is not a live Super Admin, when `list_published_pages` runs, then it fails with `permission denied`.
- Given the local gate, when `scripts/ci-local.sh` runs in full, then every stage passes.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter 16, Edge Case Hunter 15, Verification Gap 2 + 4 others). Routed: 1 patch group applied, the rest rejected low or false. No intent_gap or bad_spec: the frozen text says "live (visible)", so the fix has one reading.

| Finding (layers) | Verdict | Evidence / route |
|---|---|---|
| Live ignores the name's state; a released/redirect/held name reads Live and offers Open page (all 3) | high | `private.gym_page_visible` requires `pn.state = 'active'`; the function did not; every fixture used `active`. **patch**: `paused` now also covers a missing or non-active name; pgTAP fixture `plist-released` + a live-set = view assertion; shown able to fail by reverting the rule (tests 8 and 13 failed, restored). |
| Active failure takes the whole Pages screen down; only regexes pin page.tsx (Verification Gap, derived by me) | medium | One `Promise.all` + `LoadError`. **patch**: Active has its own failure state (`active={active.error ? null : active.data}`), message in en/fr, panel test; wiring test updated. A rendered test of page.tsx was rejected: `PagesData` is not exported and Next forbids extra page exports. |
| Boundary test accepts SCREAMING_CASE (`PAGES_TABS` passes `/^[A-Z]/`) (Blind) | medium | Confirmed in the test. **patch**: component names must be PascalCase with a lower-case letter; `X as Y` judged by X. |
| 0168 release records incomplete: no decisions entry, rehearsal does not assert the function is gone (Blind) | medium | **patch**: `docs/decisions.md` entry; rehearsal prints and requires `list_published_pages left: 0`. `deploy-readiness.sh` and the landing-gate README do not name a head version (grep), nothing to update. |
| Any non-active gym status reads "Paused" while copy says suspended (Blind) | low | **patch** (string only): hint in en/fr says suspended or deactivated or name no longer active. |
| Stray space `!appeals.data )`; mis-indented `userEvent.setup()` (Blind, Edge, Gap) | low | **patch**, direct fixes. |
| 1000-row cap is silent (Blind, Edge) | low | rejected: far from reachable (about 1000 published pages); fix needs a count and a notice. Recorded in decisions. |
| Show/Hide details lost `aria-expanded` (Blind, Edge, Gap) | low | rejected: the owner asked for one menu; the item label flips Show/Hide; fix adds structure. |
| Popup blocker swallows Open page; stale row in a dialog after refresh; success banner never cleared; invalid date; time zone of the date; fetch on every visit (Edge, Blind) | low | rejected: same patterns as the existing panels, unlikely in everyday use, fixes add guards. |
| Paused page cannot be taken down from the list (Edge) | low | rejected: by design in the spec's matrix (paused: View gym); a suspended gym's page is not served. |
| Public domain constant duplicated in Super Admin; counts `active: 0` placeholder; i18n key coverage test list incomplete; template id `bold` in SQL fixtures; brittle pgTAP/test details (row_number over (), error text, grep of `limit 1000`, 6-space indent regex) (Blind) | low | rejected: developer-only, no named harm today; parity check already covers key sets. |
| Decided appeal row shows a dash instead of an empty cell (Edge) | false | The spec's matrix row "Row with no action: RowActions shows a dash" requires it. |
| No status filter or sorting; no export (Blind) | low | rejected: not in the intent; idea for later (recorded). |

## Verification

**Commands:**
- `pnpm --filter @gymos/super-admin exec vitest run` -- expected: all pass
- `bash scripts/ci-local.sh` -- expected: static, deno, pgtap, unit, layout, e2e PASS (clean local DB first: no QA data)
- `bash scripts/rollback-rehearsal-epic24.sh` -- expected: 0168 included, all rollbacks run cleanly

**Manual checks (owner, after production apply):**
- Pages > Active lists the SmartSana page once it is live again; each tab's Actions menu opens and completes an action.
