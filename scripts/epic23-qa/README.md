# Epic 23 — local test kit (GymOS support)

LOCAL Supabase only. Every state is reached through the real functions (create account, invite, password, TOTP, activate,
assign, confirm, Owner switch); only the clock-based ones (idle, recertification overdue, velocity lock) are moved by hand.

```
node scripts/epic23-qa/seed.mjs                  # (re)create the QA world: re-run any time to reset
cd apps/super-admin && pnpm dev -p 3001          # http://localhost:3001  (Super Admin app)
cd apps/dashboard   && pnpm dev                  # http://localhost:3000  (Owner dashboard, invite page)
node scripts/epic23-qa/totp.mjs [handle]         # current authenticator code for a QA account
node scripts/epic23-qa/lifecycle.mjs status      # accounts / assignments / resets at a glance
node scripts/epic23-qa/smoke.mjs                 # 6 database-level checks with real JWTs
```
Mail (invites, factor-reset notices) goes to Inbucket at http://127.0.0.1:54324, never to a real mailbox
(`MAIL_SMTP_*` was added to `apps/super-admin/.env.local`; restart the Super Admin dev server after the first seed).

## What exists after the seed
| Who | Login | Password | State |
|---|---|---|---|
| Super Admin | `admin@epic23qa.test` + code from `totp.mjs admin` | `Epic19Pass!` | aal2 flag is ON |
| Gym A owner / supervisor / manager / receptionist / coach | `ownerA@` `supervisorA@` `managerA@` `receptionistA@` `coachA@` `epic23qa.test` | `Epic19Pass!` | switch **ON**, 3 members, 1 plan |
| Gym B owner | `ownerB@epic23qa.test` | `Epic19Pass!` | switch **OFF** |
| Suspended-gym owner | `ownerS@epic23qa.test` | `Epic19Pass!` | gym suspended |
| `qa23-active@gymosapps.com` | | `Epic23Support!` | active in A, **pending** in B |
| `qa23-second@` | | | active in A (two people in A, Owner still sees one row) |
| `qa23-idle@` | | | active in A, last active 40 days ago |
| `qa23-recert@` | | | recertification overdue since yesterday |
| `qa23-reset@` | | | active in A, for the authenticator reset |
| `qa23-locked@` | | | velocity-locked |
| `qa23-fresh@` | | | created, never invited |

## Not testable in a browser yet (by design in the delivered stories)
The dashboard request path for a support person (TOTP sign-in, `session_gate_touch`, gym picker) is story 23-6b and the
step-up UI is 23-6c, both deferred (docs/decisions.md, Story 23.6). So a support person cannot use the Owner dashboard
yet; their behaviour inside a gym is tested at the database level (`smoke.mjs`, plus the pgTAP suite in `ci-local.sh`).
Everything the Super Admin and the Owner see, and the invite page, is testable by clicking.

## A. Super Admin app (`:3001`, sign in with password, then the authenticator code)
| # | Do | Expect |
|---|---|---|
| A1 | Open **GymOS support** | seven accounts listed with name, email, state (Active / Not activated), invite column |
| A2 | Create account: name `Test Person`, email `qa23-new@gymosapps.com` | toast "Support account created"; row shows Not activated, "No invite sent" |
| A3 | Create with `someone@gmail.com` | refused, domain message (only @gymosapps.com) |
| A4 | Create again with `qa23-active@gymosapps.com` | the generic refusal, no hint that it exists |
| A5 | `qa23-new` → **Send invite** | toast "Invite emailed"; Inbucket has the mail; link, no password, no code in it |
| A6 | Send a second invite | the first link now says invalid (superseded) |
| A7 | `qa23-fresh` → **Send invite**, finish the invite page (section I) | row turns Active |
| A8 | Assign `qa23-fresh` to Gym A with reason `x` | refused: reason must be 3–500 characters |
| A9 | Assign with a proper reason | assignment appears **pending** (new accounts need explicit confirmation) |
| A10 | Confirm it | becomes active; Gym A's Owner sees "assigned" (section O) |
| A11 | Assign `qa23-active` to Gym A again | "already has an open assignment in this gym" |
| A12 | Assign anyone to the **Suspended** gym | "That gym is not active" |
| A13 | Unassign `qa23-second` from Gym A with a reason | assignment ended; audit row written |
| A14 | `qa23-new` (never activated) → **Remove** | account and sign-in deleted |
| A15 | `qa23-active` → **Deactivate** | all assignments end, sessions signed out, cannot be undone here |

