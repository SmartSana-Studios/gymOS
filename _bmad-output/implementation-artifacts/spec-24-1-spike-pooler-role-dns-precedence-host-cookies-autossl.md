---
title: '24-1 Spike: pooler role, DNS precedence, __Host- cookies, AutoSSL'
type: 'chore'
created: '2026-11-01'
status: 'in-progress'
baseline_commit: '9b89903d1cd831c3f49ad94f08a5468c155819e8'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 24 rests on four unverified assumptions (AD-42 pooler login role, AD-43 DNS precedence and AutoSSL, AD-44 `__Host-` cookies). Building 24.2 to 24.12 on a wrong assumption wastes the epic.

**Approach:** Probe each assumption on the real stack, write one dated `docs/decisions.md` entry with a result per item and a "changes to later stories" list, and resolve the `[ASSUMPTION]` tags in the architecture spine. No product code, migration or app config changes.

## Boundaries & Constraints

**Always:** Pooler role is a throwaway with `SELECT` on one view, dropped afterward. DNS probes use a throwaway label on the real zone, removed afterward. Each of the four items ends as a stated result: AD-42 "use direct role" or "use pre-minted JWT fallback"; AD-43 "explicit records win" or the exact exception; AD-44 confirmed or "use the separate-domain fallback"; AutoSSL "still issues for apex and `mail.`" or the exact conflict. Record what was NOT verified and why. Existing `owner.`, `portal.`, `www.`, apex and mail records stay unchanged.

**Never:** No change to `apps/*` code, migrations, `vercel.json` or the production database. No nameserver change. Never put a password, JWT or connection string in `docs/decisions.md`. Do not leave the throwaway role, label or `_acme-challenge` delegation behind.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pooler accepts role | `role.project_ref` over transaction mode | Entry records transaction-mode behavior, connection-limit behavior, password rotation; says "use direct role" | N/A |
| Pooler rejects role | Connection refused or auth fails | Entry says "use pre-minted JWT fallback" with the exact error | Stop that item; do not try the project JWT secret |
| Wildcard shadows explicit host | `owner.`/`portal.`/`www.` resolves to the wildcard target | Entry names the exception | Report to owner before 24.2 |
| AutoSSL conflict | Apex or `mail.` cert fails to renew after delegation | Entry names the conflict and the AD-43 risk is "not accepted" | Remove delegation at once |

**Decisions (owner, 2026-11-01):**
1. Pooler probe runs on a new throwaway free Supabase project the owner creates and deletes afterward. Production is not touched. The owner supplies its database URL through an environment variable; it is never written to a file or the entry.
2. The owner makes the A2 Hosting, cPanel AutoSSL and Vercel dashboard changes from an exact numbered checklist and pastes back outputs; the agent runs `dig` and `curl` against the throwaway label (suggested `spike-24-1`, with the probe wildcard on a sub-label so the live zone's `*` is untouched).

</frozen-after-approval>

## Code Map

- `docs/decisions.md` -- newest-first log; add the 24.1 entry at the top (below the header, above the 24.0 entry). Style: see the 22.1 spike entry (numbered items, "Changes to later stories").
- `_bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md` -- AD-42 (line ~275), AD-43 (~281), AD-44 (~287): resolve `[ASSUMPTION]`/spike wording.
- `apps/{dashboard,super-admin}/lib/supabase/{server,client,proxy}.ts` -- read only. Today none sets `cookieOptions`; the 22.1 spike already proved `__Host-` chunking, `secure: true` and round trip against emitted `Set-Cookie` locally. Remaining for 24.1: a real HTTPS browser check of persistence across refresh and sign-out, and what breaks over plain HTTP locally.
- `apps/landing/{proxy.ts,vercel.json}` -- read only; landing is the project the wildcard attaches to.
- `scripts/prod-db.sh`, `scripts/deploy-readiness.sh` -- how production DB access is done today (relevant to Open Question 1).

## Tasks & Acceptance

**Execution:**
- [x] `docs/decisions.md` -- add the dated 24.1 entry with four numbered results and "Changes to later stories" -- the story's only deliverable
- [x] `ARCHITECTURE-SPINE.md` -- resolve AD-42/43/44 assumption tags to the recorded results -- AC requires it
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 24-1 status follows the workflow
- [ ] Remove every throwaway artifact (role, label, delegation, test project if created) and say so in the entry

**Acceptance Criteria:**
- Given a throwaway login role with `SELECT` on one view, when connected through the pooler as `role.project_ref`, then the entry states transaction-mode behavior, connection-limit behavior, password rotation and one of "use direct role" / "use pre-minted JWT fallback".
- Given a throwaway wildcard, when `dig` and a live request check `owner.`, `portal.`, `www.` and a random label, then the entry states explicit records and other-project hostnames win, or the exact exception.
- Given the `@supabase/ssr` helpers, when sign-in sets a `__Host-` session cookie with `secure: true`, `path: '/'` and no `domain` on a real HTTPS origin, then the entry records chunk prefixes, persistence across refresh and sign-out, plain-HTTP breakage, or "use the separate-domain fallback".
- Given `_acme-challenge` delegated on a throwaway label, when AutoSSL runs, then the entry states whether apex and `mail.` still issue.
- Given the entry is written, then the spine's AD-42/43/44 spike tags are resolved and no throwaway remains.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Manual checks:**
- `dig` and `curl -sI` output for each probed host is summarized in the entry; `grep -n "ASSUMPTION" ARCHITECTURE-SPINE.md` shows none left under AD-42/43/44 that this spike answered.
- The zone and the Supabase project are back to their pre-spike state.
