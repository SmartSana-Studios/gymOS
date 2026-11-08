---
title: '24-5 page content fields and public plans'
type: 'feature'
created: '2026-11-08'
status: 'done'
baseline_commit: 'aee96da3e8b1be5d6356cb79fbd52bf68348b5c5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A gym has nowhere to store what its public page says, and no plan can be marked public. Without opt-in storage, 24.8 has nothing to snapshot and a plan could leak by default (FR-197, FR-200).

**Approach:** One migration adds nullable page-content columns to `gyms` and `plans.is_public` (default false), both pinned against direct writes, plus one audited setter RPC. A Zod schema in `packages/types` validates the same input. No UI, no publish.

## Boundaries & Constraints

**Always:** All new `gyms` columns nullable; existing gyms get an empty page, existing plans `is_public = false`. Content columns: `page_about_en/fr`, `page_services_en/fr`, `page_address`, `page_lat`, `page_lng`, `page_hours` (jsonb, keys mon..sun, each null or `{open,close}` as `HH:MM`), `page_contact_phone`, `page_contact_whatsapp` (E.164), `page_city` (free text now; the controlled city list is 25.1). `country` already exists (0105) and is reused. Plans gain `is_public` and nullable `public_label_en/fr` (OQ-28: both optional). Direct writes are blocked by BEFORE UPDATE pin triggers with a transaction-local GUC bypass, copied from `0123_gym_category.sql` (owners and support hold whole-row UPDATE today). One setter `set_gym_page_content(p_gym_id, p_content jsonb, p_plans jsonb)`: `security definer`, `set search_path = public`, admission as in `set_gym_category` (Owner, Supervisor, or live-assigned support via `private.support_rpc_gym_id/role`, super admin allowed), non-active gym refused for non-super-admins, `select ... for update`, unchanged input returns without logging, otherwise exactly one `log_audit_event` row holding old and new values for the fields that changed. Unknown content keys are rejected; the login phone is never read or written. Validation in the RPC and in Zod both: bounded lengths, markup characters (`<`, `>`) rejected, E.164 `^\+[1-9]\d{7,14}$`, lat in -90..90, lng in -180..180, plan ids must belong to the gym. Add the capability row `('gym_page','rpc','set_gym_page_content')` to `private.support_capabilities`. Revoke execute from `public, anon`; grant to `authenticated`. Start with `set local lock_timeout = '5s'`. Add a `scripts/rollback-NNNN-*.sql`.