## L. Lifecycle (23-11) and locks (23-10), Super Admin app
| # | Do | Expect |
|---|---|---|
| L1 | `lifecycle.mjs status`, then `lifecycle.mjs sweep` | `qa23-idle` becomes LOCKED:inactivity; `job_runs` row success; Owner A notified; Locked accounts panel lists it with "No activity for too long" |
| L2 | Re-run `sweep` | locks nothing else (idempotent); `qa23-active`/`second` untouched (fresh activity) |
| L3 | Locked accounts → `qa23-locked` and `qa23-idle`: unlock with no reason | refused (reason 3–500 chars) |
| L4 | Unlock `qa23-idle` with a reason | unlocked; earlier assignments restored if the Owner switch is on (23-10 deferral); audit row |
| L5 | Recertification panel: `qa23-recert` | "Recertification overdue since …: no access" |
| L6 | **Recertify** with a reason | "Recertified. The next due date is set."; 90 days out |
| L7 | `lifecycle.mjs recert-due qa23-second`, refresh | now shows overdue; that person has no gym access until recertified |
| L8 | `qa23-reset` → **Reset authenticator**, no identity note | refused (3–500 chars) |
| L9 | Same with a note | "Reset started…"; person signed out immediately; state "Reset waiting until …"; Inbucket mail to the person with a cancel link |
| L10 | While pending: **Change address** for that person | refused while a reset is open |
| L11 | Open the cancel link (`/support-reset-cancel?…` on :3000) | reset cancelled; sessions stay revoked; Super Admin alerted; second use of the link fails |
| L12 | Start a new reset, `lifecycle.mjs reset-due qa23-reset`, then **Run due resets now** | "1 reset(s) executed"; old factor removed; a new single-use invite is mailed (Inbucket) |
| L13 | Finish that invite page | account active again, new authenticator works (`totp.mjs qa23-reset` will be stale: use the app) |
| L14 | **Change address** (no reset open) to `qa23-moved@gymosapps.com` | "Address changed and recorded."; a non-@gymosapps.com address is refused |
| L15 | `lifecycle.mjs digest` | Gym A's Owner gets the activity digest (notification history) |
| L16 | `lifecycle.mjs drift` | no false positive for untouched accounts |

## O. Owner dashboard (`:3000`, ownerA@ / ownerB@)
| # | Do | Expect |
|---|---|---|
| O1 | ownerA → Settings → GymOS Support | switch ON; state "allowed and assigned"; "Last acted: …" |
| O2 | ownerA → Settings → Staff | exactly ONE fixed row "GymOS Support": no name, no count, not editable, not deactivatable, even with two people assigned |
| O3 | Switch OFF (confirm dialog) | "turned off by you"; assignments suspended; support memberships removed; `smoke.mjs` shows the active person loses Gym A |
| O4 | Switch back ON | previously active assignments restored |
| O5 | ownerB → Settings | switch OFF, "turned off by you"; `qa23-active`'s pending assignment stays pending |
| O6 | ownerB switch ON | state "An assignment is waiting for GymOS to confirm"; then confirm in the Super Admin app → "assigned" |
| O7 | supervisorA / managerA / receptionistA | no GymOS Support section anywhere |
| O8 | ownerS (suspended gym) | cannot change the switch (gym is not active) |
| O9 | Audit page (ownerA) | "GymOS Support access changed" rows; no support person's name, email, phone anywhere |
| O10 | Switch EN → FR | all GymOS Support strings translated |
| O11 | Disclosure: an audit row written by support → file a disclosure request | appears in Super Admin → Owner disclosure requests; answer it; due date shown; overdue styling when past |
| O12 | (needs 23-6b to produce staff created by support) | the "Staff created by GymOS Support" review card appears on the staff page only when such staff exist; nothing to see yet |

## I. Invite page (`:3000/support-invite?t=…`, token from the Inbucket mail)
| # | Do | Expect |
|---|---|---|
| I1 | Open the link | Step 1 of 2: password |
| I2 | Password under 12 chars | rejected |
| I3 | Mismatched confirm | "The two passwords do not match." |
| I4 | Valid password | Step 2 of 2: QR + secret |
| I5 | Wrong 6-digit code | generic failure, retry allowed; the invite dies after the attempt limit |
| I6 | Correct code (`node -e` or any app on the printed secret) | "Your account is ready." Super Admin list shows Active |
| I7 | Reload the same link | generic invalid-link message, no hint why (single use) |
| I8 | Open a link 24 h old / a mangled token | the same generic message |

## Automated safety net
`smoke.mjs` (6 checks above) and `bash scripts/ci-local.sh` (pgTAP covers the denied-set matrix, hidden identity, velocity
limits, revocation, lifecycle). Run `ci-local.sh` on a **pristine** DB: `seed.mjs` leaves QA data, so reset first
(`npx --no-install supabase db reset`).
