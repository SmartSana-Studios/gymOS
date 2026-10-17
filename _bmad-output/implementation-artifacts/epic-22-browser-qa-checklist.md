# Epic 22 — Browser QA Checklist (super-admin app)

Stories covered: 22-5 (`/security`), 22-6 (`/auth/mfa`), 22-7 (session limits, step-up, lockout).
Stories 22-1..22-4 are database/edge/CI only; nothing to click.
Compiled 2026-10-16 from the story specs and `docs/runbooks/super-admin-recovery.md`; not yet run by hand.

## Setup

- Local stack with TOTP enabled in `supabase/config.toml`; restart the auth container so it picks the setting up.
- One Super Admin account, an authenticator app (or a TOTP generator), ideally a second device/app entry for 2 factors.
- Flag state is noted per section. Flip it with `scripts/enable-super-admin-aal2.mjs` / `reset-super-admin-factors.mjs` (dry-run is the default; `--apply --operator <name>` to act).
- For section C, shorten limits instead of waiting: `update private.session_limits_config` (`idle_minutes`, `absolute_session_minutes`, `stepup_ttl_minutes`, `stepup_failure_threshold`). Restore afterwards.

## A. `/security` — enrollment (22-5, flag OFF)

1. Open `/security` as a Super Admin: page loads, lists current factors (empty on a fresh account).
2. Start enrollment: QR code and secret render; the browser never calls `mfa.enroll` itself (Server Action only).
3. Enter a valid code: factor becomes verified and appears in the list.
4. Enter a wrong code: error shown, factor stays unverified.
5. Abandon an enrollment, then enroll again: the stale unverified factor is cleaned up, no duplicate left behind.
6. Enroll a second verified factor (with the first verified, you must be aal2 — go via `/auth/mfa` first): succeeds.
7. Remove one factor while two exist: succeeds, and an audit row `super_admin_mfa_removed` is written.
8. Try to remove the only remaining verified factor (flag ON): blocked by the last-factor guard, in the app and also by the database (migration 0129).

## B. `/auth/mfa` — sign-in prompt (22-6)

Run `enable-super-admin-aal2.mjs --apply` first (needs exactly 2 verified factors per Super Admin).

9. Sign in with password only, then open any admin route (e.g. `/gyms`): you land on `/auth/mfa`, not `/auth/login`, and there is no redirect loop.
10. Enter a wrong code: error shown, you stay on `/auth/mfa`.
11. Enter a correct code: you reach `/gyms` at aal2.
12. Open `/auth/mfa` with no session: redirected to `/auth/login`.
13. Sign in as a non-Super-Admin (aal1): denied, and not sent to `/auth/mfa`.
14. With the flag OFF, type `/auth/mfa` into the address bar by hand (runbook bootstrap step 2): the prompt works and gets you to aal2 to add factor two.
15. Flag on, aal1 session, try enrolling a new factor on `/security`: refused.

## C. Session limits and expiry (22-7, flag ON)

16. Set `idle_minutes` to 1, sign in at aal2, wait past it, click any admin route: session removed, redirected to `/auth/login?expired=1`.
17. The login page shows the "session expired" notice, and signing in again works (no redirect loop).
18. Set `absolute_session_minutes` to 1 and repeat while staying active: expires on age, same notice.
19. With the flag OFF, none of the above applies (no expiry, no notice).

## D. Step-up prompt (22-7, flag ON)

20. Remove a verified factor on `/security`: a step-up prompt asks for a fresh code. Enter a valid one: removal proceeds.
21. Press Enter inside the prompt: it submits once and does not also submit the parent form.
22. Wrong code in the prompt: error shown, prompt stays open, you can retry.
23. Reuse a code/grant after a successful removal: a second removal asks for step-up again (single use).
24. Let `stepup_ttl_minutes` (set to 1) lapse before confirming: the grant is refused and you are asked again.
25. After removing a factor, the global sign-out runs: you are signed out everywhere. If sign-out is made to fail, the warning (`signOutFailed`) appears.
26. (changed by retro item 54) With the flag ON, create a Super Admin via `AddAdminModal`: refused with the "turned off while the second factor is required" message, nothing is created, you are not signed out.
27. Bootstrap window: `node scripts/disable-super-admin-aal2.mjs --apply --operator <you>` (flag off, factors and your session untouched), then create a new Super Admin and promote an existing user from the app: both succeed; then `node scripts/enable-super-admin-aal2.mjs` (dry run refuses until the new admin has two factors or one + recovery email).
28. Billing and gym actions do not ask for step-up (unchanged).

## E. Lockout (22-7, flag ON)

29. Set `stepup_failure_threshold` to 3. Enter wrong step-up codes 3 times: account locked and sessions removed; the UI shows the locked/denied state.
30. Wrong codes at the `/auth/mfa` sign-in prompt do NOT count toward the lockout (try several, then a correct one: still allowed).
31. A locked account cannot sign in past the gate; `reset-super-admin-factors.mjs <email> --apply` releases it (clears lock, state, grants, turns flag off).
32. Audit rows exist: `super_admin_stepup_failed` per wrong step-up code, `super_admin_locked` on lockout.

## F. Recovery email (22-8)

Needs mail: restart the Supabase stack once (`smtp_port = 54325` in config.toml), then read mail at http://127.0.0.1:54324. For speed: `limit recovery_delay_minutes 1`.

