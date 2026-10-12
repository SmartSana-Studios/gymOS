# Epic 19 — local test kit (session guests)

Two ways to test, both against the **local** Supabase stack only:

1. **`run.mjs`** — automated, no phone, no app. Real users, real JWTs, real RLS and RPCs, and the real
   `payment-webhook` edge function fed by a fake Tara. ~100 checks in about 30 s.
2. **Manual** — dashboard in a browser + the member app on your phone (Expo Go over tunnels).

## One-time setup (per devcontainer boot)
```
scripts/epic19-qa/start-edge-functions.sh      # edge runtime; Tara URLs rewritten to the fake provider (a COPY of
                                               # the functions -- repo code untouched). Replaces the Epic 18 runtime;
                                               # run epic18-qa/start-edge-functions.sh to switch back.
node scripts/epic19-qa/fake-tara.mjs &         # fake Tara on :4010 (UI at http://localhost:4010)
```

## 1. Automated
```
node scripts/epic19-qa/run.mjs                 # wipes + rebuilds "Epic19 QA Gym", exit 1 on any failure
```
Covers: setting (default on, role limits, audit) · blocked scan (null result, once per scan id, one alert) ·
desk payment (plan amount, role limits, consume, same-day cover) · in-app Tara (initiate, duplicate refused,
webhook, replay idempotent) · declined · late confirmation · wrong account / forged secret · class attendance ·
offline scans (receipt time, replay) · 7-day lapse and soonest-first · refunds (unused voided, consumed kept) ·
overview figures + role gate + alert dismissal · price-0 exempt · kill switch · plan lock · registration-fee gate.

Not covered (do these by hand): camera scan, the member app overlays, the dashboard UI.

## 2. Manual
```
node scripts/epic19-qa/seed.mjs                # (re)create the QA gym — re-run any time to reset
cd apps/dashboard && pnpm dev                  # http://localhost:3000
scripts/epic19-qa/start-mobile.sh              # Metro + 2 Cloudflare tunnels; prints the exps:// URL for Expo Go
```
Dashboard logins, password `Epic19Pass!`: `owner@` `supervisor@` `manager@` `receptionist@` `coach@` + `epic19qa.test`.
The gym QR is on Settings (the phone scans it off the dashboard screen).

**Phone**: install Expo Go (SDK 57), open the `exps://…trycloudflare.com` URL the script prints (or scan its QR).
Sign in with `+237 699000001` or `+237 670000001`, OTP `123456`. The tunnel URLs change on every run.
If Expo Go cannot run the app (a native module), use `MODE=dev-client` with a GymOS development build instead.

### Put the phone member in a state, then scan
```
node scripts/epic19-qa/state.mjs none     # -> scan: "Pay for your session"; dashboard shows the session-required alert
node scripts/epic19-qa/state.mjs paid     # -> scan: allowed, session consumed, "Sessions" line on Home
node scripts/epic19-qa/state.mjs used     # -> scan again today: covered, no second session
node scripts/epic19-qa/state.mjs lapsed   # -> scan: blocked (paid session lapsed)
node scripts/epic19-qa/state.mjs exempt   # -> price-0 plan: always allowed
node scripts/epic19-qa/state.mjs expired  # -> the old expired-subscription screen (not session-required)
node scripts/epic19-qa/state.mjs checkout # close the open check-in so you can scan again
# add B for the second phone number: state.mjs none B
```

### In-app Tara payment (fake provider)
1. `state.mjs none`, scan → "Pay for your session" → **Pay** → app shows the waiting state.
2. Approve it: http://localhost:4010 (Approve / Decline), or `node scripts/epic19-qa/tara.mjs success|failed`.
3. Also: `tara.mjs wrong` (another gym's account — must be refused, member stays unpaid), `tara.mjs forged` (bad secret — 401).
4. Late confirmation: start a payment, wait 10+ min (or `update payments set created_at = now() - interval '11 minutes'`),
   start again, then approve the FIRST one in the fake UI → verified, audited, session created.

### Dashboard click-through
| # | Do | Expect |
|---|---|---|
| D1 | Owner → Settings → "Charge guests per session" | on by default; toggling shows the affected-member count + old-app warning; saved on its own, not by [Save Settings]; Audit "…changed"; manager/receptionist don't see it |
| D2 | Front desk, after a blocked scan | session-required alert (same panel, assertive), **Record session payment**; Cash default; Bank Transfer only for manager+; amount fixed |
| D3 | Record it | alert clears, member's next scan passes; Audit "session payment recorded"; Payments page purpose filter + reason tags |
| D4 | Class roster → Class Cleo → Attended with no session | inline message + the same payment action; after paying, Attended works |
| D5 | Members → a member → Sessions | paid/free/lapsed list, [Record session payment] |
| D6 | Plans → pay-per-session plan | type locked once subscribed; price change audited, doesn't touch paid sessions |
| D7 | Overview (manager+) | Guest sessions card (paid / blocked / who collected) + revenue sub-line; absent when charging is off; Guest Sessions page tabs |
| D8 | Dismiss an alert | Guest sessions figures unchanged |
| D9 | Payments → refund a session payment | unused → "session cancelled"; used → stays used; revenue line drops |
| D10 | Switch UI to French | all new strings translated; "session" qualified in EN ("paid session") |

## Notes
- Alert cooldown (0116): after the desk dismisses a session-required alert, the same guest scanning again within 15 minutes is still recorded as a blocked attempt but does not raise a new alert. Use `state.mjs none` to clear alerts when re-testing.
- `demo-data.mjs` adds paid / blocked / refunded history to the existing gym without wiping it (logins stay valid).
- After `seed.mjs` or `run.mjs` sign out and in again on the dashboard: the old browser session points at a deleted gym.

## Files
`seed.mjs` world + manual members · `run.mjs` automated suite · `state.mjs` phone member state · `tara.mjs` fire the
fake callback · `fake-tara.mjs` provider + UI · `start-edge-functions.sh` · `start-mobile.sh` · `lib.mjs`, `constants.mjs`, `reset.sql`.

Re-run `seed.mjs` after `run.mjs` (the suite leaves its own data). A pristine DB is needed again for pgTAP:
`scripts/ci-local.sh` expects no QA data (see its header).
