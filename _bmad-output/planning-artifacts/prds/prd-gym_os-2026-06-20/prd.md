---
title: GymOS — Product Requirements Document
status: final
created: 2026-06-20
updated: 2026-10-15
version: "1.7"
audience: Development Team
scope: V1.0 (shipped) + V1.5 — Beta-Ready (shipped) + V1.6 — Session Guests, Loyalty & Gym Category (shipped) + V1.7 — GymOS Support Staff, Gym Landing Pages & Directory (this update; support staff ships first)
---

# GymOS — Product Requirements Document

> Stable requirement IDs (FR-NNN, NFR-NNN) are never renumbered. V1.0 ended at FR-086 / NFR-010; V1.5 ran FR-087–FR-155 / NFR-011–NFR-020; V1.6 ran FR-156–FR-174 / NFR-021–NFR-022; V1.7 begins at FR-175 / NFR-023. Where a V1.5 requirement changes a V1.0 requirement's behavior, it says so explicitly ("Amendment to FR-XXX") and states the change — V1.0 text is not edited in place, so history stays legible. The exceptions are the two pre-existing FR-071/FR-082 edits below, decided and shipped (Story 1.13) before this convention was adopted for V1.5.

## 1. Overview

GymOS is a white-label gym management SaaS built for African fitness businesses. It replaces the fragmented stack of paper records, WhatsApp groups, and spreadsheets most gym owners rely on today with an integrated platform: a branded member mobile app (Android and iOS), a gym admin dashboard, a coach portal, and a Super Admin layer for the platform owner.

The product is organized around a single thesis: **retention**. Features map to three loops that build on each other across versions:

| Loop | Question it answers | V1 features |
|------|---------------------|-------------|
| **Keep members coming** | Why open the app between visits? | QR check-in, subscription status, coach session notes |
| **Catch members leaving** | How do we intervene before they churn? | Renewal alerts, grace periods, front-desk alert at check-in |
| **Monetize the audience** | What revenue exists beyond SaaS fees? | Gym merch store (V2.5), platform marketplace (V3) |

V1 builds loops 1 and 2. Loop 3 requires the member base and trust that loops 1 and 2 create. The signature V1 interaction is a real-time front-desk alert the instant an expiring member checks in, putting renewal collection at the point of maximum willingness to pay.

V1 targets Cameroon-first gyms with mobile-money payments (MTN MoMo + Orange Money), an Android-first member base, and 1–3 founder-onboarded pilot gyms. Target: a live pilot with real members and real payments in 3–4 months, built by a 1–2 person full-stack team.

### 1.1 What Changed Since V1.0

V1.0 proved the retention spine — payments, attendance, the front-desk alert, multi-tenant isolation — and has shipped (Epics 1–8, all `done`). V1.5 turns that pilot into a beta a gym can run without founder hand-holding, and gives members a reason to open the app between visits.

| Area | V1.0 | V1.5 |
|------|------|------|
| Automated mobile-money provider | Notch Pay as planned (FR-034), never actually carried live traffic | Tara Money formalized as the documented, sole intended provider; one real-money sandbox round-trip passed (Story 4.2, 2026-07-31), but no automated mobile-money payment has yet been collected from a real member in production — production activation is still pending (OQ-7) |
| Member payment routing | Implicit | Into each gym's own Tara Money account |
| Gym SaaS billing | Tier assigned, not collected | Owner-approved recurring, reminder + one-tap pay via Tara Money (gym Owner → GymOS); automated debit deferred pending a card provider (OQ-14) |
| Tenant suspension | Manual (Super Admin) | Automated on SaaS non-payment, after grace |
| Client profile | Name, phone, plan, status | + body metrics, measurements, photos, trends |
| Staff accounts | Super Admin creates Owner only | Owner self-serve: Supervisor, Manager, Receptionist, Coach |
| Coach data access | Assigned members + notes | + member progress data (when assigned) |
| App between-visit value | Status, history | + progress tracking, quiet-gym alerts |
| Classes | Deferred | Scheduling + booking + reminders |
| Workout plans | Deferred | Coach-authored plans |
| Registration fee | None | Optional one-time per-gym fee that a new member must settle before getting member-app access and a plan (FR-147–FR-155) |
| WhatsApp invite / OTP fallback | Started, unfinished | Completed |
| Product analytics | Sentry only | + PostHog |
| Test automation | Manual + RLS/payment CI | + E2E automation baseline |

### 1.2 What V1.6 Adds

V1.5 is live with real gyms, and their first feedback is specific: **gyms lose money on session guests** — people on a Pay-per-session plan who walk in, are never charged per visit (the plan has no expiry and nothing charges at check-in), and leave no countable record. V1.6 makes every guest visit a recorded, paid event and gives guests a reason to keep coming back, and it opens the product to studios that run like gyms.

| Area | Before V1.6 | V1.6 |
|------|-------------|------|
| Pay-per-session visits | A plan with a price but no per-visit charge; check-in never asks for payment | Per-gym setting: each visit needs a paid session, recorded at the desk or paid in-app; unpaid check-in is blocked and alerted (FR-156–FR-163) |
| Guest repeat visits | No incentive | Per-gym loyalty program: stamps toward a free session for guests (FR-164–FR-166) |
| Subscriber loyalty | No incentive to renew on time | Stamps for on-time renewals toward free days (FR-167) |
| Owner view of the leak | None | "Guest sessions" card: paid, blocked, free given (FR-163) |
| Business type | Every tenant is implicitly a "gym" | Category set at gym creation: Gym / Salle de sport, Studio Pilates, Studio Yoga, Fitness Center, Autre (FR-171–FR-172) |

The V1.7 backlog — a public landing page per gym on its own subdomain, a swappable template module, and a country-by-country directory with SEO — is recorded in Section 12 and is **not** part of V1.6.

### 1.3 What V1.7 Adds

V1.6 is live. V1.7 does two things, in a fixed order: it lets GymOS help a gym from the inside, then it puts every gym on the public web.

| Order | Area | Before V1.7 | V1.7 |
|-------|------|-------------|------|
| 1 | GymOS support staff | Platform staff can only read a gym's data after an escalation (FR-072) and cannot fix a gym's settings, plans, members or payment account | Super Admin creates per-person support accounts and assigns them to gyms; support works as Supervisor-scope staff behind a second factor; the Owner sees one "GymOS Support" presence and one on/off control, and confirms every connection or change of the gym's payment account (FR-175–FR-195) |
| 2 | Gym landing pages | A gym has no public web presence | An optional public page per gym at `{name}.gymosapps.com`, built from a swappable template over the gym's own content (FR-196–FR-208) |
| 3 | Directory and SEO | Nothing discoverable | A country and city directory of published gyms, built for search and AI-search (FR-209–FR-214) |

**Support staff ships first (decided 2026-10-15).** Its prerequisites ship inside it: the live authorization retrofit that completes FR-090 (FR-192, NFR-023) and the second-factor gate (FR-189–FR-191). Category stays descriptive (FR-172); V1.7 uses it only as a directory filter and page label (FR-213).

**Existing gyms are not changed silently.** Support access starts ON for gyms created after release and OFF for gyms that exist at release, until their Owner turns it on (FR-183), following the V1.6 precedent (FR-157).

---

---

## 2. Problem

Gym owners in Cameroon and across Africa manage operations with tools never designed for the job:

- **Paper records and WhatsApp** for member tracking — no audit trail, no history, no alerts
- **Spreadsheets** for payments — cash and mobile-money transactions go unreconciled; revenue disappears silently
- **Manual attendance** — no reliable check-in system; occupancy is guesswork
- **Missed renewals** — expiring memberships lapse quietly with no trigger to intervene
- **No coach tools** — coaches manage assigned members through personal messages and memory

The cost is twofold: operational chaos for the gym owner, and invisible churn that compounds month over month.

---

## 3. Goals & Success Metrics

### 3.1 Goals

| # | Goal | V |
|---|------|---|
| G-1 | Deliver a live pilot with real members and real payments within 3–4 months | 1.0 |
| G-2 | Make every franc auditable — no silent payment failures, all manual actions traceable | 1.0 |
| G-3 | Land the retention moment — front-desk alert catches expiring members at check-in | 1.0 |
| G-4 | Prove the multi-tenant foundation — RLS and schema hold as new gyms are added | 1.0 |
| G-5 | Ship to both Android and iOS from a single codebase | 1.0 |
| G-6 | Launch fully bilingual (English + French) with zero missing-string errors | 1.0 |
| G-7 | Ship a beta a gym can operate end-to-end without founder involvement — including provisioning its own staff | 1.5 |
| G-8 | Give members a reason to open the app between gym visits, measured by non-visit-day app opens | 1.5 |
| G-9 | Complete the Notch Pay → Tara Money cutover with zero lost or double-charged payments | 1.5 |
| G-10 | Keep member body/progress data private by construction — no cross-member and no unauthorized coach access | 1.5 |
| G-11 | Prove classes and workout plans work in a real gym's weekly rhythm without adding operational load | 1.5 |
| G-12 | Stand up GymOS's own SaaS revenue collection (Flow B) — reliable and reconciled with zero cross-account leakage into or out of gym funds, via the reminder-driven, Owner-approved billing model V1.5 ships with (OQ-14) | 1.5 |
| G-13 | Stop the guest revenue leak — every *scanned* session-guest visit at a gym that turns charging on is a recorded, paid event, and the owner can see the gap between paid, blocked, and unscanned visits | 1.6 |
| G-14 | Give guests and subscribers a reason to come back and renew on time, through a loyalty program the gym controls and can afford | 1.6 |
| G-15 | Open the product to studios that run like gyms (Pilates, Yoga, fitness centers) without forking it | 1.6 |
| G-16 | Let GymOS set up and repair a gym from the inside — plans, settings, members, staff, payment account — without anyone sharing a gym's login credentials, while the Owner keeps one switch to turn that access off and confirms every connection or change of the gym's payment account | 1.7 |
| G-17 | Give every gym an optional public web presence with no extra work beyond entering its own content once | 1.7 |
| G-18 | Make gyms discoverable by search and AI-search, country by country, without exposing any tenant data | 1.7 |

### 3.2 Success Metrics

| Metric | Target | Counter-Metric | V |
|--------|--------|----------------|---|
| Pilot live date | Within 3–4 months of dev start | Scope expansion pushing timeline — tracked via sprint velocity | 1.0 |
| Front-desk alert reliability | ≥ 95% of expiring/expired check-ins trigger an alert | Alert-to-renewal-action conversion — if alerts fire but aren't actioned, they become noise | 1.0 |
| Payment reconciliation accuracy | Zero undetected discrepancies in first 30 pilot days | Mandatory-reason field abandonment — if receptionists skip payments to avoid friction | 1.0 |
| Cross-tenant data isolation | Zero cross-tenant leaks in CI and pilot operation | Over-restrictive RLS — access-denied errors per role tracked in Sentry | 1.0 |
| Localization completeness | Zero missing-string errors in EN and FR across all flows | Translation divergence — EN and FR string counts must stay in sync on every PR | 1.0 |
| Beta gym self-sufficiency | ≥ 80% of beta gyms complete a full week with zero founder-support tickets | Founder-intervention rate per gym/week | 1.5 |
| Non-visit-day app opens | ≥ 20% of active members open the app on a non-visit day within 60 days | Progress-logging abandonment after first entry | 1.5 |
| Payment cutover integrity | Zero lost or duplicated payments across migration | Reconciliation discrepancies during cutover | 1.5 |
| Progress-data isolation | Zero unauthorized reads of member body data | Coaches wrongly blocked from assigned members | 1.5 |
| Staff-provisioning safety | Zero privilege-escalation incidents | Legitimate staff-creation actions blocked | 1.5 |
| Class booking reliability | ≥ 95% of bookings honoured (no overbooking) | No-show rate (informational only) | 1.5 |
| SaaS billing collection reliability | Zero missed or duplicated billing cycles across active gyms; zero payments settling to the wrong account (NFR-019) | Suspension false-positive rate — gyms wrongly moved to `suspended` | 1.5 |
| Guest-charging adoption `[ASSUMPTION — targets to confirm with pilot data]` | ≥ 60% of the gyms that exist at release and have at least one Pay-per-session member turn "Charge guests per session" on within 30 days (new gyms default on and are not counted); paid guest sessions per gym per day rise against the same gyms' recorded guest check-ins in the 30 days before (FR-163) | Walk-away rate — blocked unpaid attempts (FR-160) not followed by a paid session within 15 minutes; front-desk collection time | 1.6 |
| Guest repeat visits `[ASSUMPTION]` | ≥ 50% of gyms with charging on enable the loyalty program; guests with ≥ 2 paid sessions in a 30-day window rises versus the pre-release pilot baseline | Program cost — free sessions given as a share of paid guest sessions, watched against 1/N (FR-165) | 1.6 |
| Studio adoption `[ASSUMPTION]` | At least two gyms with a non-Gym category (FR-171) active within 60 days of release | Studios creating workarounds (e.g. support requests about "gym" wording, FR-172) | 1.6 |
| Subscriber on-time renewal `[ASSUMPTION]` | On-time renewal rate at gyms with the program on exceeds the same gyms' rate in the 60 days before enabling | Free days granted (FR-167) as a share of subscription days sold | 1.6 |
| Support-access safety | Zero support actions in a gym outside an active assignment, after an opt-out, without a verified second factor, or after revocation (asserted in CI by test per entry path, and in audit review); a revoked person is refused on their next request (FR-192) | Legitimate staff wrongly refused after a role-check change; Owner opt-out rate (informational — a high rate means support is not trusted) | 1.7 |
| Gym set-up effort `[ASSUMPTION — baseline to measure]` | Median time from gym creation to its first member check-in, and founder-support tickets per new gym, fall against the pilot gyms' baseline for gyms that use support | Support actions later reversed by the Owner (a sign of unwanted changes) | 1.7 |
| Landing-page adoption `[ASSUMPTION]` | ≥ 50% of gyms active at release publish a page within 60 days of release; every published page continuously meets the publish gate (FR-199) | Pages unpublished within 30 days of publishing (a sign the template or gate is wrong) | 1.7 |
| Directory discoverability `[ASSUMPTION — conditional on gym count]` | Every published page's structured data validates with zero errors; published pages are indexed within 30 days; directory listings are indexed once they meet the FR-212 threshold (at launch, with few gyms, only individual pages are expected to be indexed) | Thin listings indexed (FR-212) | 1.7 |

---

## 4. Users & Roles

### 4.1 Role Hierarchy

Roles are scoped per gym except Super Admin, which is platform-wide.

```
Super Admin  (platform-wide; GymOS staff only)
  └─ Owner       (full gym access + settings)
       └─ Supervisor  (Manager-plus: staff management + settings access) [V1.5]
            └─ Manager     (operations; no settings)
                 └─ Receptionist  (front desk; payments; check-in)
                      └─ Coach         (assigned members + session notes only)
                           └─ Member       (own data only)
```

A **GymOS support person** (V1.7) is a platform account, not a rung of this tree: in each assigned gym it holds a Supervisor-scope membership ranked below Owner and above Manager, and appears to the gym only as one "GymOS Support" row (FR-177, FR-182).

Role enforcement is at the PostgreSQL RLS layer. Client-side role checks are supplementary only. When RLS rejects a request the client thought was allowed, the UI shows "You don't have permission to do that" and logs the denial to Sentry with the user's role, action, and resource — no raw database errors reach the user.

**Supervisor** is new in V1.5 (see 6.17). It sits between Owner and Manager with the same staff-management and Settings access as Owner ("Manager-plus"), but it structurally cannot create another Supervisor or an Owner — only Manager, Receptionist, or Coach, mirroring Owner's own creatable set minus Supervisor itself. The general rule this and every other rung follows: no role may create a role equal to or above its own (NFR-013).

### 4.2 User Profiles

**Gym Owner / Manager**
Replace paper, WhatsApp, and Excel. See every franc reconciled, every member's status, and every expiring membership — and catch those members at the door before they quietly disappear.

**Receptionist**
Front-desk operator. Processes payments, confirms check-ins, acts on renewal alerts.

**Member**
One branded app for gym life: subscription status, QR check-in, payment history, profile, language preference.

**Coach**
Manages assigned members and session notes from a role-gated view inside the dashboard. Sees member goals and experience levels set during onboarding. Workout plans and class scheduling ship in V1.5 (6.21, 6.22).

**GymOS Platform Owner (Super Admin)**
Full visibility across all tenant gyms: gym status, platform-wide metrics. Creates and manages gym accounts in the founder-onboarding flow.

### 4.3 Role Capability Deltas in V1.5

The V1.0 role hierarchy is unchanged in spirit — V1.5 makes the already-defined staff roles operationally real by giving the Owner (and now Supervisor) the means to create and manage them, and extends the Coach's data access to include progress tracking.

| Role | New in V1.5 |
|------|-------------|
| Owner | Create, edit, deactivate, reassign Supervisors, Managers, Receptionists, Coaches; assign members to coaches |
| Supervisor | Same staff-management and Settings access as Owner; creates Manager, Receptionist, Coach only — never Supervisor or Owner |
| Manager | Manage classes and schedules; cannot manage staff accounts or settings |
| Receptionist | Manage class bookings at the desk; check members into classes |
| Coach | Author workout plans; view assigned members' progress data; manage class sessions they lead |
| Member | Log body metrics and progress photos; book classes; opt into quiet-gym alerts; follow a workout plan |

### 4.4 Role Capability Deltas in V1.6

No new role and no new account type: a session guest is an ordinary Member on a Pay-per-session plan (FR-156).

| Role | New in V1.6 |
|------|-------------|
| Super Admin | Choose the gym's category at gym creation and edit it afterwards (FR-171) |
| Owner / Supervisor | Turn "Charge guests per session" and the loyalty program on or off and set N, K, and the reward days (FR-157, FR-164); change the gym's category (FR-171) |
| Manager | Record session payments (FR-158); see the guest-sessions card (FR-163) |
| Receptionist | Record a guest's session payment at the desk and admit the guest after an unpaid-check-in alert (FR-158, FR-160) |
| Member / guest | Pay for a session in the app where the gym has Tara Money connected; see loyalty progress and any free session earned (FR-158, FR-169) |
| Coach | No change |

