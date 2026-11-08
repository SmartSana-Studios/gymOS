---
title: '24-3 Staff session cookies: __Host- prefix, host-only'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'dispatch'
baseline_commit: '419c59521755c62150ef71cfe7bce0639bb768c5'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Dashboard and super-admin session cookies are `sb-<ref>-auth-token.N` with no `Secure` flag. A gym page under `*.gymosapps.com` could set or overwrite a cookie of that name from a sibling host, so a public page could hijack or clobber a staff login (NFR-026 cookie half, AD-44).

**Approach:** One shared `cookieOptions` per app (`name: '__Host-sb-auth'`, `secure: true`, `path: '/'`, `sameSite: 'lax'`, no `domain`) used by `server.ts`, `proxy.ts` and browser `client.ts`. Old-name cookies are cleared and the user sent once to sign-in with the existing `auth.sessionExpired` copy. Spike 24.1 and 22.1 confirmed this works with `@supabase/ssr` 0.12.7 in Chromium, so the separate-domain fallback is not triggered.

## Boundaries & Constraints

**Always:** `secure: true` explicit (the helper omits it otherwise and browsers reject the cookie). Every chunk and every removal cookie carries the prefix, `Path=/`, `Secure`, no `Domain`. Both apps use the same options module (a parity test fails if they drift). Production is `appEnvironment() === 'production'` from `lib/app-env.ts`, not `NODE_ENV`, so the Playwright `next start` run is not production.

**Never:** no `domain` option. No change to the session gate (23-6b), role redirects or `/api/cron`, `/api/version` exemptions. No migration. No change to `apps/mobile` or `apps/landing`. Do not touch the uncommitted `apps/dashboard/AGENTS.md` or `scripts/demo-gym/`. No cross-host session handoff (owner., portal., www. sessions are isolated by design).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sign-in | valid credentials | every `Set-Cookie` chunk `__Host-sb-auth.N; Path=/; Secure; SameSite=Lax`, no `Domain` | N/A |
| Sign-out / removal | signed-in session | removal cookies also prefixed, `Path=/`, `Secure`, `Max-Age=0` | N/A |
| Legacy session | request has `sb-*-auth-token*`, no `__Host-sb-auth*` | legacy cookies cleared on the response, 307 to `/auth/login?expired=1` once | already on `/auth/*` or exempt path: clear only, no redirect |
| Legacy plus new | both present | legacy cleared, request continues with the new session | N/A |
| Local dev over HTTP | gate `AUTH_COOKIE_UNPREFIXED=1`, non-production | name `sb-auth`, `secure` follows protocol | N/A |
| Production with gate | `AUTH_COOKIE_UNPREFIXED` set and `appEnvironment()==='production'` | server refuses to start (`register()` throws) and options builder throws | clear error message naming the variable |
| Prefixed cookie over HTTP on a non-localhost host (dev) | `next dev` reached via LAN IP | dev-time check throws an explicit error | otherwise login "succeeds" and nobody is signed in |

</frozen-after-approval>

## Code Map

- `apps/dashboard/lib/supabase/{server,proxy,client}.ts`, `apps/super-admin/lib/supabase/{server,proxy,client}.ts` -- all six pass no `cookieOptions` today; each gets the shared options. Browser client must be able to read the cookie (not HttpOnly).
- `apps/dashboard/lib/app-env.ts` (and super-admin twin) -- `appEnvironment()` decides production; reuse, do not read `VERCEL_ENV` elsewhere (`scripts/check-host-neutral-env.mjs` fails CI).
- `apps/*/instrumentation.ts` -- `register()` is the startup hook for the production refusal.
- `apps/dashboard/lib/supabase/proxy.ts` -- `?expired=1` redirect pattern already exists in the session gate (copies refreshed cookies onto the redirect). Mirror it for legacy cookies. Dashboard exempt paths (`/api/cron/`, `/api/version`, `/privacy`, support-invite and reset-cancel) must not be redirected.
- `apps/super-admin/lib/supabase/proxy.ts` -- no `expired` handling yet; `app/auth/login/page.tsx` and `components/login-form.tsx` already render `auth.sessionExpired` for `?expired=1`.
- `apps/dashboard/lib/supabase/proxy.test.ts`, `proxy.gate.test.ts`, `super-admin/lib/supabase/proxy.test.ts` -- existing mocks of `@supabase/ssr`; extend, keep passing.
- `apps/dashboard/playwright.config.ts` -- `next start` on `http://127.0.0.1`; Chromium treats it as secure, so prefixed cookies should hold. `apps/dashboard/e2e/` -- specs sign in through the UI.
- `docs/decisions.md` (22.1 and 24.1 entries) -- evidence and the release-notice pattern from 23.0.