**Never:** No publish gate, snapshot, `gym_pages` writer or view change (24.8). No media columns (24.6). No page name (24.7). No dashboard UI (24.9). No city or country lists (25.1). No production deploy. Do not touch `apps/dashboard/AGENTS.md` or `scripts/demo-gym/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner saves content | valid `p_content`, two plan ids public | columns and flags set, one audit row old/new | N/A |
| Same input again | identical values | returns, no audit row | N/A |
| Member, coach, other gym's Owner | any | refused | typed error |
| Support, assigned and live | valid | allowed, audited | refused if unassigned |
| Direct `update gyms set page_about_en` or `update plans set is_public` as Owner | outside the RPC | value unchanged (pin reverts) | N/A |
| Markup, bad phone, extra key, foreign plan id | invalid | nothing written | typed error |
| Suspended gym, non-super-admin | any | refused | typed error |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0123_gym_category.sql`, `0107_*.sql:339-362` -- GUC pin trigger and setter precedent to copy.
- `supabase/migrations/0140_support_capability_allow_list.sql:51,83,667` -- capability row, `support_rpc_*` helpers, redefined `set_gym_category`.
- `supabase/migrations/0105_gym_country.sql` -- existing `gyms.country`.
- `supabase/migrations/0161_gym_page_content.sql` (next free at merge) -- new; rollback `scripts/rollback-0161-gym-page-content.sql`.
- `supabase/tests/gym_category.test.sql`, `gym_category.negative.test.sql` -- templates for the new pgTAP; `support_capabilities.test.sql` (plan 146; counts 35/21/14 and name arrays at lines 93, 106, 113, 199-203) must be updated for the new rpc row; also check `support_role_live_gate.test.sql`, `suspension_rpc_coverage.test.sql`.
- `packages/types/src/schemas/gym.ts` -- add schema beside `gymSettingsSchema` (:215); `e164Phone` (:42) is private, export it. `packages/types/src/database.ts` -- hand-splice new columns and the RPC (gen command unreliable per docs/decisions.md).
- Zod tests live in `apps/dashboard` (vitest, `pnpm --filter dashboard test`); put the schema test there.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0161_gym_page_content.sql` -- columns, pin triggers, setter, capability row, grants
- [x] `scripts/rollback-0161-gym-page-content.sql` -- reverse, with data-effects note
- [x] `supabase/tests/gym_page_content.test.sql` -- matrix rows above, defaults empty/private, one audit row, login phone untouched, pin proven to fail when removed
- [x] `supabase/tests/support_capabilities.test.sql` (+ any RPC-listing test) -- counts and name arrays for the new row
- [x] `packages/types/src/schemas/gym.ts`, `database.ts` -- Zod schema and types
- [x] `apps/dashboard/lib/gymPageContentSchema.test.ts` -- schema edge cases
- [x] `docs/decisions.md`, `sprint-status.yaml` -- 24.5 entry and status

**Acceptance Criteria:**
- Given the migration on a local DB with live-shaped gyms and plans, then every gym page field is null and every plan private
- Given the setter's consumers (Owner, Supervisor, support, super admin), then a test enumerates them and a new admitted role without the check fails it
- Given full `scripts/ci-local.sh` and `check-migration-guardrails.mjs`, then both pass, per-stage lines read

## Implementation Notes

Beyond the spec, all needed to make the story work: `pin_plan_public_insert` (an Owner may insert plans, so a "public from the first row" insert would skip the opt-in); `gym_page_content_changed` added to `private.support_audit_actions` (a live support caller was refused without it); `private.gym_page_hours_valid` granted to `authenticated`/`service_role` (the hours CHECK runs as the writing role); `p_plans` defaults to null; `p_content` and `p_plans` are patches (missing key untouched, JSON null clears). Migration number 0161 is provisional until merge.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Test looks up plan `'PG DIRECT'` but inserts `'PG Direct'` (Blind, Edge) | false | reject | Migration 0159 `uppercase_name` trigger on `plans.name` uppercases on insert; the lookup is correct. |
| SQL `btrim` strips spaces only, Zod `trim()` strips all whitespace (Blind, Edge, Gap) | medium | patch | `gym_page_text`/`gym_page_phone`: `"x\n"` is stored raw via the RPC but trimmed via Zod; 24.8 snapshots the text. |
| Table CHECKs never exercised; only setter errors tested (Gap) | medium | patch | Test writes only valid values with pins off; removing a CHECK keeps all tests green. |
| Length limits tested in SQL for `about_en` only (Gap) | low | patch | Cheap `alike` cases; a typo in a limit would ship. |
| Pin untested as super admin / service_role; insert pin never shown failing when removed (Gap, Blind) | medium | patch | Spec says "no exemption" and "pin proven to fail"; only the Owner and two of three triggers are covered. |
| RPC branches untested: duplicate plan, unknown plan key, non-array plans, non-object content, null clearing, label-only change (Gap, Blind) | low | patch | Cheap `throws_ok`/`is` cases; the branches are in the setter. |
| Consumers test matches `prosrc` text, no enum role loop (Gap, Blind) | low | defer | Behavioural role cases exist; use an enum loop when a role is next added. |
| Zod vs SQL contract drift (emoji code units, rounding) with no shared fixture (Gap, Edge) | medium | defer | Shared fixture belongs with the 24.9 form wiring; the whitespace divergence is patched above. |
| lat without lng, `open == close`, `{}` hours (Blind) | low | defer | Page completeness belongs to the 24.8 publish gate (FR-199). |
| GUC bypass forgeable by raw SQL (Blind, Edge) | low | reject | Same accepted design as 0123/0098; a raw-SQL caller already holds table UPDATE and `set_config` is not reachable through PostgREST. |
| Gyms INSERT unpinned (Blind, Edge) | low | defer | `super_admin_insert_gyms` is the only insert path; no Owner can reach it. Record for 24.8. |
| Lat 90.0000004 rounds in SQL, rejected in Zod (Edge, Blind) | low | reject | Client is stricter than server; no bad data stored; fix adds branches. |
| Zod `max()` UTF-16 vs `char_length` (Edge) | low | reject | Client can only be stricter on emoji; fix adds a refine. |
| Insert pin forces private for seeds and imports (Edge) | low | reject | Intended and documented in the migration header. |
| `p_plans` unbounded; no-op save holds locks (Edge) | low | reject | Owner-scoped, a gym has a handful of plans; no demonstrated contention. |
| Rollback deletes `support_audit_actions` row; dependency risk (Edge) | false | reject | The table is a plain allow-list; no FK from `audit_log`. |
| Hours function granted to `authenticated`/`service_role` only (Edge) | low | reject | Every writer of `gyms` is one of those roles; `support_capabilities` caught the real case. |
| Audit metadata stores full old/new text (Blind) | low | reject | Spec requires old and new values; bounded by field limits. |
| Control characters and entity-encoded markup pass the `<`/`>` blocklist (Blind) | low | patch (doc) | Note in decisions.md that the 24.8 renderer must escape output and not rely on this check. |
| Rollback script not run by a test (Gap) | low | defer | Applied, rolled back and re-applied by hand; it has its own `$verify$` block. |
| Spec logs empty; ci-local evidence missing; `AGENTS.md` modified (Blind) | low | process | Implementation Notes added; full ci-local re-run after the patches; `AGENTS.md` is the owner's pre-existing edit. |

## Verification

**Commands:**
- `scripts/pgtap-run.sh supabase/tests/gym_page_content.test.sql supabase/tests/support_capabilities.test.sql` -- expected: all ok
- `pnpm --filter dashboard test` -- expected: pass
- `scripts/ci-local.sh` -- expected: GREEN, stage lines read
