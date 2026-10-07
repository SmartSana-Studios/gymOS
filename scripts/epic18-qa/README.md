# Epic 18 — local manual test guide

## Start
```
node scripts/epic18-qa/seed.mjs        # (re)creates "Epic18 QA Gym", fee 5000 XAF. Re-run any time to reset to a clean state.
cd apps/dashboard && pnpm dev          # http://localhost:3000   (Supabase local: 127.0.0.1:54321, Studio :54323)
cd apps/mobile && EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=<local publishable key from apps/dashboard/.env.local> npx expo start --web --port 8081
```
Mobile: http://localhost:8081 (web build). `apps/mobile/.env.local` points at a tunnel, so the env override above is required.

## Accounts — password for all: `Epic18Pass!`
Dashboard (http://localhost:3000/auth/login): `owner@` · `supervisor@` · `manager@` · `receptionist@` · `coach@` + `epic18qa.test`.
Member app: phone `+237 699000001`, OTP `123456` (Awaiting Mobile).

## Seed data (fee = 5000 XAF)
| Member | State | Use it for |
|---|---|---|
| Legacy Lou | settled (created before fee), active plan | S1 regression |
| Awaiting Alice | awaiting | T2 collect cash |
| Awaiting Bruno | awaiting | T4 waive |
| Awaiting Chloe | awaiting | T3 role limits, T6 gate |
| Awaiting Dan | awaiting | T5 Tara (needs sandbox creds) |
| Awaiting Mobile | awaiting | T8 member app |
| Paid Pierre | fee paid (cash), no plan | T7 void |
| Paid Paula | fee paid (transfer), no plan | T6 assign first plan |
| Waived Walter | waived | T4 display |
| Active Sam | fee paid + active plan | T7 void blocked, T9 refund blocked |

## Scenarios
**S1 Fee setting (18.1)** — Owner → Settings → "Registration fee": shows 5000, hint "0 means no registration fee". Manager/Receptionist: field not available. Set 6000 → toast; Audit page shows "Registration fee changed" (old/new). Set back to 5000. Existing members unaffected. Legacy Lou has no badge and no fee line.

**T2 Collect fee (18.2/18.6)** — Receptionist → Members → Awaiting Alice (badge "Awaiting registration fee", plan fields unavailable) → Collect fee → cash + reason → Save. Alice becomes settled; fee payment visible; Audit "Registration fee recorded"; Payments page shows a registration-fee row. Collecting twice is impossible (button gone).

**T3 Role limits** — Receptionist on Chloe: Collect only, no Waive/Void. Manager: Collect + Waive, no Void. Owner/Supervisor: all three (Void only when a manual fee payment exists).

**T4 Waive (18.2/18.6)** — Manager → Awaiting Bruno → Waive fee → reason required (empty rejected) → confirm. Shows "Waived", "Waived by QA Manager", "Reason: …"; no payment row created. Not undoable. Receptionist viewing Walter sees "Waived" without name/reason.

**T5 Tara Money (18.3)** — Awaiting Dan → Collect via Tara Money. Needs a connected sandbox account on the gym (Settings → Payment Account); without it only verify the option is unavailable/errors cleanly. With sandbox: waiting state, retry on failure, success settles Dan; no subscription is created; no push notification.

**T6 First plan gate (18.1/18.5/18.6)** — Chloe (awaiting): assigning a plan is unavailable/blocked ("Available once the registration fee is settled"). Paid Paula: Assign plan works → subscription created. Add member (owner) → new member starts awaiting, form hides plan/status/expiry; notice "This gym charges a registration fee…". WhatsApp invite is sent only after the fee is settled.

**T7 Void (18.4/18.6)** — Owner/Supervisor → Paid Pierre → Void fee → reason required → member returns to Awaiting; audit "Registration fee voided"; revenue drops by 5000. Active Sam: Void not offered/rejected (has subscription). Void is not a refund.

**T8 Member app (18.7)** — http://localhost:8081, sign in +237 699000001 / 123456. Expect "registration not complete, contact the gym" screen, no payment option, no tabs. Then, as staff, collect (or waive) the fee for Awaiting Mobile and reopen/refresh the app: blocked screen goes away. Assign a plan to see normal app and the fee receipt (amount 5000 XAF, method). Re-run seed to repeat.

**T9 Refund block (18.4)** — Try to refund Active Sam's fee payment from the Payments page: blocked (also at DB level).

**T10 Revenue line (18.4)** — Overview (owner): month-to-date revenue shows "of which registration fees". Collecting increases it; voiding decreases it. Set fee to 0 → line hidden when no fee revenue.

**T11 Import exemption (18.5)** — Members → Import → `scripts/epic18-qa/import-sample.csv`. Imported members are settled (no badge), keep their plan/status. Cap: awaiting members count toward the tier member cap (Grind = 100).

**T12 Fee 0 gym** — Set fee to 0 as owner, add a member: created settled with plan fields as before; nothing about the fee appears. Set back to 5000.

**T13 FR** — switch dashboard/app to French; all above strings translated.

## Direct DB checks (docker exec supabase_db_gym_os psql -U postgres)
- `select name, registration_fee_settled_at from members where gym_id=(select id from gyms where name='Epic18 QA Gym');`
- `select purpose, amount, method, voided_at from payments where purpose='registration_fee';`
- Bypass attempt must fail: `update members set registration_fee_settled_at=now() where name='Awaiting Chloe'` as `authenticated` role, or inserting a subscription for an awaiting member → `registration_fee_not_settled`.

## Tara Money (real credentials) — T5

Tara has to call the gym's webhook back, so Supabase must be reachable from the internet. Locally that needs a tunnel to Kong (`127.0.0.1:54321`); the payment function builds the callback URL from whatever host the dashboard called, so **the dashboard must talk to Supabase through the tunnel URL**.

1. Edge functions (done once, re-run after editing `supabase/functions`):
   `./scripts/epic18-qa/start-edge-functions.sh` — expect `{"error":"paymentId and phoneNumber are required"}`.
2. Tunnel (you run it; the agent was not allowed to): e.g. `cloudflared tunnel --url http://127.0.0.1:54321`, copy the `https://….trycloudflare.com` URL (call it `$T`).
3. Restart the dashboard through the tunnel:
   `cd apps/dashboard && NEXT_PUBLIC_SUPABASE_URL=$T pnpm dev` (the publishable key is unchanged). Log in again — the session cookie is per Supabase URL.
4. Connect your credentials: log in as `owner@epic18qa.test` → Settings → Payment Account → Connect Tara Money, and paste your real business id / API key / webhook secret. Use the webhook URL the page shows (it should start with `$T/functions/v1/payment-webhook/…`) in the Tara dashboard if Tara asks for one.
5. **Use a tiny fee** — it is a real charge: Settings → Registration fee → e.g. 100 (Tara minimums may apply), save.
6. Members → **Awaiting Dan** → Collect fee → Mobile Money (Tara). Enter a phone you control, approve on the phone.
   - Expect: "Waiting for Dan to approve…", then the dialog closes and Dan is settled; fee payment `mobile_money`, provider `taramoney`; no subscription created, no push.
   - Decline / let it expire: expect the failed/expired state with Try again; Dan stays awaiting.
   - While a request is pending: Collect (manual) and Waive should refuse for Dan.
   - Tara-paid fee: Void must refuse (corrected outside the platform).
7. Reset anytime with `node scripts/epic18-qa/seed.mjs` (this does not remove your saved Tara credentials only if the gym row is reused — it recreates the gym, so re-enter them).
