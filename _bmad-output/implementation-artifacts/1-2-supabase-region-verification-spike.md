---
baseline_commit: 87a71b0
---

# Story 1.2: Supabase Region Verification Spike

Status: done (documented exception: AC #3 was violated pre-story — Supabase project existed before region decision was recorded — accepted since no data had been written; see Critical Context section)

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want to measure RTT from a Cameroonian mobile network against EU West Ireland vs. Frankfurt,
so that the Supabase Cloud project's region is locked in before any data is written and the <3s front-desk alert budget stays achievable.

## Acceptance Criteria

1. **Given** candidate regions EU West Ireland and Frankfurt, **when** RTT is measured from a representative Cameroonian mobile network, **then** the lower-latency region is selected.
2. **And** the outcome is recorded in `docs/decisions.md`.
3. **And** the Supabase Cloud project is not created until this decision is recorded (region cannot change after data is written; local Docker-based dev from Story 1.1 is unaffected).

## ⚠️ Critical Context: AC #3 Is Already Violated — Read Before Starting

**A Supabase Cloud project already exists** (`vfxezibagiznrirdwkwh.supabase.co`), created during Story 1.1's 2026-07-05 course correction to unblock local dev speed (see `apps/dashboard/.env.local`, `apps/super-admin/.env.local`, and Story 1.1's Change Log/Completion Notes). That project's region was **never chosen by measurement** — it's whatever Supabase's project-creation UI defaulted to or whatever was clicked at the time. This story's own AC #3 says the project must not exist before the region decision is recorded, and NFR-010 says region "must be confirmed before any Supabase project is created — it cannot be changed after data is written."

**This is recoverable, not a disaster, because no schema/data exists yet** — Story 1.1 explicitly deferred all migrations (RLS/schema work starts in Story 1.3), so the existing project is empty. Do this, in order:

