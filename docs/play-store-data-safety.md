# Play Console Data Safety Form — GymOS (Android)

Answers for Play Console → Policy → App content → Data safety, grounded in
the actual schema (`supabase/migrations/`), the analytics/error-monitoring
SDKs actually wired into `apps/mobile`, and `apps/mobile/app.json`'s
declared permissions — not generic boilerplate. Re-derive this if the
schema, the third-party SDKs, or the permissions change; don't hand-edit
Play Console without updating this file to match.

**Last re-derived: 2026-09-06**, against migrations `0001`–`0084`.
The previous revision predated Epic 10 (body metrics + progress photos),
Story 9.5 (PostHog), Story 14.1 (Sentry), and the Notch Pay → Tara Money
payment-provider switch — all four materially change the answers below.
See "What changed since the last revision" at the bottom.

## Does your app collect or share any of the required user data types?

**Yes.**

## Data types collected

### Personal info
| Type | Collected? | Shared with third parties? | Required or optional | Purpose |
|---|---|---|---|---|
| Name | Yes (`members.name`) | No | Required | App functionality (member identification) |
| Phone number | Yes (`members.phone`, `users.phone`) | Yes — messaging providers (see below), to deliver the login one-time code and member invites | Required | Account management (OTP login), app functionality |
| Email address | Yes, optional (`members.email`) | No | Optional | App functionality |
| Date of birth | Yes, optional (`members.dob`) | No | Optional | App functionality |
| Other info (emergency contact) | Yes, optional (`members.emergency_contact`) | No | Optional | App functionality (safety) |

The phone number is shared with whichever messaging provider in
`send-sms-hook`'s ordered fallback chain actually delivers the message —
**Evolution API (self-hosted WhatsApp), Twilio (WhatsApp), Twilio (SMS),
sent.dm**, in that order (`supabase/functions/send-sms-hook/index.ts`).
Declare all four, or whichever subset is actually configured in the
production environment at submission time.

