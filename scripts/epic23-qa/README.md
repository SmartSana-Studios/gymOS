# Epic 23 — local test kit (GymOS support)

LOCAL Supabase only. Every state is reached through the real functions (create account, invite, password, TOTP, activate,
assign, confirm, Owner switch); only the clock-based ones (idle, recertification overdue, velocity lock) are moved by hand.

```
node scripts/epic23-qa/seed.mjs                  # (re)create the QA world: re-run any time to reset
cd apps/super-admin && pnpm dev -p 3001          # http://localhost:3001  (Super Admin app)
cd apps/dashboard   && pnpm dev                  # http://localhost:3000  (Owner dashboard, invite page)
node scripts/epic23-qa/totp.mjs [handle]         # current authenticator code for a QA account
node scripts/epic23-qa/lifecycle.mjs status      # accounts / assignments / resets at a glance
node scripts/epic23-qa/smoke.mjs                 # the support request path end to end with real JWTs (code step, picker, gate, revoke)
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

## The support request path (story 23-6b)
A support person now signs in on the Owner dashboard: password, authenticator code, gym picker, then the dashboard in the chosen
gym. Section S below is the browser run; `smoke.mjs` plays the same calls at the database level. The step-up UI (refunds, fee
waivers, staff creation, payment connection code) is 23-6c, so those four actions still ask for a step-up the UI cannot give yet.

## A. Super Admin app (`:3001`, sign in with password, then the authenticator code)
| # | Do | Expect |
|---|---|---|
| A1 | Open **GymOS support** | top buttons **Create account**, **Assign to gym**, **Run due resets**; five tabs (Accounts, Assignments, Locked accounts, Lifecycle, Disclosure requests), Accounts selected; no inline form or page-wide reason box. Accounts tab lists seven accounts with name, email, state (Active / Not activated), invite column and an **Actions** menu per row. Click **Locked accounts**, reload: the same tab stays open (`?tab=locks`); an unknown `?tab=` opens Accounts |
| A2 | **Create account** (modal): name `Test Person`, email `qa23-new@gymosapps.com` | modal closes, message "Support account created"; row shows Not activated, "No invite sent" |
| A3 | Create with `someone@gmail.com` | refused inside the modal, domain message (only @gymosapps.com); modal stays open |
| A4 | Create again with `qa23-active@gymosapps.com` | the generic refusal inside the modal, no hint that it exists |
| A5 | `qa23-new` → Actions > **Send invite** | message "Invite emailed"; Inbucket has the mail; link, no password, no code in it |
| A6 | Actions > send a second invite (**Send a new invite**) | the first link now says invalid (superseded) |
| A7 | `qa23-fresh` → Actions > **Send invite**, finish the invite page (section I) | row turns Active |
| A8 | **Assign to gym** (modal): person `qa23-fresh`, Gym A, reason `x` | submit stays disabled and the field says to enter 3–500 characters |
| A9 | Assign `qa23-fresh` (activated in A7) to Gym A with a proper reason | modal closes; Assignments tab shows it **active** (activated account, Gym A switch ON). For a **pending** row assign anyone to Gym B (switch OFF) or an account that was never activated |
| A10 | a pending row (e.g. `qa23-active` in Gym B; needs Gym B switch ON, else `switch_off` refusal) → Actions > **Confirm**, reason in the modal | becomes active; Gym A's Owner sees "assigned" (section O) |
| A11 | Assign `qa23-active` to Gym A again | "already has an open assignment in this gym" shown in the modal, which stays open |
| A12 | Assign anyone to the **Suspended** gym | "That gym is not active" in the modal |
| A13 | Assignments tab → `qa23-second` → Actions > **Unassign**, reason in the modal | assignment ended; audit row written |
| A14 | `qa23-new` (never activated) → Actions > **Remove**, reason in the modal | account and sign-in deleted |
| A15 | `qa23-active` → Actions > **Deactivate**, reason in the modal | the modal warns that it cannot be undone here; all assignments end, sessions signed out |
| A16 | Make 11+ rows visible (e.g. set rows per page to 5 on Accounts, Assignments) and switch tabs; open the gym detail page of Gym A | each tab has its own rows-per-page selector and page buttons (like Gyms); the gym page's support panel has **Assign to gym** with the gym fixed (no gym field) and the same Actions menu and modals; check dark mode and a phone-width window |

## L. Lifecycle (23-11) and locks (23-10), Super Admin app
| # | Do | Expect |
|---|---|---|
| L1 | `lifecycle.mjs status`, then `lifecycle.mjs sweep` | `qa23-idle` becomes LOCKED:inactivity; `job_runs` row success; Owner A notified; **Locked accounts** tab lists it with "No activity for too long" |
| L2 | Re-run `sweep` | locks nothing else (idempotent); `qa23-active`/`second` untouched (fresh activity) |
| L3 | Locked accounts tab → `qa23-locked` and `qa23-idle`: Actions > **Unlock** with no reason | submit disabled until the reason is 3–500 chars |
| L4 | Unlock `qa23-idle` with a reason in the modal | unlocked; earlier assignments restored if the Owner switch is on (23-10 deferral); audit row |
| L5 | **Lifecycle** tab: `qa23-recert` | "Recertification overdue since …: no access" |
| L6 | Actions > **Recertify**, reason in the modal | "Recertified. The next due date is set."; 90 days out |
| L7 | `lifecycle.mjs recert-due second`, refresh | now shows overdue; that person has no gym access until recertified |
| L8 | `qa23-reset` → Actions > **Reset authenticator**, no identity note | submit disabled until the note is 3–500 chars |
| L9 | Same with a note | "Reset started…"; person signed out immediately; state "Reset waiting until …"; Inbucket mail to the person with a cancel link |
| L10 | While pending: open Actions for that person | only **Recertify** is offered (no reset, no change address) while a reset is open |
| L11 | Open the cancel link (`/support-reset-cancel?…` on :3000) | reset cancelled; sessions stay revoked; Super Admin alerted; second use of the link fails |
| L12 | Start a new reset, `lifecycle.mjs reset-due reset`, then the top **Run due resets** button | "1 reset(s) executed"; old factor removed; a new single-use invite is mailed (Inbucket) |
| L13 | Finish that invite page | account active again, new authenticator works (`totp.mjs qa23-reset` will be stale: use the app) |
| L14 | Actions > **Change address** (no reset open), new address and reason in the modal, to `qa23-moved@gymosapps.com` | "Address changed and recorded."; a non-@gymosapps.com address is refused |
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
| O11 | Disclosure: an audit row written by support → file a disclosure request | appears in Super Admin → **Disclosure requests** tab; Actions > **Answer** opens a modal; due date shown; overdue styling when past |
| O12 | (staff creation by support needs the 23-6c step-up UI) | the "Staff created by GymOS Support" review card appears on the staff page only when such staff exist |

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

## S. Support person on the Owner dashboard (`:3000`)
Account state: `qa23-active@gymosapps.com`, password `Epic23Support!`, code from `node scripts/epic23-qa/totp.mjs qa23-active`.
Active in Gym A, pending in Gym B. `ownerA@epic23qa.test` (password `Epic19Pass!`) is the Gym A Owner. Run `seed.mjs` first.
| # | Do | Expect |
|---|---|---|
| S1 | Sign in as `qa23-active@gymosapps.com` with the password | straight to the code step (`/auth/mfa`), no dashboard data yet |
| S2 | Enter a wrong code | one generic message, you can retry |
| S3 | Enter the right code | the gym picker (`/support-gym`) lists **Gym A** only (B is pending); nothing is preselected |
| S4 | Click Gym A | Members page of Gym A; header shows "GymOS Support" (no name, no email); sidebar: Members, Staff, Plans, Subscriptions, Payments, Settings only |
| S5 | Open Settings | gym settings, guest charging, category, loyalty and the payment connection card are there; no GymOS Support (Owner) section |
| S6 | Open Settings > payment connection > Connect | the connect dialog (with the authenticator code field) opens: the 23-9 flow is reachable |
| S7 | In another window, Super Admin: unassign `qa23-active` from Gym A (reason), then reload the dashboard tab | sent back to the gym picker, which says no gym is assigned; **Sign out** returns to the login page |
| S8 | Re-assign and confirm in Super Admin, sign in again | code step, picker lists Gym A again |
| S9 | Leave the dashboard tab idle past the idle limit (30 min), or age the session: `docker exec supabase_db_gym_os psql -U postgres -c "update private.support_session_state set last_seen_at = now() - interval '2 hours' where user_id = (select id from auth.users where email = 'qa23-active@gymosapps.com')"`, then reload | login page with "Your session expired. Please sign in again." |
| S10 | `qa23-recert@gymosapps.com` (assignment active, recertification overdue: after `lifecycle.mjs recert-due recert` on an account that was recertified, because an overdue person is skipped when the Owner switch goes back on and then has no assignment to pick) signs in, passes the code, picks Gym A | **no data is readable**: the Gym A pages show the generic "Something went wrong on our end" error (the gym row read is denied by the live gate). It is not a redirect to the login page. Owner decision pending on a clearer message; see deferred-work.md |
| S11 | `ownerA@epic23qa.test` signs in | no code step, dashboard as before |
| S12 | Switch EN to FR on the code step and picker pages | strings translated |
| S13 | As `qa23-active` in Gym A: Payments > Record refund, pick a member and payment, type the current code from `totp.mjs active` | refund recorded; the same code cannot be reused for the next dialog (wait for the next 30 s code) |
| S14 | Members > a member awaiting the fee > Waive, reason + current code | fee waived. A wrong code shows "That code was not accepted" and nothing is written |
| S15 | Settings > Staff > Add staff (phone, role, current code) | staff member created. A wrong code creates no account |
| S16 | Type a wrong code on the sign-in code step (S2), or in a dialog above, until the limit (5) | account locked, sent to the login page with the expired notice. Reset with `node scripts/epic23-qa/seed.mjs` |
| S17 | As `ownerA@`: record a refund, waive a fee, add staff | no code field in any of the three dialogs |

## Automated safety net
`smoke.mjs` (now also the 23-6c step-up flows: refund, waiver, staff creation with a real TOTP, single-use, subject binding, and the wrong-code lock) and `bash scripts/ci-local.sh` (pgTAP covers the denied-set matrix, hidden identity, velocity
limits, revocation, lifecycle, and the request path in `support_request_path.test.sql`). Run `ci-local.sh` on a **pristine** DB: `seed.mjs` leaves QA data, so reset first
(`npx --no-install supabase db reset`).