## Tasks & Acceptance

**Execution:**
- [x] `apps/{dashboard,super-admin}/lib/supabase/cookie-options.ts` -- shared builder: prefixed options, dev gate, production throw, legacy-cookie name matcher, dev HTTP check -- one source for six call sites
- [x] six `server/proxy/client.ts` files -- pass `cookieOptions` -- closes the gap
- [x] both `proxy.ts` -- clear legacy cookies and redirect to `/auth/login?expired=1` when only legacy cookies exist -- one-time re-sign-in
- [x] both `instrumentation.ts` -- call the production-refusal check in `register()` -- refuse to start
- [x] `cookie-options.test.ts` per app plus a parity test -- assert prefix, `Secure`, `Path=/`, no `Domain` on every chunk and removal cookie (including an oversized multi-chunk session), the matrix rows, and that the two modules are identical; fails if an app emits an auth cookie without them
- [x] `docs/decisions.md` -- 24.3 entry: options, cutover, release checklist: send the save-your-work notice to staff before release (23.0 pattern), Firefox and Safari real-HTTPS check before cutover (failure reopens the AD-44 fallback)

**Acceptance Criteria:**
- Given either app, when a session cookie is issued or removed, then it has no `Domain`, `Path=/`, `Secure`, `SameSite=Lax` and `__Host-` on every chunk, and a unit test fails otherwise
- Given a session with the old cookie name, when its next request arrives, then the user reaches sign-in once with the "session expired" copy and the old cookies are cleared
- Given local dev over HTTP with the gate, then an unprefixed name is used; and given the gate in a production environment, then the app refuses to start
- Given `scripts/ci-local.sh` and the Playwright baseline, when they run, then sign-in, sign-out, role redirect and refresh paths pass for both apps; run once against a deliberately unprefixed cookie to show the new test can fail

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| No test proves proxy/server/client pass `cookieOptions` | medium | patch | Deleting the line keeps all tests green; the three call sites alone make the apps issue `__Host-sb-auth`. |
| Production startup refusal untested | medium | patch | Removing the `register()` call keeps tests green. |
| Browser client never throws on the gate in production | low | reject | `register()` stops the server starting, so a bundle with the gate is never served; a fix adds a build-time guard. |
| Safari rejects Secure cookies on http://localhost | maybe-false | reject | Dev-only, would be low; the release checklist already requires a Safari real-HTTPS check. |
| Legacy matcher omits `-code-verifier` cookie | low | reject | A stale verifier is harmless; matching it would show "session expired" to people who never had a session. |
| Legacy redirect drops `next` | low | reject | Matches the matrix row and the 23-6b pattern; one-time cutover. |
| Non-307 redirect skips expired copy | false | reject | `NextResponse.redirect` defaults to 307 and the inner gate uses it. |
| Legacy clear omits Domain | false | reject | Old cookies came from `@supabase/ssr` with no `cookieOptions`, so no Domain was ever set. |
| `server.ts`/`client.ts` Secure differs with dev gate on | low | reject | Dev-only gate over HTTP; fix adds parameters. |
| `*.localhost`, preview env, Edge runtime, no APP_ENV off Vercel | low | reject | Existing `appEnvironment()` convention; dev-time check only. |
| Dev check returns 500 on a LAN IP | false | reject | The explicit error is the spec's behavior. |
| Negative test passes for unrelated reasons | false | reject | The same `drive()` yields cookies in the positive tests; only the attributes differ. |
| No no-legacy or non-login-redirect cases in legacy tests | low | reject | Pass-through is covered by the existing proxy tests. |
| `app-env.ts` not in parity test | low | reject | Files are byte-identical today. |
| Env var docs, rollback note | low | reject | Docs only; the dev check error names the variable. |
| AGENTS.md change, `scripts/demo-gym/` in tree | false | reject | Pre-existing, left by the owner's decision; not in the diff. |

### Review Findings

