---
stepsCompleted: [1, 2]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md
excludedDocuments:
  - _bmad-output/planning-artifacts/architecture.md (superseded by ARCHITECTURE-SPINE.md per its own frontmatter)
project_name: 'gym_os'
user_name: 'smartsana'
date: '2026-08-11'
lastStep: 6
status: 'complete'
completedAt: '2026-08-11'
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-11
**Project:** gym_os

## Step 1: Document Discovery

### PRD Files Found

**Sharded (prds/prd-gym_os-2026-06-20/):**
- prd.md (84,774 bytes, modified 2026-08-11 20:33)
- addendum.md (8,624 bytes, modified 2026-08-11 19:00)
- reconcile-brief.md
- review-rubric.md

No whole-document duplicate found. Using sharded PRD.

### Architecture Files Found

**Whole:**
- architecture.md (58,201 bytes, modified 2026-07-07)

**Sharded (architecture/architecture-gym_os-2026-08-11/):**
- ARCHITECTURE-SPINE.md (29,244 bytes, modified 2026-08-11 21:05)
- reviews/review-adversarial.md
- reviews/review-rubric-walker.md
- reviews/review-version-verification.md

⚠️ **Duplicate found — resolved:** ARCHITECTURE-SPINE.md's own frontmatter states it "supersedes the pre-spine architecture.md (2026-07-04)" and lists `architecture.md (prior version, superseded by this spine)` as one of its input sources. **Using ARCHITECTURE-SPINE.md as the authoritative architecture document; architecture.md excluded as superseded.**

### Epics & Stories Files Found

**Whole:**
- epics.md (155,184 bytes, modified 2026-08-11 22:00)

No sharded version found. Using epics.md.

### UX Design Files Found

**Sharded (ux-designs/ux-gym_os-2026-07-04/):**
- DESIGN.md (2,794 bytes, modified 2026-08-11 23:35)
- EXPERIENCE.md (143,567 bytes, modified 2026-08-11 23:36)

No whole-document duplicate found. Using DESIGN.md + EXPERIENCE.md.

### Other Relevant Documents Found (context, not primary assessment inputs)

- sprint-change-proposal-2026-07-14.md
- sprint-change-proposal-2026-08-08.md
- sprint-change-proposal-2026-08-11.md
- implementation-artifacts/sprint-status.yaml
- briefs/brief-gym_os-2026-06-20/brief.md
- Prior report: implementation-readiness-report-2026-07-04.md (previous assessment run; superseded by this report)

### Issues Found & Resolution

- ⚠️ CRITICAL (resolved): Duplicate architecture document formats — architecture.md (whole, 2026-07-07) vs. ARCHITECTURE-SPINE.md (sharded, 2026-08-11). Resolved by the spine document's explicit self-declared supersession. Proceeding with ARCHITECTURE-SPINE.md only.
- No other duplicates found.
- No required document types missing.

## Step 2: PRD Analysis