### Health and fitness
| Type | Collected? | Shared? | Required or optional | Purpose |
|---|---|---|---|---|
| Fitness info | **Yes** (`progress_entries.weight_kg`, `waist_cm`, `chest_cm`, `hips_cm`, `arms_cm`, `thighs_cm`, and the member's free-text `note`) | No | Optional | App functionality (member-logged body-measurement progress tracking, Epic 10) |
| Health info | No | — | — | No clinical/medical data is collected |

**This is the answer that changed.** The previous revision declared health
and fitness **not** collected, with an explicit caveat that adding weight or
body metrics would require revisiting — Story 10.1 (`0066_body_profile_progress_entry_logging.sql`)
added exactly that. Body measurements a member logs about themselves are
**Fitness info** under Play's taxonomy and must be declared.

`members.goal` / `members.experience_level` (`0020`) remain free-text
onboarding selections (e.g. "lose weight", "beginner"), not clinical health
data — they are covered under App activity below, not here.

### Photos
| Type | Collected? | Shared? | Required or optional | Purpose |
|---|---|---|---|---|
| Photos | Yes — profile photos (`members.photo_url`, `users.photo_url`, `member-photos` bucket) and progress photos (`progress_photos.photo_path`, `progress-photos` bucket) | No | Optional | App functionality (identification at check-in; member-logged progress tracking) |

Two distinct photo classes, with **different storage-privacy postures** —
worth knowing before answering any follow-up question Play asks about
photo handling:
- `member-photos` is a **public** bucket (`0019`, `public = true`), path-scoped
  to `{user_id}/photo.{ext}`.
- `progress-photos` is a **private** bucket (`0067`, `public = false`),
  served only via short-lived signed URLs, member-only by default, with
  per-photo opt-in sharing to the member's assigned coach
  (`progress_photos.shared_with_coach`, default `false`).

### Financial info
| Type | Collected? | Shared? | Required or optional | Purpose |
|---|---|---|---|---|
| Purchase history | Yes (`payments`: amount, currency, method, status, `provider_transaction_ref`) | Yes — **Tara Money**, the payment processor, to process the transaction | Required (for paid memberships) | App functionality |

**No raw card or payment-instrument numbers are stored** —
`payments.provider_transaction_ref` only; instrument data is handled
entirely by Tara Money and never touches GymOS's database.

**Note:** the payment processor is **Tara Money**, not Notch Pay. Notch Pay
was the originally-planned provider and was replaced during Epic 4; every
Notch Pay reference in an earlier revision of this file was stale. Gyms
connect their **own** Tara Money merchant credentials (FR-126, Story 4.13),
stored encrypted in Supabase Vault — so a member's payment is processed
against their own gym's merchant account, not a single platform-wide one.

### App activity
| Type | Collected? | Shared? | Required or optional | Purpose |
|---|---|---|---|---|
| App interactions | Yes (`attendance_events` check-in/check-out timestamps; `class_bookings`; `workout_plan_completions`; `notifications` history; `member_preferences`) | Yes — PostHog, for product analytics (see below) | Required | App functionality, analytics |
| Other user-generated content | Yes (`session_notes` — coach-authored session notes; `progress_entries.note` — member's own free-text note; `members.goal` / `experience_level`) | No | Optional | App functionality (coach–member interaction, progress tracking) |

**Analytics (PostHog, Story 9.5)** — `apps/mobile` sends a deliberately
narrow set of product-analytics events to PostHog: `app_opened`,
`progress_entry_logged`, `workout_plan_exercise_completed`
(`packages/types/src/analytics.ts`). The payload interfaces are closed and
named by design, and **carry no body-measurement value, photo, note text,
name, phone, or email** — `progress_entry_logged` sends only booleans and a
count (`hasWeight`, `measurementCount`, `hasPhoto`, `hasNote`,
`loggedOffline`) plus `gymId`. The app never calls PostHog's `identify()`,
so events are tied to the SDK's own locally-generated anonymous ID, not to
a GymOS user ID.

### App info and performance
| Type | Collected? | Shared? | Required or optional | Purpose |
|---|---|---|---|---|
| Crash logs | Yes (Sentry, Story 14.1) | Yes — Sentry, the error-monitoring provider | Required | Analytics (diagnosing production crashes, NFR-007) |
| Diagnostics | Yes (Sentry — stack traces, device/OS context, environment tag) | Yes — Sentry | Required | Analytics |

`Sentry.init()` runs with no `sendDefaultPii` override, i.e. the SDK
default `sendDefaultPii: false` (`apps/mobile/src/app/_layout.tsx`);
no session replay, no request-body capture, no user-identity attachment is
configured. Sentry initializes only when `EXPO_PUBLIC_SENTRY_DSN` is set
for the build.

### Device or other IDs
| Type | Collected? | Shared? | Required or optional | Purpose |
|---|---|---|---|---|
| Device or other IDs | Yes — Expo push token (`device_push_tokens.expo_push_token`); PostHog's anonymous device/distinct ID | Yes — Expo's push notification service; PostHog | Required | App functionality (notification delivery), analytics |

## Data types explicitly NOT collected
- **Location** — no GPS/location permission is requested anywhere in `app.json`
- **Health info** (clinical/medical sense) — see Health and fitness above; only self-logged body measurements are collected, declared as Fitness info
- **Contacts, calendar, web browsing history, search history**
- **Audio/voice recordings** — no microphone usage anywhere in the app. **Corrected 2026-09-06:** an earlier revision of this file claimed `RECORD_AUDIO` was "not among `app.json`'s declared Android permissions". That was true of the static config but *false of the built app* — `expo-image-picker`'s config plugin adds `android.permission.RECORD_AUDIO` unless `microphonePermission: false` is set explicitly, and it was not, so every build up to and including TestFlight build 5 shipped a microphone permission the app never uses. `microphonePermission: false` is now set (which also *blocks* any other plugin from re-adding it), and `npx expo config --json --full` confirms the resolved Android manifest declares `android.permission.CAMERA` only. Verify against the **resolved** config, not `app.json`, when re-deriving this section
- **Messages** — OTP and invite delivery happens server-side in Edge Functions; the app itself never reads or sends SMS/WhatsApp
- **Payment instrument numbers** — see Financial info above

## Permissions declared (grounding for the answers above)
Taken from the **resolved** Expo config (`npx expo config --json --full`), not
from `app.json` alone — config plugins add permissions of their own, and
reading only the static file is what produced the `RECORD_AUDIO` error
corrected below:
- `android.permission.CAMERA` — QR check-in scanning (`expo-camera`) and taking a profile/progress photo (`expo-image-picker`)
- Photo library access (`expo-image-picker`'s `photosPermission`) — choosing an existing profile/progress photo
- Notifications (`expo-notifications`) — delivering the notification types in `public.notifications`

## Third parties data is shared with
| Party | What | Why |
|---|---|---|
| Tara Money | Payment amount/currency/reference | Processing the member's payment |
| Expo (push service) | Device push token | Delivering notifications |
| Evolution API / Twilio / sent.dm | Phone number, message body | Delivering login OTP codes and member invites |
| PostHog | Anonymous device ID, the four analytics events above, `gymId` | Product analytics |
| Sentry | Crash/diagnostic data | Error monitoring |
| Supabase | All of the above, as the hosting/database processor | Infrastructure |

GymOS does not sell user data and does not share it for advertising or
third-party marketing purposes.

## Security practices
- **Data encrypted in transit: Yes** (HTTPS/TLS to Supabase and to every third party above)
- **Data encrypted at rest:** Yes at the platform level (Supabase); per-gym payment credentials additionally encrypted in Supabase Vault (NFR-017)
- **Users can request data deletion: Yes** — satisfied by a **documented manual process**, not an in-app delete button (Play permits this provided the instructions are published and the contact route works). Decided 2026-09-06; see `docs/privacy-policy.md`.
  - **Method to declare in Play Console:** account-deletion request via a published contact route (no in-app flow).
  - **Published instructions:** §6 of the hosted policy (`/privacy`) — the member contacts their gym or writes to the support address; GymOS confirms identity via the gym, deletes what it is not legally required to keep, and confirms completion.
  - **What is retained regardless:** payment and audit records required for financial/legal record-keeping (`audit_log` is append-only by design, Story 1.4). The policy states this explicitly rather than promising total erasure.
  - **Contact route:** `info@smartsana.com` (set 2026-09-06). The declaration is only truthful while that inbox is actually monitored and deletion requests are actioned — treat it as an operational commitment, not just a form field.
  - No in-app deletion flow was built for V1: erasure would cross ~40 tables and conflicts with `audit_log`'s append-only design and with financial-record retention. Available as a future story if the manual process proves insufficient.

## Still needed before this form can be submitted
1. ~~A live **privacy policy URL**~~ — **done (2026-09-06)**: served at `/privacy` from `apps/dashboard` (public, unauthenticated, EN + FR), with all five operator-supplied values filled. The remaining step is deploying the dashboard so the URL resolves publicly.
2. ~~A decision on the **data-deletion** question~~ — **done (2026-09-06)**: documented manual process via `info@smartsana.com`, see Security practices above.
3. Confirm whether **Tara Money's** DPA / data-sharing terms need to be referenced explicitly (this was previously worded against Notch Pay, the wrong provider).
4. Confirm which **messaging providers** are actually enabled in the production environment, so the phone-number sharing declaration lists the real set rather than all four chain members.
5. Counsel review of the hosted policy text in **both languages** (`apps/dashboard/lib/legal/privacy-policy.ts`) — the French text was authored alongside the English, not translated from a reviewed source.
6. ~~**Target audience declaration**~~ — **decided (2026-09-06)**: minimum age **18**, so Play's "Target audience and content" section takes the **18+ bracket only**, avoiding the 13–17 branch's additional child-safety, ads and content-rating requirements. Note that nothing in the app enforces this — there is no age gate and `members.dob` is optional — so it is a declaration about intent, not a technical control.
7. **Retention is a manual promise, not an enforced one.** The policy commits to deleting member data one year after a membership ends; no retention/purge job exists in the codebase (`deactivated_at` is a soft-delete). Either keep this as an operational commitment or schedule the work.

## What changed since the last revision (2026-09-06)
| Change | Why |
|---|---|
| Payment processor: Notch Pay → **Tara Money** | Provider switched during Epic 4; the old name was factually wrong and would have been a false declaration |
| Health and fitness: "not collected" → **Fitness info collected** | Story 10.1 added `progress_entries` body measurements — the previous revision's own caveat called for exactly this revisit |
| Photos: one class → **two** (public profile bucket, private progress bucket) | Story 10.2 added `progress_photos` with its own private bucket and per-photo coach-sharing consent |
| Added: **App info and performance** (crash logs, diagnostics) | Story 14.1 wired Sentry into the mobile app |
| Added: **analytics sharing with PostHog**, and the anonymous PostHog device ID under Device or other IDs | Story 9.5 wired PostHog into the mobile app |
| Added: phone-number **sharing with the messaging provider chain** | Previously omitted entirely; OTP/invite delivery has always sent the number to a third party |
| Added: App activity now names `class_bookings`, `workout_plan_completions`, `notifications`, `member_preferences` | Epics 12, 13, and Story 6.7 shipped after the previous revision |
| Added: required-vs-optional column, permissions grounding, third-party summary table | Play Console asks for required/optional per data type; the form was previously unanswerable from this file alone |