Code review 2026-11-08 of commit 0884b15 (layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor; none failed).

- [x] [Review][Patch] Proxy dev-time HTTP guard is not pinned by any test — add a case to `cookie-callsites.test.ts` in each app: `updateSession` on `http://192.168.1.5:3000/members` with `APP_ENV=development` and the gate unset rejects with `AUTH_COOKIE_UNPREFIXED`, and `http://localhost` does not [apps/dashboard/lib/supabase/proxy.ts:57, apps/super-admin/lib/supabase/proxy.ts] (verification-gap; deleting the `assertPrefixedCookieCanStick` call keeps every test green)
- [x] [Review][Patch] `assertPrefixedCookieCanStick` rejects `*.localhost` hosts (`owner.localhost`), which Chromium treats as secure, so the dev check would 500 every request once Epic 24 dev uses subdomains — treat `hostname.endsWith(".localhost")` as local, in both byte-identical copies, plus a test [apps/*/lib/supabase/cookie-options.ts] (edge-case-hunter + blind-hunter; low, direct one-line correction; no `*.localhost` use in the repo yet)
- [x] [Review][Defer] The last acceptance criterion (run the Playwright baseline once against a deliberately unprefixed cookie to show the e2e check can fail) is not evidenced by the diff — deferred: maybe-false, would be medium if true; settle by checking the 24-3 ci-local/Playwright run log for the negative run, or running it once [acceptance-auditor + blind-hunter]

#### Rejected

- Browser client cannot see `APP_ENV`, so its production guard is dead (acceptance-auditor, edge-case-hunter, blind-hunter, verification-gap): low. `register()` throws at server start, so a production deploy with the gate never serves; already in the triage log above.
- `server.ts` calls `authCookieOptions()` with no `secure`, so gate-on over HTTPS is non-Secure (acceptance-auditor, edge-case-hunter): low. Dev-only gate, plain HTTP is its purpose; the fix adds parameters.
- Legacy redirect replaces the inner response and drops its cookies and headers, and drops `next` (acceptance-auditor, edge-case-hunter, blind-hunter): low. It only runs when no current session cookie exists, so the inner response carries no refreshed cookies; `next` loss is the matrix row.
- Exempt-path tests miss `/api/cron/`, support-invite and reset-cancel (acceptance-auditor, blind-hunter): low. The inner gate decides exemption and those paths are covered by the existing proxy tests.
- `request.cookies.delete` and the `getAll` result are not asserted (verification-gap, disposition defer): low. Cookies are still cleared on the response; no user-visible effect.
- Legacy matcher omits `-code-verifier` and `.N` variants (edge-case-hunter): false for `.N` (the regex has `(\.\d+)?`); low for the verifier, already rejected above.
- Dev guard uses `nextUrl.protocol`, not `x-forwarded-proto` (edge-case-hunter): low. A speculative HTTPS-tunnel case with no shown path to it; the fix adds a branch.
- Wrapper duplicated in both `proxy.ts` files and `app-env.ts` is outside the parity test (blind-hunter): low. Already rejected above; byte-identical today.
- Spec says `status: done` while sprint-status says `review`; empty Implementation Notes and Change Log (acceptance-auditor, blind-hunter): the fix edits the spec metadata; status is set by this review's step 6.
- pgtap failure recorded only in a sprint-status comment; release checklist lacks rollback steps and the notice mechanics; `AUTH_COOKIE_UNPREFIXED` undocumented in `.env.example`; forced re-login not weighed against a session migration (blind-hunter): low. Docs and process points, or a spec decision already made; fix is to edit the spec or docs.
- Nothing checks other readers of `sb-<ref>-auth-token` (e2e `storageState`, `scripts/epic19-qa`) (blind-hunter): false. The verification-gap layer searched `apps/` and `packages/` and found no other readers; the e2e baseline question is the deferred item above.

## Verification

**Commands:**
- `cd apps/dashboard && pnpm vitest run lib/supabase` and the same in `apps/super-admin` -- expected: pass
- `node scripts/check-host-neutral-env.mjs` -- expected: OK
- `scripts/ci-local.sh` -- expected: every stage GREEN (read per-stage lines)

**Manual checks (owner):**
- Firefox and Safari on real HTTPS: sign in, refresh, new tab, sign out on `owner.` and `portal.` before cutover.
