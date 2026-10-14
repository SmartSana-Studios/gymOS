# Epic 20 — local test kit (loyalty: free sessions & free days)

LOCAL Supabase only. Builds on the Epic 19 helpers (`../epic19-qa/lib.mjs`). Setup rows are written for stamp
history only; every state change you test (scan, renew, refund, program save) goes through the real RPCs.

```
node scripts/epic20-qa/seed.mjs               # (re)create "Epic20 QA Gym", loyalty ON, N=4 K=3 R=10 -- re-run to reset
cd apps/dashboard && pnpm dev                 # http://localhost:3000  (sign out/in after every re-seed)
scripts/epic19-qa/start-mobile.sh             # optional, phone: Expo Go over tunnels (see epic19-qa/README.md)
```
Dashboard logins, password `Epic19Pass!` (shared with the Epic 19 kit): `owner@` `supervisor@` `manager@`
`receptionist@` `coach@` + `epic20qa.test`. Phone members `+237699000001` (guest) / `+237670000001` (subscriber), OTP `123456`.

Helpers: `state.mjs <state> [A|B]` (see header: fresh/mid/almost/rewarded/stale/lapsed/checkout, sub-due/sub-fresh/
sub-early/sub-late/sub-rewarded) · `program.mjs on|off|never|charging on|off|sweep|status`.

## Dashboard click-through
| # | Do | Expect |
|---|---|---|
| L1 | Owner/Supervisor → Settings → Loyalty program | switch + N / K / R; saved by its own [Save loyalty program]; [Save Settings] never writes it; manager/receptionist/coach do not see the section |
| L2 | `program.mjs never`, reload, switch on, leave blank / N=1 / N=99, save | field errors only on submit ("Enter a whole number from 2 to 50", 3–24, 1–30); no RPC until valid |
| L3 | Type N=4 → pause | "≈ 20%" guest readout (aria-live); subscriber line per distinct plan duration (30 d, 365 d), named; max 3 |
| L4 | Lower N or K below saved | lowered-threshold note above the save button |
| L5 | Switch off, save | inline off-note while unsaved; inputs disabled, values kept; toast "Loyalty program saved." |
| L6 | `program.mjs charging off`, reload | info line under Guests (loyalty earns only while charging is on) |
| L7 | Members → Guest Mid / Almost / Rewarded (as receptionist) | Rewards section: counters "n / N", free sessions with expiry, no edit control, "Balances change only through the program's rules." |
| L8 | Program off, open Guest Rewarded vs Guest Mid | Rewarded: free session only, no counters; Mid: no Rewards section |
| L9 | Guest Almost: record/scan → 4th stamp | free session granted, counter 0, Audit "free session earned", Actor System |
| L10 | Sub Due → Renew (cash) today | 3rd stamp, expiry +10 days, counter 0, no payment created for the reward |
| L11 | Sub Early / Sub Late → Renew | no stamp (early / late) |
| L12 | Sub Annual → Renew | stamp + reward; window is plan duration, not 90 days |
| L13 | Payments → refund Guest Refund's session payment | counter 2 → 1, Audit "stamp reversed"; a granted free session is never taken back |
| L14 | `program.mjs sweep` | Guest Lapse: lapse event + audit; Guest Stale: persisted reset + audit; second run writes nothing |
| L15 | Switch UI to French | all loyalty strings translated; EN "session" always qualified ("paid/free session") |
| L16 | Coach login | no loyalty UI anywhere |

## Phone (Expo Go) click-through
| # | Do | Expect |
|---|---|---|
| P1 | `state.mjs fresh`, sign in as A | Home shows Rewards card "0 / 4" + footnote "Progress resets after 90 days without a paid session." |
| P2 | `state.mjs almost`, scan gym QR | allowed; headline "Free session earned — valid for 60 days" once; row "Free session — use by …"; counter 0 / 4 |
| P3 | Leave Home and return | headline does not repeat |
| P4 | `state.mjs checkout`, scan again the same day | covered re-entry: no second session consumed, no extra stamp |
| P5 | B: `state.mjs sub-due` | subscriber card "2 / 3 on-time renewals toward 10 free days"; guest counter hidden |
| P6 | Renew B from the dashboard (Members → Phone Sub B) | pull to refresh: "10 free days added — your new renewal date is …", card 0 / 3 |
| P7 | B: `state.mjs sub-early` then renew | no stamp, card unchanged |
| P8 | `program.mjs off` | card shows only held free/paid rows, no progress/footnote; with nothing held the card is absent |
| P9 | A on a monthly plan holding a free session (seed: Sub Dormant Free) | neutral row "Usable when you're back on Pay-per-session" |
| P10 | `state.mjs stale` | counter reads 0 / 4 even though 2 stamps are stored |

Notes: the seed runs `run_subscription_lifecycle_job()` once, so members expiring within 7 days are `expiring_soon` and appear in
Overview -> "Expiring This Week", where the Renew button is (the member modal has none; the Subscriptions page shows Renew
only for non-active rows). Re-seeding deletes the gym, so dashboard tabs and phone sessions go stale — sign out/in. The pgTAP stage of
`scripts/ci-local.sh` expects no QA data (same as Epic 19). In-app Tara payment needs the Epic 19 edge-runtime copy and
fake Tara (`../epic19-qa/README.md`); not required for any loyalty scenario above.
