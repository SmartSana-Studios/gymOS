---
title: 'Spike: claims hook aal, factor-enrollment guard, session deletion, cookie behavior'
type: 'chore'
created: '2026-10-15'
status: 'done'
baseline_commit: 'a0f0597a5797ef422f9be4705aef10be0b4493f0'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epics 22-23 (AAL2 for Super Admin and support, immediate access revocation, `__Host-` cookies) rest on unverified auth-provider behavior marked `[ASSUMPTION]` in the architecture spine.

**Approach:** Answer each Step 1 spike item against the real provider (local Supabase stack; hosted per the decision below) with throwaway scripts, then record one dated entry in `docs/decisions.md` with a result per item and a "changes to later stories" list, and point the spine's Deferred bullet at it. No product code, no migrations.

## Boundaries & Constraints

**Always:** Spike scripts live under the scratchpad or `scripts/spikes/` and are deleted or clearly marked throwaway; local TOTP enablement is a local `supabase/config.toml` change that is reverted unless 22.5 needs it (record which). Results state exact field paths and observed HTTP statuses, not impressions. Decision (product owner, 2026-10-15): no staging project is created and production is not read; all probes run on the local stack. The hosted MFA factor cap (documented 10) and TOTP enabled setting (OQ-27) are recorded as "not independently verified on hosted".

**Never:** Modify production (project `vfxezibagiznrirdwkwh`): no enrollment, no config write, no user created. No product code, migration, or RLS change. No edits to later stories' text beyond the "changes to later stories" list in the decision entry.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hook `aal` | AAL2 session token mint (verify + refresh) | Record whether `event` carries `aal`/`amr`, exact path, and whether it is present on refresh too | If absent, record the alternative (read `auth.sessions.aal` by `session_id`) |
| Enroll guard | AAL1 session, user has one verified factor, direct `POST /factors` | Record created or refused | If created, name the `auth.mfa_factors` object a guard must target |
| Session delete | Service role deletes `auth.sessions` row | Record next-request result (access JWT still accepted? refresh refused?) | If stale JWT still works, record the max window and alternative |
| Cookie | SSR helper sets `__Host-` name | Record prefix, `Secure`, `Path=/`, no `Domain` survive | If not, flag NFR-026 as needing a separate domain |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0065_multi_gym_session_switching.sql:77` -- current `public.custom_access_token_hook(event jsonb)`; strips and re-adds `gym_id`/`app_role`; the `aal` read would be added here by 22.5/22.7.
- `supabase/config.toml:288,337-344` -- hook registration; `[auth.mfa.totp]` enroll/verify are false locally; cap `max_enrolled_factors = 10`.
- `apps/dashboard/lib/supabase/{server,proxy}.ts`, `apps/super-admin/lib/supabase/{server,proxy}.ts` -- `createServerClient` cookie plumbing; no `cookieOptions` set today; proxies pass `options` straight through.
- `docs/decisions.md` -- newest-first; add entry at top (below the intro rule). Verify cited line numbers after inserting.
- `_bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md:450` -- the Deferred spike bullet to repoint.
- `_bmad-output/implementation-artifacts/sprint-status.yaml:433-441` -- 22-1 status and `last_updated` entry.
- Local stack is up (`supabase_auth_gym_os`, db, kong); psql via `supabase status -o env`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/config.toml` -- enable `[auth.mfa.totp]` enroll/verify locally, restart auth -- needed to enroll a factor
- [x] scratchpad script -- user with verified TOTP; sign in, step up, decode tokens; log the hook `event` keys via a temporary hook wrapper in a rolled-back/local-only migration -- resolves the `aal` assumption
- [x] scratchpad script -- AAL1 session calls `POST /auth/v1/factors` with an existing verified factor -- resolves the enroll guard
- [x] scratchpad script -- delete `auth.sessions` row as service role; call REST and `/auth/v1/user` with old access token, then refresh -- resolves FR-192/FR-184 basis
- [x] scratchpad Next route or Node script using `@supabase/ssr` with `__Host-` name -- inspect `Set-Cookie`
- [x] `docs/decisions.md` (same entry) -- record hosted cap and TOTP setting as documented/OQ-27 values, not independently verified
- [x] `docs/decisions.md`, `ARCHITECTURE-SPINE.md`, `sprint-status.yaml` -- decision entry, pointer, status/last_updated

**Acceptance Criteria:**
- Given the spike is done, when `docs/decisions.md` is read, then one dated entry has a result for each of the five items and a "changes to later stories" list.
- Given the work tree, when `git diff` is read, then it contains no migration, no app source change, and `config.toml` is reverted or the retained change is justified.
- Given production, when the spike ends, then nothing in production was written.

## Implementation Notes

- Probes ran in a second GoTrue container with TOTP enabled and a logging hook wrapper (config.toml untouched, container and test data removed). Five results and a changes-to-later-stories list are in the top entry of `docs/decisions.md`.
- Verified at review: diff touches only `docs/decisions.md`, `ARCHITECTURE-SPINE.md` (Deferred bullet and AD-34 marker), `sprint-status.yaml`; no migration, app or config change.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|
| edge | AD-34 `[ASSUMPTION]` marker still unverified in spine | medium | real; patched to cite the spike |
| edge | factor reset reopens first-factor window | medium | real; patched into changes list (22.6/23.x) |
| edge | session_id check needs helper everywhere | low | already a stated requirement; folded into helper note |
| edge | hook should read `aal` fail-closed | low | patched as one guidance line |
| edge | server.ts vs proxy.ts cookie path differs | false | both use the same `setAll` plumbing; note says share one options object |
| blind | evidence not reproducible | low | scripts are throwaway by spec; results carry versions and statuses; rejected |
| blind | deletion via DB-owner SQL, not service-role function | medium | real nuance; recorded as unverified for hosted definer |
| blind | AD-34 claim lacks anchor, definer grants | low | patched |
| blind | first-factor window lacks owner | low | 22.5 AC already carries it; reset case patched |
| blind | `__Host-` cutover and per-host isolation | medium | real; patched |
| blind | open items lack owner/trigger | low | patched with reopen triggers |
| blind | spec bookkeeping | low | checkboxes ticked, notes filled |
| verification-gap | none | n/a | no gaps |

## Verification

**Commands:**
- `git diff --stat epic/22 -- supabase/migrations apps packages` -- expected: empty
- `scripts/ci-local.sh` -- expected: green (docs-only change on the story branch)
