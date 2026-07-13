# Manual walkthrough findings — 2026-07-13

Found while wiring up a real, browser-driven walkthrough of the Super Admin
"Create Gym" flow (Story 1.5) and the Dashboard app (Stories 1.8-1.10), ahead
of a client demo. Both apps were run for real (`next dev`) against a real
local Supabase instance, driven with an actual headless browser — not unit
tests, not a mocked client. Both bugs below are new: neither is mentioned in
`docs/decisions.md` or `_bmad-output/implementation-artifacts/deferred-work.md`,
and Story 1.5's own manual-verification notes explicitly used a hand-rolled
Node script talking to `supabase-js` directly rather than a real browser
following the real generated link — which is exactly the gap that hid both
of these.

---

## Finding 1 — Create Gym form is unusable out of the box (seeded tier IDs fail client-side validation)

**Status: Fixed.** `supabase/migrations/0010_super_admin_gym_provisioning.sql`
and `0011_super_admin_tier_gym_lifecycle.sql` now seed/reference
RFC-4122-conformant tier UUIDs (`00000000-0000-4000-8000-000000000101/102/103`).
Verified live: created a real gym through the actual Create Gym form with no
validation error.

**Severity:** Blocking. Nobody can create a gym through the Super Admin UI in
any fresh environment (local, staging, or a real deploy that runs migration
0010 as-is).

**Repro:**
1. Log in to `apps/super-admin` as a super admin.
2. Open **Gyms → + Create Gym**, fill in every field, and pick any
   Subscription Tier from the dropdown (Hustle/Grind/Elite — the only three
   that exist).
3. Submit.
4. The form rejects it with **"Select a subscription tier"** on the tier
   field, even though a tier is visibly selected.

**Root cause:** `createGymSchema.tierId` uses `z.uuid(...)`
(`packages/types/src/schemas/gym.ts:25`). Zod v4's `z.uuid()` enforces
RFC-4122's version nibble (must be `1`-`8`, or the exact all-zero/all-`f`
nil/max UUIDs). The three tiers seeded by
`supabase/migrations/0010_super_admin_gym_provisioning.sql:117-119` use
placeholder IDs —
`00000000-0000-0000-0000-000000000101/102/103` — whose version nibble is
`0`. They are syntactically UUID-shaped but fail `z.uuid()`'s stricter check.
Confirmed directly:

```js
z.uuid().safeParse('00000000-0000-0000-0000-000000000103') // → success: false
z.uuid().safeParse('11111111-1111-4111-8111-111111111111') // → success: true (real v4)
```

This form has therefore never worked against its own seed data on this zod
version — the bug isn't reachable in isolated unit tests of `createGym()`
because it's a client-side check in `CreateGymModal.tsx` that runs before the
Server Action is ever called.

**Fix:** Re-seed migration 0010 with spec-conformant UUIDs (e.g. real
`gen_random_uuid()` values, or handwritten v4-shaped placeholders like
`00000000-0000-4000-8000-000000000101`). If any environment has already run
0010 as-is, existing tier rows also need updating (and anything that
references them by ID, e.g. `gyms.tier_id`) via a follow-up migration —
they can't just be edited in place if real gyms already reference them.

**What I did locally (dev-only, not committed):** regenerated the 3 seed
tiers' `id` columns via `update tiers set id = gen_random_uuid()` directly in
the local Postgres container, so the form is usable for continued local
testing/demoing. This is not a code fix and does not survive `supabase db
reset`.

---

## Finding 2 — Owner invite/recovery link doesn't establish a session (dead-end for real invited owners)

**Status: Fixed.** `apps/super-admin/app/(admin)/gyms/actions.ts`'s
`createGym` now builds the invite link from `linkData.properties.hashed_token`
pointed at `apps/dashboard`'s own `/auth/confirm` route (new server-only
`DASHBOARD_APP_URL` env var), instead of sending GoTrue's raw `action_link`.
Verified live: following the real generated link now correctly establishes a
session and lands on `/auth/update-password` — the exact step that
previously failed. Also had to fix a required follow-on to make the fix
complete end-to-end:
`apps/dashboard/components/update-password-form.tsx` was redirecting to
`/protected`, a route that doesn't exist in this app (identical leftover
starter-kit bug to the one noted below for super-admin's login form) — a
successful password reset would still 404 without this. Changed to redirect
to `/` (AD-02 Overview).