1. Determine the existing project's actual region first — Supabase Dashboard (Project Settings → General → Region) or `npx supabase projects list` (needs a Supabase access token: `npx supabase login` or `SUPABASE_ACCESS_TOKEN` env var) both show it.
2. Run the RTT measurement (Tasks below) to determine the winning region between EU West Ireland (`eu-west-1`) and Frankfurt (`eu-central-1`).
3. **If the existing project's region matches the winning region:** no new project needed. Just record the decision in `docs/decisions.md` and note that the existing project already satisfies it.
4. **If it does NOT match:** the existing project must be recreated in the correct region (cheap now — it's empty — but expensive later). Create the new project, update `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in both `apps/dashboard/.env.local` and `apps/super-admin/.env.local` (gitignored, not committed — same pattern Story 1.1 used), then re-verify `turbo dev` still reaches `Ready` against the new project (repeat Story 1.1's smoke test, don't just assume it works). Do not delete the old project until the new one is confirmed working — flag old-project cleanup as a manual follow-up for the user rather than doing it silently, since it's a destructive/irreversible action outside this repo.
5. Either way, **do not touch schema, migrations, or RLS in this story** — that's Story 1.3's scope, unaffected by which project URL `.env.local` points to.

## Tasks / Subtasks

- [x] Task 1: Establish ground truth on the existing project (AC: #3)
  - [x] Confirm the existing Supabase project's current region via Dashboard or CLI (see Critical Context above) — confirmed via Dashboard → Project Settings → General: `eu-west-1` (EU West, Ireland)
  - [x] Record this as the "starting state" in `docs/decisions.md` before doing anything else, so the before/after is auditable — see `docs/decisions.md#2026-07-05 — Supabase Cloud region`
- [x] Task 2: Measure RTT from a representative Cameroonian mobile network (AC: #1)
  - [x] Measured via a device tethered to MTN/Orange Cameroon mobile data, using `curl -w` `time_connect` against AWS's own regional endpoints (`s3.eu-west-1.amazonaws.com`, `s3.eu-central-1.amazonaws.com`) as the RTT proxy — Supabase Cloud's EU projects run on AWS in these exact regions, so this is a real network-path measurement, not a weaker substitute; documented as such in `docs/decisions.md`
  - [x] Two independent rounds taken (round 1: 1 sample/region; round 2: 5 samples/region), one clear cold-start outlier excluded — see `docs/decisions.md` for full data and median/trimmed-mean figures
  - [x] Compared only Ireland (`eu-west-1`) vs. Frankfurt (`eu-central-1`) per NFR-010
- [x] Task 3: Select and record the decision (AC: #1, #2)
  - [x] Result was a statistical tie (Ireland ≈71.5ms vs Frankfurt ≈74.0ms median `time_connect`, within measurement noise) — selected Ireland as the tie-break since it avoids infrastructure churn (see rationale in `docs/decisions.md`) and came out marginally ahead in every calculation method tried
  - [x] `docs/decisions.md` created (first entry — `docs/` had no files before this story) with dated entry: candidates tested, methodology, full measured data, result, rationale
  - [x] Confirmed OQ-2 (Notch Pay spike) is tracked separately as Story 4.1, not conflated into this entry
- [x] Task 4: Reconcile the already-existing Supabase project against the decision (AC: #3)
  - [x] Existing project's region (`eu-west-1`, confirmed Task 1) matches the winning region — recorded in `docs/decisions.md`, **no infrastructure change needed**, both apps' `.env.local` files remain correct as-is
- [x] Task 5: Sanity check (AC: #1, #2, #3)
  - [x] `docs/decisions.md` exists with the region decision and full measured data (not an assertion)
  - [x] Both `.env.local` files already point at the `eu-west-1` project (unchanged) — no `turbo dev` re-verification needed since nothing was modified; Story 1.1's most recent smoke test already confirmed this configuration starts cleanly
  - [x] No migrations, RLS policies, or schema changes introduced — out of scope, untouched

### Review Findings

- [x] [Review][Decision→Patch] AC #1 not literally satisfied — result was a statistical tie (~71.5ms vs ~74.0ms, within measurement noise), yet Ireland was selected via a churn-avoidance tiebreak rather than being measured as lower-latency, and Task 3 checks off AC #1 as met without flagging the deviation. **Resolved by user: accept as-is, patch wording** — applied: added an "AC #1 note" to `docs/decisions.md` explicitly stating AC #1 was satisfied via an accepted tiebreak-on-tie rule, not a measured win. Sources: Blind Hunter, Edge Case Hunter, Acceptance Auditor (all three independently flagged this).
- [x] [Review][Decision→Patch] AC #3 was already violated before the spike began (Supabase Cloud project was created in Story 1.1, before any region decision existed) — honestly disclosed in the story's own "Critical Context" section and Completion Notes ("satisfied in substance"), but sprint-status.yaml and this story's Status/Tasks show a clean `review` state with no visible flag that an AC was violated and retroactively accepted. **Resolved by user: accept as a documented exception, patch tracker** — applied: this story's `Status:` line now states the documented exception explicitly.
- [x] [Review][Decision→Dismiss] RTT methodology substitutes generic AWS S3 regional endpoints for actual Supabase Cloud endpoints, with the equivalence ("Supabase Cloud's EU projects run on AWS in these exact regions") merely asserted, not verified or cited. **Resolved by user: accept the S3 proxy as sufficient** — network-path RTT to the AWS region is what matters for the <3s budget; no further action.
- [x] [Review][Patch] Arithmetic/reporting error: `docs/decisions.md` states Ireland's median `time_connect` as "≈71.5ms," but the median of the five listed valid samples (0.101, 0.041, 0.053, 0.070, 0.073) is 0.070s (70ms) [docs/decisions.md:26] — applied: corrected to "≈70.0ms (5 valid samples)" and added Frankfurt's sample count for clarity.
- [x] [Review][Patch] No forward risk mitigation recorded for an admittedly tied, irreversible decision — add a brief "Follow-up" note to `docs/decisions.md` committing to monitor real front-desk check-in-alert latency in production and revisit the region choice if the <3s budget (FR-052) is at risk [docs/decisions.md] — applied: "Follow-up" line added to the decision entry.
- [x] [Review][Defer] `npx supabase projects list` failed with `LegacyPlatformAuthRequiredError` and wasn't retried with a token/login — future spikes (Notch Pay 4.1, SMS/OTP 2.1) remain dependent on manual Dashboard screenshots for region confirmation rather than a scriptable, auditable check [1-2-supabase-region-verification-spike.md:91] — deferred, pre-existing tooling gap
- [x] [Review][Defer] The "if region does NOT match" project-recreation/env-swap/re-verify procedure was never exercised in this story (the match made it moot) — untested path, flag for whichever future spike first hits a mismatch [1-2-supabase-region-verification-spike.md:32] — deferred, no code path to test yet
- [x] [Review][Defer] No raw measurement artifacts (exact curl commands, raw output, Dashboard screenshot) were retained alongside the summarized figures — the sole audit trail for an "irreversible" decision is paraphrased narration [docs/decisions.md] — deferred, data already collected without capture

## Dev Notes

- **This is a measurement/decision spike, not a build story.** The deliverable is a documented, data-backed region decision in `docs/decisions.md` — plus, conditionally, a project swap if the already-existing project guessed wrong. Resist the urge to build anything beyond that (no schema, no RLS, no app code changes beyond `.env.local` if a swap is needed).
- **Why this matters so much it blocks its own AC:** NFR-010 and FR-052 tie region choice directly to the product's signature feature — the <3s front-desk alert (check-in → dashboard alert). US East was already ruled out (200–400ms extra latency); the open question is Ireland vs. Frankfurt specifically, and only real measurement from the target user base's actual network conditions (Cameroonian mobile, not a wired dev machine) answers it. [Source: prd.md#7.7 Infrastructure — NFR-010]
- **The "sprint 1" language in architecture.md** groups this with the Notch Pay and SMS/OTP spikes as "sprint 1, gates its Epic" — that's a narrative grouping in the architecture doc, not the authoritative sequencing. `sprint-status.yaml` is authoritative: this is Story 1.2, Notch Pay is Story 4.1, SMS/OTP is Story 2.1. Don't let the architecture doc's phrasing pull in Notch Pay work here. [Source: architecture.md#Core Architectural Decisions — Decision Priority Analysis]
- **No format is prescribed for `docs/decisions.md` beyond "outcome is recorded"** — use a simple dated-entry format (date, decision, data, rationale) since this is the first entry and later spikes (Notch Pay, SMS/OTP) will follow the same file/pattern. Keep it factual and skimmable, not prose.
- **Testing framework is still undecided** (per Story 1.1's Dev Notes) — no automated test is expected for this story; the "test" is the measured RTT data itself plus the `turbo dev` smoke check if a project swap happens.

### Project Structure Notes

- `docs/` does not exist yet in this repo (confirmed empty/absent) — this story creates `docs/decisions.md` as the first file in it. [Source: _bmad-output/implementation-artifacts/1-1-monorepo-starter-initialization.md#Directory structure to match exactly — "docs/decisions.md # not created yet — first spike story (1.2) creates it"]
- If a project swap is needed: only `apps/dashboard/.env.local` and `apps/super-admin/.env.local` change (both gitignored, not committed — same as Story 1.1). No other file in the repo references the Supabase project URL directly. `apps/mobile` has no Supabase client wiring yet (lands in Story 2.6), so it needs no env change regardless of outcome.
- Local Docker-based Supabase dev (`pnpm dev:local-db`, from Story 1.1) is entirely unaffected by this story — it's a separate local Postgres instance, not the region-pinned Cloud project this story is about.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2] — original acceptance criteria (verbatim above)
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md#7.7 Infrastructure] — NFR-010, the region requirement and its rationale (US East latency numbers, <3s FR-052 link)
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md#Open Questions] — OQ-2, confirms Notch Pay spike is a separate tracked item, not part of this story
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Context Analysis — Working Decisions] — "Region verification" row: EU West is right in principle but needs measured confirmation, not assertion
- [Source: _bmad-output/planning-artifacts/architecture.md#Development Workflow Integration] — describes the already-existing remote Supabase project and the `.env.local` pattern this story must reconcile against
- [Source: _bmad-output/implementation-artifacts/1-1-monorepo-starter-initialization.md#Change Log, #Completion Notes List] — the 2026-07-05 course correction that created the existing (region-unverified) Supabase project; `apps/dashboard/.env.local` / `apps/super-admin/.env.local` pattern to follow if a swap is needed

## Change Log

- 2026-07-05: Confirmed existing Supabase project's region (`eu-west-1`, Ireland) via user checking the Dashboard. Measured RTT from a Cameroonian mobile network (MTN/Orange) against Ireland vs. Frankfurt using AWS regional S3 endpoints as a proxy — result was a statistical tie (~72ms median either way). Selected Ireland as the tie-break since the existing project is already there, avoiding an unnecessary project recreation. Created `docs/decisions.md` (first file in `docs/`) recording the full methodology, data, and rationale. No code, schema, or `.env.local` changes required.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- DNS/header probing of `vfxezibagiznrirdwkwh.supabase.co` (`nslookup`, `curl -D -`) — ruled out as a region signal: the `CF-RAY` datacenter code reflects the Cloudflare edge nearest the querying machine, not Supabase's backend region. Confirmed region instead via user checking the Supabase Dashboard directly.
- `npx supabase projects list` — failed with `LegacyPlatformAuthRequiredError` (no cached CLI session, no `SUPABASE_ACCESS_TOKEN`); did not pursue interactive `supabase login` since the user provided the region directly.
- RTT measurement (user-run, from a device tethered to MTN/Orange Cameroon mobile data): round 1 (`curl -w`, 1 sample/region) — Ireland connect=0.101s, Frankfurt connect=0.099s. Round 2 (5 samples/region via `for /L` loop) — Ireland: 1.018s*, 0.041s, 0.053s, 0.070s, 0.073s; Frankfurt: 0.149s, 0.070s, 0.046s, 0.039s, 0.078s (*excluded as cold-start outlier). Full analysis in `docs/decisions.md`.

### Completion Notes List

- Task 1: existing Supabase project (`vfxezibagiznrirdwkwh`) confirmed at `eu-west-1` (Ireland) via user checking the Dashboard. Recorded as the starting state in `docs/decisions.md`, created for the first time by this story (`docs/` did not exist before).
- Task 2: RTT measured by the user (dev agent has no access to a Cameroonian mobile network) via `curl -w time_connect` against AWS's `s3.eu-west-1`/`s3.eu-central-1` regional endpoints, two independent rounds, one cold-start outlier excluded.
- Task 3: result is a **statistical tie** — median `time_connect` Ireland ≈71.5ms vs Frankfurt ≈74.0ms, well within measurement noise. Selected Ireland as the tie-break (avoids churn, existing project already there, marginally ahead in every calculation variant tried). Full data, methodology, and rationale recorded in `docs/decisions.md`.
- Task 4: existing project's region already matches the winning region — no Supabase project swap, no `.env.local` changes. AC #3's constraint ("project not created until decision recorded") is satisfied in substance: the decision confirms the existing project's region was the right call, even though the decision was technically recorded after project creation rather than before (see Story's own "Critical Context" section — this was flagged and accepted as recoverable going in, since no data had been written).
- Task 5: sanity-checked — `docs/decisions.md` has real measured data (not an assertion), both `.env.local` files unchanged and already consistent, no schema/RLS/migration work introduced.

### File List

- `docs/decisions.md` (new) — region decision: candidates, methodology, measured RTT data, result, rationale, outcome
