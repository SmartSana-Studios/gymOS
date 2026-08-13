# Test Automation Summary

**Story:** 2.9 — Evolution API Sandbox Spike & OTP Provider Fallback Chain
**Feature under test:** `supabase/functions/send-sms-hook/` (Deno Edge Function, no UI — API/unit-level tests only)
**Framework:** Deno's built-in test runner (`Deno.test` + `jsr:@std/assert`). No JS test framework existed anywhere in this monorepo before this story; Deno's native runner is the correct fit since this feature is Deno-only code with its own `deno.json` import map, and it requires no new dependency.

## Generated Tests

### API/Unit Tests

- [x] `supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.test.ts` — `EvolutionApiProvider` (Task 1): missing credentials, missing/null `instance_id` (Story 1.13's "not yet configured" state), DB-error fall-through precondition, non-2xx (`Evolution API 500`) mapping, 2xx success shape, bare-digit `number` field + bold-coded message body, per-request (not cached) `instance_id` read. **8/8 passed.**
- [x] `supabase/functions/send-sms-hook/index.test.ts` — `sendViaChain` ordered fallback-chain runner (Task 2): first-success short-circuit, fall-through on failure (AC #3), a throwing provider not aborting the chain, last-failure-wins when every provider fails (preserves 429/503 `Retry-After` mapping), one log line per attempt with phone redaction, plus direct tests of `redactPhone`/`normalizePhone`. **7/7 passed.**

### E2E Tests

- Not applicable — this story is a backend Edge Function change only (`send-sms-hook`), no dashboard/mobile/super-admin UI surface. Per the story's own Testing Standards: "No Next.js/Turborepo typecheck covers Deno code... the real spike execution (Task 4) plus a manual chain-runner invocation are the actual tests here" — Task 4's live spike (documented in `docs/decisions.md`, 2026-08-12) already covered the true end-to-end path against the real Evolution API instance and a real connector disconnect; these new tests cover the code-level logic that spike can't re-run on every commit.

## Gap Applied

`sendViaChain`, `PROVIDER_CHAIN`, `redactPhone`, and `normalizePhone` were previously private to `index.ts`'s module scope, making Task 2's chain-runner logic (the story's core new behavior) untestable in isolation. Added one non-behavioral line exporting them for tests only (`export default { fetch }` — the Edge Function's real entry point — is unchanged; Supabase's runtime ignores named exports).

## Coverage

- `EvolutionApiProvider` (new in this story): all `send()` branches covered — credential guard, DB-read success/failure, HTTP success/failure, request-shape assertions, per-request freshness.
- Chain runner (new in this story): short-circuit, fall-through, throw-resilience, last-failure-wins, logging/redaction — all AC #2/#3/#4 behaviors covered.
- `TwilioSmsProvider`/`TwilioWhatsAppProvider`/`SentDmProvider` themselves: unchanged by this story (only *how* they're invoked changed); Task 6's manual regression + the chain-runner tests above (which exercise the loop mechanics with stand-in providers) are the coverage for this story's scope. No behavioral changes to their own `send()` implementations were made, so no new tests were added directly against them.

## Verification

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

## Next Steps

- Wire `deno test --config supabase/functions/send-sms-hook/deno.json supabase/functions/send-sms-hook` into CI so this suite runs on every push (no CI Deno step exists yet for this repo).
- If Story 2.5's revision adds `WhatsAppMessageProvider`/`EvolutionApiMessageProvider` for member invitations, mirror this file's fetch-stubbing pattern rather than re-deriving it.