34. `/security` → *Recovery email* card: set an address equal to the login email: refused. Set a different one: a 6-digit code arrives in Inbucket; a wrong code is refused; the right code saves it and the card shows a masked address. The LOGIN mailbox gets a "recovery address changed" notice showing only the masked address.
35. Change the address: a step-up prompt appears first; after a valid authenticator code the new address gets a code and replaces the old one.
36. Remove it: step-up again, then the card shows none; the login mailbox gets a "recovery address removed" notice.
37. With the flag ON and a recovery email set, sign in password-only → `/auth/mfa` → *Can't use your authenticator?* → *Email me a code* → code arrives at the recovery address only → wrong code refused (never counts toward the account lockout: try 4 wrong ones across fresh codes, you can still sign in with the authenticator) → right code shows "Recovery requested… at <time>"; you are NOT signed in.
38. Both mailboxes (login and recovery) receive the notice with a cancel link; open it: a page with a Cancel button (opening alone does nothing); click it: "Recovery cancelled". Open it again: "invalid or already used".
39. Repeat 37 and let the delay pass (1 min locally, up to 1 more for the cron): authenticators and sessions are gone, the flag is still ON; signing in with the password lands on `/auth/mfa/enroll`; enrol one authenticator in the modal; you reach `/gyms` at aal2. `/auth/mfa/enroll` then redirects away (window closed; it is 60 minutes by default, `recovery_enrol_window_minutes`).
40. A non-Super-Admin password session and an account with no recovery email see the same "code is on its way" message and receive no mail.
41. `enable-super-admin-aal2.mjs` dry-run accepts one factor + recovery email, refuses one factor alone.
42. `reset-super-admin-factors.mjs <email> --cancel-recovery --apply --operator <you>` cancels a pending recovery.
43. Schedule a recovery (37), then in another browser sign in with password AND the authenticator code: the pending recovery is cancelled automatically, both mailboxes get a "recovery cancelled" notice, and the authenticators stay. Step 38's cancel link now also sends the same "cancelled" notice to both mailboxes.

## Cleanup

33. Restore `session_limits_config` to 30 / 480 / 5 / 5, and set the flag to the intended state for the environment.

## Results

Stories covered also: 22-8 (section F).

| # | Pass/Fail | Notes |
|---|-----------|-------|
| 1-4 | Pass | Run by the owner, 2026-10-17. |
| 5-8 | Not confirmed | The audit log showed no second enrolment or removal at the time (only one enrol/verify), so these are not recorded as passed. The last-factor guard itself is covered by pgTAP (migration 0129) and the app test. |
| 9-13 | Pass | 12 passed in a private window (the first try was still signed in). 13: denied, never sent to `/auth/mfa`; the wrong-account login notice was added because of it. |
| 14 | Skipped | Applies only with the flag OFF; step 19 covered the flag-OFF behaviour. |
| 15 | Pass | |
| 16-18 | Pass | Idle (16), sign back in with no loop (17), age expiry while active (18). Three fixes came out of this: failed page loads now re-check the session and go to login instead of "Something went wrong", sign-in Verify navigates once, dev instant validation set to opt-in. |
| 19 | Pass | Flag OFF with both limits at 1 minute: no expiry, no notice, no new `super_admin_session_expired` row. |
| 20-23 | Pass | Step-up prompt (now a modal, and no longer closes the dialog under it). 21: Enter submits once. 23 confirmed by the consumed-grant row plus the owner. |
| 24 | Pass (database) | Not reachable in the UI as worded (the grant is issued and consumed in one action). Proved in the database with the real 1-minute limit: consume after 65 s refused, a fresh grant consumed once, a second consume refused. |
| 25 | Pass | Other browser signed out; account had 0 sessions after the removal. |
| 26 | Pass | Add admin refused while the flag is ON (retro item 54). |
| 27 | Pass | Bootstrap window (`disable-super-admin-aal2.mjs`): created and promoted an admin; the window was closed by undoing the two test admins first, since the enable dry run refused (no authenticator yet), which is the intended check. |
| 28 | Pass | Tier change, suspend, reinstate, credit and billing retry asked for no step-up; audit rows present. |
| 29 | Pass | Three wrong step-up codes locked the account; audit `super_admin_stepup_failed` x3 and `super_admin_locked`, counts only. |
| 30 | Pass | Wrong sign-in codes did not count toward the lock. |
| 31 | Pass | Locked account with a correct code was sent to login; `reset-super-admin-factors.mjs` cleared the lock, state and grants, removed factors and sessions, and turned the flag off. |
| 32 | Pass | |
| 33 | Done | Limits restored, flag state set, QA accounts torn down (close-out). |
| 34-39 | Pass | Recovery email set/change/remove with step-up and notices; recovery request; cancel link; applied reset opens the 60-minute enrol window; polling page with a sign-in button. |
| 40 | Pass | A non-admin and a Super Admin with no recovery email got the identical sentence; no mail, no stored code; the non-admin wrote no audit row. |
| 41-42 | Pass | Enable dry run accepts one factor + recovery email and refuses one factor alone; operator `--cancel-recovery`. |
| 43 | Pass | `super_admin_recovery_cancelled` by `owner_signin` with the owner as actor; both mailboxes got the cancelled notice; the authenticator was kept. |

Result: accepted with open items. Not recorded as passed: 5-8 (second-factor enrol/remove and the in-app last-factor block; the database guard is covered by pgTAP, the shell test and a real-GoTrue probe). Skipped: 14.