**Severity:** Blocking for the owner-onboarding path. A gym owner who
receives the invite (once real SMS delivery, Story 2.1, replaces today's
console-log stub) and taps the link cannot set a password or sign in — they
land back on the plain login page with no session and no way to proceed
(they don't know the random temp password `createGym` generated for them).

**Repro:**
1. Super Admin creates a gym (see Finding 1 for a workaround to get past the
   form). `createGym`'s `sendInviteSms` stub logs the real link to the
   server console:
   `[invite-sms-stub] Would send SMS to <phone> with login link: <url>`.
2. Open that exact URL in a real browser (simulating the owner tapping the
   SMS link).
3. Instead of a "set your password" screen, the browser ends up on
   `apps/dashboard`'s plain `/auth/login` page, logged out, with no error
   shown.

**Root cause (traced, not guessed):**
- `createGym` (`apps/super-admin/app/(admin)/gyms/actions.ts:126-129`) calls
  `admin.auth.admin.generateLink({ type: "recovery", email })` and sends
  `linkData.properties.action_link` as the invite link. `action_link` points
  at **GoTrue's own** `/auth/v1/verify?token=...&type=recovery&redirect_to=...`
  endpoint — confirmed by hitting `generate_link` directly:
  `action_link: "http://127.0.0.1:54321/auth/v1/verify?token=...&type=recovery&redirect_to=http://127.0.0.1:3000"`.
- Visiting that URL makes **GoTrue itself** verify the token and redirect to
  the bare `redirect_to` origin, appending the new session as a URL **hash
  fragment** (the implicit-grant pattern) — never reaching the dashboard
  app's own `/auth/confirm` route
  (`apps/dashboard/app/auth/confirm/route.ts`), which already has the
  correct server-side handling (`supabase.auth.verifyOtp({ type, token_hash
  })`) but is simply never in this URL's path.
- A hash fragment is never sent to the server, so it can only be consumed by
  client-side JS (`detectSessionInUrl`) *after* the page loads. But
  `apps/dashboard/lib/supabase/proxy.ts` (Story 1.8) redirects any
  unauthenticated request to a non-`/auth/*` path — including `/` — to
  `/auth/login` **in middleware, server-side, before that client JS ever
  runs**. Per the middleware's own comment, `/` was deliberately made
  non-public by Story 1.8 ("no longer exempted... AD-02 Overview
  (protected)"). Before that story, an unauthenticated `/` wouldn't have
  redirected, giving the client JS time to consume the hash; now it loses
  that race every time.
- Net effect: Story 1.8's middleware change silently broke Story 1.5's
  recovery-link flow. The two were never integration-tested together via a
  real browser — Story 1.5's manual verification (see
  `_bmad-output/implementation-artifacts/1-5-super-admin-create-onboard-a-gym.md`,
  Debug Log References) used a hand-written Node script that called
  `supabase-js` directly and constructed session cookies manually; it never
  actually loaded the generated link in a browser.

**Fix:** Don't send `action_link` (GoTrue's own verify URL). GoTrue's
`generate_link` response already includes a `hashed_token` field alongside
`action_link` — confirmed:
`{"action_link": "...", "hashed_token": "6ced6c6c713f...", "verification_type": "recovery", ...}`.
Build the invite link yourself, pointed at the app's own already-working
confirm route instead:

```
${DASHBOARD_URL}/auth/confirm?token_hash=${linkData.properties.hashed_token}&type=recovery&next=/auth/update-password
```

That route does the `verifyOtp` call server-side and sets real session
cookies before ever redirecting, so it doesn't race the middleware. This is
also the standard pattern Supabase itself documents for custom
email/SMS templates (build the link from `token_hash`, don't rely on
`action_link`).

---

## Minor (not blocking, noting for completeness)

`apps/super-admin/components/login-form.tsx:44` still does
`router.push("/protected")` after a successful login — leftover
Supabase-starter scaffolding (`docs/decisions.md`'s 2026-07-10 entry already
flags `app/protected/**` as confirmed-dead and excluded from lint, but the
login form's redirect target wasn't specifically called out). A real admin
logging in lands on the starter's raw-JWT debug page for one beat before
they'd manually navigate to Gyms/Metrics/Tiers via the top nav — not broken,
just a rough first-run edge that's easy to fix in the same pass as the two
findings above (redirect to `/gyms` instead).

---

## Environment note (not a code bug)

While re-verifying Finding 2's fix, this session's local Supabase (run via
WSL2 Docker) needed a full `wsl --shutdown`/restart to fix an unrelated
clock-drift issue (`PGRST303 "JWT issued at future"`, from WSL2's clock
free-running across repeated suspend/resume). After that restart, both
Next.js dev servers' Turbopack HMR WebSocket
(`ws://127.0.0.1:PORT/_next/webpack-hmr`) started failing its handshake
(`ERR_INVALID_HTTP_RESPONSE`) through WSL2's NAT port-forwarding — a known
class of WSL2 networking flakiness. Effect: real page loads and hydration
worked fine, but client-side form submissions (reproduced even on the
untouched login form, in both apps) stopped invoking their React `onSubmit`
handlers and fell through to a native HTML form GET instead. This blocked
live verification of the very last step of Finding 2 (submitting the new
password and landing on Overview) in this session. It is a local dev-tooling
artifact of WSL2 + Turbopack, not reachable in a real deployment (no WSL2 in
the loop) — restarting the local dev servers fresh (not through repeated WSL
suspend/resume) should clear it.

## What still works (verified via the same real browser walkthrough)

- Super Admin login, Gyms list, and Gym detail pages render and behave
  correctly.
- Once past Finding 1 (locally patched), gym + owner + membership creation
  succeeds end-to-end (DB rows for `gyms`/`auth.users`/`public.users`/
  `members`/`audit_log` all correct).
- Dashboard owner login (once a password is set directly via the Admin API,
  bypassing Finding 2) reaches the Overview page and Settings
  (branding/operational) page correctly, and the EN/FR language toggle
  works.