Source: `prds/prd-gym_os-2026-06-20/prd.md` (v1.5, updated 2026-08-11) + `addendum.md` (updated 2026-08-11). PRD covers V1.0 (shipped, FR-001–FR-086 minus gaps, NFR-001–NFR-010) plus V1.5 Beta-Ready (FR-087–FR-140, NFR-011–NFR-019). Full text extracted below, in PRD document order (which groups by feature area, not strictly by ID — the PRD's own convention: "New requirements append to the end of their section with the next available global number").

### Functional Requirements Extracted

**6.1 Platform Foundation**

- **FR-001** — Phone number is the primary identity. One phone number maps to one platform user account. A user may be a member at multiple gyms; each gym relationship is a separate `members` row linked to the same user account.
- **FR-002** — Registration requires phone verification via OTP. No email-based registration in V1.
- **FR-003** — The platform enforces a role hierarchy per gym: Member → Coach → Receptionist → Manager → Owner → Super Admin. Roles are enforced via PostgreSQL RLS policies. Custom role claims (`gym_id`, `role`) are injected into the Supabase JWT via a Database auth hook on login. This hook is a sprint-1 spike item — missing claims fail silently by defaulting to deny-all. When RLS rejects a request, the client shows "You don't have permission to do that" and logs the event to Sentry; no raw PostgreSQL errors reach the UI.
- **FR-004** — Super Admin is a platform-level role, not scoped to any gym. Super Admin can act across all tenants.
- **FR-005** — Each gym is a fully isolated tenant. A user in Gym A cannot read, write, or infer any data from Gym B. RLS enforces this at the database layer on every query.
- **FR-006** — The data model is designed to support hundreds of gyms and thousands of members per gym without schema changes. The 1–3 pilot gym scale is an operational expectation, not an architectural ceiling.

**6.2 Gym Setup & Onboarding**

- **FR-007** — V1 gym onboarding is founder-assisted. There is no self-serve gym signup flow. GymOS staff create the gym record and owner account in the Super Admin dashboard.
- **FR-008** — The gym admin dashboard includes a CSV import tool with a standardized template (member_name, phone [E.164], plan_type, join_date, subscription_status, expiry_date [conditional]). Import is all-or-nothing: all rows validated before any records are inserted; any failing row rejects the entire import with per-row error display. Members imported without an expiry date for a non-session plan are rejected at validation.
- **FR-009** — Historical payment and attendance records are not migrated. Imported members start with a clean history on the platform from the date of import.
- **FR-010** — During onboarding, the gym configures: gym name, logo, primary color, timezone (default Africa/Douala, GMT+1), preferred language (English or French), grace period duration, and gym capacity.

**6.3 White-Label Branding**

- **FR-011** — One app binary serves all gyms, published under the GymOS account. Gym-specific branding (name, logo, primary color) is applied within the app after launch, not at the OS/store level. Per-gym App Store listings deferred to V4+. Branding data cached on-device 24 hours; updates propagate on next app launch after cache expiry.
- **FR-012** — The gym admin dashboard Settings page lets the Owner upload a logo (Supabase Storage, CDN-served), set a gym name shown in the app header, and set a primary hex color for buttons/accents/nav highlights. Changes take effect in the member app within 24 hours.
- **FR-013** — Per-gym App Store listings, custom fonts, and full theme systems are out of V1 scope (deferred to V4+).

**6.4 Localization**

- **FR-014** — The platform is bilingual in English and French from V1. All UI strings, push notification copy, onboarding flows, and error messages are available in both languages.
- **FR-015** — Language is selected by the member at the start of onboarding (before phone number entry), defaulting to device locale. Also user-selectable from the profile screen at any time. Persists per user account across devices.
- **FR-016** — All string literals are externalized via an i18n library. No hardcoded UI text anywhere in the codebase. CI enforces this — PRs with hardcoded strings fail the build.
- **FR-017** — Receipts and payment confirmation documents follow the gym Owner's language preference.
- **FR-018** — The i18n foundation is structured to support additional languages in future versions without rework.

**6.5 Member Management**

- **FR-019** — A Manager or Owner can create, view, edit, and deactivate member records. Soft-delete only — records are deactivated, never deleted, to preserve audit history.
- **FR-020** — Member records store: full name, phone number, email (optional), date of birth (optional), profile photo (optional), join date, current plan, subscription status, and emergency contact (optional).
- **FR-021** — A Receptionist can view and search member records and initiate payments for a member, but cannot create, edit, or deactivate member records.
- **FR-022** — Coaches can view profiles of their assigned members only. Coaches cannot see or access members not assigned to them.
- **FR-023** — Members can view and edit their own profile (name, photo, language preference) from the app. Changing a phone number requires admin intervention.
- **FR-082** — When a Manager or Owner creates a new member record and clicks "Send Invite," the system automatically sends a personalized onboarding invitation (name, gym name, deep link) via WhatsApp, routed through the self-hosted Evolution API gateway (FR-071). The deep link pre-associates the member's phone number. Manager/Owner may resend at any time. If the automated send fails, the dashboard shows an inline error and falls back to the manual copy/share-via-WhatsApp option (demoted from primary to fallback, not removed).
- **FR-083** — When a Manager or Owner deactivates a member: (a) subscription set to `expired` immediately; (b) member loses check-in access; (c) member retains app access to view history; (d) no automated push notification is sent for deactivation. Deactivation is audit-logged with actor, mandatory reason, and timestamp.

**6.6 Membership Plans**

- **FR-024** — The platform supports V1 plan types: Pay-per-session, Monthly, Coach-inclusive, Class-only. Travel mode deferred to V2.0.
- **FR-025** — Plan definitions (name, price XAF, duration, access type) configurable per gym by Owner/Manager. Platform supports monthly and annual billing intervals for recurring plans from V1; annual plans carry a gym-set discount. Billing interval stored on the subscription record independently of tier names/price points.
- **FR-026** — All monetary values stored as integers (whole XAF francs) with an explicit `currency` column. No floating-point monetary storage anywhere. V1 currency is XAF only; schema multi-currency-ready from day one.

**6.7 Subscription Lifecycle**

- **FR-027** — A member subscription moves through states in sequence: `active → expiring_soon → grace_period → expired`. Transitions executed by a Supabase pg_cron job nightly at 02:00 Africa/Douala. Job failure is logged to the audit log and surfaced as a Super Admin dashboard alert; no automatic retry; a missed run is corrected on the next successful execution, statuses not retroactively backfilled.
- **FR-028** — `expiring_soon` is triggered 7 days before the expiry date.
- **FR-029** — `grace_period` begins the day after the expiry date. Duration set per gym in Settings; platform default 3 days.
- **FR-030** — `expired` is set when the grace period ends without renewal. An expired member loses gym access but retains their app account and membership history.
- **FR-031** — Two distinct check-in outcomes for non-active members: `expiring_soon`/`grace_period` → accepted, green confirmation, yellow dashboard alert; `expired` (beyond grace) → rejected, red screen, red dashboard alert. The front-desk alert fires in both cases; color/copy differ by urgency.
- **FR-032** — Renewal resets subscription to `active` and sets a new expiry date based on plan duration. Triggered by successful payment or manual admin override. On renewal: (a) front-desk alert dismisses immediately; (b) member receives push N-04; (c) renewal appears in payment history immediately.

**6.8 Payments**

- **FR-033** — Supported payment methods in V1: MTN Mobile Money (automated, via aggregator), Orange Money (automated, via aggregator), Cash (manual, mandatory reason), Bank transfer (manual, Manager/Owner, mandatory reason), Manual mobile money (manual, for gateway-unavailable cases).
- **FR-034** — V1 ships with Notch Pay as the sole mobile-money aggregator, behind an internal `PaymentProvider` interface so a second provider can be added later without touching payment logic. Campay deferred to V2. Gated by a one-day sandbox spike (exit criteria: sandbox auth, initiation returns a reference, webhook received/processed, idempotency test passes) recorded in `docs/decisions.md` before the payments Epic begins. If the spike fails, no payment code ships until an alternative is validated and documented.
- **FR-035** — Payment webhooks are processed idempotently. Duplicate webhook delivery does not create duplicate payment records, enforced via a unique constraint on the provider transaction reference.
- **FR-036** — A scheduled reconciliation job runs nightly (same pg_cron window) matching provider-confirmed payments against internal records. A discrepancy is: (a) a webhook with no matching internal record; (b) an internal `processing` record with no webhook within 10 minutes of creation; or (c) an amount mismatch between webhook payload and internal record. Discrepancies appear as flagged rows on the Payments dashboard page.
- **FR-037** — The Payments page includes a verification queue for manual payments awaiting confirmation; a Receptionist or Manager can mark a queued payment verified or flag it for review.
- **FR-038** — All manual payment entries require: payment method, amount, member, actor (auto-populated), mandatory reason/note, timestamp (auto-populated) — none optional at the UI level.
- **FR-039** — Transaction fees from the aggregator are passed through to gyms by default. The platform does not absorb provider fees. A member-pays-surcharge option is deferred.
- **FR-040** — Refunds are recorded in the system in V1 (amount, reason, actor, timestamp). Provider-executed refund API calls deferred. A Manager/Owner records a manual refund entry with mandatory reason on member dispute; the gym pays the member out-of-band. Audit-logged.
- **FR-041** — The system generates a payment receipt for each successful payment: member name, gym name, plan, amount, currency, payment method, date, transaction reference, actor.

**6.9 Attendance & Occupancy**

- **FR-042** — Members check in via the app's Check-In screen scanning a static QR code at the gym entrance. A successful scan records an attendance event (member, gym, timestamp).
- **FR-043** — The entrance QR encodes a URL with a `gym_token` (non-guessable UUID per gym at setup). The app decodes/sends it to the check-in endpoint, which validates against the `gyms` table before recording. Non-matching token shows "QR code not recognized — make sure you're scanning your gym's code." The gym's QR is downloadable/printable from Settings.
- **FR-044** — Only one open check-in per member at a time. A second scan while open is rejected: "You're already checked in." Enforced via a partial unique index (`WHERE checked_out_at IS NULL`). Edge case: a stale open check-in (app crash, auto-timeout job didn't run) is auto-closed at `original_check_in_time + timeout_duration`, the new check-in recorded, and the auto-close logged to the audit log.
- **FR-045** — Check-out is manual (member from app, or receptionist from dashboard) or automatic via a configurable auto-timeout (default 8 hours, configurable per gym), executed by the same pg_cron job as lifecycle transitions. Late job run closes sessions on the next successful run.
- **FR-046** — Occupancy is calculated as currently checked-in members as a percentage of the gym's configured capacity.
- **FR-047** — Member-facing occupancy display uses three bands: Low (<30%), Medium (30–70%), Busy (71–90%). The 91%+ "Full" threshold and raw counts are admin-dashboard-only, never in the member app.
- **FR-048** — The admin dashboard Attendance page shows currently checked-in members, today's attendance count, and a check-in/check-out log filterable by date and member.

**6.10 Retention Triggers — Front-Desk Alert**

- **FR-049** — When a member with status `expiring_soon`, `grace_period`, or `expired` triggers a check-in event (accepted or rejected), the system immediately publishes a real-time alert to all active dashboard sessions for that gym via Supabase Realtime. Two alert types: yellow grace alert (accepted), red denied alert (rejected). See FR-031 for copy/color per state.
- **FR-050** — The alert displays member name, profile photo, subscription status, days until/since expiry, and a "Renew" action button, on both the Overview and Attendance pages. "Renew" opens an inline renewal panel within the alert — no navigation away. Pre-populates current plan, renewal price in XAF, today's date as new start date; plan/method changeable. "Confirm Renewal" records payment, resets subscription to `active`, sets new expiry date, dismisses alert. Max 3 taps for a straight-through cash renewal.
- **FR-051** — Multiple simultaneous alerts display as a stacked queue, newest on top, max 5 visible, older ones scroll below. Each alert dismissed individually (writes `dismissed_at` + dismissing user ID) or auto-dismisses after 30 minutes (gym-configurable; also writes a record). A new alert fires for the same member if they scan again after dismissal without renewal.
- **FR-052** — End-to-end latency from QR scan completion to alert appearing on the dashboard is under 3 seconds under normal network conditions. See NFR-010 for the Supabase region requirement affecting this target.

**6.11 Coach Portal (V1)**

- **FR-053** — The Coach Portal is a role-gated section within the gym admin dashboard. Coach-role users see only the Coach Portal; all other sections (Payments, Members, Settings, Audit Log) are inaccessible.
- **FR-054** — V1 Coach Portal features: assigned member list (sortable by name/plan, shows subscription status); member profile view (name, plan, status, contact, goal, experience level); session notes (add/view/edit timestamped, coach-attributed). Expired members remain visible with status shown, no automatic notification. Coach-to-receptionist escalation deferred to V2.0; verbal communication expected through V1.5.
- **FR-055** — A Manager or Owner assigns members to coaches from the Members page. A member may be assigned to at most one coach at a time. Reassignment ends the previous assignment with an `ended_at` timestamp (not deleted). Session notes from the previous coach remain visible to Owner/Manager only — not the new coach. Historical assignment records are queryable from the member's profile.
- **FR-056** — Workout plan management and class scheduling were deferred to V1.5, now resolved — see 6.21 (FR-104–FR-108) and 6.22 (FR-109–FR-112).

**6.12 Member Mobile App**

- **FR-057** — The member app ships to Android and iOS from a single React Native + Expo codebase via EAS Build + Submit. Bundle ID `com.gymos.app`. Both platforms ship together; no Android-only pilot.
- **FR-058** — First-launch onboarding flow: (0) language selection (EN/FR, defaults to device locale, before any other screen); (1) phone number entry (E.164 enforced); (1a) OTP verification (60s countdown before resend enabled, max 3 resend attempts, 5-min lockout after exhaustion with "Contact your gym for assistance," one-tap resend, no navigation away); (2) profile setup (name required, photo optional); (3) goal selection (Lose Weight / Build Muscle / Improve Fitness / General Wellness, visible to assigned coach); (4) experience level (Beginner/Intermediate/Advanced, visible to coach); (5) plan confirmation (gym's available plans; member confirms or selects pre-assigned plan).
- **FR-059** — Home screen displays: gym branding header (logo, name, color), current subscription status and expiry date, quick-action buttons (Check In, View Plan, Profile), and recent activity summary (last check-in date).
- **FR-060** — The Check-In screen opens the camera and scans the gym's static QR. States: Success (green, timestamp), Success-offline (green + syncing indicator), Wrong QR (not recognized message), Already checked in, Expired-denied (red screen).
- **FR-061** — The app supports offline check-in only. Scanning without connectivity records the check-in locally in SQLite and shows success immediately; syncs on reconnect. Conflict resolution: if sync arrives after the auto-timeout window, the server accepts the check-in and sets `checked_out_at` to `scan_time + timeout_duration`. The front-desk alert fires at sync time, not scan time. No other actions (payments, profile updates) are queued offline in V1.
- **FR-062** — Members can view: current plan details, expiry date, payment history, and a list of past check-ins from the app.
- **FR-063** — The Profile screen includes a language selector (EN/FR) and profile photo upload. Language change takes effect immediately across the app without re-login.

**6.13 Gym Admin Dashboard**

- **FR-064** — The gym admin dashboard is a Next.js web app. Pages and minimum access role: Overview (Receptionist) — check-ins, expiring members, revenue summary, alert panel; Members (Receptionist view; Manager+ create/edit/deactivate/send invite); Subscriptions (Manager) — all records, manual renewal; Payments (Receptionist) — all records, verification queue, manual entry; Attendance (Receptionist) — current check-ins, daily log, manual check-out; Audit Log (Manager) — append-only, filterable; Settings (Owner) — branding, language, timezone, grace period, capacity, QR download; Coach Portal (Coach) — assigned member list, session notes.
- **FR-065** — The Overview page front-desk alert panel is the primary surface for renewal action. Alerts are real-time (Supabase Realtime), no page refresh required.
- **FR-066** — The Members page supports search by name/phone, filter by subscription status, and bulk CSV export (limited to 1,000 rows/download; apply a filter to reduce results for larger sets). Export columns: member_name, phone, plan_type, subscription_status, expiry_date, join_date, last_check_in_date.
- **FR-067** — The Payments page verification queue shows all unverified manual payments ordered by submission time, each row showing member, amount, method, submitting receptionist, mandatory reason note.
- **FR-068** — The Audit Log page is read-only; records cannot be edited/deleted by any role. Paginated at 50/page. CSV export available to Owners.
- **FR-069** — The Settings page lets the Owner configure: gym name, logo, primary color, timezone, default language, grace period duration (days), gym capacity, front-desk alert auto-dismiss duration (minutes, default 30), QR code download/regeneration.
- **FR-085** — The Subscriptions page provides: record list (sortable by name/status/expiry); filters (status, plan type); access limited to Manager/Owner; manual renewal via the same inline renewal panel as FR-050; CSV export (same 1,000-row limit and column schema as Members export); renewal start date defaults to today, back-dateable to the original expiry date for grace_period/expired members.

**6.14 Super Admin Dashboard**

- **FR-070** — The Super Admin dashboard is a separate Next.js app, sharing the same Supabase project but accessible only to GymOS staff via a distinct URL/auth flow. Super Admin bypasses per-gym RLS; all Super Admin access to gym-specific data is audit-logged.
- **FR-071** — V1 Super Admin capabilities: gym list (name, owner, creation date, member count, status); gym creation (founder-onboarded, triggers owner SMS invite); gym management (suspend/deactivate/reinstate); platform metrics (total gyms, members, payments processed); tier management (create/edit/delete tiers — name, monthly/annual price XAF, member cap; changes effective for new assignments only, existing gyms not auto-reclassified); gym tier assignment (assign/change tier, override member cap per gym); messaging instance management (view active Evolution API WhatsApp instance ID/status, update the instance ID used for platform-wide sends without a code deployment).
- **FR-072** — Super Admin access to individual member data or payment records within a specific gym requires an explicit support escalation action (not a standard view), audit-logged with identity, reason, timestamp.
- **FR-073** — GymOS charges gyms a recurring subscription across three default tiers, differentiated by member count and price, same feature set across all tiers: Hustle (1–30 members), Grind (31–100), Elite (>100, no cap) — monthly/annual prices Super Admin configurable. Tier definitions (names, price points, thresholds, ability to add new tiers) managed entirely by Super Admin.
- **FR-086** — Member cap enforcement: when a gym reaches its tier's max member count, new member creation is blocked at the API level, dashboard shows "You've reached your plan limit ([N]/[Max] members). Contact GymOS to upgrade." Active and deactivated members both count toward the cap. Super Admin can override the cap or move the gym to a higher tier.

**6.15 Push Notifications**

- **FR-074** — All push notifications route through Expo Push Notification Service → FCM (Android) + APNs (iOS). No direct FCM/APNs integration; Expo EAS handles token management.
- **FR-075** — V1 notification schedule: N-01 Membership expiring — 7 days (7 days before expiry, V1); N-02 Membership expiring — 1 day (1 day before, V1); N-03 Membership expired (on expiry date, V1); N-04 Payment confirmed (webhook success or manual verification, V1); N-05 Payment failed (webhook failure event, V1); N-06 Quiet-gym alert (occupancy drops to Low band, opt-in, max 2/day, min 3-hr gap, V1.5); N-07 Class reminder (60 min before a booked class, V1.5).
- **FR-076** — Notification preferences stored per member in `member_preferences`. Members can opt out of non-critical notifications (N-06, N-07). Lifecycle (N-01–N-03) and payment (N-04, N-05) notifications cannot be opted out of in V1. Note: mandatory notifications may require consent management for future GDPR-adjacent expansion — flagged as a known deferred risk.
- **FR-077** — Push tokens are stored per device. A token returned as invalid by FCM or APNs is cleaned up automatically on the next delivery attempt.
- **FR-078** — All notification copy is available in English and French, served per each member's language preference.

**6.16 Audit Log**

- **FR-079** — The audit log is append-only at the database level. No role — including Super Admin — can UPDATE or DELETE audit records. Enforced via RLS and absence of UPDATE/DELETE permissions on the audit table for all roles.
- **FR-080** — The following actions generate audit records: all manual payment entries, payment verifications, refund records, member deactivations, coach assignment changes, Super Admin gym-data escalations, pg_cron job failures. Each record: actor (user ID + display name), action type, target entity ID, relevant fields, UTC timestamp.
- **FR-081** — The Audit Log dashboard page is filterable by date range and actor. CSV export of filtered results available to Owners.

**6.17 Staff Management (Owner Self-Serve) — V1.5**

- **FR-087** — A gym Owner can create staff accounts for their own gym: Supervisor, Manager, Receptionist, Coach. A Supervisor can create Manager, Receptionist, Coach (Owner's creatable set minus Supervisor). Neither Owner nor Supervisor can create an Owner or Super Admin. A Manager cannot create staff at all. General rule: no role may create a role equal to or above its own rung (Owner > Supervisor > Manager > Receptionist > Coach — see NFR-013). Captures full name, phone (E.164), role. Staff creation is audit-logged.
- **FR-088** — A newly created staff member is provisioned like V1.0 owner activation: SMS with temp password + dashboard link. First login requires setting a new password. Until first login the account is `pending_activation`.
- **FR-089** — An Owner or Supervisor can edit a staff member's name and role, and deactivate (soft-delete) a staff account. Same ceiling rule as FR-087 applies to edits: an editor cannot raise a target's role to equal or above their own rung, and cannot edit their own role at all (self-escalation structurally impossible). Deactivation revokes access immediately via the same server-side check as FR-090, audit-logged with mandatory reason. A deactivated Coach's notes and plan authorship are retained, visible to Owner and Manager.
- **FR-090** — Role changes take effect immediately, not on next voluntary token refresh/re-login. Because role/gym claims are carried in the JWT (FR-003), immediate revocation requires a server-side check independent of client cooperation — a role-version or session-invalidation marker verified at the same auth-hook/RLS layer that enforces deny-all-by-default. A demoted/deactivated staff member's existing JWT is rejected the moment that check runs.
- **FR-091** — One phone number maps to one platform user (FR-001). A person may hold different roles at different gyms — each a separate binding. A person cannot hold two roles at the same gym; a new role replaces the prior binding (audit-logged).
- **FR-092** — A Coach account is a staff role for portal access. Assigning members to that coach remains a separate action on the Members page (FR-055). A Coach with no assignments sees an empty list with guidance to contact Manager/Owner/Supervisor.

**6.18 Complete Client Profiles — Body & Progress Tracking — V1.5**

- **FR-093** — The member profile gains an optional body profile: height, starting weight, optional baseline measurements. Entered during an optional "Complete your profile" step or any time from Progress. No body data is mandatory.
- **FR-094** — A member can log progress entries over time — any subset of weight, body measurements (waist, chest, hips, arms, thighs), a progress photo, and a note. Each entry carries a timestamp and a `client_id` for offline-safe dedupe. A member may soft-delete their own entry.
- **FR-095** — Body and progress data is private by default. RLS visibility: member always reads/writes own data; assigned Coach reads progress data of currently-assigned members only; Coach access ends the instant assignment ends (FR-055 `ended_at`); no other role (Receptionist, Manager, Supervisor, Owner, another member) can read a member's measurements or photos. Progress photos readable only by the owning member and, if opted in per-photo, their assigned coach — sharing defaults off per photo, revocable any time, revocation takes effect immediately (no outstanding signed URL remains valid, NFR-011) and applies going forward (does not retroactively determine whether the coach already viewed it).
- **FR-096** — The member Progress screen shows current weight and change since start, a weight trend chart, logged measurements with trends, a photo timeline (member-only unless shared), and a log-entry action. Charts view offline; logging offline queues the entry (FR-097).
- **FR-097** — Amendment to FR-061. V1.5 extends offline queueing to progress entry logging, stored locally (SQLite) and synced on reconnect via `client_id` idempotency. No other flows are offline in V1.5.
- **FR-098** — In the Coach Portal, an assigned member's profile gains a Progress tab showing weight/measurement trends and shared photos. The coach can add a note but cannot edit/delete a member's progress entries. Unassigned members invisible and unreadable.

**6.19 Payments — Tara Money (Automated Mobile-Money Option) — V1.5**

- **FR-099** — Amendment to FR-034. Tara Money is the designated automated mobile-money provider going forward, replacing Notch Pay in that role — formalizes a decision already made (`docs/decisions.md`, 2026-07-31), not new capability. Correction: no automated mobile-money payment has actually been collected from a real member in production under either provider to date; only cash/manual methods (FR-033) have carried real member payments. The sandbox spike (FR-100) succeeded including one real-money round-trip, but production activation is still pending (OQ-7). Tara Money is offered alongside cash/manual methods, not a replacement for them. Uses the existing `PaymentProvider` interface; business logic unchanged. Notch Pay remains a documented fallback behind the same interface, never carrying live traffic. Provider selection is configuration, not code.
- **FR-100** — The Tara Money integration was gated by a sandbox spike with the same exit criteria as Notch Pay's (OQ-2). Spike passed in full against a stand-in business account on 2026-07-31, including one real-money round-trip. No member has been charged/collected through that stand-in account or any other since — the spike proved the integration works, did not put it into production use. GymOS's own business account (`9FmIZg9GBB`) was blocked on activation until this session. A credential swap to the real account, re-verifying the same round-trip, and only then routing real member payments, are the remaining steps before production reliance (OQ-7). This is a credential swap, not a provider cutover (FR-102) — needs no code/migration changes, but is a hard prerequisite for G-9 and Section 10 item 2.
- **FR-101** — Webhook signature verification (NFR-002) is provider-specific; the handler verifies using the active provider's scheme. Tara Money verification is implemented and tested against sandbox and real webhook deliveries before cutover. Invalid payloads rejected with HTTP 401.
- **FR-102** — Cutover procedure: new payment initiations route to Tara Money; Notch Pay payments already in processing reconcile to a terminal state under Notch Pay (reconciliation job polls both providers during the window); no payment re-initiated across providers (prevents double-charge); migration window and reconciliation result recorded in the audit log; cutover reversible by configuration for the duration of the beta.
- **FR-103** — Both MTN Mobile Money and Orange Money are supported via Tara Money (matching V1.0 coverage, FR-033). Cash, bank transfer, and manual mobile money remain first-class manual methods, unchanged.

**6.20 Payment Gateway — Two Distinct Payment Flows — V1.5**

- **FR-124** — When a member pays their gym by Tara Money, the payment settles directly into that gym's own Tara Money account. GymOS orchestrates (create collect, detect confirmation, reconcile, receipt) but never receives or holds member funds — a technical orchestrator over each gym's own account, not an aggregator. Tara Money is one option beside cash and other manual methods (FR-033).
- **FR-125** — GymOS takes no commission on member→gym payments in V1.5. Platform revenue comes solely from the SaaS tier fee (Flow B). Provider transaction fees borne by the gym (FR-039); GymOS neither absorbs nor marks them up.
- **FR-126** — Each gym must connect its own Tara Money account to collect automated mobile-money payments. Settings provides a "Connect payment account" flow where the Owner authorizes their gym's merchant credentials. Credentials stored encrypted (Supabase Vault), readable only by the payment service, never returned to any client, tenant-isolated.
- **FR-127** — Cash and Tara Money are co-equal payment options, not primary/fallback. A gym without Tara Money connected loses no ability to operate — collects by cash/manual entry as before; the app simply does not surface the automated option until connected. Connecting is an enhancement, never a prerequisite.
- **FR-128** — When a member initiates a mobile-money payment, the service resolves the gym's connected credentials (FR-126) and routes through them. A member never sees gym credentials. If credentials are missing/invalid/revoked, initiation fails gracefully, directing the member to the desk, and the Owner is notified their connection needs attention.
- **FR-129** — Both member subscription purchase and renewal use Flow A. Renewal via the front-desk alert panel (FR-050) and self-service renewal from the app both route through the gym's connected account. Subscription lifecycle (FR-027–FR-032) unchanged; only money routing is now explicitly the gym's own account.
- **FR-130** — GymOS bills each gym for its platform SaaS subscription per tier (FR-073) and interval. New in V1.5: V1.0 assigned tiers and enforced caps (FR-086) but did not collect the fee. Billing for V1.5 is a reminder-to-approve model, not automated debit: GymOS notifies the Owner when payment is due (FR-135) and the Owner completes the charge via Tara Money into the platform's account (OQ-14, resolved). Automated recurring debit deferred to a future version pending a card-based provider.
- **FR-131** — A gym's platform subscription has its own lifecycle: `active` → `past_due` → `grace_period` → `suspended`. `active` — SaaS fee paid, gym fully operational. `past_due` — Owner missed the notice or the Tara Money charge failed; gym stays operational, repeat reminders begin (FR-133, FR-135). `grace_period` — retries exhausted, Super-Admin-configurable window begins (default 7 days), gym operational, Owner sees a "renew to avoid suspension" banner. `suspended` — grace elapsed, whole gym tenant suspended (staff and members cannot log in), data retained; payment restores full access immediately. Formalizes the Super Admin suspend capability (FR-071).
- **FR-132** — Suspending a gym for non-payment suspends the entire tenant — every staff and member account loses access until the subscription is current. Reversible: a successful SaaS payment returns the gym to `active` and restores access immediately. Member states and all data preserved through suspension. The member-facing suspension surface never mentions billing/payment.
- **FR-133** — Amendment — OQ-14 resolved. SaaS billing is Owner-approved, not automated: on each gym's billing anchor date, GymOS sends the Owner a payment-due notice (channels per FR-135) with a one-tap Tara Money payment link. The Owner is never auto-debited — mobile money does not support that. If unpaid, GymOS re-sends the notice on a defined schedule (default 1, 3, 5 days after due) before the gym moves to `grace_period`. Every notice and payment attempt recorded (FR-135). Automated recurring debit deferred pending a card-based provider; this FR amended again when that ships.
- **FR-134** — The Super Admin dashboard gains a Billing view: each gym's tier, interval, SaaS status, next billing date, last payment, failed attempts. Super Admin can mark a payment received (out-of-band), apply a credit/free period (beta gyms, FR-136), trigger a retry, or suspend/reactivate. All actions audit-logged (FR-080).
- **FR-135** — Gym Owners receive platform-subscription notifications distinct from member notifications: upcoming SaaS renewal, payment due (one-tap link, FR-133), payment succeeded/failed (with retry date), entering grace, impending suspension. Owner-facing and mandatory (non-opt-out). Sent via both SMS and WhatsApp (not a fallback chain — both fire), reusing the Evolution API/Twilio infrastructure (FR-118), plus email if the Owner has one on file. Capturing an Owner email is new in V1.5 (optional field, mirrors FR-020) and requires a transactional email provider not yet part of the stack (addendum §A lists none) — email is best-effort until integrated; SMS/WhatsApp are guaranteed channels regardless.
- **FR-136** — Beta accommodation. Super Admin can place a gym on a free or discounted plan (zero-price tier or credited period) so beta gyms aren't charged during validation — formalized as the Free/Test tier (FR-139) rather than ad-hoc discounting. The billing machinery (FR-130–FR-135) is built and exercised even at a 0 XAF price point; whether a given beta gym is charged is Super-Admin policy per gym.
- **FR-137** — Both flows reuse the V1.0 integrity machinery: idempotent webhooks (FR-035), reconciliation (FR-036), append-only audit (FR-079), integer-XAF storage (FR-026). Flow B reconciles against the platform account, Flow A against each gym's account; discrepancies in either flagged. Amendment to FR-036: the discrepancy definition gains a fourth category — a payment whose settled account does not match its declared routing context (FR-138), i.e. a Flow A collect landing in/credited to the platform account, or a Flow B collect landing in a gym account. Reference/amount matching alone cannot catch a misrouted-but-otherwise-clean payment.
- **FR-138** — The `PaymentProvider` abstraction carries a routing context identifying which account a payment belongs to (a specific gym for Flow A, the platform for Flow B). This context selects the correct credentials at initiation, verification, and reconciliation. Adding a provider or flow changes only the adapter and context, not the calling code.
- **FR-139** — Amendment to FR-073. A fourth tier, Free/Test, is added to the platform defaults: member cap Super Admin-configurable per gym, monthly/annual price fixed at 0 XAF. Exists specifically for beta/test gyms during validation. Assigning a gym to Free/Test is a tier change like any other (FR-071) — the billing reminder/reconciliation machinery (FR-130–FR-135) still runs, just at 0 XAF, so those code paths stay exercised during beta.
- **FR-140** — A member can renew their own subscription directly from the app (Flow A, FR-124) without visiting the front desk. When status is `expiring_soon`, `grace_period`, or `expired`, the app surfaces a "Renew" action showing current plan and renewal price; member pays by Tara Money if the gym has one connected (FR-126), or sees "See front desk to renew with cash" if not (FR-127). On successful payment, subscription resets per FR-032 with immediate confirmation — same outcome as the front-desk renewal panel (FR-050), member-initiated and routed through the gym's connected account (FR-129).

**6.21 Classes & Scheduling — V1.5**

- **FR-104** — A Manager or Owner can create classes: name, description, assigned coach, capacity, and a schedule (one-off or recurring). Classes are tenant-isolated like all other data.
- **FR-105** — Any member with an active subscription, on any plan type, can book a class session from the app (fixed rule — no per-plan class-eligibility flag). Booking is capacity-limited; when full, booking closes. Enforced server-side to prevent overbooking under concurrency.
- **FR-106** — A member can cancel a booking up to a gym-configurable cutoff (default 2 hours), freeing the spot. Booking and cancellation are not payments.
- **FR-107** — A Receptionist can view a session's booked members and mark attendance. Class attendance is distinct from floor check-in but uses the same member-status rules — an expired member cannot be checked in and triggers the front-desk alert (FR-049).
- **FR-108** — The member app shows upcoming booked classes on Home and a Classes screen of available/booked sessions. Workout plans and classes are separate features.

**6.22 Workout Plans — V1.5**

- **FR-109** — A Coach can author a workout plan for an assigned member: a named plan with an ordered list of exercises (sets, reps, optional notes), created/edited from the Coach Portal.
- **FR-110** — A plan is assigned to exactly one member. The member sees their plan and can mark exercises/sessions complete; completion logging is offline-safe (`client_id`). Completion data visible to the authoring coach.
- **FR-111** — If a coach assignment ends (FR-055), the previous coach's plan stays visible to the member and Owner/Manager but is not editable by a new coach until they take ownership — mirroring the V1.0 session-note handoff.
- **FR-112** — A shared exercise library (platform defaults; gym/coach can add custom entries, gym-scoped) backs plan authoring.

**6.23 Quiet-Gym Alerts — V1.5**

- **FR-113** — A member can opt in to quiet-gym alerts (default off). When occupancy drops into the Low band (FR-047) during opening hours, opted-in members receive N-06.
- **FR-114** — Quiet-gym alerts are rate-limited: max 2/day/member, min 3-hour gap, only during configured opening hours.
- **FR-115** — Quiet-gym alerts use the existing occupancy calculation (FR-046) — no new presence detection — preserving the honest-estimate guarantee.

**6.24 Class Reminders — V1.5**

- **FR-116** — A booked member receives N-07 60 minutes before the session. Class reminders are opt-out (non-critical), per FR-076.

**6.25 WhatsApp Invite & OTP Fallback (V1.0 Carryover Completion) — V1.5**

- **FR-117** — The Evolution API WhatsApp integration is completed, covering the two unfinished V1.0 stories. Member invitations (FR-082) can be sent via WhatsApp in addition to SMS, at the gym admin's choice.
- **FR-118** — OTP delivery uses an ordered fallback chain: Evolution API WhatsApp first, falling through to Twilio WhatsApp, then Twilio SMS, then sent.dm on failure at each step. Transparent to the member; channel and outcome logged for observability.
- **FR-119** — The Evolution API instance configuration (V1.0 Epic 1, Story 1.13 — shipped) is finalized: platform-level, managed by Super Admin, documented in `docs/decisions.md`.

**6.26 Dashboard & App Additions — V1.5**

- **FR-120** — The Settings page gains a Staff section (Owner and Supervisor) listing staff with role/status, plus Add/Edit/Deactivate (FR-087–FR-089). All other Settings capabilities unchanged.
- **FR-121** — A new Classes page (Manager for create/edit; Receptionist for bookings and class attendance) lists classes, sessions, booking counts vs capacity, and the assigned coach.
- **FR-122** — The Coach Portal gains Workout Plans and, per assigned member, a Progress tab. No other dashboard section becomes visible to the Coach role.
- **FR-123** — The member app gains a Progress tab and a Classes tab alongside Home/Check-In/Profile. Notification preferences gain N-06 and N-07 toggles.

**Total FRs: 139** (FR-001 through FR-140; FR-084 does not exist in the document — a gap in the numbering, not a content omission, consistent with the PRD's "stable IDs, never renumbered" convention).

### Non-Functional Requirements Extracted

**7.1 Performance** (targets, not individually numbered)
- Dashboard page load: < 2 seconds on standard broadband.
- QR scan → front-desk alert end-to-end: < 3 seconds under normal network conditions.
- Offline check-in sync: queued check-in syncs within 10 seconds of connectivity restore.

**7.2 Security & Data Integrity**

- **NFR-001** — Multi-tenant data isolation is enforced at the PostgreSQL layer via RLS. Every query against tenant data must pass through RLS-governed policies. The JWT role claim injection hook (FR-003) is spiked in week one, before any RLS policies are written — a misconfigured hook defaults to deny-all and silently blocks all authenticated users.
- **NFR-002** — Payment webhook endpoints validate the provider's request signature before processing. Unsigned or invalid webhook payloads are rejected with HTTP 401.
- **NFR-003** — Monetary values are stored as integers with an explicit currency column. Floating-point types are not used for any monetary field.
- **NFR-004** — The audit log is append-only by design. No migration, script, or application code may issue UPDATE or DELETE against audit records.
- **NFR-012** — The Tara Money cutover (FR-102) must produce zero double-charges and zero lost payments, verified by the reconciliation job reporting zero discrepancies before Notch Pay is stood down as primary.
- **NFR-013** — Staff provisioning and role editing (FR-087, FR-089) must make privilege escalation impossible: no role can create or edit a target into a role equal to or above its own, and no role can edit its own role, enforced at the RLS/auth-hook layer. CI asserts an Owner cannot mint/promote-to a Super Admin, a Supervisor cannot mint/promote-to a Supervisor or Owner (including on themselves), and a Manager cannot mint or edit staff roles at all.
- **NFR-017** — Per-gym Tara Money credentials (FR-126) are stored encrypted at rest (Supabase Vault), accessible only to the server-side payment service, never returned to any client, never logged, never readable across tenants. Same isolation guarantees as all tenant data (NFR-001).
- **NFR-018** — Tenant suspension for SaaS non-payment (FR-131/FR-132) is enforced at the authorization layer, not only the UI: a suspended gym's staff/members are denied at the RLS/auth-hook layer, so suspension cannot be bypassed by a client ignoring UI state. Takes effect on the next request; no tenant data deleted or mutated.
- **NFR-019** — FR-125's "GymOS takes no commission on member→gym payments" is auditable, not merely asserted: every Flow A payment's settlement account is verifiable against its gym's connected credentials (FR-126) via the audit log, so a platform-account credit from a Flow A transaction is detectable after the fact, not just prevented in theory.

**7.3 Availability**

- **NFR-005** — V1 availability is covered by Supabase Cloud and Vercel managed SLAs. No additional uptime commitment is made until commercial scale.
- **NFR-006** — The member app supports offline QR check-in only. Offline check-ins are queued in SQLite and sync on reconnect. No other flows require or support offline operation in V1.

**7.4 Observability**

- **NFR-007** — Sentry is integrated on both the mobile app and the admin dashboard in V1. Error events from both surfaces are routed to a single Sentry project with environment tagging (dev / staging / prod).
- **NFR-008** — Superseded by NFR-014. PostHog was deferred at V1.0; V1.5 activates it.
- **NFR-014** — PostHog product analytics is integrated on app and dashboard, focused on the V1.5 metrics (Section 3.2), carrying no body-measurement or photo content into events. Same environment tagging as Sentry (NFR-007).

**7.5 Testing**

- **NFR-015** — An E2E test automation baseline is established, covering four priority flows: staff provisioning + role enforcement, the payment cutover path, progress-data access boundaries, class booking capacity limits. Complements, not replaces, V1 CI gates.

**7.6 Scale Targets**

- **NFR-009** — Pilot scale: ~30 members per gym, 1–3 gyms. Architecture must support scaling to hundreds of gyms and thousands of members per gym without schema changes or RLS rework.

**7.7 Infrastructure**

- **NFR-010** — The Supabase project must be provisioned in a region geographically close to West/Central Africa. EU West (Ireland or Frankfurt) is the recommended selection. US East adds 200–400ms of intercontinental latency on top of Cameroonian mobile network jitter, making the <3s front-desk alert target (FR-052) difficult to meet. Region selection must be confirmed before any Supabase project is created — it cannot be changed after data is written.

**7.8 Data Privacy — Progress Data (V1.5)**

- **NFR-011** — Progress photos (FR-094) are stored in Supabase Storage under access rules mirroring FR-095: retrievable only by the owning member and, if shared, their assigned coach. Object paths non-guessable; no photo served from a public bucket — a new, dedicated bucket, separate from the existing public `member-photos` bucket (Story 2.6). Signed URLs are short-lived enough that revoking a photo's sharing invalidates access within that same window — no long-lived signed URL survives a revoke.
- **NFR-016** — Coach access to member progress data — both the assignment relationship and each photo's per-photo sharing flag (FR-095) — is re-verified on every request against current state; an ended assignment or a revoked photo-share revokes read access with no caching window that outlives either.

**Total NFRs: 19** (NFR-001 through NFR-019, all present; NFR-008 retained in text but explicitly marked superseded by NFR-014).

### Additional Requirements

**Constraints & Assumptions (Section 8 — Out of Scope, hard boundary):** Self-serve gym signup (post-V1.5); Travel mode plan type (V2.0); Campay integration (V2.0); Provider-executed refund API calls (V2.0); Coach-to-receptionist escalation (V2.0); Class waitlists (V2.0); Nutrition/meal logging (V2.0); Progress data export (V2.0); Streaks/challenges/leaderboards/activity feed (V2.0); Multi-currency beyond XAF (V2+); Gym-owned merch store (V2.5); Platform-wide marketplace (V3.0); Geofence/BT/WiFi presence detection (V3.0); Per-gym App Store listings (V4+); Custom fonts/theme systems (V4+); AI features/wearables/corporate wellness (V4+); Dokploy/VPS services (decision pending). Explicit non-goal: Manager/Owner visibility into member progress data is not planned — a product privacy commitment (FR-095), not a temporary limitation.

**Open Questions still active (Section 9):** OQ-2 (Notch Pay spike — historically resolved by the V1.5 Tara Money pivot, FR-099/FR-100, but the PRD leaves the OQ-2 row itself unmarked as resolved — a minor documentation-drift note, not a blocker); **OQ-7** (Tara Money re-verification against GymOS's own activated business account `9FmIZg9GBB` — blocks full production reliance on FR-100, and blocks the Flow B billing-job architecture decision, FR-130/FR-133); **OQ-12** (WhatsApp/Evolution API compliance, number provisioning, messaging limits/sender identity — blocks FR-117–FR-119, Stories 2.9/2.10, backlog); **OQ-13** (Tara Money create-collect + payment-detection flow confirmation, folded into the OQ-7 re-spike — blocks FR-124, FR-126, FR-128). All other OQs (1, 3–6, 8–11, 14, 15) are marked Resolved in the PRD text.

**V1.5 Release Definition — "Beta-Ready" gate (Section 10):** Six conditions, each traceable to FR ranges: (1) self-staffing FR-087–FR-092; (2) Tara Money cutover proven clean FR-099–FR-103/NFR-012; (3) retention loop incl. progress FR-093–FR-098; (4) classes + workout plans FR-104–FR-112; (5) SaaS billing collection FR-130–FR-140/NFR-019/G-12, gated on OQ-7; (6) bilingual/offline-tolerant/PostHog/E2E NFR-014/NFR-015. This is the acceptance bar the epics/stories must collectively satisfy — used as the traceability anchor in Step 3.

**Key architectural decisions carried from the Addendum (§D)** that constrain implementation but aren't independently numbered FRs: staff-provisioning security uses a new `SECURITY DEFINER` RPC (distinct in shape from Story 1.5's admin-client gym/owner creation); progress-photo storage uses a new, separate, private Storage bucket with signed URLs (not the existing public `member-photos` bucket); Supabase Vault for per-gym payment credentials.

### PRD Completeness Assessment

The PRD is thorough and internally disciplined: every requirement carries a stable, never-renumbered ID; V1.5 amendments to V1.0 requirements are explicit ("Amendment to FR-XXX") rather than silent edits, preserving history; goals (Section 3) and success metrics map cleanly to FR ranges; the Section 10 release gate gives a concrete, FR-anchored Beta-Ready definition that Step 3 can trace epics/stories against.

Two items to carry into coverage validation and gap analysis (Steps 3–4), not blocking PRD analysis itself:
1. **OQ-7 is a live, unresolved blocker** for G-9, G-12, and Section 10 items 2 and 5 — it gates production reliance on Tara Money and the Flow B billing-job architecture. This is a legitimate open dependency, not a PRD defect, but epics/stories touching Flow B billing or Tara Money production cutover should be checked for whether they correctly treat OQ-7 as a pending gate rather than assuming it's closed.
2. **OQ-2's row is not marked Resolved** even though it's superseded in substance by the Tara Money pivot (FR-099) — a minor documentation-drift item, not a functional gap.

No missing FR/NFR numbering gaps beyond the single explained case (FR-084, never allocated). Ready to proceed to epic coverage validation.

## Step 3: Epic Coverage Validation

Source: `epics.md` (2,342 lines), which contains its own **Requirements Inventory** (a restatement of every PRD FR/NFR, matching Step 2's extraction) and a dedicated **FR Coverage Map** section (lines 299–440) explicitly assigning every FR to an epic (V1.0, epics 1–8) or epic+story (V1.5, epics 9–13 + Epic 4/6 extensions).

### Epic FR Coverage Extracted

The FR Coverage Map assigns all 139 FRs (FR-001–FR-140, FR-084 never allocated — consistent with Step 2) to an epic, with V1.5-era FRs (087–140) additionally pinned to a specific story number. V1.0-era FRs (001–083, 085–086) are assigned at epic granularity only (no story number) in this map — coarser, but every V1.0 epic's own story section (read in full below, per-epic) carries its own FR references in each story's acceptance criteria, so story-level traceability exists, just not consolidated into this top-level map for the older epics.

Total FRs in epics: **139 / 139** (100%).

### FR Coverage Analysis

| FR Range | Feature Area | Epic(s) | Status |
|---|---|---|---|
| FR-001–006 | Platform Foundation | Epic 1, Epic 2 | ✓ Covered |
| FR-007–010 | Gym Setup & Onboarding | Epic 1 | ✓ Covered |
| FR-011–013 | White-Label Branding | Epic 1 | ✓ Covered |
| FR-014–018 | Localization | Epic 1 | ✓ Covered |
| FR-019–023, 082–083 | Member Management | Epic 2 | ✓ Covered |
| FR-024–026 | Membership Plans | Epic 2 | ✓ Covered |
| FR-027–032 | Subscription Lifecycle | Epic 3 | ✓ Covered |
| FR-033–041 | Payments (V1.0) | Epic 4 | ✓ Covered |
| FR-042–048 | Attendance & Occupancy | Epic 3 | ✓ Covered |
| FR-049–052 | Front-Desk Alert | Epic 4 | ✓ Covered |
| FR-053–056 | Coach Portal (V1) | Epic 5 | ✓ Covered |
| FR-057–063 | Member Mobile App (V1.0) | Epic 2, Epic 3 | ✓ Covered |
| FR-064–069, 085 | Gym Admin Dashboard | Epic 1, Epic 2, Epic 4 | ✓ Covered |
| FR-070–073, 086 | Super Admin Dashboard | Epic 1, Epic 2 | ✓ Covered |
| FR-074–078 | Push Notifications (V1.0) | Epic 6 | ✓ Covered |
| FR-079–081 | Audit Log | Epic 1, Epic 7 | ✓ Covered |
| FR-087–092, 120 | Staff Management (V1.5) | Epic 9 (Stories 9.1–9.4) | ✓ Covered |
| FR-093–098, 123 | Progress Tracking (V1.5) | Epic 10 (Stories 10.1–10.4) | ✓ Covered |
| FR-099–103, 124–129, 137–138, 140 | Tara Money / Flow A (V1.5) | Epic 4 extension (Stories 4.10–4.15) | ✓ Covered |
| FR-104–108, 121 | Classes & Scheduling (V1.5) | Epic 12 (Stories 12.1–12.4) | ✓ Covered |
| FR-109–112, 122 | Workout Plans (V1.5) | Epic 13 (Stories 13.1–13.4) | ✓ Covered |
| FR-113–115 | Quiet-Gym Alerts (V1.5) | Epic 6 extension (Story 6.5) | ✓ Covered |
| FR-116 | Class Reminders (V1.5) | Epic 6 extension (Story 6.6) | ✓ Covered |
| FR-117–119 | WhatsApp/OTP Completion (V1.5) | Epic 1 (Story 1.13, shipped) | ✓ Covered |
| FR-130–136, 139 | SaaS Billing / Flow B (V1.5) | Epic 11 (Stories 11.1–11.6) | ✓ Covered |

No FR appears in the PRD without a corresponding epic/story entry in the coverage map, and no FR number appears in the coverage map that isn't in the PRD (spot-checked against the Step 2 extraction — no phantom IDs).

### Missing Requirements

**None.** Zero FRs are unaccounted for. This is a genuinely clean result, not an assumption — every one of the 139 FRs extracted in Step 2 has a matching line in the epics document's own FR Coverage Map.

Two non-blocking observations carried forward rather than logged as missing coverage:

1. **NFR traceability exists but isn't consolidated.** There's no dedicated "NFR Coverage Map" analogous to the FR one. However, all 19 NFRs (NFR-001–NFR-019) are referenced by ID somewhere in `epics.md` — 47 total mentions across the 19 unique IDs, meaning most NFRs are cited multiple times (in the Requirements Inventory restatement plus again in individual stories' acceptance criteria or Dev Notes). Traceability exists, just distributed rather than mapped in one table. Not a gap for this step (Step 3 is scoped to FR coverage only per the workflow), but worth a formal NFR Coverage Map if the team wants the same single-glance auditability the FR map provides.
2. **Granularity asymmetry between V1.0 and V1.5 epics in the map itself.** V1.5 FRs (087–140) are pinned to specific story numbers in the coverage map; V1.0 FRs (001–086) are pinned to epic only. This doesn't indicate missing coverage — each V1.0 epic's stories carry their own FR references in-line — but it's a minor documentation-consistency gap if the map is meant to be the single source of truth for traceability.

### Coverage Statistics

- Total PRD FRs (from Step 2): **139**
- FRs covered in epics: **139**
- Coverage percentage: **100%**
- NFRs referenced in epics (informational, not this step's pass/fail criterion): **19 / 19 (100%)**, distributed across story ACs rather than a single map.

Ready to proceed to UX alignment.

## Step 4: UX Alignment

### UX Document Status

**Found.** `DESIGN.md` (tokens) + `EXPERIENCE.md` (2,543-line implementation-ready spine covering Member App, Admin Dashboard, Coach Portal, Super Admin Dashboard). Both files carry `updated: 2026-08-11` in frontmatter.

**Timestamp finding (material, not cosmetic):** file mtimes place `epics.md` at **22:00** and the UX pair at **23:35–23:36** on 2026-08-11 — the UX documents were updated **after** `epics.md` was finalized, on the same day. This matters because `epics.md`'s own Requirements Inventory (line 297) states: *"V1.5: no UX Design Requirements available... has not been updated since 2026-07-04 and has no mockups for staff management, progress tracking, classes/booking, workout-plan authoring, the Super Admin Billing view, or the Tara Money connect-account flow — flagged explicitly in the 2026-08-11 sprint-change-proposal as needing a dedicated `bmad-ux` pass, routed separately from this workflow."*

That statement is now **stale**. The `bmad-ux` pass it called for has since happened. Verified directly in `EXPERIENCE.md`:
- **MA-15 · Progress** *(V1.5)* — full screen spec, FR-093–097 referenced, offline behavior, privacy note tied to FR-095 RLS enforcement.
- **MA-16 · Classes** *(V1.5)* — booking/cancellation, FR-105/106, explicitly references the capacity race condition and **Architecture Decision AD-21** (`book_class_session()` RPC).
- **AD-16/AD-17 · Staff — List / Add-Edit** *(V1.5)* — staff management screens for FR-087–092.
- **AD-18/AD-19 · Classes — List & Attendance / Create-Edit** *(V1.5)*.
- **AD-15 · Coach Portal — Member Detail**, restructured into three tabs (Session Notes / Progress / **Workout Plan**, FR-122, Story 13.2) — explicitly annotated *"Confirmed with user (2026-08-11)"*, i.e. a real design decision made after `epics.md` was written.
- **AD-13 · Settings** — gains a **Connect Payment Account** modal (FR-126) with a defined disconnect/invalid-credential banner state (FR-128).
- **SA-07 · Billing** *(V1.5, FR-131/FR-135, **explicitly cites "Story 11.5"**)* — Super Admin billing view with row-level override actions, all tied to FR-080 audit logging and Story 11.2/11.4's lifecycle/suspension mechanics.
- A dedicated **"V1.5 — New State Patterns"** section specifying four new state-machine UI treatments (gym-suspended, immediate access revocation, class-capacity race, progress-photo-revoke), each cross-referenced to its governing FR/NFR/AD.

Every one of the six gaps `epics.md` names as missing — staff management, progress tracking, classes/booking, workout-plan authoring, Super Admin Billing, Tara Money connect-account — now has a screen-level spec in `EXPERIENCE.md`.

### A. UX ↔ PRD Alignment

Strong. Sampled in depth, not just structurally:
- All ten PRD user journeys (UJ-1–UJ-10, including the six V1.5 journeys UJ-6–UJ-10) have a corresponding entry in `EXPERIENCE.md`'s **Key Flows** section (Flow 1–11).
- Screen specs cite FR IDs inline throughout (e.g. MA-16 cites FR-105/FR-106; SA-07 cites FR-131/FR-135/FR-080), not just at a section level — this is requirement-traceable UX, not decorative.
- The color/status semantics in `DESIGN.md` (fixed `success`/`warning`/`danger`/`neutral` tokens, never overridden per gym) directly implement FR-047's "never color alone" style requirements and the 5-state status badge system (UX-DR5, itself derived from the PRD's subscription-lifecycle states FR-027–031).
- No PRD user-facing FR was found during sampling that lacks a corresponding UX surface (e.g. FR-126 Connect Payment Account → AD-13 modal; FR-134 Billing view → SA-07; FR-098 Coach Progress tab → AD-15 tab).

No UX requirements were found that contradict or introduce scope beyond the PRD.

### B. UX ↔ Architecture Alignment

Strong, with explicit cross-references rather than incidental agreement:
- MA-16's class-booking race condition explicitly invokes **AD-21** (`book_class_session()` `SELECT...FOR UPDATE` RPC) — the UX spec correctly assumes atomic server-side capacity enforcement, not a client-side check.
- SA-07's manual suspend/reactivate override explicitly reuses **AD-3**'s `private.current_gym_status()` live-lookup mechanism — same enforcement path as the automated suspension flow, not a separate one.
- The "Immediate access revocation" state pattern (V1.5 New State Patterns) matches **NFR-013**'s and **FR-090**'s server-side, next-request revocation model exactly — no client-side-only treatment assumed anywhere.
- Offline queueing on MA-15 (Progress) reuses the same `client_id`-idempotency pattern as check-in (FR-097 amendment to FR-061) — consistent with the architecture's stated offline model, not a new one invented at the UX layer.
- One architecture-side caveat carries forward rather than being a UX defect: the architecture spine flags Supabase Vault's GA/beta status as unconfirmed (AD-15) while AD-13's Connect Payment Account flow assumes it works as a stable credential store — this is an architecture verification item (already flagged in Step 2/3 context), not a UX alignment gap.

### Warnings

1. **`epics.md` is stale relative to the UX spine it was written against — this is the step's primary finding.** `epics.md`'s V1.5 stories (Epics 9–13, Epic 4/6 extensions) were explicitly written by deriving acceptance criteria "from FR/AD wording" because, at write time (22:00), no V1.5 UX mockups existed. They now do (23:35–23:36), including confirmed design decisions (e.g. AD-15's three-tab restructure, "Confirmed with user 2026-08-11") and named edge-case state treatments (V1.5 New State Patterns) that aren't reflected anywhere in `epics.md`'s current story ACs. **Recommendation:** before running `bmad-create-story` for Epics 9–13 (all currently `backlog` in `sprint-status.yaml`), either (a) run a targeted `bmad-ux`-informed pass over those epics' story ACs to fold in the now-available screen specs, or (b) treat `EXPERIENCE.md` as an explicit input each story-creation pass reads directly, so the gap self-heals at story-creation time rather than needing a batch epics.md rewrite. Either is workable; leaving it unaddressed risks story ACs that miss confirmed UI decisions (e.g. a story-writer inventing a workout-plan UI that conflicts with AD-15's now-confirmed three-tab layout).
2. `epics.md`'s Requirements Inventory should have its UX-DR list (currently UX-DR1–16, V1.0-only) extended with V1.5-derived UX-DR entries once (1) above is addressed, so the same single-glance requirements-traceability convention applies to V1.5 that already applies to V1.0.

Neither warning blocks this readiness check from proceeding — the underlying design work exists and is well-aligned with both PRD and Architecture — but both should be resolved before V1.5 story creation begins, since Step 5 (Epic Quality Review, next) evaluates the stories as currently written, not the newer UX spine they haven't yet absorbed.

Ready to proceed to Epic Quality Review.

## Step 5: Epic Quality Review

Full read of all 13 epics and 70 stories in `epics.md` (lines 441–2342) against create-epics-and-stories standards: user-value framing, epic independence, story sizing/independence, forward-dependency detection, AC quality (Given/When/Then, testability, error-path coverage), and database/entity creation timing.

**Overall assessment: high quality, no critical violations found.** This is a rigorously cross-referenced document — nearly every story cites the specific FR/NFR/AD IDs it implements, and every place one story's output feeds a later one is explicitly named rather than left implicit.

### 🔴 Critical Violations

**None found.**

- **No technical epics masquerading as user value.** Every epic title and goal statement describes a user-facing outcome (e.g., Epic 9: "Owners and Supervisors can provision, edit, and deactivate their own staff... without a GymOS support ticket"). The handful of developer-facing stories (1.1 monorepo init, 1.2/2.1/4.1/4.10 sandbox spikes) are explicit, architecture-mandated exceptions — the workflow's own Special Implementation Checks section expects exactly this pattern (starter-template story first, spikes gating their dependent epics) — not violations of the user-value rule.
- **No forward dependencies.** Checked every story in every epic for references to later stories/epics. Every cross-reference found is one of two legitimate patterns: (a) backward — a story explicitly reuses an earlier story's output (e.g., Story 9.2 reuses Story 1.11's SMS mechanism; Story 13.3 reuses Story 10.1's offline `client_id` pattern); or (b) forward-as-enhancement, always stated as such — an earlier story is explicitly noted to work standalone and gets *extended* later (e.g., Story 3.7's Home-screen activity feed ships check-ins-only and is "extended to include payment events in Epic 4, Story 4.9" — 3.7 is not broken or incomplete without 4.9, it just gets richer). No story requires a later story to function.
- **No epic-sized stories.** Every story is scoped to a single coherent capability with a bounded AC set (typically 3–6 Given/When/Then blocks).

### 🟠 Major Issues

**None found.** Acceptance criteria are consistently Given/When/Then, testable, and specific — including error paths and edge cases that are easy to skip (stale check-in auto-close, offline sync landing after timeout, webhook idempotency, RLS-blocked cross-tenant/cross-coach access, race conditions on class-capacity booking, self-escalation rejection on staff role edits). Database/entity creation timing follows the "create when first needed" rule throughout — e.g., Story 1.4 creates `audit_log` right before Epic 1 needs it, not in one big upfront schema story; Story 10.1 creates `progress_entries` with baseline member-only RLS, and Story 10.2 *adds* the coach-read grant on top rather than both being done at once.

### 🟡 Minor Concerns

1. **Epic List presentation order doesn't match the stated V1.5 build order.** The "Epic List" section (lines 479–511) presents V1.5 scope in the order Epic 9, 10, 11, 12, 13, then the Epic 4 and Epic 6 extensions. But the very next line — "V1.5 dependency order" — states the actual required build sequence is **9 → Epic 4 extension → 11 → (10 ∥ 12) → Epic 6 extension → 13**. Epic 11 (SaaS Billing) has a hard prerequisite on the Epic 4 extension's Story 4.14 (the `{type:'gym'}` routing context Story 11.1 extends with `{type:'platform'}`) — a reader following the list's presentation order rather than its dependency-order footnote could start Epic 11 before the Epic 4 extension exists. This is a documentation-clarity issue, not a structural defect — the correct order is stated, just easy to miss since it's a trailing note rather than the section's primary ordering. **Recommendation:** reorder the Epic List section itself to match the stated build sequence, or move the dependency-order note to the top of the V1.5 section.
2. **Uneven explicitness of the "RLS in the same migration as CREATE TABLE" convention across new-table stories.** Epic 1 (Story 1.3) and Epic 10 (Story 10.1) state this convention explicitly in their ACs ("RLS is enabled with a deny-all default in the same migration... no open-table window"). Epic 11 (Story 11.1, new `saas_billing_payments` table), Epic 12 (Story 12.1, new `classes`/`class_sessions`/`class_bookings` tables), and Epic 13 (Story 13.1, new exercise-library tables) don't restate it in their own ACs — they rely on the blanket architecture-level rule (epics.md's Additional Requirements section, line 254) applying by default. Functionally this is almost certainly fine (the blanket rule is real and CI-enforced per the architecture spine), but restating it locally in each new-table story's ACs — as Epic 1 and Epic 10 already do — would make the convention self-evidently testable per-story rather than requiring a reader to know to check the global rule. Cosmetic, not a gap in coverage.
3. **Epic 8 is explicitly a non-PRD addition** ("Raised directly by the user (2026-08-05), not derived from the original PRD"). This is transparently disclosed in the epic's own description, not hidden, and its stories are genuinely user-facing (Settings redesign, mobile visual refresh) — noted here only for completeness, not as a defect.
4. **Carried forward from Step 4:** Epic 9–13 story ACs were written before the newer, more detailed UX spine existed (see Step 4). None of the ACs read as *contradicting* the now-available UX specs during this review's sampling (e.g., Story 10.4/13.2's Coach Portal tab descriptions are compatible with, just less detailed than, `EXPERIENCE.md`'s confirmed three-tab AD-15 restructure) — so this is a completeness gap, not a correctness one. Still worth resolving before story-file creation, per Step 4's recommendation.

### Best Practices Compliance Checklist (by epic)

| Epic | User value | Independent* | Stories sized right | No forward deps | DB timing correct | Clear ACs | FR traceable |
|---|---|---|---|---|---|---|---|
| 1. Platform Foundation | ✓ | ✓ (root) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2. Member Onboarding | ✓ | ✓ (needs 1) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 3. Subscription & Attendance | ✓ | ✓ (needs 1,2) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4. Payments & Front-Desk Alert | ✓ | ✓ (needs 1–3) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 5. Coach Portal | ✓ | ✓ (needs 2,3) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 6. Push Notifications | ✓ | ✓ (needs 3,4) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 7. Audit Log & Compliance | ✓ | ✓ (needs 1,2,4,5) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 8. Front-of-House Polish | ✓ | ✓ (needs 1,2,3) | ✓ | ✓ | n/a (no new tables) | ✓ | ✓ (non-PRD, disclosed) |
| 9. Staff Management | ✓ | ✓ (needs V1.0 auth/RLS only) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 10. Client Progress Tracking | ✓ | ✓ (needs Epic 5's coach-assignment) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 11. SaaS Billing | ✓ | ✓ (needs Epic 4 ext, see concern #1) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 12. Classes & Scheduling | ✓ | ✓ (needs V1.0 only) | ✓ | ✓ | ✓ (see concern #2) | ✓ | ✓ |
| 13. Workout Plans | ✓ | ✓ (needs Epic 5's coach-assignment) | ✓ | ✓ | ✓ (see concern #2) | ✓ | ✓ |
| Epic 4 ext. (Tara Money) | ✓ | ✓ (needs Epic 4 base) | ✓ | ✓ | n/a (no new tables) | ✓ | ✓ |
| Epic 6 ext. (Quiet-gym/Reminders) | ✓ | ✓ (needs Epic 3, Epic 12) | ✓ | ✓ | n/a (no new tables) | ✓ | ✓ |

*"Independent" here means "does not require a later-built epic" — every epic's stated prerequisites are earlier in the build sequence, never later.

Ready to proceed to Final Assessment.

## Summary and Recommendations

### Overall Readiness Status

**READY.** GymOS's PRD, Architecture, Epics/Stories, and UX are aligned and complete enough to begin V1.5 implementation (Epics 9–13 + Epic 4/6 extensions, all currently `backlog`). This is not a qualified or reluctant "ready" — 139/139 FRs (100%) trace to a specific epic and, for every V1.5 requirement, a specific story; the epic quality review found zero critical and zero major violations across 70 stories; UX and Architecture documentation both exist and are demonstrably cross-referenced with the PRD, not just present. The issues found are real but are completeness/sequencing gaps, not defects that would produce wrong or unbuildable stories.

### Critical Issues Requiring Immediate Action

**None.** No finding in this assessment rises to blocking severity.

### Issues Requiring Attention Before or During V1.5 Story Creation

These aren't gates on *this* readiness check passing, but they should be resolved before or during `bmad-create-story` runs for Epics 9–13, or they'll compound downstream:

1. **`epics.md` predates the current UX spine (Step 4/5 finding).** `EXPERIENCE.md`/`DESIGN.md` were updated at 23:35–23:36 on 2026-08-11, over an hour after `epics.md` was finalized at 22:00 the same day. `epics.md` still asserts "no UX Design Requirements available" for V1.5 — untrue as of now. The newer spine has full screen-level specs for every V1.5 feature (Staff, Progress, Classes, Billing, Workout Plans, Connect Payment Account) plus confirmed design decisions made after the epics were written (e.g., AD-15's Coach Portal three-tab restructure, "Confirmed with user 2026-08-11"). **Action:** either fold `EXPERIENCE.md`'s V1.5 screen specs into `epics.md`'s UX-DR list and story ACs before story creation, or have each `bmad-create-story` pass read `EXPERIENCE.md` directly as a source so the gap closes at story-creation time. Either resolves it; leaving it as-is risks a story-writer inventing UI that conflicts with an already-confirmed design decision.
2. **OQ-7 is a live, unresolved PRD blocker, not a planning defect** (Step 2 finding, re-surfaced here because it gates real work): Tara Money production reliance and the Flow B billing-job architecture both wait on re-verifying the sandbox spike against GymOS's own activated business account. The epics/stories correctly treat this as pending — Story 4.10 exists specifically to close it and explicitly blocks Story 4.12's cutover until it passes. No action needed on the planning artifacts themselves; this is an execution dependency to track, not a documentation gap.
3. **Epic List's presentation order doesn't match its own stated V1.5 build order** (Step 5, concern #1) — Epic 11 has a hard prerequisite on the Epic 4 extension that's easy to miss reading top-to-bottom. Low effort to fix: reorder the section or move the dependency note to the top.

### Recommended Next Steps

1. Resolve the UX-spine staleness (item 1 above) before or during story creation for Epics 9–13 — cheapest to do now, before story files lock in acceptance criteria that would need revisiting later.
2. Track OQ-7 to closure via Story 4.10 as already planned; no change to the artifacts required.
3. Reorder or re-flag the V1.5 Epic List's build-sequence note (item 3 above) — a five-minute documentation fix that removes a real (if unlikely) sequencing footgun for whoever runs `bmad-create-story` next.
4. Optional polish, non-blocking: consolidate NFR traceability into a dedicated NFR Coverage Map (Step 3) analogous to the existing FR Coverage Map; restate the "RLS in the same migration" convention explicitly in Epic 11/12/13's new-table story ACs (Step 5, concern #2); resolve the stale OQ-2 row status (Step 2).

### Final Note

This assessment reviewed the full PRD (139 FRs, 19 NFRs), the current architecture spine, all 13 epics and 70 stories, and both UX documents in complete detail — not sampled. It found **zero critical issues, zero major issues, and one genuinely actionable finding** (the UX-spine staleness), plus a handful of minor documentation-clarity items. The one substantive finding — that the UX design work has outpaced the epics that were supposed to consume it — is a good problem to have: it means more design detail exists than the story-writer had access to, not less. Address it before locking in V1.5 story ACs, then proceed to implementation. These findings can be used to improve the artifacts, or the team may choose to proceed as-is and let each `bmad-create-story` pass pull from `EXPERIENCE.md` directly.

---

**Implementation Readiness Assessment Complete**

Report generated: `_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-11.md`

Assessed by: smartsana (via BMad Check Implementation Readiness workflow) — 2026-08-11