### 4.5 Role Capability Deltas in V1.7

One new account type, no new gym role: a **GymOS support person** is a platform account that holds a Supervisor-scope staff membership, flagged as support, in each gym it is assigned to (FR-175–FR-178). Support sits below Owner and is never the Owner.

| Role | New in V1.7 |
|------|-------------|
| Super Admin | Must sign in at AAL2, after a one-time bootstrap (FR-191); create support accounts by invite; assign, unassign and remove them; reset a second factor; see individual support identities in audit and answer Owner disclosure requests; approve names held for review; take down or force-rename a landing page (FR-175–FR-177, FR-185, FR-187, FR-190, FR-202–FR-204) |
| Support person | Act within the FR-179 allow-list (a Supervisor's capabilities plus the listed additions), including preparing a payment-account connection for the Owner to confirm and recording payments, refunds and waivers, in assigned gyms only, at AAL2 (FR-179, FR-180, FR-189) |
| Owner | Turn "Allow GymOS Support" on or off; confirm every connection or replacement of the gym's payment account; see one "GymOS Support" row, never individuals; claim and rename the page name; publish and unpublish; choose public plans (FR-180, FR-182, FR-183, FR-198–FR-200, FR-203) |
| Supervisor | Edit page content, publish and unpublish, and choose public plans; cannot claim a name or change "Allow GymOS Support" (FR-183, FR-198) |
| Manager / Receptionist / Coach / Member | No change |

---

## 5. User Journeys

### UJ-1: Kwame's first check-in

Kwame, a 28-year-old office worker in Yaoundé, joined a new gym last week. The receptionist added his record and tapped "Send invite" — Kwame got an SMS with his name, the gym name, and a link. He tapped it, the Play Store opened, he downloaded the app.

He opens it for the first time. He picks his language (French), enters his phone number, and waits for the OTP. It arrives in 12 seconds. He verifies, sets his name, picks his goal (Build Muscle), sets his experience (Beginner), and confirms his Monthly plan. The app loads in the gym's colors with their logo in the header.

At the gym entrance, he taps Check In, points his camera at the QR code on the wall, and sees a green confirmation within 2 seconds. His name appears in the Attendance panel on the receptionist's dashboard. No paperwork, no sign-in sheet.

### UJ-2a: The renewal moment — grace period

Amara's monthly plan expired yesterday. She didn't notice. This morning she walks into the gym, opens the app, and scans the entrance QR. The scan succeeds — she's in the 3-day grace period — and her check-in is recorded. But the instant the check-in lands, a yellow banner fires on every open dashboard tab: **"Amara K. — Grace period. Expires [date]. Renew now?"**

The receptionist sees the alert, greets Amara by name, and taps "Renew". An inline panel opens — pre-populated with Amara's current Monthly plan and the renewal price. The receptionist selects Cash, types "Paid at desk", taps Confirm Renewal. The alert clears. Amara's status resets to Active. She gets a push notification: "Payment confirmed — your membership is active." Total time: 45 seconds. Amara has no idea anything was wrong.

### UJ-2b: The expired member at the door

Amara comes back three weeks later, never renewed. Her grace period ended two weeks ago. She opens the app, taps Check In, scans the QR. The app shows a red screen: **"Access denied — membership expired. Please see the front desk."** Her check-in is rejected. But the dashboard fires a red alert: **"Amara K. — Access DENIED. Membership expired [N] days ago. Collect payment to restore access."** The receptionist catches her before she walks away.

### UJ-3: Nadia reconciles end-of-day payments

Nadia manages a gym in Douala. At 7 PM she opens the Payments page. Three cash payments are sitting in the verification queue — each shows the member, amount, the receptionist who recorded it, and the mandatory note ("Paid at desk, member confirmed"). She cross-checks against her cash drawer and marks all three verified.

She runs a quick mental check against the day's check-ins on the Attendance page — everyone who trained today has a matching payment. She closes the laptop knowing nothing is unreconciled.

### UJ-4: Fatima manages her clients

Fatima is a personal trainer at the Douala gym. The gym Owner assigned her 8 clients last week. She logs into the dashboard and sees only the Coach Portal — no payments, no member list, no settings.

She opens a client's profile: sees his goal (Lose Weight), experience level (Beginner), current plan (Coach-inclusive), and subscription status (Active — expires in 12 days). She adds a session note: "Focused on compound lifts. Struggled with form on deadlift. Next session: start with lighter weight and focus on hip hinge." The note saves with her name and the timestamp.

She checks her next client. His status shows "Expiring Soon." Fatima can't process a renewal — that's the receptionist's job — but she makes a mental note to mention it when he comes in tomorrow.

### UJ-5: Chidi onboards a new gym

Chidi works at GymOS HQ. A new gym in Yaoundé has signed up. He opens the Super Admin dashboard, clicks "Create Gym", fills in the gym name, owner's name, and phone number, and clicks Create. The system creates the gym record and sends the owner an SMS with their login credentials.

Chidi sets the gym's subscription to Active. The gym now appears in the gym list. He hands off to the owner, who logs into the dashboard and goes through Settings to upload their logo and set their primary color. Their members haven't been imported yet — the owner will use the CSV import tool tomorrow with GymOS's help.

### UJ-6: The Owner staffs their gym (V1.5)

Grace's gym just joined the beta. She opens Settings → Staff, clicks Add staff, adds her receptionist Aicha (name, phone, role → Create). Aicha gets an SMS with a temp password and dashboard link. Grace adds her coach Emmanuel, who on login sees only the Coach Portal. Grace never contacts support — the gym is staffed in four minutes.

### UJ-7: Amara tracks her progress (V1.5)

On a rest-day evening Amara opens the app, taps Progress, logs her weight and waist measurement, and adds a photo stored privately. The app shows her weight down 2.4 kg since joining. She didn't train today but she opened the app — exactly the behaviour V1.5 is built to create.

### UJ-8: Emmanuel coaches with real data (V1.5)

Emmanuel opens an assigned client's profile and sees their goal, experience level, and now their progress trend. He writes a note about the plateau and adjusts the workout plan, swapping two exercises. The member sees the update on next app open. A member he isn't assigned to is invisible — including all their progress data.

### UJ-9: Nadia schedules a week of classes (V1.5)

Nadia (Manager) creates a recurring HIIT Tue/Thu 6 PM class, capacity 15, coach Emmanuel. Members book from the app; when it fills, booking closes. An hour before each session, booked members get a reminder push. The receptionist sees who's booked and checks them in.

### UJ-10: Chidi verifies the payment cutover (V1.5)

Chidi, back at GymOS HQ, re-runs the Tara Money round-trip that already passed once (`docs/decisions.md`, 2026-07-31) — this time against GymOS's own now-activated business account instead of the stand-in the original spike used (OQ-7). He swaps one config value, sends a real test charge, and confirms the webhook lands and reconciles. He checks the audit log: no gym's payment ever touched the platform account, and no member was charged twice. The swap changed one config surface behind the `PaymentProvider` interface — payment logic never moved.

### UJ-11: Ange pays per session (V1.6)

Ange trains at Grace's gym three or four times a month and never wanted a monthly plan. When she first came, Aicha at the desk registered her and waived the registration fee, then put her on the gym's Pay-per-session plan — 2,000 XAF a visit. Since Grace turned on "Charge guests per session", Ange's visit works like this: she pays Aicha at the desk (or taps Pay in the app, where Grace's gym has Tara Money connected), then scans the entrance QR like everyone else and the app confirms her check-in. One payment covers her whole day at the gym.

One Thursday she skips the payment and scans straight away. The app does not check her in: "Pay for your session," with a Pay option or "See the front desk." No attendance is recorded, and Aicha's dashboard shows an alert, so she collects the 2,000 XAF and Ange scans again. On her fifth paid visit, Ange's app shows "Free session earned — valid for 60 days" and her progress is back at 0 / 5; at her next visit she scans and is checked in without paying. If she doesn't come for 90 days her progress resets; if she doesn't use the free session within 60 days it lapses.

At month end Grace opens her Overview: 41 paid guest sessions, 6 blocked attempts, 8 free sessions given. She can see what the guest desk is actually earning.

### UJ-12: Idris sets up a gym from the inside (V1.7) `[ASSUMPTION — narrative to confirm]`

Grace has signed up her gym and is stuck on plan prices and connecting Tara Money. Idris, a GymOS support person assigned to Grace's gym by Chidi at Super Admin, signs in with his phone, then types the six-digit code from his authenticator app. In Grace's dashboard he enters her plans and prices and imports her first forty members from a spreadsheet. Then he prepares her Tara Money connection from the details she gives him; Grace gets a confirmation that shows the new account, masked, and approves it before anything changes. Grace's Settings shows one new row in Staff, "GymOS Support", and her audit trail labels every change "GymOS Support" with the time. She never sees Idris's name, or whether anyone else also works on her gym. A week later Grace switches "Allow GymOS Support" off; Idris's next request in her gym is refused.

### UJ-13: Aminata finds a gym, and Grace publishes one (V1.7) `[ASSUMPTION — narrative to confirm]`

Aminata, new to Douala, searches for "pilates studio Douala" and lands on a gym's page: a banner, the studio's hours, two public plans with prices, and a WhatsApp button that opens a chat. She taps it. On Grace's side, publishing was a checklist: logo, banner, about text, hours, a contact number she chose to make public, and one plan she marked "show on my page" — her other plans stay private. She claimed `grace-fit` as her page name and confirmed what becomes public before publishing. Her Supervisor edits the opening hours later; the page keeps passing its checks, so it stays live. If Grace made her last public plan private, the page would unpublish itself and tell her why.

### UJ-14: Chidi takes down an impersonating page (V1.7) `[ASSUMPTION — narrative to confirm]`

A visitor reports a page named `getgymfit` whose about text says "Official GymOS payment page — pay your fees here". The name passes every rule, so nothing held it; the report form is how it surfaced. Chidi takes the page down with the reason "impersonation"; the address stops returning content within the minute, the gym's Owner is told why, and republishing is blocked until Chidi lifts the takedown. The name stays reserved to that gym.

---

## 6. Functional Requirements

> Stable IDs: FR-NNN. Do not renumber. New requirements append to the end of their section with the next available global number.

### 6.1 Platform Foundation

**FR-001** — Phone number is the primary identity. One phone number maps to one platform user account. A user may be a member at multiple gyms; each gym relationship is a separate `members` row linked to the same user account.

**FR-002** — Registration requires phone verification via OTP. No email-based registration in V1.

**FR-003** — The platform enforces a role hierarchy per gym: Member → Coach → Receptionist → Manager → Owner → Super Admin. Roles are enforced via PostgreSQL RLS policies. Custom role claims (`gym_id`, `role`) are injected into the Supabase JWT via a Database auth hook on login. This hook is a sprint-1 spike item — missing claims fail silently by defaulting to deny-all. When RLS rejects a request, the client shows "You don't have permission to do that" and logs the event to Sentry; no raw PostgreSQL errors reach the UI.

**FR-004** — Super Admin is a platform-level role, not scoped to any gym. Super Admin can act across all tenants.

**FR-005** — Each gym is a fully isolated tenant. A user in Gym A cannot read, write, or infer any data from Gym B. RLS enforces this at the database layer on every query.

**FR-006** — The data model is designed to support hundreds of gyms and thousands of members per gym without schema changes. The 1–3 pilot gym scale is an operational expectation, not an architectural ceiling.

---

### 6.2 Gym Setup & Onboarding

**FR-007** — V1 gym onboarding is founder-assisted. There is no self-serve gym signup flow. GymOS staff create the gym record and owner account in the Super Admin dashboard.

**FR-008** — The gym admin dashboard includes a CSV import tool. GymOS provides a standardized CSV template with the following columns:

