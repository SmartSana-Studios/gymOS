# Test Automation Summary

This file accumulates one section per story's QA-automation run (most recent first) rather than being overwritten per run — the fixed `tests/test-summary.md` output path is shared across stories, so each run's section is kept rather than replacing the last.

---

## Story 2.10 — Automated Member Invite via Evolution API

### Framework

`apps/dashboard` had no automated JS/TS test runner before this workflow run (confirmed by every prior story's Testing Standards note, and by grepping the monorepo for `jest`/`vitest`/`playwright` config — none existed for any Next.js app; only Deno tests under `supabase/functions/` and pgTAP under `supabase/tests/`).

**Vitest** was added as the first test runner for `apps/dashboard` (native ESM/TS, no separate transpile config, integrates cleanly with the app's `moduleResolution: "bundler"` and `@/*` path alias) plus `@testing-library/react` / `@testing-library/user-event` / `jsdom` for the one UI-workflow suite. No browser/Playwright E2E setup exists in this monorepo, and this story's own Testing Standards note that live verification was done manually against the real Evolution API gateway (which isn't something a CI-run browser test should be doing) — so the "E2E" layer here is a component-level React Testing Library suite driving the actual `MembersPageClient` "Send Invite" button through real clicks, not a mocked shallow render.

New files: `apps/dashboard/vitest.config.mts`, `apps/dashboard/vitest.setup.ts`. New script: `pnpm --filter dashboard test` (`vitest run`). New Turborepo task: `test` (`turbo.json`).

Tests are colocated next to the source they cover (`*.test.ts(x)` beside the file under test), matching this repo's existing Deno-test convention (`EvolutionApiProvider.test.ts` beside `EvolutionApiProvider.ts`) rather than a single top-level `tests/` directory.

### Generated Tests

**Unit Tests**

- [x] `apps/dashboard/lib/messaging/EvolutionApiMessageProvider.test.ts` — 8 tests. Mirrors the Deno test suite for the sibling `EvolutionApiProvider.ts` this file was ported from: missing env config, missing/null `instance_id`, DB lookup error, non-2xx gateway response (status + body surfaced), 2xx success, exact REST contract (`POST {baseUrl}/message/sendText/{instance}`, `apikey` header, `+`-stripped `number` field), per-request (non-cached) `instance_id` reads, and a body-read failure on a non-ok response.
- [x] `apps/dashboard/services/members.getMemberForInvite.test.ts` — 5 tests. The new `getMemberForInvite` gym-scoped lookup: happy path, no matching row, member with no phone, no `gym_id` claim on the session, and a genuine query error mapped (never thrown).
- [x] `apps/dashboard/app/(dashboard)/members/actions.sendMemberInvite.test.ts` — 6 tests. The new `sendMemberInvite` Server Action's orchestration: `memberId` validation, member-not-found propagation, AC #2's `sent:true`, AC #3's `sent:false`/`error:null` (the fallback-triggering shape), message composition from the re-fetched name + session `gymName` (never client-supplied), and AC #4's unguarded resend (two independent calls).

**UI / Workflow Tests**

- [x] `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.sendInvite.test.tsx` — 4 tests, real user clicks via `@testing-library/user-event`: AC #1/#2 successful send shows the confirmation toast and never opens the fallback modal; AC #3 a `sent:false` result shows the failure toast **and** opens `InviteMemberModal` as fallback; AC #4 the button stays enabled and clickable immediately after a send (resend, no guard); and the per-row "sending" in-flight label/disabled state while the call is pending.

### Coverage

- New Story 2.10 code paths: `EvolutionApiMessageProvider` (all branches), `getMemberForInvite` (all branches), `sendMemberInvite` (all branches), `MembersPageClient`'s Send Invite wiring (AC #1-#4, all exercised).
- Not covered by this run (by design, matches the story's own Testing Standards): a real network call against the live `evo.ultradominon.com` gateway — the story's Dev Agent Record already confirms this was manually verified with user consent; automating a live third-party call in a test suite would be flaky and unnecessary given the unit-level HTTP contract is fully covered above.
- `InviteMemberModal.tsx` itself is unmodified by this story (Story 2.5's own component) and is stubbed, not re-tested, in the workflow suite — it already shipped under Story 2.5.

### Verification Run

```
pnpm --filter dashboard test        # 4 files, 23 tests, all passing
pnpm --filter dashboard typecheck   # 0 errors
pnpm --filter dashboard lint        # same 4 pre-existing baseline errors (RecordRefundModal.tsx/RenewalModal.tsx), no new failures
node scripts/check-i18n-key-parity.mjs  # OK, all 4 locale sets in parity
```

### Next Steps

- Done as part of this run: `.github/workflows/ci.yml`'s `typecheck` job now also runs `npx turbo run test --filter=@gymos/dashboard`, alongside the existing typecheck/lint/i18n-parity gates — this suite was a gap (new tests, no CI wiring) that would otherwise have silently rotted.
- If a future story introduces a resend-history/rate-limit, extend `actions.sendMemberInvite.test.ts`'s AC #4 case rather than adding a new file.

---

## Story 2.9 — Evolution API Sandbox Spike & OTP Provider Fallback Chain

**Feature under test:** `supabase/functions/send-sms-hook/` (Deno Edge Function, no UI — API/unit-level tests only)
**Framework:** Deno's built-in test runner (`Deno.test` + `jsr:@std/assert`). No JS test framework existed anywhere in this monorepo before this story; Deno's native runner is the correct fit since this feature is Deno-only code with its own `deno.json` import map, and it requires no new dependency.

### Generated Tests

**API/Unit Tests**

- [x] `supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.test.ts` — `EvolutionApiProvider` (Task 1): missing credentials, missing/null `instance_id` (Story 1.13's "not yet configured" state), DB-error fall-through precondition, non-2xx (`Evolution API 500`) mapping, 2xx success shape, bare-digit `number` field + bold-coded message body, per-request (not cached) `instance_id` read. **8/8 passed.**
- [x] `supabase/functions/send-sms-hook/index.test.ts` — `sendViaChain` ordered fallback-chain runner (Task 2): first-success short-circuit, fall-through on failure (AC #3), a throwing provider not aborting the chain, last-failure-wins when every provider fails (preserves 429/503 `Retry-After` mapping), one log line per attempt with phone redaction, plus direct tests of `redactPhone`/`normalizePhone`. **7/7 passed.**

**E2E Tests**

- Not applicable — this story is a backend Edge Function change only (`send-sms-hook`), no dashboard/mobile/super-admin UI surface. Per the story's own Testing Standards: "No Next.js/Turborepo typecheck covers Deno code... the real spike execution (Task 4) plus a manual chain-runner invocation are the actual tests here" — Task 4's live spike (documented in `docs/decisions.md`, 2026-08-12) already covered the true end-to-end path against the real Evolution API instance and a real connector disconnect; these new tests cover the code-level logic that spike can't re-run on every commit.

### Gap Applied

`sendViaChain`, `PROVIDER_CHAIN`, `redactPhone`, and `normalizePhone` were previously private to `index.ts`'s module scope, making Task 2's chain-runner logic (the story's core new behavior) untestable in isolation. Added one non-behavioral line exporting them for tests only (`export default { fetch }` — the Edge Function's real entry point — is unchanged; Supabase's runtime ignores named exports).

### Coverage

- `EvolutionApiProvider` (new in this story): all `send()` branches covered — credential guard, DB-read success/failure, HTTP success/failure, request-shape assertions, per-request freshness.
- Chain runner (new in this story): short-circuit, fall-through, throw-resilience, last-failure-wins, logging/redaction — all AC #2/#3/#4 behaviors covered.
- `TwilioSmsProvider`/`TwilioWhatsAppProvider`/`SentDmProvider` themselves: unchanged by this story (only *how* they're invoked changed); Task 6's manual regression + the chain-runner tests above (which exercise the loop mechanics with stand-in providers) are the coverage for this story's scope. No behavioral changes to their own `send()` implementations were made, so no new tests were added directly against them.

### Verification

Ran locally (Deno CLI not present in the base container — installed via `https://deno.land/install.sh` for this verification run):

```
deno test --allow-env --allow-net --config supabase/functions/send-sms-hook/deno.json \
  supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.test.ts
# ok | 8 passed | 0 failed

deno test --allow-env --allow-net --config supabase/functions/send-sms-hook/deno.json \
  supabase/functions/send-sms-hook/index.test.ts
# ok | 7 passed | 0 failed

deno check --config supabase/functions/send-sms-hook/deno.json supabase/functions/send-sms-hook/index.ts
# Check supabase/functions/send-sms-hook/index.ts (clean)
```

**All 15 tests pass.**

### Next Steps (as of Story 2.9's run)

- Wire `deno test --config supabase/functions/send-sms-hook/deno.json supabase/functions/send-sms-hook` into CI so this suite runs on every push (no CI Deno step exists yet for this repo).
- If Story 2.5's revision adds `WhatsAppMessageProvider`/`EvolutionApiMessageProvider` for member invitations, mirror this file's fetch-stubbing pattern rather than re-deriving it. — **Done in Story 2.10's section above.**