| Column | Format | Required |
|--------|--------|----------|
| member_name | Text | Yes |
| phone | E.164 format, entered via a country-code picker (global for contact phones; Tara Money's supported countries only for the Mobile-Money payer-phone field — FR-142) | Yes |
| plan_type | Must match a plan configured for this gym | Yes |
| join_date | YYYY-MM-DD | Yes |
| subscription_status | active / expiring_soon / grace_period / expired | Yes |
| expiry_date | YYYY-MM-DD; blank for pay-per-session | Conditional |

The import is **all-or-nothing**: all rows are validated before any records are inserted. If any row fails validation, the entire import is rejected and no data is written. Validation errors are displayed per row with the row number and failure reason. Members imported without an expiry date for a non-session plan are rejected at validation — expiry date is required for all non-pay-per-session plans.

**FR-009** — Historical payment and attendance records are not migrated. Imported members start with a clean history on the platform from the date of import.

**FR-010** — During onboarding, the gym configures: gym name, logo, primary color, timezone (default: Africa/Douala, GMT+1), preferred language (English or French), grace period duration, and gym capacity.

**FR-154** — Amendment to FR-008. Imported members are existing members of the gym and are exempt from the registration fee (FR-149). CSV import is never blocked by FR-148 and creates no registration-fee payment.

---

### 6.3 White-Label Branding

**FR-011** — One app binary serves all gyms. The binary is published under the GymOS account — the app appears as "GymOS" in the device's app drawer and Play Store / App Store listing in V1. Gym-specific branding (gym name, logo, primary color) is applied within the app after launch, not at the OS or store level. Per-gym App Store listings are deferred to V4+. Branding data is cached on-device for 24 hours; gym logo or color updates propagate on the member's next app launch after the cache expires.

**FR-012** — The gym admin dashboard Settings page allows the gym Owner to: upload a logo (stored in Supabase Storage, served from CDN), enter a gym name displayed in the app header, and set a primary hex color applied to buttons, accents, and navigation highlights. Changes take effect in the member app within 24 hours (next branding cache refresh).

**FR-013** — Per-gym App Store listings, custom fonts, and full theme systems are out of V1 scope (deferred to V4+).

---

### 6.4 Localization

**FR-014** — The platform is bilingual in English and French from V1. All UI strings, push notification copy, onboarding flows, and error messages are available in both languages.

**FR-015** — Language is selected by the member at the start of the onboarding flow (before phone number entry), defaulting to device locale. Language is also user-selectable from the member profile screen at any time. Language preference is stored per user account and persists across devices.

**FR-016** — All string literals are externalized via an i18n library. No hardcoded UI text anywhere in the codebase. CI enforces this — PRs with hardcoded strings fail the build.

**FR-017** — Receipts and payment confirmation documents follow the gym Owner's language preference.

**FR-018** — The i18n foundation is structured to support additional languages in future versions without rework.

---

### 6.5 Member Management

**FR-019** — A Manager or Owner can create, view, edit, and deactivate member records. Soft-delete only — records are deactivated, never deleted, to preserve audit history.

**FR-020** — Member records store: full name, phone number, email (optional), date of birth (optional), profile photo (optional), join date, current plan, subscription status, and emergency contact (optional).

**FR-021** — A Receptionist can view and search member records and initiate payments for a member, but cannot create, edit, or deactivate member records.

**FR-022** — Coaches can view profiles of their assigned members only. Coaches cannot see or access members not assigned to them.

**FR-023** — Members can view and edit their own profile (name, photo, language preference) from the app. Changing a phone number requires admin intervention.

**FR-082** — When a Manager or Owner creates a new member record in the dashboard and clicks "Send Invite," the system automatically sends the personalized onboarding invitation (member's name, gym name, a deep link to the GymOS app) via WhatsApp, routed through the self-hosted Evolution API gateway (FR-071). The deep link pre-associates the member's phone number, so the OTP screen is the first thing they see in the app. Manager/Owner may resend at any time from the member's row. If the automated send fails, the dashboard shows an inline error and falls back to the manual copy/share-via-WhatsApp option as a safety net — the original V1.0 UI, demoted from primary path to fallback, not removed.

**FR-083** — When a Manager or Owner deactivates a member: (a) the member's subscription is set to `expired` immediately; (b) the member loses check-in access; (c) the member retains app access to view their history; (d) no automated push notification is sent for deactivation — the gym handles communication. The deactivation is audit-logged with actor, reason (mandatory), and timestamp.

---

### 6.6 Membership Plans

**FR-024** — The platform supports the following plan types in V1:

| Plan Type | Description |
|-----------|-------------|
| Pay-per-session | Member pays per visit; no fixed expiry |
| Monthly | Fixed-fee plan with a defined expiry date |
| Coach-inclusive | Monthly plan that includes scheduled sessions with an assigned coach |
| Class-only | Access to scheduled classes only; no general floor access |

Travel mode is deferred to V2.0 (see Section 8).

**FR-025** — Plan definitions (name, price in XAF, duration, access type) are configurable per gym by the Owner or Manager. The plan types above are templates; gyms set their own pricing and durations. The platform supports **monthly and annual billing intervals** for recurring plans from V1; annual plans carry a gym-set discount to incentivize commitment. Billing interval is stored on the subscription record independently of tier names or price points (OQ-1 does not block billing interval implementation).

**FR-026** — All monetary values are stored as integers (whole XAF francs) with an explicit `currency` column alongside the amount. No floating-point monetary storage anywhere. V1 currency is XAF only; the schema is multi-currency-ready from day one.

**FR-147** — Each gym can configure a one-time **registration fee**: a flat amount in whole XAF (FR-026), set by the Owner or Supervisor on the Settings page (Amendment to FR-069: the fee joins the Settings fields). The default is 0 XAF, meaning the gym charges no registration fee and FR-148–FR-155 do not apply to it. The fee is one amount per gym, not per plan type. Every change to the fee is audit-logged with the old and new value, and applies only to members registered afterwards.

**FR-148** — When a gym's registration fee is above 0, a newly created member starts as **awaiting registration fee**: the member record exists, but the member cannot use the member app and cannot be assigned a plan or subscription of any type — including Pay-per-session — until the fee is settled, meaning recorded as paid (FR-152) or waived (FR-150). Once the fee is settled, staff assign a plan as they do today. For such a gym, member creation therefore no longer includes plan assignment (amends FR-019); for a gym whose fee is 0 the one-step flow is unchanged. Only staff collect the fee — a member cannot pay it from the app. The rule is enforced server-side, so no dashboard or app entry point can bypass it; CSV import is exempt (FR-154). A member awaiting the fee counts toward the gym's member cap (FR-073).

**FR-149** — The registration fee is paid once per member and is non-refundable. Every member who exists when this capability is released is treated as having already paid, so no existing member is charged, blocked, or changed — including members added by CSV import (FR-154). A member created while their gym's fee is 0 is likewise settled from creation and is never charged retroactively if the gym later sets a fee. The fee is per gym: a person who is a member of two gyms pays each gym's fee separately. Whether a deactivated-then-reactivated member pays again is deferred (OQ-17).

**FR-150** — An Owner, Supervisor, or Manager can waive the registration fee for a specific member, which settles it. A reason is mandatory, and the waiver is audit-logged with actor, reason, and timestamp (Section 6.16). Receptionists and Coaches cannot waive.

**FR-151** — An Owner or Supervisor can void a manually recorded registration-fee payment that was entered in error (wrong member, or a duplicate). A reason is mandatory, and the void is audit-logged with actor, reason, and timestamp. Voiding corrects a recording mistake and is not a refund: it is allowed only while the member has no subscription yet, and it returns the member to the awaiting registration fee state. It exists because the fee is non-refundable (FR-149) and refunds are blocked (FR-153), so a wrong entry would otherwise be permanent. A fee paid by Tara Money (FR-152) cannot be voided in the platform, because the money has already reached the gym's own account; the gym corrects it outside the platform. [ASSUMPTION: Tara Money fees are corrected outside the platform.]

---

### 6.7 Subscription Lifecycle

**FR-027** — A member subscription moves through the following states in sequence:

```
active → expiring_soon → grace_period → expired
```

State transitions are executed by a **Supabase pg_cron job** scheduled to run nightly at 02:00 Africa/Douala time. If the job fails (timeout or infrastructure error), the failure is logged to the audit log and surfaced as an alert on the Super Admin dashboard. The job does not retry automatically — a missed run is corrected on the next successful execution; statuses are not retroactively backfilled.

**FR-028** — `expiring_soon` is triggered 7 days before the expiry date.

**FR-029** — `grace_period` begins the day after the expiry date. Duration is set per gym in Settings. Platform default is 3 days if a gym has not configured its own value.

**FR-030** — `expired` is set when the grace period ends without a renewal. An expired member loses gym access but retains their app account and membership history.

**FR-031** — Two distinct check-in outcomes exist for non-active members:

| Member State | Check-in Outcome | Member App Shows | Dashboard Alert |
|---|---|---|---|
| `expiring_soon` or `grace_period` | Accepted — check-in recorded | Green confirmation (normal flow) | Yellow alert: "Amara K. — Grace period. Expires [date]. Renew now?" |
| `expired` (beyond grace period) | Rejected — check-in blocked | Red screen: "Access denied — membership expired. Please see the front desk." | Red alert: "Amara K. — Access DENIED. Expired [N] days ago." |

The front-desk alert fires in both cases. The alert color and copy differ to signal urgency to the receptionist.

**FR-032** — Renewal resets the subscription to `active` and sets a new expiry date based on plan duration. Renewal can be triggered by a successful payment or a manual admin override. On renewal: (a) the front-desk alert for that member dismisses immediately; (b) the member receives push notification N-04 (Payment confirmed); (c) the renewal appears in the member's payment history immediately.

---

### 6.8 Payments

**FR-033** — Supported payment methods in V1:

| Method | Type | Notes |
|--------|------|-------|
| MTN Mobile Money | Automated | Via Notch Pay |
| Orange Money | Automated | Via Notch Pay |
| Cash | Manual | Recorded by Receptionist or Manager; mandatory reason |
| Bank transfer | Manual | Recorded by Manager or Owner; mandatory reason |
| Manual mobile money | Manual | For cases where the payment gateway is unavailable |

**FR-034** — V1 ships with **Notch Pay as the sole mobile-money aggregator**. The payment integration is built behind an internal `PaymentProvider` interface from day one so a second provider can be added later without touching the payment logic. Campay integration is deferred to V2. Integration is gated by a one-day sandbox spike that must be completed before the payments Epic begins; its outcome must be recorded in `docs/decisions.md`. Spike exit criteria: sandbox auth succeeds, payment initiation returns a reference, webhook is received and processed, idempotency test passes (duplicate webhook does not create a duplicate record). **If the spike fails**, no payment code ships until an alternative integration is validated and documented — the payments Epic does not begin on an unverified provider.

**FR-035** — Payment webhooks from the provider are processed idempotently. Duplicate webhook delivery does not create duplicate payment records. Idempotency is enforced via a unique constraint on the provider transaction reference.

**FR-036** — A scheduled reconciliation job runs nightly (same pg_cron window as lifecycle transitions) to match provider-confirmed payments against internal records. A **discrepancy** is any of: (a) a webhook event received from Notch Pay with no matching internal payment record; (b) an internal payment record in `processing` status with no webhook received within 10 minutes of creation; or (c) an amount mismatch between the webhook payload and the internal record. Discrepancies appear as flagged rows on the Payments dashboard page.

**FR-037** — The Payments page includes a verification queue for manual payments awaiting confirmation. A Receptionist or Manager can mark a queued payment as verified or flag it for review.

**FR-038** — All manual payment entries require the following fields — none are optional at the UI level:

- Payment method
- Amount
- Member
- Actor (auto-populated from logged-in user)
- Mandatory reason / note
- Timestamp (auto-populated)

**FR-039** — Transaction fees from Notch Pay are passed through to gyms by default. The platform does not absorb provider fees. A member-pays-surcharge option is deferred.

**FR-040** — Refunds are recorded in the system in V1 (amount, reason, actor, timestamp). Provider-executed refund API calls are deferred. If a member disputes a payment, a Manager or Owner records a manual refund entry with a mandatory reason; the gym pays the member out-of-band. The refund record is audit-logged.

**FR-041** — The system generates a payment receipt for each successful payment. Receipt fields: member name, gym name, plan, amount, currency, payment method, date, transaction reference, actor.

**FR-152** — Staff collect the registration fee at the front desk, either by recording a manual payment (cash, bank transfer, or manual mobile money — FR-033, FR-038) or, when the gym has Tara Money connected (FR-127), by starting a Tara Money collection for the member. The amount is always exactly the gym's fee, not a plan price; any staff role that can record payments (FR-021) may collect it. At most one non-voided registration-fee payment can exist per member. The payment is stored with a purpose that distinguishes it from subscription payments, so it is identified as a registration fee on the Payments page, in the member's payment history, and on the receipt (FR-041), and recording it never creates or renews a subscription. A manually recorded fee takes effect immediately and does not wait in the verification queue (FR-037). [ASSUMPTION: this matches how front-desk cash renewals activate immediately (FR-050); no second-person check is required.] A Tara Money fee takes effect when the payment is confirmed (FR-035), following the same rules as other Tara payments (FR-124, FR-125); completing it settles the fee and never creates or renews a subscription.

**FR-153** — Amendment to FR-040, FR-080, and FR-143. FR-040: a refund cannot be recorded against a registration-fee payment (FR-149); the block holds in the data layer, not only in the interface. FR-080: registration-fee payment recordings, fee-amount changes (FR-147), waivers (FR-150), and voids (FR-151) are added to the audited actions. FR-143: registration fees (manual once recorded, Tara Money once confirmed) count toward the Overview's month-to-date revenue and appear as their own line, separate from subscription revenue.

---

### 6.9 Attendance & Occupancy

**FR-042** — Members check in by opening the member app, navigating to the Check-In screen, and scanning a static QR code displayed at the gym entrance. A successful scan records an attendance event (member, gym, timestamp).

**FR-043** — The gym entrance QR code encodes a URL with a `gym_token` query parameter — a non-guessable UUID generated per gym at setup. The app decodes the QR, extracts the token, and sends it to the check-in endpoint. The endpoint validates the token against the `gyms` table to identify the gym before recording the check-in. If the token does not match any gym, the app shows: "QR code not recognized — make sure you're scanning your gym's code." A member scanning the wrong gym's QR cannot accidentally check in there — the token resolves to no gym and the request is rejected. The gym's QR code is downloadable and printable from the Settings page.

**FR-044** — Only one open check-in per member is permitted at a time. A second scan while a check-in is already open is rejected with: "You're already checked in." Enforced via a partial unique index on the attendance table (`WHERE checked_out_at IS NULL`). **Edge case:** if a member scans but has a stale open check-in from a previous session (app crash before checkout, or the auto-timeout job did not run), the system auto-closes the stale check-in (sets `checked_out_at` to `original_check_in_time + timeout_duration`), records the new check-in, and logs the auto-close to the audit log.

**FR-045** — Check-out can be triggered manually (member from the app, or receptionist from the dashboard) or automatically via a configurable auto-timeout (default: 8 hours; configurable per gym in Settings). The auto-timeout is executed by the same pg_cron job as subscription lifecycle transitions. If the job runs late, open sessions are closed on the next successful run.

**FR-046** — Occupancy is calculated as the number of currently checked-in members as a percentage of the gym's configured capacity.

**FR-047** — The member-facing occupancy display uses three bands:

| Band | Threshold |
|------|-----------|
| Low | < 30% of capacity |
| Medium | 30–70% of capacity |
| Busy | 71–90% of capacity |

The 91%+ "Full" threshold and raw occupancy counts are visible on the admin dashboard only, never in the member app.

**FR-048** — The admin dashboard Attendance page shows: currently checked-in members, today's attendance count, and a check-in/check-out log filterable by date and member.

---

### 6.10 Retention Triggers — Front-Desk Alert

**FR-049** — When a member with status `expiring_soon`, `grace_period`, or `expired` triggers a check-in event (accepted or rejected), the system immediately publishes a real-time alert to all active dashboard sessions for that gym via Supabase Realtime. Two alert types exist: a yellow **grace alert** (check-in accepted) and a red **denied alert** (check-in rejected). See FR-031 for copy and color per state.

**FR-050** — The alert displays: member name, profile photo, subscription status, days until or since expiry, and a "Renew" action button. The alert panel appears on both the Overview page and the Attendance page. The "Renew" button opens an **inline renewal panel** within the alert — the receptionist does not navigate away. The panel pre-populates the member's current plan, the renewal price in XAF, and today's date as the new start date; the receptionist may change the plan or payment method. Tapping **Confirm Renewal** records the payment, resets the subscription to `active`, sets a new expiry date, and dismisses the alert. End-to-end tap sequence: alert → Renew → [change plan/method if needed] → Confirm Renewal — a maximum of 3 taps for a straight-through cash renewal.

**FR-051** — Multiple simultaneous alerts (e.g., three expired members check in within seconds) are displayed as a stacked alert queue, newest on top, maximum 5 visible at once; older alerts scroll below. Each alert is dismissed individually by a staff member (writes a `dismissed_at` timestamp and the dismissing user's ID to the alert record) or auto-dismisses after 30 minutes (also writes a record; duration is gym-configurable in Settings). A new alert fires for the same member if they scan again after their alert was dismissed without renewal.

**FR-052** — End-to-end latency from QR scan completion to alert appearing on the dashboard is under 3 seconds under normal network conditions. See NFR-010 for Supabase region requirements that affect this target.

---

### 6.11 Coach Portal (V1)

**FR-053** — The Coach Portal is a role-gated section within the gym admin dashboard. Users with the Coach role see only the Coach Portal; all other dashboard sections (Payments, Members, Settings, Audit Log, the admin Classes page) are inaccessible. The Coach Portal is itself composed of multiple sub-surfaces (FR-144); "only the Coach Portal" constrains which *dashboard sections* a Coach reaches, not how many pages the Portal has. *(Amended 2026-09-09 — sprint-change-proposal-2026-09-09.md.)*

**FR-054** — V1 Coach Portal features:

| Feature | Description |
|---------|-------------|
| Assigned member list | View all members assigned to the coach; sortable by name and plan; shows subscription status |
| Member profile view | Name, plan, subscription status, contact info, goal, and experience level set during onboarding |
| Session notes | Add, view, and edit timestamped session notes per member (coach-attributed) |

Members with `expired` status remain visible in the coach's list with their status shown — the coach is not automatically notified but can see the status. Coach-to-receptionist escalation for expiring or expired clients (e.g., coach flags a member for a renewal conversation) is deferred to V2.0 (Section 8); verbal communication is expected through V1.5.

**FR-055** — A Manager or Owner assigns members to coaches from the Members page. A member may be assigned to at most one coach at a time. When a new coach is assigned to a member who already has one, the previous assignment is ended with an `ended_at` timestamp (not deleted). Session notes from the previous coach remain visible to Owner and Manager only — not to the new coach. Historical assignment records are queryable from the member's profile.

**FR-056** — Workout plan management and class scheduling are deferred to V1.5. Resolved in V1.5 — see 6.21 Classes & Scheduling (FR-104–FR-108) and 6.22 Workout Plans (FR-109–FR-112).

---

### 6.12 Member Mobile App

**FR-057** — The member app ships to Android and iOS from a single React Native + Expo codebase via EAS Build + Submit. Bundle ID: `com.gymos.app`. Both platforms ship together; no Android-only pilot.

**FR-058** — First-launch onboarding flow:

| Step | Screen | Notes |
|------|--------|-------|
| 0 | Language selection | English / French; defaults to device locale; appears before any other screen |
| 1 | Phone number entry | E.164 format enforced via country-code picker with auto-prefixed calling code (FR-142) |
| 1a | OTP verification | 60-second countdown before "Resend OTP" is enabled; max 3 resend attempts; 5-minute lockout after all attempts exhausted; lockout screen shows "Contact your gym for assistance." If OTP does not arrive within 60 seconds, resend is one tap — no navigation away from the screen. |
| 2 | Profile setup | Name (required), profile photo (optional) |
| 3 | Goal selection | Lose Weight / Build Muscle / Improve Fitness / General Wellness; visible to assigned coach in coach portal |
| 4 | Experience level | Beginner / Intermediate / Advanced; visible to assigned coach |
| 5 | Plan confirmation | Gym's available plans displayed; member confirms or selects their pre-assigned plan |

**FR-059** — Home screen displays: gym branding header (logo, name, primary color), current subscription status and expiry date, quick-action buttons (Check In, View Plan, Profile), and recent activity summary (last check-in date).

**FR-060** — The Check-In screen opens the device camera and scans the gym's static QR code. States:

| State | Display |
|-------|---------|
| Success | Green confirmation with timestamp: "Checked in at [time]" |
| Success (offline) | Green confirmation with syncing indicator: "Checked in — syncing when online" |
| Wrong QR | "QR code not recognized — make sure you're scanning your gym's code." |
| Already checked in | "You're already checked in. See front desk if you need help." |
| Expired — denied | Red screen: "Access denied — membership expired. Please see the front desk." |

**FR-061** — The app supports **offline check-in only**. When a member scans the gym QR without connectivity, the check-in is recorded locally in SQLite and the success state is shown immediately. The check-in syncs to the server when connectivity resumes. Conflict resolution: if the sync arrives after the auto-timeout window has passed, the server accepts the check-in and sets `checked_out_at` to `scan_time + timeout_duration`. The front-desk alert fires at sync time, not at scan time. No other actions (payments, profile updates) are queued offline in V1.

**FR-062** — Members can view: current plan details, expiry date, payment history, and a list of past check-ins from the app.

**FR-063** — The Profile screen includes a language selector (English / French) and profile photo upload. Language change takes effect immediately across the app without requiring re-login.

**FR-155** — Amendment to FR-058 and FR-082. A member in the awaiting registration fee state cannot use the member app: signing in shows a message that registration is not complete and tells the member to contact the gym, and no payment option is offered. The WhatsApp invite (FR-082) is sent once the fee is settled. After the fee is settled and a plan is assigned, onboarding proceeds exactly as in FR-058. [ASSUMPTION: exact copy and screen flow to be settled in UX.]

---

### 6.13 Gym Admin Dashboard

**FR-064** — The gym admin dashboard is a Next.js web application. Pages and their minimum access role:

| Page | Minimum Role | Key Capabilities |
|------|--------------|-----------------|
| Overview | Receptionist | Current check-ins, expiring members, monthly revenue summary, front-desk alert panel |
| Members | Receptionist | Search, filter by status, view profiles; create/edit/deactivate (Manager+); send invite (Manager+) |
| Subscriptions | Manager | All subscription records; manual renewal initiation |
| Payments | Receptionist | All payment records; verification queue; manual payment entry |
| Attendance | Receptionist | Current check-ins; daily log; manual check-out |
| Audit Log | Manager | Append-only payment action log; filterable by date and actor |
| Settings | Owner | Branding, language, timezone, grace period, capacity, QR code download |
| Coach Portal | Coach | Assigned member list; session notes |

**FR-065** — The Overview page front-desk alert panel is the primary surface for renewal action. Alerts are real-time (Supabase Realtime) and require no page refresh.

**FR-066** — The Members page supports: search by name or phone, filter by subscription status (all / active / `expiring_soon` / `grace_period` / expired), and bulk CSV export. Export is limited to 1,000 rows per download in V1; apply a filter to reduce results before exporting larger sets. Export columns: member_name, phone, plan_type, subscription_status, expiry_date, join_date, last_check_in_date.

**FR-067** — The Payments page verification queue shows all unverified manual payments ordered by submission time. Each row shows the member, amount, method, submitting receptionist, and mandatory reason note.

**FR-068** — The Audit Log page is read-only. Records cannot be edited or deleted from any role. Paginated at 50 records per page. CSV export available to Owners.

**FR-069** — The Settings page allows the Owner to configure: gym name, logo, primary color, timezone, default language, grace period duration (in days), gym capacity (number of members), front-desk alert auto-dismiss duration (in minutes; default 30), and QR code download/regeneration.

**FR-085** — The Subscriptions page provides:

| Element | Detail |
|---------|--------|
| Record list | All member subscriptions, sortable by member name, status, and expiry date |
| Filters | By subscription status (active / `expiring_soon` / `grace_period` / expired) and by plan type |
| Access | Manager and Owner only (matches FR-064 table) |
| Manual renewal | Manager or Owner selects a member row → opens the inline renewal panel (same panel as the front-desk alert, FR-050) → selects plan, payment method, confirms |
| Export | CSV export of the filtered list (same 1,000-row limit and column schema as the Members page export, FR-066) |
| Renewal start date | Defaults to today; if the member is in `grace_period` or expired, the receptionist/manager may back-date to the original expiry date to avoid losing the member a day |

---

### 6.14 Super Admin Dashboard

**FR-070** — The Super Admin dashboard is a separate Next.js application. It shares the same Supabase project as the gym admin dashboard but is accessible only to GymOS platform staff via a distinct URL and authentication flow. The Super Admin role is assigned at the platform level and bypasses per-gym RLS — all Super Admin access to gym-specific data is audit-logged.

**FR-071** — V1 Super Admin capabilities:

| Capability | Description |
|------------|-------------|
| Gym list | View all tenant gyms: name, owner, creation date, member count, subscription status |
| Gym creation | Create and activate a gym account (founder-onboarded flow; triggers owner SMS invite) |
| Gym management | Suspend or deactivate a gym; reinstate a suspended gym |
| Platform metrics | Total gyms, total members, total payments processed (platform-wide aggregates) |
| Tier management | Create, edit, and delete subscription tiers: set name, monthly price (XAF), annual price (XAF), and member cap (integer or unlimited). Changes take effect immediately for new gym assignments; existing gyms are not automatically reclassified. |
| Gym tier assignment | Assign or change a gym's subscription tier; override the member cap for a specific gym |
| Messaging instance management | View the active Evolution API WhatsApp instance ID and connection status; update the instance ID used for platform-wide WhatsApp sends (OTP delivery and member invitations) when a number disconnects, without a code deployment |

**FR-072** — Super Admin access to individual member data or payment records within a specific gym requires an explicit support escalation action (not a standard view). Such access is audit-logged with the Super Admin's identity, reason, and timestamp.

**FR-073** — GymOS charges gyms a recurring subscription across three default tiers, differentiated by member count and price. All tiers include the same feature set.

| Tier | Member cap | Monthly price | Annual price |
|------|-----------|---------------|--------------|
| **Hustle** | 1–30 members | Super Admin configurable | Super Admin configurable |
| **Grind** | 31–100 members | Super Admin configurable | Super Admin configurable |
| **Elite** | > 100 members (no cap) | Super Admin configurable | Super Admin configurable |

Tier definitions — names, price points, member thresholds, and the ability to add new tiers — are managed entirely by the Super Admin (see FR-071). The three tiers above are the platform defaults seeded at launch; the Super Admin can edit their prices, adjust member thresholds, or create additional tiers without a code deployment.

**FR-141** — Amendment to FR-071. In-app Super Admin account management is added to the Super Admin dashboard: a Super Admin can view the list of current Super Admins, create a new Super Admin account, or promote an existing platform-staff user (matched by email) to Super Admin — entirely in-app, no CLI/database access required. This supersedes Story 1.12's CLI-only decision (`docs/decisions.md`, 2026-08-05); the CLI script (`provision-super-admin.mjs`) is retained as the bootstrap path for creating the very first Super Admin in an environment where none yet exists (the in-app flow is necessarily gated behind an existing Super Admin session).

**FR-142** — Every phone-number input across the platform (member, staff, gym owner, coach, and the Mobile-Money payer-phone field) offers a country picker that auto-prefixes the correct calling code as the user types, always producing a valid E.164 value. Coverage is global for contact phones; the Mobile-Money payer-phone field in the renewal flow (FR-050/FR-140) is restricted to Tara Money's supported-country list (`taraMoneySupportedCountries.ts`) since only that field triggers an automated Tara Money collection call.

**FR-143** — The staff Overview (AD-02) presents live operational state: stat cards and supporting tables covering current occupancy, memberships needing attention, and month-to-date revenue. Revenue is **net** — verified payments minus refunds recorded in the same period; `payment_status` has four values (`0001:20`) and only `verified` is money the gym actually has, while refunds live in their own table with positive amounts (`0033:11`). Every card links through to the full page for its metric. Values refresh on load and by polling; no card renders a stale or unattributed number, and no figure may be computed by a client-side sum over fetched rows (`max_rows = 1000` truncates silently).

**FR-144** — The Coach Portal has its own navigation with three surfaces: Overview (default landing), My Members (the existing AD-14 list), and My Classes. A Coach signing in lands on the Coach Portal Overview, not the staff Overview.

**FR-145** — A Coach can view the classes they are assigned to teach (`classes.coach_id`), including upcoming sessions and the members booked into each. Read-only: creating, editing, and scheduling classes remain Manager/Supervisor/Owner (FR-104, FR-121); marking class attendance remains Receptionist-and-above (FR-107). The Coach Portal's My Classes surface presents only that Coach's own classes. Class *metadata* (name, schedule, coach, capacity) is readable by every authenticated user of the gym by design — that is what lets members browse and book (FR-105, FR-108) — so the guarantee here is not metadata secrecy. The protected data is the **roster**: who is booked into a given session. A Coach can retrieve a roster only for a session belonging to a class they are assigned to, enforced server-side, never by UI filtering.

**FR-146** — The Coach Portal Overview summarises the Coach's own caseload: their next class sessions, assigned-member count with subscription health, members needing follow-up, and recent progress activity from assigned members. Every figure is scoped by the same assignment rules that scope the rest of the Portal (FR-055) — an ended assignment removes the member from these figures immediately.

**FR-086** — Member cap enforcement: when a gym reaches the maximum member count for their tier, new member creation is blocked at the API level. The dashboard shows: "You've reached your plan limit ([N]/[Max] members). Contact GymOS to upgrade." Active and deactivated members both count toward the cap. The Super Admin can override the cap for a specific gym or move the gym to a higher tier.

---

### 6.15 Push Notifications

**FR-074** — All push notifications route through Expo Push Notification Service → FCM (Android) + APNs (iOS). No direct FCM/APNs integration; Expo EAS handles token management.

**FR-075** — V1 notification schedule:

| ID | Event | Trigger | V |
|----|-------|---------|---|
| N-01 | Membership expiring — 7 days | 7 days before expiry date | 1 |
| N-02 | Membership expiring — 1 day | 1 day before expiry date | 1 |
| N-03 | Membership expired | On expiry date | 1 |
| N-04 | Payment confirmed | Payment recorded (webhook success or manual verification) | 1 |
| N-05 | Payment failed | Payment webhook failure event | 1 |
| N-06 | Quiet-gym alert | Occupancy drops to Low band (opt-in; max 2/day; min 3-hr gap between sends) | 1.5 |
| N-07 | Class reminder | 60 minutes before a booked class | 1.5 |

**FR-076** — Notification preferences are stored per member in `member_preferences`. Members can opt out of non-critical notifications (N-06, N-07) from the app. Membership lifecycle notifications (N-01 through N-03) and payment notifications (N-04, N-05) cannot be opted out of in V1. Note: mandatory notifications may require consent management for future expansion into GDPR-adjacent markets — flagged as a known deferred risk.

**FR-077** — Push tokens are stored per device. A token returned as invalid by FCM or APNs is cleaned up automatically on the next delivery attempt.

**FR-078** — All notification copy is available in English and French, served per each member's language preference.

---

### 6.16 Audit Log

**FR-079** — The audit log is append-only at the database level. No role — including Super Admin — can UPDATE or DELETE audit records. This is enforced via RLS and the absence of UPDATE/DELETE permissions on the audit table for all roles.

**FR-080** — The following actions generate audit records: all manual payment entries, payment verifications, refund records, member deactivations, coach assignment changes, Super Admin gym-data escalations, and pg_cron job failures. Each record contains: actor (user ID + display name), action type, target entity ID, relevant fields (amount, method, reason as applicable), and UTC timestamp.

**FR-081** — The Audit Log dashboard page is filterable by date range and actor. CSV export of filtered results is available to Owners.

---

### 6.17 Staff Management (Owner Self-Serve) — V1.5

**FR-087** — A gym Owner can create staff accounts for their own gym: Supervisor, Manager, Receptionist, and Coach. A Supervisor can create Manager, Receptionist, and Coach accounts — the same set an Owner can create, minus Supervisor itself. Neither an Owner nor a Supervisor can create an Owner or a Super Admin. A Manager cannot create staff at all. In general, no role may create a role equal to or above its own rung (Owner > Supervisor > Manager > Receptionist > Coach — see NFR-013). Captures full name, phone (E.164), and role. Staff creation is audit-logged.

**FR-088** — A newly created staff member is provisioned like V1.0 owner activation: an SMS with a temporary password and dashboard link. First login requires setting a new password. Until first login the account is `pending_activation`.

**FR-089** — An Owner or Supervisor can edit a staff member's name and role, and deactivate (soft-delete) a staff account. The same ceiling rule as FR-087 applies to role *edits*, not only creation: an editor cannot raise a target's role to equal or above their own rung, and cannot edit their own role at all (self-escalation is structurally impossible, not just discouraged). Deactivation revokes access immediately, via the same server-side revocation check as FR-090 (a role change and a deactivation are the same security-sensitive event — losing access entirely), and is audit-logged with a mandatory reason. A deactivated Coach's notes and plan authorship are retained, visible to Owner and Manager.

**FR-090** — Role changes take effect immediately, not on the staff member's next voluntary token refresh or re-login. Because role/gym claims are carried in the JWT (FR-003), immediate revocation requires a server-side check independent of client cooperation — a role-version or session-invalidation marker verified at the same auth-hook/RLS layer that already enforces deny-all-by-default. A demoted or deactivated staff member's existing JWT is rejected the moment that check runs, closing the security window a client-side-only refresh would leave open.

**FR-091** — One phone number maps to one platform user (FR-001). A person may hold different roles at different gyms — each a separate binding. A person cannot hold two roles at the same gym; a new role replaces the prior binding (audit-logged).

**FR-092** — A Coach account is a staff role for portal access. Assigning members to that coach remains a separate action on the Members page (FR-055). A Coach with no assignments sees an empty list with guidance to contact their Manager/Owner/Supervisor.

---

### 6.18 Complete Client Profiles — Body & Progress Tracking — V1.5

**FR-093** — The member profile is extended with an optional body profile: height, starting weight, and optional baseline measurements. Entered during an optional "Complete your profile" step or any time from Progress. No body data is mandatory.

**FR-094** — A member can log progress entries over time — any subset of: weight, body measurements (waist, chest, hips, arms, thighs), a progress photo, and a note. Each entry carries a timestamp and a `client_id` for offline-safe dedupe. A member may soft-delete their own entry.

**FR-095** — Body and progress data is private by default. RLS visibility rules:
- A member can always read and write their own body/progress data.
- An assigned Coach can read the progress data of members currently assigned to them — and only those members.
- A Coach's access ends the instant their assignment ends (FR-055 `ended_at`).
- No other role — Receptionist, Manager, Supervisor, Owner, or another member — can read a member's measurements or photos.
- Progress photos: readable only by the owning member and, if the member opts in per-photo, their assigned coach. Sharing defaults to off for every new photo — an explicit per-photo action, not a blanket setting. A member can revoke a photo's sharing at any time; revocation takes effect immediately (no outstanding signed URL remains valid past revocation, per NFR-011) and applies going forward — it does not retroactively determine whether the coach already viewed it, which is not tracked.

**FR-096** — The member Progress screen shows current weight and change since start, a weight trend chart, logged measurements with trends, a photo timeline (member-only unless shared), and a log-entry action. Charts view offline; logging offline queues the entry (FR-097).

**FR-097** — Amendment to FR-061. V1.0 limited offline support to check-in. V1.5 extends offline queueing to progress entry logging, stored locally (SQLite) and synced on reconnect via `client_id` idempotency. No other flows are offline in V1.5.

**FR-098** — In the Coach Portal, an assigned member's profile gains a Progress tab showing weight/measurement trends and shared photos. The coach can add a note but cannot edit or delete a member's progress entries. Unassigned members are invisible and unreadable.

---

### 6.19 Payments — Tara Money (Automated Mobile-Money Option) — V1.5

**FR-099** — Amendment to FR-034. Tara Money (a Cameroon mobile-money service with a developer API — create a collect, then detect payment via callback/status) is the designated automated mobile-money provider going forward, replacing Notch Pay in that role — this requirement formalizes that decision (`docs/decisions.md`, 2026-07-31) rather than introducing new capability. **Correction:** no automated mobile-money payment has actually been collected from a real member in production under either provider to date; only cash and other manual methods (FR-033) have carried real member payments. The sandbox spike (FR-100) succeeded, including one real-money round-trip, and was re-verified against GymOS's own real business account (OQ-7, resolved — `docs/decisions.md`, 2026-08-13, Story 4.10), but production activation itself is still pending Story 4.12's cutover. Tara Money is offered alongside cash and the manual methods (FR-033), not as a replacement for them. It uses the existing `PaymentProvider` interface; business logic is unchanged. Notch Pay remains a documented fallback behind the same interface, never actually carrying live traffic. Provider selection is configuration, not code.

**FR-100** — The Tara Money integration was gated by a sandbox spike with the same exit criteria that gated Notch Pay (OQ-2): sandbox auth, payment initiation returns a reference, webhook received and processed, idempotency test passes. The spike passed in full against a stand-in business account on 2026-07-31 (`docs/decisions.md`), including one real-money round-trip. **No member has been charged, and no member payment has been collected, through that stand-in account or any other account since** — the spike proved the integration works, it did not put it into production use. GymOS's own business account (`9FmIZg9GBB`) was blocked on activation until this session. A credential swap to the real account and re-verifying the same round-trip against it are now done (OQ-7, resolved — `docs/decisions.md`, 2026-08-13, Story 4.10); only actually beginning to route real member payments through it remains before production reliance (Story 4.12's cutover, still backlog). This is a credential swap, not a provider cutover (FR-102) — it needs no code or migration changes, but it is a hard prerequisite for G-9 and Section 10 item 2, not a formality.

**FR-101** — Webhook signature verification (NFR-002) is provider-specific. The handler verifies using the active provider's scheme. Tara Money verification is implemented and tested against sandbox and real webhook deliveries before cutover. Invalid payloads are rejected with HTTP 401.

**FR-102** — Cutover procedure:
- New payment initiations route to Tara Money.
- Notch Pay payments already in processing reconcile to a terminal state under Notch Pay; the reconciliation job polls both providers during the window.
- No payment is re-initiated across providers (prevents double-charge).
- The migration window and its reconciliation result are recorded in the audit log.
- Cutover is reversible by configuration for the duration of the beta.

**FR-103** — Both MTN Mobile Money and Orange Money are supported via Tara Money (matching V1.0 coverage, FR-033). Cash, bank transfer, and manual mobile money remain first-class manual methods, unchanged.

---

### 6.20 Payment Gateway — Two Distinct Payment Flows — V1.5

Two structurally different payment relationships, both using the Tara Money integration (FR-099) but routing money in opposite directions with separate lifecycles.

|  | Flow A — Member pays Gym | Flow B — Gym Owner pays GymOS |
|---|---|---|
| Payer | Member | Gym Owner |
| Recipient account | The gym's own Tara Money account | The GymOS platform account |
| Purpose | Gym membership subscription | Platform SaaS tier (FR-073) |
| Amount set by | Gym Owner (plan prices) | Super Admin (tier prices) |
| Provider credentials | Per-gym (each gym connects its own) | Single, platform-level |
| On non-payment | Member loses gym access (FR-030) | Whole gym suspended after grace (FR-131) |
| Exists before V1.5 | Yes (V1.0) | No — new in V1.5 |

The same `PaymentProvider` interface serves both; the difference is whose credentials the payment routes through. GymOS never holds member money (FR-124) and earns only the SaaS tier fee (FR-125).

**Flow A — Member → Gym (membership payments)**

**FR-124** — When a member pays their gym by Tara Money, the payment settles directly into that gym's own Tara Money account. GymOS orchestrates (create collect, detect confirmation, reconcile, receipt) but never receives or holds member funds — a technical orchestrator over each gym's own account, not an aggregator. Paying by Tara Money is one option beside cash and the other manual methods (FR-033).

**FR-125** — GymOS takes no commission on member→gym payments in V1.5. Platform revenue comes solely from the SaaS tier fee (Flow B). Provider transaction fees are borne by the gym (FR-039); GymOS neither absorbs nor marks them up.

**FR-126** — Each gym must connect its own Tara Money account to collect automated mobile-money payments. Settings provides a "Connect payment account" flow where the Owner authorizes their gym's merchant credentials. Credentials are stored encrypted (Supabase Vault), readable only by the payment service, never returned to any client, tenant-isolated.

**FR-127** — Cash and Tara Money are co-equal payment options, not a primary and a fallback. A gym always takes cash and the manual methods (FR-033); connecting Tara Money adds the automated mobile-money option beside them. A gym without Tara Money connected loses no ability to operate — it collects by cash and manual entry as before, and the app simply does not surface the automated "pay by Tara Money" action until the Owner connects. Connecting is an enhancement, never a prerequisite.

**FR-128** — When a member initiates a mobile-money payment, the service resolves the gym's connected credentials (FR-126) and routes through them. A member never sees gym credentials. If credentials are missing, invalid, or revoked, initiation fails gracefully, directing the member to the desk, and the Owner is notified their connection needs attention.

**FR-129** — Both member subscription purchase and renewal use Flow A. Renewal via the front-desk alert panel (FR-050) and self-service renewal from the app both route through the gym's connected account. The subscription lifecycle (FR-027–FR-032) is unchanged; only money routing is now explicitly the gym's own account.

**Flow B — Gym Owner → GymOS (SaaS subscription billing)**

**FR-130** — GymOS bills each gym for its platform SaaS subscription per the gym's tier (FR-073) and interval (monthly/annual). New in V1.5: V1.0 assigned tiers and enforced caps (FR-086) but did not collect the fee. Billing for V1.5 is a reminder-to-approve model, not an automated debit: GymOS notifies the Owner when payment is due (FR-135) and the Owner completes the charge via Tara Money into the platform's account (OQ-14, resolved). Automated recurring debit is deferred to a future version pending a card-based provider.

**FR-131** — A gym's platform subscription has its own lifecycle: `active` → `past_due` → `grace_period` → `suspended`.
- `active` — SaaS fee paid; gym fully operational.
- `past_due` — the Owner missed the payment-due notice or the Tara Money charge failed; the gym stays operational and repeat reminders begin (FR-133, FR-135).
- `grace_period` — retries exhausted; a Super-Admin-configurable window begins (default 7 days). Gym operational; Owner sees a "renew to avoid suspension" banner and is notified.
- `suspended` — grace elapsed; the whole gym tenant is suspended (staff and members cannot log in), data retained. Payment restores full access. Formalizes the Super Admin suspend capability (FR-071).

**FR-132** — Suspending a gym for non-payment suspends the entire tenant — every staff and member account loses access until the subscription is current. Reversible: a successful SaaS payment returns the gym to `active` and restores access immediately. Member states and all data are preserved through suspension. The member-facing suspension surface never mentions billing or payment — that is between GymOS and the Owner only.

**FR-133** — **Amendment — OQ-14 resolved.** SaaS billing is Owner-approved, not automated: on each gym's billing anchor date, GymOS sends the Owner a payment-due notice (channels per FR-135) with a one-tap Tara Money payment link. The Owner is never auto-debited — mobile money does not support that. If unpaid, GymOS re-sends the notice on a defined schedule (default: 1, 3, 5 days after due) before the gym moves to `grace_period`. Every notice and payment attempt is recorded (FR-135). Automated recurring debit is deferred to a future version pending a card-based provider (e.g. Stripe); this FR is amended again when that ships.

**FR-134** — The Super Admin dashboard gains a Billing view: each gym's tier, interval, SaaS status, next billing date, last payment, failed attempts. Super Admin can mark a payment received (out-of-band), apply a credit/free period (beta gyms, FR-136), trigger a retry, or suspend/reactivate. All actions audit-logged (FR-080).

**FR-135** — Gym Owners receive platform-subscription notifications distinct from member notifications: upcoming SaaS renewal, payment due (with the one-tap Tara Money link, FR-133), payment succeeded/failed (with retry date), entering grace, impending suspension. Owner-facing and mandatory (non-opt-out), as they concern continued platform access. Sent via **both SMS and WhatsApp** (not a fallback chain — both fire, since missing this notice risks suspension), reusing the Evolution API/Twilio infrastructure from FR-118, **plus email if the Owner has one on file.** Capturing an Owner email is new in V1.5 — an optional field on the Owner account, mirroring FR-020's optional member email — and requires a transactional email provider, which is not part of the V1.0/V1.5 stack today (addendum §A lists none). Email is a best-effort third channel until that provider is selected and integrated; SMS and WhatsApp are the guaranteed channels regardless.

**FR-136** — Beta accommodation. Super Admin can place a gym on a free or discounted plan (zero-price tier or credited period) so beta gyms aren't charged during validation — formalized as the Free/Test tier (FR-139) rather than left to ad-hoc discounting. The billing machinery (FR-130–FR-135) is built and exercised even at a 0 XAF price point, but whether a given beta gym is charged is Super-Admin policy per gym.

**Shared requirements (both flows)**

**FR-137** — Both flows reuse the V1.0 integrity machinery: idempotent webhooks (FR-035), reconciliation (FR-036), append-only audit (FR-079), integer-XAF storage (FR-026). Flow B reconciles against the platform account, Flow A against each gym's account. Discrepancies in either are flagged. Amendment to FR-036: the discrepancy definition gains a fourth category — a payment whose settled account does not match its declared routing context (FR-138), i.e. a Flow A collect that landed in or credited against the platform account, or a Flow B collect that landed in a gym account. Reference and amount matching alone (the original three FR-036 categories) cannot catch a misrouted-but-otherwise-clean payment.

**FR-138** — The `PaymentProvider` abstraction carries a routing context identifying which account a payment belongs to (a specific gym for Flow A, the platform for Flow B). This context selects the correct credentials at initiation, verification, and reconciliation. Adding a provider or flow changes only the adapter and context, not the calling code.

**FR-139** — Amendment to FR-073. A fourth tier, **Free/Test**, is added to the platform defaults: member cap Super Admin-configurable per gym, monthly and annual price fixed at 0 XAF. It exists specifically for beta/test gyms during validation, giving Super Admin a formal, auditable way to exempt a gym from SaaS billing (FR-130) rather than relying only on ad-hoc per-gym discounting (FR-136). Assigning a gym to Free/Test is a tier change like any other (FR-071 Gym tier assignment) — the billing reminder/reconciliation machinery (FR-130–FR-135) still runs, just at a 0 XAF price point, so those code paths stay exercised during the beta.

**FR-140** — A member can renew their own subscription directly from the app (Flow A, FR-124) without visiting the front desk. When status is `expiring_soon`, `grace_period`, or `expired`, the app surfaces a "Renew" action showing the current plan and renewal price; the member pays by Tara Money if the gym has one connected (FR-126), or sees "See front desk to renew with cash" if not (FR-127). On successful payment, the subscription resets per FR-032 and the member sees an immediate confirmation — the same outcome as the front-desk renewal panel (FR-050), just member-initiated and routed through the gym's connected account (FR-129).

---

### 6.21 Classes & Scheduling — V1.5

**FR-104** — A Manager or Owner can create classes: name, description, assigned coach, capacity, and a schedule (one-off or recurring). Classes are tenant-isolated like all other data.

**FR-105** — Any member with an active subscription, on any plan type, can book a class session from the app (fixed rule — no per-plan class-eligibility flag). Booking is capacity-limited; when full, booking closes ("This class is full"). Enforced server-side to prevent overbooking under concurrency.

**FR-106** — A member can cancel a booking up to a gym-configurable cutoff (default 2 hours), freeing the spot. Booking and cancellation are not payments.

**FR-107** — A Receptionist can view a session's booked members and mark attendance. Class attendance is distinct from floor check-in but uses the same member-status rules — an expired member cannot be checked in and triggers the front-desk alert (FR-049).

**FR-108** — The member app shows upcoming booked classes on Home and a Classes screen of available/booked sessions. Workout plans and classes are separate features.

---

### 6.22 Workout Plans — V1.5

**FR-109** — A Coach can author a workout plan for an assigned member: a named plan with an ordered list of exercises (sets, reps, optional notes), created and edited from the Coach Portal.

**FR-110** — A plan is assigned to exactly one member. The member sees their plan and can mark exercises/sessions complete; completion logging is offline-safe (`client_id`). Completion data is visible to the authoring coach.

**FR-111** — If a coach assignment ends (FR-055), the previous coach's plan stays visible to the member and Owner/Manager but is not editable by a new coach until they take ownership — mirroring the V1.0 session-note handoff.

**FR-112** — A shared exercise library (platform defaults; gym/coach can add custom entries, gym-scoped) backs plan authoring.

---

### 6.23 Quiet-Gym Alerts — V1.5

**FR-113** — A member can opt in to quiet-gym alerts (default off). When occupancy drops into the Low band (FR-047) during opening hours, opted-in members receive N-06 — the V1.5 activation of the reserved N-06 notification (FR-075).

**FR-114** — Quiet-gym alerts are rate-limited: max 2 per day per member, min 3-hour gap, only during configured opening hours.

**FR-115** — Quiet-gym alerts use the existing occupancy calculation (FR-046) — no new presence detection — preserving the honest-estimate guarantee.

---

### 6.24 Class Reminders — V1.5

**FR-116** — A booked member receives N-07 60 minutes before the session. Class reminders are opt-out (non-critical), per FR-076.

---

### 6.25 WhatsApp Invite & OTP Fallback (V1.0 Carryover Completion) — V1.5

**FR-117** — The Evolution API WhatsApp integration is completed, covering the two unfinished V1.0 stories. Member invitations (FR-082) can be sent via WhatsApp in addition to SMS, at the gym admin's choice.

**FR-118** — OTP delivery uses an ordered fallback chain, Evolution API WhatsApp first, falling through to Twilio WhatsApp, then Twilio SMS, then sent.dm on failure at each step. Transparent to the member; channel and outcome are logged for observability. (Corrects the V1.5 draft's original "primary SMS, WhatsApp fallback" framing, which had the order backwards relative to the chain already decided and shipping per the 2026-08-08 proposal.)

**FR-119** — The Evolution API instance configuration (V1.0 Epic 1, Story 1.13 — shipped) is finalized: platform-level, managed by Super Admin, documented in `docs/decisions.md`.

---

### 6.26 Dashboard & App Additions — V1.5

**FR-120** — The Settings page gains a Staff section (Owner and Supervisor) listing staff with role and status, plus Add/Edit/Deactivate (FR-087–FR-089). All other Settings capabilities unchanged.

**FR-121** — A new Classes page (Manager for create/edit; Receptionist for bookings and class attendance) lists classes, sessions, booking counts vs capacity, and the assigned coach.

**FR-122** — The Coach Portal gains Workout Plans and, per assigned member, a Progress tab. No other dashboard section becomes visible to the Coach role. *(V2: superseded in part by FR-144/FR-145 — the Coach Portal gains its own Overview and My Classes sub-surfaces. No **admin** dashboard section becomes visible to the Coach role; that constraint is unchanged. See sprint-change-proposal-2026-09-09.md.)*

**FR-123** — The member app gains a Progress tab and a Classes tab alongside Home/Check-In/Profile. Notification preferences gain N-06 and N-07 toggles.

---

### 6.27 Session Guests — Per-Visit Paid Sessions — V1.6

A **session guest** is a member whose plan is Pay-per-session. This section makes the plan's price a real per-visit charge and closes OQ-16.

**What the gate is, and is not.** Check-in is a phone scanning a QR (FR-042); GymOS has no door, turnstile, or staff gate. The V1.6 gate decides whether a scanned visit is **recorded and admitted by the app**. It does not physically stop someone who walks in without scanning — noticing those people stays a desk process, supported by the occupancy and "currently checked in" views (FR-046, FR-048). The promise V1.6 makes is that every *scanned* guest visit at a charging gym is a paid, recorded event, and that the owner can see the gap (FR-163).

**FR-156** — A session guest is an ordinary member on a Pay-per-session plan (FR-024). V1.6 adds no new role, no new account type, and no separate app: guests register through the normal member flow (FR-019), log in, and check in by QR (FR-042) like any member, and count toward the gym's member cap (FR-073) like any member. **The plan's price (FR-025) is the price of one session.** A Pay-per-session plan priced at 0 XAF is exempt from FR-158–FR-159: its guests check in as today. Where the gym has a registration fee (FR-147), staff settle a guest's fee by waiver (FR-150) or by collection (FR-152) like any member; no automatic waiver exists. The waiver form offers a one-tap preset reason, "Session guest", so the mandatory reason (FR-150) is not free text for the common case; a per-gym auto-waive for Pay-per-session plans is not built until pilot gyms ask for it.

**FR-157** — Each gym has a setting, **Charge guests per session**, editable by the Owner or Supervisor on the Settings page (Amendment to FR-069) and audit-logged with old and new value (FR-080). It is **off** for every gym that exists when V1.6 is released and **on by default** for gyms created afterwards. While it is off, FR-042–FR-045 and FR-061 behave exactly as before and FR-158–FR-163 do not apply. Turning it on changes only visits from that moment: past attendance is untouched, and a check-in already open at that moment is not affected. Before the Owner confirms, the Settings page shows how many Pay-per-session members will need a paid session at their next visit. While the setting is off, the loyalty program's guest rule earns nothing (FR-165) and the form says so.

**FR-158** — While the setting is on, a **paid session** is created by a payment of the guest's plan price (FR-156). It is its own record — one per purchase, linked to exactly one payment — and a free session (FR-166) is the same record linked to a loyalty grant instead of a payment, so free sessions never appear as payments, receipts, or revenue. It can be paid two ways: **at the desk**, where staff record cash or manual mobile money (any role that can record payments, FR-021) or a bank transfer (Manager or Owner only, FR-033); or **in the app** by Tara Money (Flow A, FR-124) where the gym has Tara Money connected (FR-127).
- *Desk payments take effect immediately* and do not wait in the verification queue (FR-037), as the registration fee does (FR-152). **Amendment to FR-038:** for a session payment the amount is fixed to the plan price and not entered, and the free-text reason is optional; the actor, member, method, and timestamp are still recorded.
- *The amount is determined server-side*, at the moment of payment, and never supplied by a client. A later change to the plan's price does not change the value of sessions already paid for (FR-173).
- *One payment in flight per member:* while a Tara Money session payment for a member is awaiting confirmation, a second one cannot be started and a desk payment for the same member is refused with a message that a payment is already in progress, so a double tap or a desk-plus-app overlap cannot create two sessions.
- *Tara outcomes:* a confirmed payment creates the session, **including a confirmation that arrives late** (the money is already in the gym's account, so the session is the member's; a late confirmation also raises a staff-visible audit entry). A payment that is flagged or settles to the wrong account (FR-036, NFR-019) **never produces a session** and is visible to staff as a discrepancy. A provider redelivery creates nothing new (FR-035).
- The payment carries its own purpose (`session`), distinct from subscription and registration-fee payments, so it is reportable separately and can never be treated as a renewal.

**FR-159** — Amendment to FR-042 and FR-044. While the setting is on and the member's current plan is Pay-per-session, a check-in succeeds only if the member has a usable paid session or free session (FR-166).
- The first successful check-in of a day **consumes** one session, and that session then covers every further check-in until the end of that calendar day in the gym's timezone (FR-010), so leaving and re-entering the same day costs nothing more. The covered day is stored on the consumed session when it is consumed; a later timezone change does not move it. A visit still open at midnight stays covered until it closes.
- An **unused paid session** stays usable for **7 days** from payment and then lapses; its lapse date is shown to the member (FR-169).
- *Which session is consumed first:* the one that lapses soonest; on a tie, the paid session before the free one, so a stamp is earned (FR-165) and no paid money is left to lapse.
- *Which time counts:* coverage, lapse, and stamps are evaluated at the **server's receipt time**, never at a client-supplied scan time. For an offline scan (FR-161), the scan time is accepted as the visit time only if it is within the gym's auto-timeout window (FR-045) of receipt; an older scan is treated as a new visit at receipt time. A scan time can never place a visit before its payment and have it covered retroactively, and can never extend one session's coverage onto another day.
- *No usable session:* the check-in is rejected, **no attendance event is recorded**, and the app shows a "Pay for your session" state (mirroring the awaiting-registration-fee state of FR-155) offering in-app payment where available (FR-158) or "See the front desk".
- The rule is enforced server-side for every entry path (NFR-021), so an older app build cannot bypass it; the return contract for a denial is defined so older builds show a "see the front desk" message rather than a network error.
- Plans that are not Pay-per-session are unaffected. Class attendance by a guest follows the same rule (FR-174).

**FR-160** — Amendment to FR-049. A check-in rejected under FR-159 raises a real-time alert to the gym's active dashboard sessions, through the same Supabase Realtime mechanism as FR-049, as a new alert type whose copy and color the UX specification defines (the dismissal rule is that recording the member's session payment dismisses it, as renewal dismisses FR-049 alerts). The alert names the member, shows any payment already in flight for them, and lets the receptionist record the session payment (FR-158) so the member can scan again. The rejected attempt is also stored (member, gym, timestamp, scan id) so the blocked-attempt figures in FR-163 are real; it is not an attendance event and does not appear in the attendance log (FR-048). Repeated scans carrying the same scan id are one attempt.

**FR-161** — Amendment to FR-061. A check-in made offline cannot verify payment. For a guest at a gym with the setting on, the app records it locally and shows "Check-in saved — your session will be verified" rather than the plain success state `[exact wording is a UX decision]`. The server validates it on sync under FR-159's time rules: if a usable session exists it is consumed and the attendance recorded; if not, it is **not** counted as attendance, is stored as an attempt keyed by its scan id (so a retry is not counted twice), and raises the alert of FR-160 — never silently counted, never silently dropped. If the guest has paid by the time it syncs, the paid session covers it. A sync that fails permanently is discarded as FR-061 does today, and that visit is not counted. The app refreshes the gym's charging setting each time it is online, so a stale offline copy can differ from the server's current rule for at most one offline period; the server's rule at sync time governs. FR-061's timeout rules otherwise stand.

**FR-162** — Session payments follow the existing payment rules and are added to the audited actions (Amendment to FR-080): every session payment, every consumption, every rejected attempt, and every refund is traceable to actor, member, and time. Under FR-040 a refund can be recorded against a session payment, and the rule holds in the data layer, as FR-153 does for the registration fee: a **full** refund of an **unused** session voids that session atomically (and a consumption racing a refund resolves to exactly one of the two); a **partial** refund does not void it; a refund of a **consumed** session is recorded but does not un-consume it, and the visit stays counted, but **the stamp it earned is reversed** (the counter goes down by one, never below 0, and a free session already earned from it is not taken back). Session payments count toward month-to-date revenue (Amendment to FR-143) as their own line, separate from subscription revenue and registration fees. Refunding a renewal payment does not reverse the stamp or free days that renewal earned; a refunded renewal is a rare, owner-handled correction and no rule removes days from a subscription.

**FR-163** — The staff Overview (FR-143) gains a **Guest sessions** card for gyms that have the setting on, with its own period control (today, this month): paid guest sessions, blocked attempts (counted once per scan id) with the number of distinct members blocked, and free sessions given (FR-166), each linking through to the underlying list. The list for paid sessions can be grouped by the staff member who recorded them and shows refunds recorded after consumption, so an owner can see whether the desk is collecting. Counts are computed server-side, not by summing fetched rows (the `max_rows` caveat in FR-143 applies). The card is visible to Owner, Supervisor, and Manager.

**FR-174** — Amendment to FR-105 and FR-107. While "Charge guests per session" is on, marking a Pay-per-session member **attended** at a class requires a usable session, and consumes one under exactly the rule of FR-159: the session is consumed if none covers the member's gym-local day yet, a session consumed by a class also covers the floor that day (and the reverse), and a second class the same day costs nothing more. Consumption earns the guest stamp (FR-165) as it does at check-in.
- *Booking stays free.* FR-105 and FR-106 are unchanged: a guest can book and cancel without paying (booking and cancellation are not payments, FR-106). A booking holds a capacity spot without payment; this is accepted, and a guest who books but is never marked attended simply consumes nothing.
- *No usable session at marking:* the mark is refused, the attendance is not recorded, and the dashboard offers the receptionist the session-payment action of FR-158 in place; once it is recorded the receptionist marks attendance again. The refused attempt raises the same front-desk alert and is counted in the same blocked-attempt figures as FR-160 and FR-163.
- *Enforcement* is server-side in the same database function as FR-159 (NFR-021), so no dashboard, coach, or script path can mark a charging-gym guest attended without a session. The coach roster view cannot mark attendance for a Pay-per-session guest without it either.
- Members on Monthly, Coach-inclusive, and Class-only plans are unaffected: their class rules stay exactly as FR-105 and FR-107 state.

---

### 6.28 Loyalty Program — V1.6

One program engine per gym with two earning rules: guests earn toward a free session, subscribers earn toward free days. Rewards are free sessions and free days only; percentage or amount discounts are out of scope because they would change the amount sent to the payment provider (Section 8).

**FR-164** — Each gym has a loyalty program, **off by default**, switched on or off by the Owner or Supervisor on the Settings page (Amendment to FR-069). When on, the gym sets three integers: **N**, the paid sessions a guest needs for one free session (2–50); **K**, the on-time renewals a subscriber needs for a reward (3–24); and **R**, the free days that reward adds (1–30). As the gym edits N, K, and R, the form shows the **effective discount** the setting implies (for example, "1 free session per 5 paid = about 17%"; "30 days per 3 renewals of a 30-day plan = about 25%") so an owner sees what the program costs before saving. Every change is audit-logged with old and new value. Progress is per member **per gym** — a member of two gyms has two independent cards — and is isolated by RLS (NFR-001). A member has **two separate counters**, guest stamps (toward N) and subscriber stamps (toward K); moving between plan types never converts one into the other. Changing N or K never erases progress: a member at or above a lowered threshold earns one reward at their next qualifying event and the counter returns to 0.

**FR-165** — **Guest rule.** A Pay-per-session member earns one guest stamp each time a paid session is consumed (FR-159) — not at check-in, not for a free session, and not for re-entry on an already-consumed day — so entering and leaving never earns a stamp. On reaching N the member earns one free session and the guest counter returns to 0. Stamps are earned only while both the loyalty program and "Charge guests per session" are on; nothing is awarded retroactively.

**FR-166** — A **free session** is a session with no payment (FR-158). It is added to the member's usable sessions, is consumed under FR-159's ordering, follows FR-159's same-calendar-day coverage, and is usable for **60 days** from the day it is earned, then lapses. A member can hold more than one. A member who moves to a plan that is not Pay-per-session keeps an unused free session until it lapses; it has no effect while they are on that plan and is usable again if they return to Pay-per-session. Granting, consuming, and lapsing a free session are each audit-logged.

**FR-167** — **Subscriber rule.** For Monthly, Coach-inclusive, and Class-only plans, a member earns one subscriber stamp for each **on-time renewal**.
- A renewal is a **verified payment for the member's current plan** through the manual renewal flow, the dashboard renewal panel, or the member's own in-app renewal (FR-140). A payment-less override, a plan assignment or plan change, and a renewal back-dated by staff earn no stamp.
- It is **on time** if it was verified no later than the **end of the day after** the subscription's expiry date — a one-day allowance, because mobile money is paid by hand and not charged automatically like a card — evaluated in the gym's timezone (FR-010) at the moment of verification, not initiation; one verified later earns no stamp. A late renewal neither earns a stamp nor erases progress.
- At most **one stamp per subscription period**: a second renewal payment verified before the first period has ended earns nothing, so paying repeatedly cannot farm stamps.
- On reaching K, the reward is **R free days added to the renewed subscription's expiry date**, applied in the same transaction that verifies the K-th renewal, and the counter returns to 0. The extension changes only the expiry date; it creates no payment and touches no amount.
`[ASSUMPTION — "non-consecutive" and the one-stamp-per-period rule are PM defaults]`

**FR-168** — **Expiry defaults.** Progress resets to 0 after **90 days with no qualifying event** (a consumed paid session for guests, an on-time renewal for subscribers). For subscribers the window is the longer of 90 days and the plan's own duration plus the gym's grace period (FR-010), so an annual plan is not reset between renewals; a member who renews late every month therefore does reset after 90 days with no on-time renewal. The reset is evaluated when the progress is next read or earned and is audit-logged then; the app and the dashboard never show progress that is already past its window as live. The 90-day window and the 60-day free-session validity are platform defaults, stored as data so exposing them to gyms later is a settings change, but not gym-configurable in V1.6. All windows are 24-hour multiples from the originating event, except the covered day in FR-159, which is a gym-local calendar day.

**FR-169** — The member app shows the member's loyalty progress as a count toward the threshold ("3 / 5"), any free session earned with its expiry date, and any unused paid session with its lapse date, in the member's language (FR-014–FR-018 apply). The member's page in the dashboard shows the same to staff. No push notification for earning a reward ships in V1.6.

**FR-170** — No role — including Owner and Super Admin — can manually add, remove, or edit stamps or free sessions in V1.6; they are produced only by the rules above, so nobody can change a member's loyalty balance by hand. This does not stop a staff member from recording a cash session without collecting cash or from refunding after consumption; those are made visible to the owner by the signals in FR-163 and the audit log, not prevented. Rewards are granted exactly once per qualifying event, including under webhook redelivery (FR-035) and offline sync (FR-161) (NFR-022). Amendment to FR-080: stamp earnings, reward grants, consumptions, lapses, resets, and program configuration changes are audited actions. Stamps are reversed only by the refund rule in FR-162; no manual correction path exists.

---

### 6.29 Gym Category — V1.6

**FR-171** — Every gym has a **category**, one of: Gym / Salle de sport, Studio Pilates, Studio Yoga, Fitness Center, Autre. Super Admin chooses it when creating the gym (Amendment to FR-071 and FR-010 — gyms are created by GymOS staff, not self-serve, FR-007) and can edit it afterwards; the Owner and Supervisor can edit it on the Settings page (Amendment to FR-069). Every change is audit-logged. Gyms that exist at release are set to Gym / Salle de sport. Category labels are localized in English and French (FR-014–FR-018). "Autre" carries no free-text value in V1.6.

**FR-172** — In V1.6 the category is **descriptive data only**: it changes no behavior, plan type, permission, or screen. Studios use the product exactly as gyms do. It exists so V1.7's directory and landing pages (Section 12) can filter and present by business type. Product wording does **not** adapt per category in V1.6 — the apps keep saying "gym" for every category (decided 2026-10-11; revisited at V1.7 planning when the landing pages show what each category needs).

**FR-173** — Clarification of FR-024 and amendment to FR-025. The Pay-per-session plan type is unchanged in definition ("member pays per visit; no fixed expiry"); V1.6 supplies the mechanism FR-024 always implied (FR-156–FR-159) behind the per-gym setting of FR-157, and there is no separate "session price" field. Because the gate keys on plan type and price: (a) the plan type of a plan that already has subscriptions cannot be changed in place — a gym creates a new plan instead; (b) every change to a plan's type or price is audit-logged; and (c) a price change never alters the value or validity of sessions already paid for.

### 6.30 GymOS Support Staff — V1.7 (ships first)

**FR-175** — A Super Admin can create a **GymOS support account** for one real person. The account uses a GymOS-controlled phone number or email that does not match any existing user; creation is refused on a collision, never merged (FR-001). Accounts are never shared. A support account belongs to GymOS, not to any gym, and has no access to any gym until a gym is assigned and the account's own second factor is verified (FR-189).

**FR-176** — A support account is activated through a **single-use invite link** that expires in 24 hours, is stored hashed, and is delivered to a channel Super Admin has verified, never a temporary password. The invite is bound to that channel: the person must also pass the sign-in for it. Enrollment of the account's authenticator happens inside that flow, and the account must have a verified phone and an `@gymosapps.com` email on file (unverified until mailboxes exist) before it can be assigned. Sign-in is phone and password, then the second factor; the invite sets the password. One verified factor per account; adding or removing a factor requires AAL2, and a session at AAL1 cannot enroll an additional factor.

**FR-177** — Assignment is **many-to-many and per gym**: a support person can be assigned to zero or more gyms, and a gym can have zero or more support people assigned. Assignment, unassignment and removal are Super Admin actions at AAL2, audited, with a mandatory reason (consistent with FR-089). A new gym has no support assigned automatically. An assignment to a person who has not finished enrollment (FR-176), or made while the gym's support switch is off, is **pending**: it activates only when a Super Admin confirms it after enrollment is complete and the switch is on. Assignment, activation and the Owner's switch are serialized per gym, so a concurrent assign and switch cannot leave an active membership while the switch is off (tested).

**FR-178** — In each assigned gym a support person holds a real staff membership with its own role, **support**, ranked below Owner and distinct from Supervisor: it has no access by default and is granted exactly the capabilities of FR-179, so a Supervisor permission never reaches support by inheritance. The membership is written only by Super Admin assignment and exists only while the assignment is active. The FR-087 ceiling applies: support cannot create, edit, or remove an Owner or a Supervisor, cannot create another support account, and cannot change its own role. A person who holds a support membership in a gym holds no other role there, and an assignment is refused if the person is already a member or staff in that gym (FR-091).

**FR-179** — Beyond what a Supervisor can do, a support person can: edit the gym profile and settings, plans and prices, registration fee, guest charging and loyalty settings, category, and, from Step 2, landing-page content (FR-198); create staff within the ceiling; manage member records and imports; record payments, refunds and registration-fee waivers; and **prepare** a payment-account connection or replacement for the Owner to confirm (FR-180). Support **cannot**: change "Allow GymOS Support"; change the gym's SaaS tier, interval, billing anchor, Owner contact, subscription status, or suspension state; deactivate or delete the gym; edit, deactivate or reset the credentials of the Owner or any Supervisor; change any staff member's phone number or trigger a credential reset for them; or reach any capability not on this list. The allow-list is the specification: every RPC and column grant a support session can use is enumerated, and every denied one has a negative test.

**FR-180** — Amendment to FR-126 and FR-127. **Connecting or replacing a gym's Tara Money account always needs the Owner's confirmation.** Support prepares a proposal; nothing changes until the Owner approves it in the dashboard. The confirmation shows the gym's current account and the proposed one, both with masked merchant identifiers, who prepared it (as "GymOS Support"), and when; the approval is bound to a hash of that exact proposal, so an edited proposal needs a new approval. A proposal expires after 24 hours, and a gym has at most one open proposal. The Owner is notified immediately of every proposal, approval, and change, and Super Admin is alerted. Secrets go to Vault as today; the audit row records that credentials changed, never their value. After a payment-connection change or a support revocation the Owner is prompted to review recent support changes.

**FR-181** — Support actions that move money or change who has access are visible to the gym without naming the person. The Owner is notified **immediately** of payment-connection proposals and changes (FR-180), and in a summary at least daily, on days support acted, of every refund, fee waiver, staff creation and edit, and change to a published page's public contact or about text. A velocity limit applies to support actions that move money or change access (refunds, waivers, staff creation and edits, payment-connection proposals, assignments): 10 per hour per gym and 20 per hour per account, and 3 payment-connection proposals per day per gym `[ASSUMPTION]`; exceeding it locks the account for Super Admin review. Staff created or modified by support are tagged "created by GymOS Support" in the Owner's staff list and flagged for review on any support revocation.

**FR-182** — To the Owner and the gym's staff, support appears as **one fixed row, "GymOS Support"**, in the staff list, never an individual and never a count. The gym's Settings states which state applies: **off** ("turned off by you"), **on with no one assigned**, **on with support assigned**, or **on with an assignment waiting for GymOS to confirm**, and the time support last acted. The row cannot be edited or deactivated from the gym; the only gym-side control is FR-183.

**FR-183** — Each gym has an **"Allow GymOS Support"** setting, changeable by the Owner only. It is **on for gyms created after V1.7 and off for gyms that exist at release** until the Owner turns it on; existing Owners are told in-app and by their usual channel before release (following FR-157). Switching it off ends all support access to that gym immediately. Switching it on re-activates the assignments that were active when it was switched off; assignments made while it was off stay pending (FR-177). Both changes are audited and visible to Super Admin. `[ASSUMPTION — assignments are suspended, not deleted; confirm in OQ-30]`

**FR-184** — When access ends (unassignment, removal, opt-out, deactivation, or lock), operations already started complete or roll back atomically; items created by the revoked person that are still pending are re-owned to a system actor and flagged for the Owner; support sessions' live subscriptions and signed links stop working within 60 seconds `[ASSUMPTION]`; and the Owner is prompted to review changes made by support to payment and staff settings.

**FR-185** — Removing an individual support person from a gym or deactivating the account is a Super Admin action only, with a mandatory reason. The Owner cannot see or act on individuals. Support accounts are disabled automatically after 30 days without activity `[ASSUMPTION]`, recertified by Super Admin each quarter, and any change to a support person's phone or email goes through Super Admin at AAL2.

**FR-186** — **No gym-side read returns an individual support identity**: not the staff list, audit trail, payment "recorded by" labels, refund approvers, member notes, check-ins, exports, live updates, notifications, or error logs. The displayed actor is derived by the server and cannot be set by a client. Attribution columns (created-by, recorded-by, approved-by and the like) hold a per-gym opaque identifier for support, never the platform user id, so the same person cannot be correlated across the gyms they work in. Each surface above has a test.

**FR-187** — Every action by a support person is audit-logged under the individual's identity, retained as for any staff action. To the gym it is shown as "GymOS Support". The product never shows the Owner an individual's identity on its own. The Owner can instead file a disclosure request about a specific audit row; Super Admin answers it outside the product within 3 business days `[ASSUMPTION]`, and the request and the answer are audited. GymOS is responsible for the actions of its support staff in a gym; the customer terms say so `[NOTE FOR PM — terms to be reviewed by counsel, OQ-31]`.

**FR-188** — Support memberships are excluded from the gym's staff counts, staff-role caps and tier limits, operational notifications (such as front-desk alerts), and platform metrics. A support person never receives a gym's operational notifications. One definition of "support member" (the support role) governs all of it, tested in both directions.

**FR-189** — Every support account must pass a **second factor**: a time-based one-time code from an authenticator app (TOTP, Supabase MFA). A support session works only at the elevated assurance level (AAL2); a session at the lower level sees and can do nothing in any gym. The check is enforced in the database and in every edge function and service path that touches money or secrets, through one shared check, so no entry path and no older client build can bypass it (NFR-021, NFR-023). Support sessions end after 8 hours and after 15 minutes idle, enforced by the application and not dependent on a provider plan setting `[ASSUMPTION]`; changing a payment connection, issuing a refund, and creating staff each require the second factor to have been verified within the last 5 minutes `[ASSUMPTION]`; repeated wrong codes lock the account; there is no "remember this device".

**FR-190** — A Super Admin can reset a support person's second factor. The reset requires AAL2 and a recorded identity check of the person, invalidates the person's sessions, waits a cooling-off period of 30 minutes `[ASSUMPTION]` during which the person is notified on the verified phone and on the email on file and can cancel it, then requires re-enrollment through a new single-use invite (FR-176), and is audited.

**FR-191** — Every **Super Admin** session requires the second factor too (AAL2), because Super Admin creates, assigns and resets support accounts. The requirement is switched on only after the Super Admin account has enrolled and verified its factor in a controlled pre-flight step (Section 10.2); enrollment is never open to an unverified session once the requirement is on. Recovery is a mechanism designed in architecture: the reviewer notes Supabase TOTP has no native recovery codes, and a second enrolled factor on a separate device is the candidate. The last-resort recovery, if no Super Admin can sign in, is a documented out-of-band reset by the platform owner, itself audited. Dual control (a second approver) replaces that route once a second Super Admin exists (Section 8).

**FR-192** — Amendment to FR-090. Unassigning a support person, removing or deactivating the account, a lock, or the Owner switching "Allow GymOS Support" off takes effect on the person's **next request**, not at token expiry. This closes FR-090 for every role: each role-gated policy, RPC, edge function and service path checks the caller's current membership, role, deactivation state, and for support the assignment, the opt-out, and the second-factor level, live. A gym in suspension (FR-132) is denied to support like every other staff account.

**FR-193** — Amendment to FR-072. Super Admin read-only support escalation stays as the diagnosis tool. A support person's access to member and payment data in an assigned gym is by assignment and is audited under FR-187. **A Super Admin cannot hold a support account**: at creation the phone, email and any linked identity of a support account are checked against every Super Admin and the creation is refused on a match, and a Super Admin session cannot be assigned. A support person cannot act on a record tied to their own phone or email.

**FR-194** — A support person who works in several gyms has an explicit active-gym context (FR-003), re-checked live on every request; there is no cross-gym action in one request.

**FR-195** — A support person never appears on a member-facing surface: receipts, the member app, and message templates show the gym, never an individual support identity.

### 6.31 Gym Landing Pages — V1.7

**FR-196** — A gym can have one public **landing page** at `{name}.gymosapps.com`. It is optional. Every gym user still signs in at `owner.gymosapps.com`; only the public page lives on the per-gym address. The page shows no login, no member counts, and no staff names. A visitor can call the gym, open WhatsApp, or get directions.

**FR-197** — New gym fields hold the page content: about, services and activities, public plans and session plans with prices, location (address and map position), opening hours, a **public contact** (phone or WhatsApp, which can differ from the Owner's login phone), gallery images, banner image, and logo, with the gym's existing primary color and category label (FR-171). Existing gyms are prompted to fill them in; nothing is published for them. Before publishing, a screen states exactly what becomes public.

**FR-198** — The Owner, a Supervisor, or an assigned support person can edit the content and publish or unpublish. **Only the Owner** (or Super Admin) can claim or rename the page name; edits and publishing by others use the existing name.

**FR-199** — Publishing is an explicit, server-validated action. A page can be published only when it has a page name, category, logo, banner image, about text of at least 100 characters, country and city, at least one public contact, opening hours, and at least one **public** plan. Gallery, services and map position are optional. The gate is evaluated again on every change: a page that stops meeting it unpublishes itself and the Owner is told why. Unpublishing is always allowed.

**FR-200** — Plan visibility is **opt-in per plan**. A plan is private by default; only a plan the gym marks public appears on the page and in anything public.

**FR-201** — GymOS prebuilds the page templates; V1.7 ships one launch template. The gym can swap templates at any time without re-entering content. The template system is a self-contained module with one contract: validated, versioned gym content in, rendered page out. Templates are presentation only and hold no gym data (addendum G).

**FR-202** — A page name is lowercase, 3 to 30 characters of `a-z`, `0-9`, and `-`, with no leading or trailing hyphen, no `--`, no `xn--` prefix, and not digits only. Names are unique case-insensitively. Reserved names (`owner`, `portal`, `www`, `api`, `app`, `admin`, `support`, `mail`, `staging`, `dev`, `gymos`, `gym-os`, `auth`, `cdn`, `status`, `docs`, `help`, `login`, `signin`, `account`, `billing`, `pay`, `payment`, `tara`, `taramoney`, and any name starting with `gymos`) and names containing a credential or brand word cannot be claimed. A name that is a near-match (edit distance 1, or equal after homoglyph, hyphen and digit folding) to an existing page, a reserved name, or a brand word is held for Super Admin approval before its first publish. Generic and place words (`gym`, `fitness`, `yoga`, `cameroon`, …) are held for approval too. The word lists live in a table Super Admin maintains, seeded from addendum J. A held name is decided within 2 business days and the Owner sees "name under review" meanwhile.

**FR-203** — A name is claimed first come, first served by the Owner, one name per gym, and **stays reserved to that gym while the page is unpublished or suspended**, up to 12 months. A gym may rename at most twice in any rolling 12 months, counted whatever the publish state; Super Admin forced renames and overrides do not count. After a rename the old name redirects (301, one hop) to the current name for 12 months, then is released. The name of a page taken down under FR-204 is never released: it stays reserved to that gym. Redirects are dropped immediately on a takedown or force-rename and are served with a cache lifetime of at most 5 minutes.

**FR-204** — Super Admin can take a page down with a reason code (impersonation, illegal content, trademark, misleading content, privacy, other). A takedown blocks republishing until lifted and tells the Owner why. Visitors can report a page from a public form; reports are answered within 5 business days `[ASSUMPTION]`; the Owner has an appeal path to Super Admin. No page is moderated before publishing.

**FR-205** — Gym content is rendered as text only; no HTML or script from a gym reaches the page, and structured data is built by a serializer that escapes markup. Uploaded images are re-encoded to JPEG, WebP or PNG with metadata (including location) removed, bounded in size, dimensions and count, served from a separate cookieless origin, and purged when the page is unpublished or the image deleted. The uploader attests they may publish the image. Image addresses are opaque and carry no internal identifier.

**FR-206** — The public site reads only a **published projection** and never tenant tables (NFR-024). The projection is a defined field list: page name, gym name, category, logo, banner, about, services, public plans and session plans (name, price, duration), address and optional map position, opening hours, public contact, gallery, country, city, primary color, template, and last-updated time. It exposes no internal identifiers, no `gym_token`, and no login-phone.

**FR-207** — A page that is unpublished, taken down, or belongs to a suspended gym returns the same not-found response and leaves the address, directory and sitemap within 60 seconds at the origin; CDN copies are purged within 5 minutes and the sitemap is regenerated within 15 minutes `[ASSUMPTION]`. It returns when the gym is active and the page published again, unless a takedown is in force.

**FR-208** — Page chrome (labels, navigation, structured-data fields) is available in English and French; gym-entered content is shown as entered, so language alternates are only declared where translated content exists. `[ASSUMPTION — OQ-28]`

### 6.32 Directory & Discovery — V1.7

**FR-209** — Country is chosen from the ISO country list and city from a controlled list with alias normalization (accents, spelling, case); a new city is added by Super Admin. Place slugs in addresses are ASCII-folded.

**FR-210** — GymOS publishes a **directory** on the main website: a section per country with at least one published gym, with city listings below it, built only from published pages (FR-206). Any published gym is listed regardless of country; Cameroon is the only country with a prominent entry point at launch. No Cameroon-only assumption appears in addresses, copy, or structured data.

**FR-211** — Search and AI-search optimization is a first-class requirement with verifiable outcomes: every page's and listing's structured data (`LocalBusiness` / `HealthClub`) validates with zero errors in the schema.org validator; the sitemap lists exactly the pages that are indexable; canonical addresses are defined for filtered views; social-sharing metadata is present; and a plain-text site summary for AI crawlers lists each published gym's name, category, city, hours and public plans.

**FR-212** — A country or city listing with fewer than 3 published gyms is excluded from search indexing and from the sitemap `[ASSUMPTION — OQ-29]`. At launch, with few gyms, only individual pages are expected to be indexed.

**FR-213** — Amendment to FR-172. The directory can be filtered by gym category (FR-171), and the category label appears on the public page. The category remains descriptive for behavior, plan types and permissions. Category changes are audited.

**FR-214** — A gym that unpublishes, is suspended, or is taken down leaves the directory, the sitemap and its listings within the times in FR-207.

---

## 7. Non-Functional Requirements

### 7.1 Performance

| Metric | Target |
|--------|--------|
| Dashboard page load | < 2 seconds on standard broadband |
| QR scan → front-desk alert end-to-end | < 3 seconds under normal network conditions |
| Offline check-in sync | Queued check-in syncs within 10 seconds of connectivity restore |

### 7.2 Security & Data Integrity

**NFR-001** — Multi-tenant data isolation is enforced at the PostgreSQL layer via RLS. Every query against tenant data must pass through RLS-governed policies. The JWT role claim injection hook (FR-003) is spiked in week one, before any RLS policies are written — a misconfigured hook defaults to deny-all and silently blocks all authenticated users.

**NFR-002** — Payment webhook endpoints validate the Notch Pay request signature before processing. Unsigned or invalid webhook payloads are rejected with HTTP 401.

**NFR-003** — Monetary values are stored as integers with an explicit currency column. Floating-point types are not used for any monetary field.

**NFR-004** — The audit log is append-only by design. No migration, script, or application code may issue UPDATE or DELETE against audit records.

**NFR-012** — The Tara Money cutover (FR-102) must produce zero double-charges and zero lost payments, verified by the reconciliation job reporting zero discrepancies before Notch Pay is stood down as primary.

**NFR-013** — Staff provisioning and role editing (FR-087, FR-089) must make privilege escalation impossible: no role can create *or edit a target into* a role equal to or above its own, and no role can edit its own role, enforced at the RLS/auth-hook layer. CI asserts an Owner cannot mint or promote-to a Super Admin, a Supervisor cannot mint or promote-to a Supervisor or Owner (including on themselves), and a Manager cannot mint or edit staff roles at all.

**NFR-017** — Per-gym Tara Money credentials (FR-126) are stored encrypted at rest (Supabase Vault), accessible only to the server-side payment service, never returned to any client, never logged, never readable across tenants. They carry the same isolation guarantees as all tenant data (NFR-001).

**NFR-018** — Tenant suspension for SaaS non-payment (FR-131/FR-132) is enforced at the authorization layer, not only the UI: a suspended gym's staff and members are denied at the RLS/auth-hook layer, so suspension cannot be bypassed by a client ignoring UI state. Takes effect on the next request; no tenant data is deleted or mutated.

**NFR-019** — FR-125's "GymOS takes no commission on member→gym payments" is auditable, not merely asserted: every Flow A payment's settlement account is verifiable against its gym's connected credentials (FR-126) via the audit log, so a platform-account credit from a Flow A transaction is detectable after the fact, not just prevented in theory.

**NFR-020** — In-app Super Admin creation/promotion (FR-141) must make privilege escalation impossible: the action is only reachable by an authenticated Super Admin session, the underlying RPC self-enforces the caller's `is_super_admin` status server-side (not merely hidden in the UI), no self-promotion path exists for a non-Super-Admin, and every create/promote action is audit-logged with actor, target, and timestamp — mirroring NFR-013's discipline for staff-role provisioning.

**NFR-021** — Paid-session consumption (FR-159) is atomic and enforced in the database, not only in application code. A member-level lock covers the whole sequence "find a covering consumed session, otherwise consume one, award the stamp, maybe grant a free session", so that: a session is never consumed twice, a member never has more than one session consumed per gym-local day, two simultaneous scans cannot both consume a different session, and a concurrent scan is never wrongly blocked because another scan holds the only session. A replayed offline sync (FR-161) never consumes a second session. Enforcement holds for every entry path — member app, offline sync, and any dashboard or script — so the rule cannot be bypassed by an older app build.

**NFR-022** — Loyalty accounting (FR-165–FR-168) is derived from the recorded events that earn it and is idempotent: a duplicated webhook (FR-035), a retried request, or a replayed sync grants a stamp or reward at most once per qualifying event. Stamp earnings are performed in the same transaction as the event that earns them, and stamps, free sessions, and every reset or lapse are reconstructible from the audit log. Loyalty state is per member per gym and never readable across gyms (NFR-001).

**NFR-023** — Authorization is verified against **current state** on every request, for every role that reaches a gym, support included: membership, role, deactivation, the support assignment and opt-out, and the second-factor level (FR-189, FR-192). A role or gym carried in the access token is never the sole basis for a decision. This applies to RLS policies, RPCs, edge functions and service-role paths, all through one shared check. A generated inventory of every policy, RPC and function that reads the role or gym claim is part of the support-release gate, and a CI check fails the build on any that decides from the claim alone. Role-check patterns are null-safe, and payment inserts verify that the member belongs to the gym.

**NFR-024** — The public site (landing pages and directory) is isolated from tenant data: it reads only the published projection (FR-206), runs with no privileged database credential, and a test proves the unauthenticated role has no privilege on any other relation or function. The projection's column list is pinned by a snapshot test that fails on change. A defect in the public site cannot expose a member, a payment, or an unpublished field (extends NFR-001).

**NFR-025** — Public pages and directory listings are server-rendered and fast: the field-measured 75th-percentile largest content paint is within 3 seconds on a mid-range Android phone on 4G, for the launch template and for directory pages. `[ASSUMPTION — target to confirm with a measured baseline]`

**NFR-026** — Because gym-authored pages share a registrable domain with the staff login, authentication cookies for `owner.` and `portal.` are host-only (never scoped to `.gymosapps.com`) and use the `__Host-` prefix, so a sibling subdomain cannot set or overwrite them; public pages send a strict content security policy with no inline script; and a security-header test is part of the landing-page gate. A separate domain for gym pages is the fallback if any of these cannot be met.

### 7.3 Availability

**NFR-005** — V1 availability is covered by Supabase Cloud and Vercel managed SLAs. No additional uptime commitment is made until commercial scale.

**NFR-006** — The member app supports offline QR check-in only. Offline check-ins are queued in SQLite and sync on reconnect. No other flows require or support offline operation in V1.

### 7.4 Observability

**NFR-007** — Sentry is integrated on both the mobile app and the admin dashboard in V1. Error events from both surfaces are routed to a single Sentry project with environment tagging (dev / staging / prod).

**NFR-008** — **Superseded by NFR-014.** PostHog was deferred at V1.0; V1.5 activates it.

**NFR-014** — PostHog product analytics is integrated on app and dashboard, focused on the V1.5 metrics (Section 3.2), carrying no body-measurement or photo content into events. Same environment tagging as Sentry (NFR-007).

### 7.5 Testing

| Area | Approach | Version |
|------|----------|---------|
| JWT role claim hook | Spiked in sprint 1; verified before any RLS policy is written | V1 |
| RLS policies | Automated CI tests against multi-gym fixtures; cross-tenant and role-boundary edge cases | V1 |
| Payment flows | Integration tests against Notch Pay sandbox: auth, initiate, webhook, idempotency | V1 |
| Mobile app | Manual QA on physical Android device before each release; iOS via TestFlight | V1 |
| Dashboard | Manual QA in V1; no automated E2E (team too small, surface too volatile) | V1 |
| E2E automation | Baseline established (NFR-015): staff provisioning + role enforcement, the payment cutover path, progress-data access boundaries, class booking capacity limits. Complements, not replaces, V1 CI gates | V1.5 |
| CI gate | RLS tests + payment integration tests + TypeScript type checks on every PR | V1 |

**NFR-015** — An E2E test automation baseline is established, covering the four priority flows listed above.

### 7.6 Scale Targets

**NFR-009** — Pilot scale: ~30 members per gym, 1–3 gyms. Architecture must support scaling to hundreds of gyms and thousands of members per gym without schema changes or RLS rework.

### 7.7 Infrastructure

**NFR-010** — The Supabase project must be provisioned in a region geographically close to West/Central Africa. EU West (Ireland or Frankfurt) is the recommended selection. US East adds 200–400ms of intercontinental latency on top of Cameroonian mobile network jitter, making the &lt;3s front-desk alert target (FR-052) difficult to meet. Region selection must be confirmed before any Supabase project is created — it cannot be changed after data is written.

### 7.8 Data Privacy — Progress Data (V1.5)

**NFR-011** — Progress photos (FR-094) are stored in Supabase Storage under access rules mirroring FR-095: retrievable only by the owning member and, if shared, their assigned coach. Object paths are non-guessable; no photo is served from a public bucket — a new, dedicated bucket, separate from the existing public `member-photos` bucket used for profile photos (Story 2.6). Signed URLs are short-lived enough that revoking a photo's sharing (FR-095) invalidates access within that same window — no long-lived signed URL survives a revoke.

**NFR-016** — Coach access to member progress data — both the assignment relationship and each photo's per-photo sharing flag (FR-095) — is re-verified on every request against current state; an ended assignment or a revoked photo-share revokes read access with no caching window that outlives either.

---

## 8. Out of Scope

The following are explicitly deferred. Nothing below may be added to scope without an explicit decision recorded in `.memlog.md` (see also the legacy `.decision-log.md`).

| Item | Target Version |
|------|---------------|
| Self-serve gym signup | Post-V1.5 |
| Travel mode plan type | V2.0 |
| Pay-per-session per-visit charging | **Moved into V1.6** (FR-156–FR-163; OQ-16 resolved) |
| Gym landing pages, the template module, per-gym subdomains | **Moved into V1.7** (FR-196–FR-208) |
| Country-by-country gym directory and SEO / AI-SEO | **Moved into V1.7** (FR-209–FR-214) |
| GymOS support staff (Super Admin-assigned, one collapsed "GymOS Support" row for the Owner, full configuration and transactions incl. Tara Money, TOTP second factor; amends FR-072) | **Moved into V1.7, ships first** (FR-175–FR-195) |
| Template library beyond the launch template; per-gym custom domains; page analytics; booking or payment on the public page | After V1.7 |
| Gym-entered content in more than one language per field | Later (OQ-28) |
| Dual control (a second approver) for support assignment and second-factor reset | Later, when the platform team has a second Super Admin (FR-191) |
| Content moderation tooling beyond report, takedown and appeal (FR-204) | Later |
| Category-specific behavior, wording, or plan types (FR-172) | Not in V1.7 (category stays descriptive; decided 2026-10-15); later, with studio feedback |
| Attendance-based rewards for subscribers (e.g. N visits in a month) | Later, after V1.6 proves the renewal rule |
| Discount or percentage rewards; referral rewards | Later — would touch payment amounts (FR-164) |
| Cross-gym or platform-wide loyalty cards | Not planned — the card is per gym (FR-164) |
| Manual stamp or reward adjustment | Not planned (FR-170); reversal on refund only (FR-162) |
| Push notification on earning a reward; gym-configurable expiry windows | Later (FR-169, FR-168) |
| Mobile app and dashboard redesign; hundreds of gym templates | After V1.7, with the design-reference subscription |
| Campay payment provider integration | V2.0 |
| Provider-executed refund API calls | V2.0 |
| Coach-to-receptionist escalation for expiring clients | V2.0 |
| Class waitlists (auto-promote when a spot frees) | V2.0 |
| Nutrition / meal logging | V2.0 |
| Progress data export (member downloads history) | V2.0 |
| Streaks, challenges, leaderboards, activity feed | V2.0 |
| Live multi-currency payments beyond XAF | V2+ |
| Gym-owned merch store | V2.5 |
| Platform-wide marketplace | V3.0 |
| Geofence / Bluetooth / WiFi presence detection | V3.0 |
| Per-gym App Store listings | V4+ |
| Custom fonts, full theme systems | V4+ |
| AI features, wearables, corporate wellness | V4+ |
| Dokploy / VPS services | Decision pending |

**Explicit non-goal (privacy model, not a temporary limitation):** Manager/Owner visibility into member progress data is **not planned**. The member + assigned-coach boundary (FR-095) is a product commitment. Any future change requires a recorded decision and member consent handling.

---

## 9. Open Questions

| # | Question | Owner | Blocker for |
|---|----------|-------|-------------|
| OQ-1 | **Resolved** — 3 default tiers: Hustle (1–30 members), Grind (31–100), Elite (>100). Same features across all tiers; member count is the only differentiator. Prices are Super Admin configurable (no hardcoded values). Super Admin can add new tiers. See FR-073, FR-086. | — | — |
| OQ-2 | Notch Pay sandbox spike — must be completed in sprint 1. Exit criteria: sandbox auth, payment initiation, webhook receipt, idempotency test all passing. Outcome recorded in `docs/decisions.md`. If spike fails, payments Epic does not begin until an alternative is validated. | Dev team (sprint 1) | Payments Epic |
| OQ-3 | **Resolved** — 3 days confirmed. | — | — |
| OQ-4 | **Resolved** — Travel mode plan type deferred to V2.0. See `.decision-log.md` entries #4 and #16. | — | — |
| OQ-5 | **Resolved** — 8-hour default confirmed (changed from assumed 4 hours). | — | — |
| OQ-6 | **Resolved** — 30-minute default, gym-configurable (changed from assumed 15 min fixed). | — | — |
| OQ-7 | **Resolved** — re-verification spike passed in full against GymOS's own now-activated business account (`9FmIZg9GBB`), replacing the stand-in account the 2026-07-31 spike passed against (`docs/decisions.md`, 2026-08-13, Story 4.10). Auth+initiate, webhook delivery, and idempotency all confirmed against the real account. **Not yet resolved:** actually routing real member payments through this account is Story 4.12's cutover, still `backlog` — full production reliance on Tara Money (FR-100) remains gated on that separate step. | — | Story 4.12 cutover (backlog) |
| OQ-8 | **Resolved** — no retention/purge policy for progress photos at beta scale; matches this codebase's existing accepted-unbounded-growth convention (`job_runs`, `audit_log`, `otp_resend_attempts`). Revisit if real storage cost emerges. | — | — |
| OQ-9 | **Resolved** — fixed, simplest rule: any member with an active subscription, on any plan type, can book a class. No per-plan class-eligibility flag. | — | — |
| OQ-10 | **Resolved** — all five FR-094 measurement fields ship (waist, chest, hips, arms, thighs); the schema already needs to support all five per FR-094's "any subset" wording. | — | — |
| OQ-11 | **Resolved** — no co-owners; one Owner per gym for the beta. | — | — |
| OQ-12 | WhatsApp/Evolution API compliance and number provisioning; messaging limits and sender identity. | Dev team | FR-117–FR-119 (Stories 2.9/2.10, backlog) |
| OQ-13 | **Resolved** — Tara Money's create-collect + payment-detection flow is confirmed callback/webhook-driven, not poll-based (consistent across every spike to date). The real webhook payload's `businessId` field matched the initiating account (`9FmIZg9GBB`, distinct from the prior stand-in), which is attribution/correlation evidence for per-gym `businessId`/credential scoping (`docs/decisions.md`, 2026-08-13, Story 4.10) — informs but does not by itself confirm fund settlement; Story 4.13's per-gym credential design (AD-15) should independently verify settlement. | — | FR-124, FR-126, FR-128; Story 4.13 |
| OQ-14 | **Resolved** — Tara Money (mobile money) does not support automated recurring debits. Flow B billing for V1.5 is a reminder-to-approve model: GymOS notifies the Owner when payment is due and the Owner completes the charge via Tara Money each cycle. True automated recurring collection is deferred to a future version, pending a card-based provider (e.g. Stripe). See FR-130, FR-133. | — | — |
| OQ-15 | **Resolved** — no proration on mid-cycle SaaS tier change; the new price applies at the next billing cycle. | — | — |
| OQ-16 | **Resolved (2026-10-11)** — per-visit charging is specified in FR-156–FR-163. The plan's price is the session price; payment at the desk or in-app creates a paid session; an unpaid check-in is denied and alerted to the front desk (the PM recommendation held — no receivables ledger, no "owe later"); offline check-ins are validated on sync and flagged if unpaid (FR-161). A per-gym setting, off for existing gyms, controls rollout (FR-157). | — | — |
| OQ-17 | **Reactivated member and the registration fee.** Does a member who is deactivated (FR-083) and later reactivated, or re-created, pay the fee again? Deferred by decision (2026-10-07). No reactivation capability is specified today, so this matters only once one is. | Product owner (smartsana) | Nothing; revisit when reactivation is specified |
| OQ-18 | **Resolved** — members in the awaiting registration fee state count toward the gym's member cap (FR-073), decided 2026-10-07 (see FR-148). | — | — |
| OQ-19 | **Resolved (2026-10-11)** — keep the per-guest waiver, with a one-tap "Session guest" preset reason; no auto-waive until a pilot gym asks (FR-156). | — | — |
| OQ-20 | **Resolved (2026-10-11)** — the offline policy is settled in FR-161 (saved locally, validated on sync, flagged if unpaid); only the screen wording is left to the UX specification. | — | — |
| OQ-21 | **Resolved (2026-10-11)** — on time means verified by the end of the day after expiry (one-day allowance, because mobile money is paid by hand), non-consecutive, one stamp per subscription period (FR-167). | — | — |
| OQ-22 | **Resolved (2026-10-11)** — a refund of a consumed session reverses the stamp it earned and never takes back a free session already earned; renewal refunds do not reverse stamps or days; no manual correction (FR-162, FR-170). | — | — |
| OQ-23 | **Resolved (2026-10-11, confirmed 2026-10-15)** — no per-category wording in V1.6; at V1.7 planning the category stays descriptive: directory filter and page labels only, no wording, behavior or plan-type changes (FR-172). | — | — |
| OQ-24 | **Resolved (2026-10-15)** — public site built in `apps/landing`; minimum publish content, reserved names and impersonation policy, claim and rename rules, directory geography, SEO ownership and per-plan public opt-in decided (Section 12 F). | — | — |
| OQ-25 | **Resolved (2026-10-11)** — class attendance by a Pay-per-session guest requires and consumes a paid session under the same rule as check-in (option a); booking stays free; the same session covers floor and class that day (FR-174). | — | — |
| OQ-26 | **Resolved (2026-10-11)** — V1.7 support staff may do everything gym staff can, transactions included; support is on by default and a gym may opt out; support accounts require a second login factor (Section 12 E). **Method resolved (2026-10-15): TOTP authenticator app via Supabase MFA, enforced at AAL2 in the database.** | — | — |
| OQ-27 | **Resolved (2026-10-15)** — TOTP enrollment is enabled on the production Supabase project (product owner); an enrollment check is part of the Step 1 gate (FR-189). | — | — |
| OQ-28 | **Landing page content language** — whether a gym enters content in one language or both, and how the page chooses (FR-208). | Product owner | Before landing-page stories |
| OQ-29 | **Directory thin-page threshold** — default 3 published gyms per listing (FR-212); confirm or change. | Product owner | Before directory stories |
| OQ-30 | **Opt-out semantics** — default as written: switching "Allow GymOS Support" off suspends assignments, switching on re-activates those that were active, and assignments made while off stay pending (FR-177, FR-183). Confirm. | Product owner | Before support stories |
| OQ-31 | **Legal review** — liability terms for support actions (FR-187), publishing a gym's phone and address (FR-197), and support access to member data under the applicable data-protection law. | Product owner, counsel | Before release of step 1 and step 2 |

---

## 10. Release Definition — "Beta-Ready" (V1.5)

V1.5 is beta-ready when a gym the founding team has not personally hand-held can:

1. Be created by GymOS (founder-onboarded), then staff itself — add its own Supervisor, Manager, Receptionist, and Coach — with no support ticket (FR-087–FR-092).
2. Take real payments through Tara Money, with the cutover proven clean (FR-099–FR-103, NFR-012).
3. Run the retention loop end to end: front-desk alert (V1.0) plus members returning to the app between visits to log progress (FR-093–FR-098).
4. Operate its weekly rhythm — classes scheduled and booked, workout plans assigned (FR-104–FR-112).
5. Collect its own GymOS platform subscription from gyms via the reminder-driven, Owner-approved billing model (OQ-14, resolved), with zero missed cycles and zero cross-account leakage (FR-130–FR-140, NFR-019, G-12) — the OQ-7 re-verification against GymOS's own activated Tara Money business account is done (resolved), still gated on Story 4.12's cutover before production reliance.
6. Do all of the above bilingually, offline-tolerant where FR-097 requires, with PostHog showing whether the loops work and E2E tests guarding critical paths (NFR-014, NFR-015).

This gate is additive on top of V1.0's already-shipped goals (Section 3.1, G-1–G-6) — a scope layer, not a replacement. Everything in Section 8 is deliberately out, so the beta ships on time rather than growing into V2.

### 10.1 Release Definition — V1.6

V1.6 is done when a gym already running V1.5 can, without founder help:

1. Turn on "Charge guests per session" and see that a guest's scan is not recorded as a visit without a paid session — paid at the desk or in-app — and that the front desk is alerted, while members on every other plan are untouched (FR-157–FR-160, NFR-021). A guest marked attended at a class is held to the same rule (FR-174).
2. Have a gym that does *not* turn it on see no change at all in check-in behavior (FR-157).
3. See, on the Overview, how many guest sessions were paid, blocked, and given free (FR-163).
4. Turn on the loyalty program, set N, K, and R, and watch a guest earn and spend a free session and a subscriber earn free days, each exactly once, with every grant audited (FR-164–FR-170, NFR-022).
5. Be created or edited with a category, with existing gyms unchanged and defaulting to Gym / Salle de sport (FR-171–FR-172).
6. Do all of the above in English and French, with the new rules covered by database-level tests and the E2E baseline (NFR-014, NFR-015).

Section 12 is explicitly **not** part of this gate.

### 10.2 Release Definition — V1.7

V1.7 ships in order, and each step has its own gate. Step 1 must be done before step 2 starts.

**Pre-flight (before support stories).** TOTP enrollment is enabled on the production Supabase project (confirmed by the product owner 2026-10-15, formerly OQ-27); OQ-30 and OQ-31 are answered; existing Owners have been told about support access (FR-183); the Super Admin account has enrolled its second factor with its recovery mechanism in place and the out-of-band recovery is documented (FR-191).

**Step 1 — GymOS support staff (ships first).** Done when:
1. A Super Admin, signed in at AAL2, can create a support person by invite link, assign them to several gyms, and assign several support people to one gym, and the person sees only assigned gyms (FR-175–FR-178, FR-191).
2. A support person cannot do anything in any gym without a verified second factor, in the database or in any edge function or service path, and an older client build cannot bypass it (FR-189, NFR-023).
3. The Owner sees one "GymOS Support" row, one on/off control and the three states; an opt-out, an unassignment, a removal or a lock is refused on the person's next request; in-flight work completes or rolls back (FR-182–FR-185, FR-192).
4. Connecting or replacing a gym's payment account requires the Owner's confirmation of a hash-bound proposal, and every payment-connection change notifies the Owner immediately, with refunds, waivers and staff creation in the daily summary (FR-180, FR-181).
5. Every support action is audited under the individual and shown to the gym as "GymOS Support"; a test per surface proves no gym-side read returns an individual identity (FR-186, FR-187).
6. The allow-list is enumerated and every denied capability has a negative test (FR-179).
7. Support is excluded from staff counts, role caps, notifications and metrics, tested both ways (FR-188).
8. The generated claim-read inventory is empty of claim-only decisions and the CI check is on; the payment policies are included (NFR-023).
9. Existing gyms start with support off; new gyms start with it on (FR-183).
10. Invite enrollment, factor reset with cooling-off, and the Super Admin second factor with its bootstrap work as written and are covered by tests (FR-176, FR-190, FR-191).
11. A Super Admin cannot hold or be assigned a support account (FR-193); attribution columns hold per-gym opaque identifiers (FR-186); the velocity limit locks an account (FR-181); assignment and the Owner's switch are serialized (FR-177).

**Step 2 — Landing pages.** Done when a gym can enter its content, choose public plans, claim a name that passes the rules, publish once the gate passes, swap templates, rename with redirects, and be taken down; unpublish and suspension behave within the stated times; the public site is shown by test to read only the projection; the security-header test passes (FR-196–FR-208, NFR-024, NFR-026).

**Step 3 — Directory.** Done when published gyms appear in country and city listings filtered by category with structured data that validates, thin listings are not indexed, and unpublished or suspended gyms leave the directory (FR-209–FR-214).

All three steps are delivered in English and French with database-level tests and the E2E baseline (NFR-014, NFR-015).

---

## 11. Glossary

| Term | Meaning |
|------|---------|
| RLS | Row-Level Security — PostgreSQL's per-row access control, the primary tenant/role isolation mechanism (FR-005, NFR-001) |
| JWT | JSON Web Token — carries the `gym_id`/`role` claims used for authorization (FR-003) |
| OTP | One-time password, sent via SMS/WhatsApp for phone verification (FR-002) |
| XAF | Central African CFA franc — GymOS's only supported currency in V1.0/V1.5 (FR-026) |
| MoMo | Mobile Money (MTN Mobile Money / Orange Money) |
| SaaS | Software-as-a-Service — here, specifically GymOS's own platform subscription fee charged to gyms (Flow B, FR-130) |
| Flow A / Flow B | The two payment directions in 6.20: Flow A is member→gym, Flow B is gym→GymOS |
| FR / NFR | Functional Requirement / Non-Functional Requirement — stable, never-renumbered IDs (Section 6/7 header note) |
| E2E | End-to-end (test automation), NFR-015 |
| RPC | Remote Procedure Call — a Postgres function invoked from application code, e.g. the staff-creation function (addendum D) |
| Registration fee | One-time, flat, per-gym fee a new member must settle (pay or have waived) before getting member-app access and a plan; 0 XAF by default (FR-147–FR-155) |
| Awaiting registration fee | A member state: the member record exists, but the app is unavailable and no plan can be assigned until the fee is settled (FR-148) |
| Session guest | An ordinary member on a Pay-per-session plan; not a separate account type (FR-156) |
| Paid session | One recorded purchase of a session at the guest's plan price, consumed by the first check-in of a day and covering the rest of that gym-local calendar day; an unused one lapses after 7 days (FR-158, FR-159) |
| Charge guests per session | The per-gym setting that makes a paid session required at check-in; off for existing gyms, on for new ones (FR-157) |
| Stamp | One unit of loyalty progress: a consumed paid session for a guest, an on-time renewal for a subscriber (FR-165, FR-167) |
| Free session | A session with no payment, earned after N guest stamps and consumed like a paid one; valid 60 days (FR-166) |
| Gym category | Descriptive business type chosen at gym creation: Gym / Salle de sport, Studio Pilates, Studio Yoga, Fitness Center, Autre (FR-171) |
| Support person | A GymOS platform account assigned by Super Admin to one or more gyms, holding a Supervisor-scope staff membership flagged as support in each; never the Owner (FR-175–FR-178) |
| GymOS Support (row) | The single entry the Owner and staff see in place of any individual support person (FR-182) |
| Pending assignment | A support assignment made while a gym's support switch is off; it activates only after a Super Admin confirms it (FR-177) |
| AAL2 | The elevated authentication assurance level reached after a second factor is verified; the only level at which a support or Super Admin session works (FR-189, FR-191) |
| TOTP | Time-based one-time password from an authenticator app, the support and Super Admin second factor (FR-189) |
| Landing page | A gym's optional public page at `{name}.gymosapps.com` (FR-196) |
| Published projection | The narrow, read-only, anon-safe view of gym content that the public site reads instead of tenant tables (FR-206) |

---

## 12. V1.7 — Decisions, Delivery Order & Open Assumptions

Section 12 started as the V1.7 backlog recorded on 2026-10-11. V1.7 planning ran on 2026-10-15; the requirements are FR-175–FR-214 (6.30–6.32). This section keeps the decisions behind them, the delivery order, and the assumptions index. The detailed list of inherited work from the deferred-work triage is in addendum section I.

**Delivery order (decided 2026-10-15, product owner):** E, GymOS support staff, ships first, before landing pages (C) and the directory (D). Its prerequisites ship inside it: the live-authorization retrofit that completes FR-090, and the AAL2 gate (Section 10.2).

**C — Gym landing page:** FR-196–FR-208. **D — Directory and discovery:** FR-209–FR-214. **E — GymOS support staff:** FR-175–FR-195.

**E — decisions (2026-10-11, refined 2026-10-15):**
- Many-to-many assignment; the Owner sees one collapsed "GymOS Support" row and one "Allow GymOS Support" control. Removing an individual is Super Admin only; the individual's name is visible to Super Admin only.
- Second factor: TOTP via Supabase MFA, AAL2 enforced in the database and in every edge function and service path, forced enrollment by invite link, audited Super Admin reset. Chosen because staff sign in by phone or email, so a code sent over either channel is not an independent factor for everyone, and TOTP has no delivery cost. Super Admin also requires AAL2 (FR-191), switched on only after a controlled bootstrap, with a designed recovery mechanism and a documented out-of-band recovery until a second Super Admin exists.
- Connecting or replacing a gym's payment account always needs the Owner's confirmation of a hash-bound proposal (FR-180). Chosen after the V1.7 reviews found that one support account could otherwise redirect every assigned gym's member payments with no Owner-visible trace, and that confirming only replacements left every new gym open.
- Support starts ON for new gyms and OFF for existing gyms until the Owner enables it (FR-183), following the V1.6 precedent (FR-157).
- A hidden account was rejected on 2026-10-11 because it would need filtering from every staff list, count, notification, and metric; one flagged membership and one row is that cost paid once.

**F — OQ-24 resolutions (2026-10-15):** the public site is built in `apps/landing` (the `www.` Vercel project) and reads only the published projection; the `*.gymosapps.com` wildcard attaches to that project, and `owner.` and `portal.` stay explicit records. Pages stay on `gymosapps.com` for brand and search value, with host-only authentication cookies, a strict content security policy, text-only rendering, and gym images on a separate origin (FR-205, NFR-026); a separate domain is the fallback if those cannot be met. GymOS owns the SEO surface; the gym owns the content.

**G — Assumptions index** (each is tagged `[ASSUMPTION]` where it appears; confirm or change before the stories that depend on it):

| Where | Assumption | Confirm in |
|-------|------------|-----------|
| FR-181 | Velocity limit: 10 per hour per gym, 20 per hour per account, 3 payment-connection proposals per day per gym | Step 1 stories |
| FR-183, FR-177 | Opt-out suspends assignments; assignments made while off stay pending | OQ-30 |
| FR-184 | Live subscriptions and signed links stop within 60 seconds | Step 1 stories |
| FR-185 | Auto-disable after 30 days inactive; quarterly recertification | Step 1 stories |
| FR-190 | 30-minute cooling-off before a factor reset completes | Step 1 stories |
| FR-187 | Disclosure request answered within 3 business days | OQ-31 |
| FR-189 | Support session 8 h max, 15 min idle, step-up within 5 min | Step 1 stories |
| FR-204 | Reports answered within 5 business days | Step 2 stories |
| FR-207 | 60 s at origin, 5 min CDN purge, 15 min sitemap | Step 2 stories |
| FR-208, FR-211 | Page chrome EN/FR, content as entered | OQ-28 |
| FR-212 | Listing indexed from 3 published gyms | OQ-29 |
| NFR-025 | p75 LCP 3 s on mid-range Android, 4G | Step 2, after a measured baseline |
| Section 3.2 | Adoption and discoverability targets; set-up effort baseline | Release planning |
| UJ-12, UJ-13, UJ-14 | Narratives are drafted, not user-contributed | Before UX |

**Not planned for V1.7 and recorded elsewhere:** mobile app and dashboard redesign and the large template library (Section 8).
