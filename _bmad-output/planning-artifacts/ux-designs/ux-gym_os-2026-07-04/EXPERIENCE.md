---
name: GymOS
status: final
created: 2026-07-04
updated: 2026-10-11
sources:
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md
design_spine: DESIGN.md
---

# GymOS — Experience Spine

> Implementation-ready UX specification for frontend developers.
> Covers four surfaces: Member App (React Native / Expo), Gym Admin Dashboard (Next.js),
> Coach Portal (role-gated section within Admin Dashboard), and Super Admin Dashboard
> (separate Next.js app). This spine governs behavior, layout, and interaction.
> Visual tokens live in `DESIGN.md`.

---

## Foundation

| Surface | Runtime | Primary Audience | Primary Device |
|---|---|---|---|
| Member App | React Native + Expo (iOS + Android) | Gym members | Android mobile, portrait |
| Admin Dashboard | Next.js web app | Receptionist, Manager, Supervisor, Owner, Coach | Desktop browser |
| Super Admin Dashboard | Next.js web app (separate URL + auth) | GymOS platform staff | Desktop browser |

**Localization.** All UI strings, push notification copy, and error messages are available in English (EN) and French (FR). Language resolves in priority order: (1) user-saved preference stored on the account, (2) device/browser locale, (3) EN fallback. No string is hardcoded in the UI — all strings flow through the i18n layer. Date and monetary values follow locale conventions (e.g., "25 000 XAF" in FR; "25,000 XAF" in EN).

**Authentication.** Members authenticate via phone + OTP. Admin dashboard users (Owner, Manager, Receptionist, Coach) authenticate via email + password. Super Admin users authenticate via a separate credential flow on the Super Admin dashboard URL. All authenticated sessions carry a JWT with custom claims (`gym_id`, `role`) injected by the Supabase auth hook. A missing or malformed claim defaults to deny-all; the UI shows "You don't have permission to do that."

**Role-based rendering.** Navigation items, action buttons, and columns the current user cannot access are hidden — not disabled and not visible. The only exception: status information that helps a lower-permission user do their job (e.g., a Receptionist sees a member's subscription status even though they cannot edit it).

**Monetary display.** All monetary values are integers in XAF. Display as: "25 000 XAF" (FR) / "25,000 XAF" (EN). Never show decimal places for XAF.

---

## Surface Index — All Screens

> **ID namespace note *(V1.6)*.** Screen ids `AD-nn` here are Admin Dashboard screens. The architecture spine also numbers its decisions `AD-nn`, and from V1.6 the two ranges overlap (screens AD-22/AD-23 vs. Architecture Decisions AD-22…AD-32). This spine always writes an architecture reference as "Architecture Decision AD-nn"; a bare `AD-nn` is always a screen.

### Member App

| ID | Screen | Route | Entry Points |
|---|---|---|---|
| MA-01 | Language Selection | `/onboarding/language` | App cold start, unauthenticated |
| MA-02 | Phone Number Entry | `/onboarding/phone` | After MA-01 |
| MA-03 | OTP Verification | `/onboarding/otp` | After MA-02 |
| MA-04 | OTP Lockout | `/onboarding/lockout` | After 3 failed OTP resend attempts |
| MA-05 | Profile Setup | `/onboarding/profile` | After MA-03 (new account only) |
| MA-06 | Goal Selection | `/onboarding/goal` | After MA-05 |
| MA-07 | Experience Level | `/onboarding/experience` | After MA-06 |
| MA-08 | Plan Confirmation | `/onboarding/plan` | After MA-07 |
| MA-09 | Home | `/home` | Post-onboarding; bottom tab. *(V1.6: guest status card, Rewards card, post-sync denial notice)* |
| MA-10 | Check-In (+ result states) | `/checkin` | Bottom tab; Home quick-action. *(V1.6: "Pay for your session" and "will be verified" result states)* |
| MA-11 | History (Payments / Check-ins) | `/profile/history` | Profile → History row *(V1.5: moved off the bottom tab bar, see Navigation Structure)*. *(V1.6: session payments labelled "Session")* |
| MA-12 | Profile | `/profile` | Bottom tab. *(V1.5: gains History and Notification Preferences sections)* |
| MA-13 | Plan Details | `/plan` | Home quick-action. *(V1.6: Pay-per-session variant)* |
| MA-14 | Payment Detail | `/profile/history/payment/:id` | History → payment row. *(V1.6: session receipt label)* |
| MA-15 | Progress | `/progress` | Bottom tab *(V1.5, FR-123)* |
| MA-16 | Classes | `/classes` | Bottom tab; Home quick-action for upcoming bookings *(V1.5, FR-123, FR-108)* |
| MA-17 | Pay for Session | `/pay-session` | MA-10 "Pay for your session" result [Pay now]; Home quick action [Pay for a session] *(V1.6, FR-158, Story 19.11)* |
| — | In-app Renewal *(shipped, Story 4.15; documented V1.6)* | `/renew` | Home quick action [Renew] (gym has Tara Money connected) |
| — | Awaiting Registration *(shipped, FR-155; documented V1.6)* | `/awaiting-registration` | Root guard, replaces all tabs while the registration fee is unsettled |

### Admin Dashboard

| ID | Page | Route | Min Role |
|---|---|---|---|
| AD-01 | Login | `/login` | — |
| AD-02 | Overview | `/` | Receptionist *(V1.6: Guest sessions card, Manager-plus; session revenue line; session alert variant)* |
| AD-03 | Members — List | `/members` | Receptionist |
| AD-04 | Member — Detail | `/members/:id` — **shipped as a View-mode modal on AD-03** (`MemberModal.tsx`), see AD-04 | Receptionist *(V1.6: Sessions and Rewards sections; "Record session payment" action)* |
| AD-05 | Member — Create / Edit | `/members/new`, `/members/:id/edit` | Manager |
| AD-06 | Member — Invite | Modal on AD-03 / AD-04 | Manager |
| AD-07 | CSV Import | Modal on AD-03 | Manager |
| AD-08 | Subscriptions | `/subscriptions` | Manager |
| AD-09 | Payments | `/payments` | Receptionist *(V1.6: Purpose column/filter, flagged-reason labels, session refund notices)* |
| AD-10 | Manual Payment Entry | Modal on AD-09 / AD-02 | Receptionist *(V1.6: unchanged — no Session purpose; see AD-10)* |
| AD-11 | Attendance | `/attendance` | Receptionist *(V1.6: session alert variant)* |
| AD-12 | Audit Log | `/audit` | Manager *(V1.6: new action labels)* |
| AD-13 | Settings | `/settings` | Supervisor *(V1.5: Manager-plus access — was Owner-only; gains Staff and Connect Payment Account sections)* *(V1.6: Charge guests per session, Loyalty program, Category)* |
| AD-14 | Coach Portal — Member List | `/coach` | Coach |
| AD-15 | Coach Portal — Member Detail | `/coach/:memberId` | Coach *(V1.5: restructured into tabs — Session Notes / Progress / Workout Plan)* |
| AD-16 | Staff — List | `/settings/staff` | Supervisor *(V1.5, FR-120)* |
| AD-17 | Staff — Add / Edit | Modal on AD-16 | Supervisor *(V1.5, FR-087–FR-089)* |
| AD-18 | Classes — List & Attendance | `/classes` | Receptionist *(V1.5, FR-121)* *(V1.6: guest marking refusal + in-place session payment)* |
| AD-19 | Classes — Create / Edit | Modal on AD-18 | Manager *(V1.5, FR-104)* |
| AD-20 | Coach Portal — Overview | `/coach/overview` | Coach *(V2, FR-146)* |
| AD-21 | Coach Portal — My Classes | `/coach/classes` | Coach *(V2, FR-145)* |
| AD-22 | Guest Sessions (drill-down) | `/guest-sessions?tab=paid\|blocked\|free&period=today\|month` | Manager *(V1.6, FR-163, Story 19.10)* — reached only from the AD-02 Guest sessions card |
| AD-23 | Plans | `/plans` | Manager *(shipped, undocumented until V1.6; V1.6 adds the plan-type lock, FR-173)* |

### Super Admin Dashboard

| ID | Page | Route |
|---|---|---|
| SA-01 | Login | `/login` |
| SA-02 | Gym List | `/gyms` *(V1.6: Category column)* |
| SA-03 | Gym Detail | `/gyms/:id` *(V1.6: Category, editable)* |
| SA-04 | Create Gym | Modal on SA-02 *(V1.6: required Category select)* |
| SA-05 | Platform Metrics | `/metrics` |
| SA-06 | Tier Management | `/tiers` |
| SA-07 | Billing | `/billing` *(V1.5, FR-131/FR-135)* |

---

## Information Architecture

### Member App IA

```
App — Unauthenticated
└── Onboarding (linear, no skipping)
    ├── MA-01  Language Selection
    ├── MA-02  Phone Number Entry
    ├── MA-03  OTP Verification
    │    └── MA-04  OTP Lockout  [branch: 3 failed resends]
    ├── MA-05  Profile Setup      [new account only]
    ├── MA-06  Goal Selection
    ├── MA-07  Experience Level
    └── MA-08  Plan Confirmation

App — Authenticated
├── Root guards (replace the whole tab app; checked before any tab renders)
│    ├── Awaiting Registration  [/awaiting-registration — shipped, FR-155]
│    └── Gym suspended          [/suspended — see State Patterns]
└── Bottom Tab Bar (always visible) — 5 tabs (V1.5, up from 4; see Navigation Structure for the tab-count rationale)
    ├── Tab 1: Home (MA-09)
    │    ├── → Check-In (MA-10)     [quick-action button]
    │    ├── → Plan Details (MA-13) [quick-action button]
    │    ├── → In-app Renewal (/renew)      [quick action Renew — shipped, Story 4.15]
    │    ├── → Pay for Session (MA-17)      [quick action Pay for a session — V1.6]
    │    ├── Rewards card (in-page)         [V1.6, FR-169]
    │    └── → upcoming booked classes summary [V1.5, links into Classes tab]
    ├── Tab 2: Check-In (MA-10)     [camera activates on tab entry]
    │    └── "Pay for your session" result → Pay for Session (MA-17) [V1.6]
    ├── Tab 3: Classes (MA-16)      [V1.5]
    │    └── → Class Detail / booking action
    ├── Tab 4: Progress (MA-15)     [V1.5]
    │    └── → Log Entry sheet
    └── Tab 5: Profile (MA-12)
         ├── → History (MA-11)         [V1.5: moved off the tab bar into here]
         │    ├── → Plan Details (MA-13)
         │    └── → Payment Detail (MA-14)
         └── → Notification Preferences section [in-page, unchanged from V1.0 shipped behavior]
```

### Admin Dashboard IA

```
Admin Dashboard
├── Sidebar (role-filtered; see Navigation Structure)
│   ├── Overview          → AD-02
│   │   └── Guest sessions card → AD-22 (tabs: Paid / Blocked / Free) [Manager-plus, V1.6]
│   ├── Members           → AD-03 → AD-04 (modal) → AD-05 / AD-06 / AD-07
│   ├── Plans             → AD-23                                    [shipped; documented V1.6]
│   ├── Subscriptions     → AD-08
│   ├── Payments          → AD-09 → AD-10 (modal)
│   ├── Attendance        → AD-11
│   ├── Classes           → AD-18 → AD-19 (modal)                    [V1.5]
│   ├── Audit Log         → AD-12
│   ├── Settings          → AD-13
│   │   └── Staff         → AD-16 → AD-17 (modal)  [Owner/Supervisor] [V1.5]
│   └── [Coach role only]
│       └── Coach Portal                                             [V2]
│           ├── Overview      → AD-20                                [V2]
│           ├── My Members    → AD-14 → AD-15 (tabs: Session Notes / Progress [V1.5] / Workout Plan [V1.5])
│           └── My Classes    → AD-21                                [V2]
└── Floating / Overlay
    ├── Front-Desk Alert Panel  [on AD-02, AD-11; real-time; V1.6 adds the session-required variant]
    ├── Inline Renewal Panel    [within alert or Subscriptions row]
    └── Record Session Payment Panel [V1.6; from session alert, AD-04, AD-18 refusal]
```

### Super Admin Dashboard IA

```
Super Admin Dashboard
└── Sidebar
    ├── Gyms      → SA-02 → SA-03; SA-04 (modal on SA-02)            [V1.6: Category on all three, no new page]
    ├── Metrics   → SA-05
    ├── Tiers     → SA-06
    └── Billing   → SA-07                                            [V1.5]
```

---

## Navigation Structure

### Member App — Bottom Tab Bar

**V1.5 change:** the tab bar goes from 4 tabs to 5 — Progress (MA-15) and Classes (MA-16) are added; History (MA-11) moves off the bar into a Profile section. 6 tabs was rejected as exceeding the mobile usability ceiling (iOS HIG / Material Design both cap persistent bottom-nav items around 5). History was the item folded away rather than Progress or Classes, since those two are the features V1.5 is explicitly betting on to drive non-visit-day app opens (PRD Section 3.2); History is a lower-frequency look-back action by comparison. See `.memlog.md` for the full decision record.

| Tab index | Label | Icon type | Badge |
|---|---|---|---|
| 1 | Home | House icon | Red dot if status = expired; orange dot if expiring_soon or grace_period |
| 2 | Check In | QR / scan icon | None |
| 3 | Classes | Calendar icon | None *(V1.5)* |
| 4 | Progress | Trend/chart icon | None *(V1.5)* |
| 5 | Profile | Avatar / person icon | None |

**Rules:**
- Tab bar is rendered only for authenticated users. Onboarding screens have no tab bar.
- Active tab: accent color on icon + label; no indicator bar needed (color alone is sufficient given tab labeling).
- Tapping the active tab scrolls its screen back to the top (if scrollable).
- Check-In tab (Tab 2): activates the camera immediately on tab entry without requiring any further tap.
- Deep link from SMS invite (new member): app opens → if unauthenticated → MA-01 → MA-02 with phone number from deep link pre-populated.
- Deep link for returning authenticated user: open to MA-09 (Home).
- *(V1.6)* No tab changes. MA-17 Pay for Session, `/renew`, and MA-13 are pushed full-screen routes (back arrow, no tab bar), matching the shipped `/renew` pattern. The Rewards card lives inside Home, not on its own tab.

### Admin Dashboard — Sidebar

**Dimensions:** 240px wide fixed on desktop. Collapses to 64px icon rail on tablet (768–1023px). Overlay-slide on < 768px.

**Content (top to bottom):**
1. GymOS platform logo (top, 32px height)
2. Gym name (below logo; truncated with ellipsis at 200px)
3. Divider
4. Navigation links — role-filtered (items inaccessible to the current role are absent, not shown as disabled)
5. Divider
6. Bottom section: avatar + logged-in user name + role pill; EN | FR language toggle; Logout

**Active page state:** 3px left-border accent on the active nav item; label weight bold.

**Role visibility matrix:**

*V1.5 adds the Supervisor role, inserted between Owner and Manager (`Owner → Supervisor → Manager → Receptionist → Coach → Member`). Supervisor's nav access is "Manager-plus": everything Manager sees, plus Settings and Staff — the same footprint as Owner, minus the ability to create another Supervisor.*

| Nav item | Receptionist | Manager | Supervisor | Owner | Coach |
|---|---|---|---|---|---|
| Overview | ✓ | ✓ | ✓ | ✓ | — |
| Members | ✓ | ✓ | ✓ | ✓ | — |
| Plans (AD-23) *(shipped; documented V1.6)* | — | ✓ | ✓ | ✓ | — |
| Subscriptions | — | ✓ | ✓ | ✓ | — |
| Payments | ✓ | ✓ | ✓ | ✓ | — |
| Attendance | ✓ | ✓ | ✓ | ✓ | — |
| Classes — view/attendance (AD-18) | ✓ | ✓ | ✓ | ✓ | — |
| Classes — create/edit (AD-19) | — | ✓ | ✓ | ✓ | — |
| Audit Log | — | ✓ | ✓ | ✓ | — |
| Settings (AD-13) | — | — | ✓ | ✓ | — |
| Staff (AD-16/17) | — | — | ✓ | ✓ | — |
| Coach Portal | — | — | — | — | ✓ |

*(V1.6)* Guest Sessions (AD-22) has **no sidebar item**. It is reached only from the AD-02 Guest sessions card, so it is Manager-plus by construction; a Receptionist who types the URL gets the global "You don't have permission to do that." state. Settings (AD-13) stays Owner/Supervisor as shipped, so no Manager ever sees the V1.6 Settings sections. Story 21.2's "Manager who can open Settings sees category read-only" is therefore moot; it is not built, because the shipped sidebar never gives a Manager Settings.

Coach role: the sidebar renders only the "Coach Portal" link. All other items are absent from the DOM. Selecting it enters the Portal, which carries its own sub-navigation (V2, FR-144):

| Coach Portal sub-nav | Coach |
|---|---|
| Overview (AD-20) | ✓ |
| My Members (AD-14) | ✓ |
| My Classes (AD-21) | ✓ |

My Classes is **not** the admin Classes page (AD-18/AD-19) — a Coach never reaches AD-18, cannot create or edit a class, and cannot mark class attendance. AD-21 shows only classes where `classes.coach_id` is that Coach.

**Logout:** Clicking Logout shows a confirmation inline ("Log out of GymOS?" [Log out] [Cancel]) before clearing session.

### Super Admin Dashboard — Sidebar

Same structure as Admin Dashboard sidebar. 240px fixed on desktop. Links: Gyms | Metrics | Tiers | Billing *(V1.5)*.

---

## Voice and Tone

Microcopy guide. Brand voice and visual identity live in `DESIGN.md`.

| Context | Write this | Not this |
|---|---|---|
| Front-desk alert — grace | "Amara K. — Grace period. Expires [date]. Renew now?" | "Warning: Member subscription expiring" |
| Front-desk alert — denied | "Jean B. — Access DENIED. Expired [N] days ago. Collect payment to restore access." | "Error: Subscription invalid" |
| Check-in success | "Checked in at [time]" | "Check-in recorded successfully." |
| Check-in denied | "Access denied — membership expired. Please see the front desk." | "Error 403: Subscription state invalid" |
| Already checked in | "You're already checked in. See front desk if you need help." | "Duplicate check-in detected." |
| Wrong QR | "QR code not recognised — make sure you're scanning your gym's code." | "Invalid gym token." |
| Empty list | Short + action: "No members yet. Import a CSV or add one manually." | "No data found." |
| Validation error | Field-specific: "Enter a valid phone number (e.g. +237 6 XX XX XX XX)" | "Invalid input." |
| Destructive action confirmation | Named action: "Deactivate Amara K.? They'll lose gym access immediately." | "Are you sure?" |
| Lockout | "Too many attempts. Wait 5 minutes, then try again. Contact your gym if you need help sooner." | "Maximum attempts exceeded. Account locked." |
| Offline (member app) | "You're offline — check-in still works." | "No internet connection detected." |
| Offline (dashboard) | "You're offline. Data may be outdated." | "Network error." |
| Session expired | "Your session expired. Please log in again." | "401 Unauthorized." |
| Class full *(V1.5)* | "This class is full." | "Booking failed: capacity exceeded." |
| Class booking lost the race *(V1.5)* | "That spot was just taken — try another session." | "Conflict: session at capacity." |
| Staff role-ceiling rejection *(V1.5)* | "You don't have permission to assign that role." | "Forbidden: insufficient privilege level." |
| Staff deactivation confirm *(V1.5)* | "Deactivate [Name]? They'll lose gym access immediately." | "Are you sure?" (already covered by the general destructive-action row above — listed here as the specific staff instance since it's a new, security-sensitive action) |
| Gym suspended — member-facing *(V1.5, FR-132)* | "GymOS is temporarily unavailable for this gym. Please check back later." | Anything mentioning billing, payment, subscription, or an amount owed — never shown to a member, this relationship is between GymOS and the Owner only |
| Gym suspended — Owner-facing *(V1.5)* | "Your GymOS subscription payment is overdue. Pay now to restore access for your whole team." | "Account suspended." |
| SaaS payment reminder *(V1.5, FR-131)* | "Your GymOS subscription payment is due [date]. Pay now: [link]" | Anything implying an automatic charge — mobile money isn't auto-debited, the copy must always ask the Owner to act |
| Quiet-gym alert *(V1.5, N-06)* | "[Gym name] is quiet right now — good time to train." | "Occupancy alert: low." |
| Class reminder *(V1.5, N-07)* | "Your [Class name] class starts in 1 hour." | "Reminder: upcoming event." |
| Check-in — session required *(V1.6, FR-159)* | "Pay for your session" + "You need a paid session to check in today." | "Access denied — no valid entitlement." (and never the expired copy on a current build) |
| Check-in — offline guest *(V1.6, FR-161)* | "Check-in saved — your session will be verified" | "Checked in" (a guest's offline scan is not yet a confirmed visit) |
| Offline scan denied on sync *(V1.6)* | "Your check-in on [date] at [time] wasn't counted — you had no paid session. See the front desk if this is wrong." | "Sync error: attempt rejected." |
| Front-desk alert — session required *(V1.6, FR-160)* | "Ange T. — No paid session. Record a payment so they can scan again." | "Error: guest entitlement missing" |
| Session payment recorded *(V1.6)* | "Session recorded for Ange T. Ask them to scan again." | "Payment saved successfully." |
| Charge-guests confirmation *(V1.6, FR-157)* | "12 Pay-per-session members will need a paid session at their next visit." | "This will affect some members. Continue?" |
| Rewards — free session earned *(V1.6, UJ-11)* | "Free session earned — valid for 60 days" | "Loyalty reward unlocked!" (no hype, no exclamation) |
| Rewards — free days added *(V1.6, FR-167)* | "30 free days added — your new renewal date is 14 Nov 2026" | "Your expiry date has changed." (a moved date with no reason looks like an error) |
| Session lapse *(V1.6)* | "Paid session — use by 18 Oct" | "Expires in 7d" / "Will be forfeited" |
| Plan type locked *(V1.6, FR-173)* | "This plan has members, so its type can't be changed. Create a new plan instead." | "Field locked." |
| Gym category *(V1.6, FR-171)* | The label only: "Yoga Studio" / "Studio Yoga" | Any category-specific product wording — the apps keep saying "gym" for every category (FR-172) |

**Session vs. class terminology *(V1.6, user decision 2026-10-11)*.** A paid or free day-visit is a **session** in EN and a **séance** in FR (matching the shipped plan type "Paiement à la séance"). A class is always a **class** in EN and **cours** (or "séance de cours" where an occurrence is meant) in FR, so the two never clash on one screen. In EN, V1.6 copy always qualifies the word — "paid session", "free session", "today's session", "guest sessions", "session payment" — never a bare "session" that could read as a class occurrence or a login session. When a V1.6 story touches a screen that shows a class occurrence, its FR string moves off "séance" (for example AD-18 "Prochaine séance" → "Prochain cours", "Aucune séance à venir" → "Aucun cours à venir"). Coach "Notes de séance" (AD-15) is left as is: a Coach never sees session payments, so there is no clash on that screen.

**French translations** must be exact equivalents in tone and reading level — not literal word-for-word. Both language versions are reviewed together before ship. EN and FR string counts must match on every PR.

---

## Screen Reference — Member App

> For each screen: Purpose → Layout diagram → Components → Interactions → States.

---

### MA-01 · Language Selection

**Purpose:** Member picks their display language before any account data is collected.

**Layout:**
```
┌──────────────────────────────────┐
│                                  │
│   [GymOS platform logo, center]  │
│                                  │
│   "Choose your language"         │
│   "Choisissez votre langue"      │
│   (both lines always shown)      │
│                                  │
│  ┌────────────────────────────┐  │
│  │  🇬🇧  English              │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │  🇫🇷  Français             │  │
│  └────────────────────────────┘  │
│                                  │
└──────────────────────────────────┘
```

**Components:**
- GymOS platform logo (platform brand; gym branding is not yet loaded here)
- Bilingual heading: both languages shown simultaneously so the user can identify their option without already knowing the other language
- Two full-width selection cards (flag emoji + language name in its own language)
- No back button (first screen in the flow)
- No "Continue" button — card tap is the action

**Interactions:**
- Tap either card → selects language immediately, navigates to MA-02; no confirmation step
- Pre-highlight: if device locale matches EN or FR, that card shows a subtle selected state on arrival; user can still tap the other
- Language stored as provisional preference; finalised when account is created at MA-08

**States:**
- Default: pre-highlight per device locale (or no highlight if locale is neither EN nor FR)
- No network call; no loading state; no error state

---

### MA-02 · Phone Number Entry

**Purpose:** Collect phone number to send an OTP.

**Layout:**
```
┌──────────────────────────────────┐
│  ← (back to MA-01)               │
│                                  │
│  "Enter your phone number"       │
│  "We'll send you a one-time      │
│   verification code"             │
│                                  │
│  [+237 ▾] [  phone number     ]  │
│  Helper: "+237 6 XX XX XX XX"    │
│                                  │
│  [          Continue          ]  │
│                                  │
└──────────────────────────────────┘
```

**Components:**
- Back arrow (top-left; navigates to MA-01)
- Heading + subtitle (language set in MA-01)
- Country code prefix selector (shows flag + dial code; tappable → bottom sheet with searchable list)
- Phone number text input (numeric keyboard; formats with spaces as user types)
- Helper text below input showing expected format
- "Continue" primary button (full-width, bottom of visible area above keyboard)

**Interactions:**
- Country picker: opens bottom sheet; searchable list; Cameroon (+237) is default and top of list
- Numeric keyboard opens automatically on screen entry
- "Continue" is visually enabled as soon as the input is non-empty; validation runs on submit, not on each keystroke
- On submit: spinner replaces button label; button disabled; width locked (does not shrink)
- On response: navigate to MA-03 on success

**Validation & error states:**
- Invalid format after prefix prepend: inline error below input — "Enter a valid phone number (e.g. +237 6 XX XX XX XX)"
- Number not registered in the system: inline error — "This number isn't registered at a gym yet. Contact your gym to get an invite."
- Network error: inline error — "Something went wrong. Check your connection and try again." + "Try again" link inline

---

### MA-03 · OTP Verification

**Purpose:** Verify phone ownership via 6-digit one-time code.

**Layout:**
```
┌──────────────────────────────────┐
│  ← (back to MA-02)               │
│                                  │
│  "Enter the code"                │
│  "Sent to +237 6XX XXX XXX"      │
│  (last 4 digits shown, rest *'d) │
│                                  │
│  [ _ ][ _ ][ _ ][ _ ][ _ ][ _ ] │
│                                  │
│  Resend code (00:58)             │
│  (becomes a tappable link at 0)  │
│                                  │
└──────────────────────────────────┘
```

**Components:**
- Back arrow (returns to MA-02 to correct the phone number)
- Heading + masked phone display
- Six individual digit input boxes rendered as a single logical input; auto-advance on each digit
- Countdown timer: "Resend code (MM:SS)" — non-interactive during countdown; becomes a tappable link at 00:00
- Resend attempt tracking: internal counter (not displayed to user)

**Interactions:**
- Numeric keyboard opens on screen entry; focused on box 1
- Each digit typed auto-advances focus to the next box
- Backspace from an empty box: moves focus to the previous box
- Paste of a 6-digit string: fills all boxes and auto-submits
- Auto-submit on 6th digit entry: no confirm button needed
- On submit: boxes become non-interactive; subtle loading indicator
- Incorrect OTP: boxes animate (horizontal shake), clear, focus returns to box 1; inline error appears below boxes
- After 3 "Resend code" taps: resend link becomes non-interactive; navigate to MA-04

**Error states:**
- Incorrect OTP: "Incorrect code. Try again." (below boxes; clears on next entry)
- Max resends reached → MA-04
- Network failure on submit: "Couldn't verify the code. Check your connection." inline with retry

---

### MA-04 · OTP Lockout

**Purpose:** Inform member of 5-minute lockout after exhausting OTP resend attempts.

**Layout:**
```
┌──────────────────────────────────┐
│  (no back button)                │
│                                  │
│  [lock icon, centered, large]    │
│                                  │
│  "Too many attempts"             │
│                                  │
│  "Wait 5 minutes, then try       │
│   again. Contact your gym if     │
│   you need help sooner."         │
│                                  │
│  Try again in 04:58              │
│                                  │
│  [Try again] (disabled)          │
│                                  │
└──────────────────────────────────┘
```

**Components:**
- No back navigation (prevents bypassing the lockout via Android back gesture — back is intercepted and ignored)
- Lock icon (decorative)
- Heading + explanation copy
- Live countdown timer (5 minutes)
- "Try again" button (disabled throughout countdown; activates at 00:00 → navigates to MA-02 with phone pre-filled)

**Interactions:**
- Countdown continues even if app is backgrounded; uses elapsed time on foreground return
- At 00:00: button activates; tapping returns to MA-02

---

### MA-05 · Profile Setup

**Purpose:** Capture the member's display name and optional profile photo.

**Layout:**
```
┌──────────────────────────────────┐
│  ← back   Step 1 of 4           │
│           [progress bar]         │
│                                  │
│  "Set up your profile"           │
│                                  │
│  [circular photo area, 80px]     │
│  "Add photo (optional)"          │
│                                  │
│  Full name *                     │
│  [                            ]  │
│                                  │
│  [          Continue          ]  │
└──────────────────────────────────┘
```

**Components:**
- Back arrow (returns to MA-03)
- Step indicator: "Step 1 of 4" + segmented progress bar (4 segments; segment 1 filled)
- Photo upload circle (80px diameter; tappable)
- Name text input (required; auto-capitalize words mode; shows character count approaching limit)
- "Continue" primary button (full-width)

**Interactions:**
- Photo circle tap → native action sheet: "Take Photo" | "Choose from Library" | "Cancel"
- Photo selected: previews in circle; "Remove" label appears below circle
- "Continue" disabled until name field contains ≥1 non-space character
- Keyboard: name field gets focus automatically on screen entry

**Validation:**
- Name: required; ≥1 non-space character; max 100 characters
- Name error: "Please enter your name"
- Photo: optional; if provided and > 5MB: "Photo too large. Choose an image under 5MB."

---

### MA-06 · Goal Selection

**Purpose:** Capture fitness goal (surfaced to assigned coach in Coach Portal).

**Layout:**
```
┌──────────────────────────────────┐
│  ← back   Step 2 of 4           │
│           [progress bar]         │
│                                  │
│  "What's your goal?"             │
│  "Your coach will use this to    │
│   personalise your sessions."    │
│                                  │
│  ┌────────────────────────────┐  │
│  │  Lose Weight               │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │  Build Muscle              │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │  Improve Fitness           │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │  General Wellness          │  │
│  └────────────────────────────┘  │
│                                  │
│  [Continue] (disabled until pick)│
└──────────────────────────────────┘
```

**Components:**
- Back arrow; step indicator (step 2 of 4; segments 1–2 filled)
- Heading + context subtitle
- Four selection cards (full-width; tap to select; one active at a time)
- "Continue" CTA — disabled until a card is selected

**Interactions:**
- Tap card → selected state (accent border + checkmark icon right-aligned inside card); deselects any previously selected card
- "Continue" activates immediately on first selection
- No error state — "Continue" simply stays disabled until a selection is made

**Selection state per card:**
- Unselected: default border
- Selected: accent-color border (2px) + checkmark icon (right-aligned inside card)

---

### MA-07 · Experience Level

**Purpose:** Capture training experience level (surfaced to assigned coach).

**Layout:** Identical pattern to MA-06. Three options: Beginner | Intermediate | Advanced.
Step indicator: step 3 of 4; segments 1–3 filled.

---

### MA-08 · Plan Confirmation

**Purpose:** Member reviews their pre-assigned membership plan and confirms acceptance.

**Layout:**
```
┌──────────────────────────────────┐
│  ← back   Step 4 of 4           │
│           [progress bar, full]   │
│                                  │
│  "Your membership plan"          │
│                                  │
│  ┌────────────────────────────┐  │
│  │  [Plan Name]               │  │
│  │  [Duration]                │  │
│  │  [Price] XAF / month       │  │
│  │  Active from: [date]       │  │
│  │  Expires: [date]           │  │
│  └────────────────────────────┘  │
│                                  │
│  "This plan was set by your gym. │
│   Contact them to make changes." │
│                                  │
│  [    Confirm and start       ]  │
└──────────────────────────────────┘
```

**Components:**
- Back arrow; step indicator (step 4 of 4; all segments filled)
- Heading
- Plan detail card (read-only): plan name, duration label, price in XAF, activation date, expiry date
- Informational note (plan is gym-controlled; member cannot change it here)
- "Confirm and start" CTA

**Interactions:**
- Member cannot modify the plan displayed
- "Confirm and start" → saves all onboarding data → navigates to MA-09 (Home)
- On submit: spinner inside button; button disabled and locked to same width

**Error state:** Network failure → "Couldn't save your profile. Check your connection and try again." + retry inline below button

---

### MA-09 · Home

**Purpose:** Member's primary hub — subscription status at a glance, quick actions, recent activity.

**Mock:** [mockups/key-ma09-home.html](mockups/key-ma09-home.html) *(grace-period state)*

**Layout:**
```
┌──────────────────────────────────┐
│ [Gym Logo] [Gym Name]   [avatar] │  ← branded header (gym colors applied)
├──────────────────────────────────┤
│  "Welcome back, [First Name]"    │  ← muted subtitle
│                                  │
│  ┌────────────────────────────┐  │  ← raised Card (this screen's one)
│  │ (●) [Status badge]         │  │     leading Icon Chip, status-tinted
│  │  Monthly Plan               │  │
│  │  Expires in 12 days         │  │  ← statNumeral emphasis on "12"
│  └────────────────────────────┘  │
│                                  │
│  [Check In]        [View Plan]   │  ← quick actions (icon + label)
│                                  │
│  Upcoming Classes            →   │  ← V1.5; only if ≥1 booking exists
│  ┌────────────────────────────┐  │  ← flat Card wrapping the group
│  │(♪)[Class name]  [day, time]│  │     Icon Chip per row
│  └────────────────────────────┘  │
│                                  │
│  Recent Activity                 │
│  ┌────────────────────────────┐  │  ← flat Card wrapping the group
│  │(✓)[event row]        [date]│  │     Icon Chip: check-in=accent,
│  │($)[event row]        [date]│  │     payment=success
│  └────────────────────────────┘  │
├──────────────────────────────────┤
│ [Home][Check In][Classes][Progress][Me] │  ← bottom tab bar, 5 tabs (V1.5)
└──────────────────────────────────┘
```

**Components:**
- **Branded header:** gym logo (left, max 40px height), gym name (center or right of logo), member avatar (right, 36px, tappable → navigates to MA-12)
- **Welcome text:** "Welcome back, [First Name]" in muted style
- **Subscription status card** *(Epic 15: now a `raised` Card — the screen's one)*:
  - Leading Icon Chip, tinted to the same status color as the badge (warning glyph for `grace_period`, unchanged from before — now inside a chip rather than bare)
  - Status badge: see Status Badge states below
  - Plan name
  - Expiry date: when a "days until expiry" framing applies (`expiring_soon`/`grace_period`), the day count renders as a `statNumeral` inline within the sentence (e.g., "Expires in **12** days") rather than plain prose — reuses existing `expiryDate` data, no new field
  - Tapping the card navigates to MA-13 (Plan Details)
- **Quick action buttons:** "Check In" (navigates to MA-10) + "View Plan" (navigates to MA-13); row of two equal-width buttons — unchanged
- **Upcoming Classes section** *(V1.5, FR-108; Epic 15: rows now live inside one `flat` Card with Icon Chips)*: shown only when the member has ≥1 upcoming booking; up to 2 nearest sessions (name, day/time); "→" navigates to MA-16 (Classes) Booked tab; section is absent entirely (not an empty state) when there are zero bookings, to avoid crowding Home with an unused feature
- **Recent activity section** *(Epic 15: rows now live inside one `flat` Card with Icon Chips, tinted per item kind)*: last 2–3 combined events (check-ins + payments, reverse chronological); each row tappable; check-in rows navigate to History (now under Profile), payment rows navigate to MA-14

**Status badge states:**

| Member status | Badge label | Color signal | Additional text |
|---|---|---|---|
| active | "Active" | Green | Expiry date |
| expiring_soon | "Expiring soon" | Orange | "Expires [date]" |
| grace_period | "Grace period" | Orange + warning icon | "Expires [date] — you can still check in" |
| expired | "Membership expired" | Red | "See front desk to renew" |
| (no plan) | "No active plan" | Gray | "Contact your gym" |

**Expired state — additional behavior:**
- "Check In" quick action button is replaced with "See front desk" (tapping opens a bottom sheet with informational text only)
- Check-In tab still navigable but check-in attempt will be denied at scan

**Offline sync banner:**
- If a check-in is queued for sync: persistent banner below the header — "Offline check-in pending sync…" (disappears once sync completes)

**Loading state:**
- Status card: skeleton rectangle ~80px tall
- Recent activity: 2–3 skeleton rows, 44px each
- Branded header loads from 24-hour cache immediately (no skeleton for header)

**Empty state (recent activity):** "No activity yet — check in for the first time!"

**V1.6 — Session guests and Rewards *(FR-159, FR-161, FR-169; Stories 19.11, 20.6)*.** Everything below applies only when its switch is on. A gym with Charge guests per session off, a member not on Pay-per-session, or a Pay-per-session plan priced 0 XAF (all *exempt*) sees Home exactly as shipped.

**Mock:** [mockups/key-ma09-home-guest.html](mockups/key-ma09-home-guest.html) *(guest member, charging and loyalty on: usable sessions / no usable session)*

Layout with both switches on (guest member):
```
│  ┌────────────────────────────┐  │  ← raised Card (still this screen's one)
│  │ (🎟) [Pay per session]     │  │     Icon Chip `confirmation_number`
│  │  Drop-in · 2,000 XAF        │  │     plan name · price per session
│  │  2 paid sessions · use by   │  │  ← "2" as statNumeral
│  │  18 Oct                     │  │
│  └────────────────────────────┘  │
│  [Pay for a session] [Check In] [View Plan] │  ← Pay only when 0 usable + Tara connected
│                                  │
│  Rewards                         │  ← V1.6 Rewards card (flat)
│  ┌────────────────────────────┐  │
│  │  3 / 5  ■■■□□               │  │     Loyalty Progress (DESIGN.md)
│  │  paid sessions toward your  │  │
│  │  next free session          │  │
│  │ (🎁) Free session — use by 2 Dec │  │  Session Chip rows
│  │ (🎟) Paid session — use by 18 Oct│  │
│  └────────────────────────────┘  │
```

- **Guest status card *(charging on, Pay-per-session, price > 0)*.** The status card keeps its slot and `raised` treatment, but a guest has no expiry, so it swaps the expiry line for a sessions line:
  | State | Badge (EN / FR) | Colour | Sessions line (EN / FR) |
  |---|---|---|---|
  | Today already covered | "Today covered" / "Journée couverte" | `{colors.success}` | "You can come and go until closing." / "Vous pouvez entrer et sortir jusqu'à la fermeture." |
  | ≥1 usable session | "Pay per session" / "À la séance" | `{colors.neutral}` | "[N] paid session(s) · use by [date]" / "[N] séance(s) payée(s) · à utiliser avant le [date]" (soonest lapse date, plural-aware) |
  | No usable session | "Pay per session" / "À la séance" | `{colors.info}` | "No paid session — pay before you scan." / "Aucune séance payée — payez avant de scanner." |

  When the member also holds usable free sessions, the line appends " + [M] free" / " + [M] gratuite(s)". When they hold only free sessions, it reads "[M] free session(s) · use by [date]" / "[M] séance(s) gratuite(s) · à utiliser avant le [date]". The count and soonest-lapse summary lives on Home's status card only, not also on the MA-10 scanning screen. Story 19.11 allows either, and one place avoids two numbers drifting.
- **[Pay for a session] *(V1.6)*.** A quick action, placed first in the quick-action row like the shipped [Renew], that pushes MA-17. Shown only when the member has no usable session **and** the gym has Tara Money connected. It lets a guest pay before scanning, the in-app half of UJ-11's "taps Pay in the app". With no Tara connection it is absent and the line above already says to pay first.
- **Quick actions unchanged.** "Check In" stays "Check In" for a guest with no session: the scan itself lands on the designed "Pay for your session" state. This differs from expired, where "Check In" becomes "See front desk".
- **Rewards card *(V1.6, Story 20.6)*.** It sits on **Home**, below the quick actions and above Upcoming Classes, not on Profile, because the guest checks progress at the moment of a visit and Home is where they land. It is a `flat` Card, since Home's one `raised` slot belongs to the status card. Its title is "Rewards" / "Récompenses". That is plainer for members than "Loyalty program", which stays the staff-side name. It is rendered when the gym's loyalty program is on **or** the member holds an unexpired free session, and is absent otherwise (absent, not an empty state). Contents, all from `effective_loyalty` for the **active gym only**:
  - **Progress:** the Loyalty Progress component (`{components.loyaltyProgress}`) for the counter that matches the member's current plan. A guest sees "3 / 5" with the caption "paid sessions toward your next free session" / "séances payées avant votre prochaine séance gratuite". A subscriber sees "1 / 3" with "on-time renewals toward [R] free days" / "renouvellements à temps avant [R] jours offerts". The other counter is hidden even if non-zero: it cannot move while the member is on this plan type (FR-164), and two counters would read as one broken number. The progress block is hidden when the program is off, leaving only the session rows.
  - **Free session rows:** Session Chip (`{components.sessionChip}`, gift glyph, `{colors.success}`), "Free session — use by [date]" / "Séance gratuite — à utiliser avant le [date]". A free session held while on a non-Pay-per-session plan (dormant, FR-166) shows `{colors.neutral}` with the sub-line "Usable when you're back on Pay-per-session" / "Utilisable à votre retour au paiement à la séance".
  - **Unused paid session rows:** Session Chip (ticket glyph, `{colors.accent}`), "Paid session — use by [date]" / "Séance payée — à utiliser avant le [date]", soonest first.
  - **Newly earned free session:** the first time the card renders after a grant, a one-line headline above the rows reads "Free session earned — valid for [60] days" / "Séance gratuite gagnée — valable [60] jours" (UJ-11 wording; the 60 is read from the platform config, not hard-coded). It is shown once per grant, tracked on the device, because no reward push exists in V1.6 (FR-169) and UJ-11 implies a visible moment.
  - **Free days reward (subscriber):** after a grant, the card shows "[R] free days added — your new renewal date is [date]" / "[R] jours offerts ajoutés — votre nouvelle date de renouvellement est le [date]" (Story 20.6 `[UX]`). It stays until the next renewal, so the moved expiry on the status card never looks like an error.
  - **Footnote** (`small`, muted). Guest: "Progress resets after 90 days without a paid session." / "Votre progression repart à zéro après 90 jours sans séance payée." Subscriber: "Renew on time to keep your progress." / "Renouvelez à temps pour garder votre progression." The 90 is read from config.
  - **Lapsed sessions** drop off the card silently. Each row already shows its use-by date in advance, and staff can still see lapses on AD-04.
  - **Reset:** after the idle window the card shows the reset value (0) at read time, never the stale count (FR-168).
- **Offline sync banner (guest at a charging gym):** "Offline check-in waiting to be verified…" / "Enregistrement hors ligne en attente de vérification…" replaces "Offline check-in pending sync…" (which keeps its shipped key for everyone else). Same placement and lifetime.
- **Post-sync denial notice *(FR-161, Story 19.11)*.** When a queued guest scan is denied on sync, the next Home render shows a dismissible notice card directly under the header, above the status card. It is `{colors.info}`-tinted with Icon Chip `info`: "Your check-in on [date] at [time] wasn't counted — you had no paid session. See the front desk if this is wrong." / "Votre enregistrement du [date] à [heure] n'a pas été compté — vous n'aviez pas de séance payée. Voyez l'accueil en cas d'erreur." It has a [Got it] / [Compris] button. It stays until dismissed. Several denials collapse into one card naming the latest, with "+[N] more" / "+[N] autre(s)". It has no Pay action, because paying later cannot retro-cover an already-denied visit (FR-159).
- **Offline scan verified on sync:** no notice. Success is the expected outcome, and only a denial must never be silent (FR-161).
- **Recent activity:** a session payment row reads "Session payment: 2,000 XAF" / "Paiement de séance : 2 000 XAF", never the renewal wording, with a ticket-glyph Icon Chip (`{colors.accent}`). A check-in covered by a free session is a normal check-in row. Free sessions never appear as payments (FR-158).
- **Gym switch:** Home, the status card, and the Rewards card show the active gym only (Architecture Decision AD-4).

---

### MA-10 · Check-In

**Purpose:** Member scans the gym's static QR code to record attendance.

**Layout — Scanning:**
```
┌──────────────────────────────────┐
│  Check In                    [✕] │
├──────────────────────────────────┤
│                                  │
│  ┌──────────────────────────┐    │
│  │                          │    │
│  │    [Camera viewfinder]   │    │
│  │                          │    │
│  │   ┌──────────────────┐   │    │
│  │   │  [scan target]   │   │    │
│  │   └──────────────────┘   │    │
│  │                          │    │
│  └──────────────────────────┘    │
│                                  │
│  "Point at your gym's QR code"   │
│                                  │
└──────────────────────────────────┘
```

**Components:**
- Header bar: "Check In" (title) + ✕ close (top-right; returns to Home or previous tab)
- Camera viewfinder (full-width content area)
- Scan target overlay: animated corner brackets to guide alignment; gentle pulsing animation to indicate active scanning
- Instructional text below viewfinder
- No manual input fields — QR scan only

**Interactions:**
- Camera activates automatically on screen entry (no tap required)
- Camera permission check on first use → request system permission dialog; if denied → permission-denied state (see below)
- QR detected: immediate flash/highlight of scan frame, then transition to result overlay
- ✕ closes screen; camera deactivates immediately

**Permission-denied state:**
- Replace camera viewfinder with: lock icon + heading "Camera access needed" + copy "GymOS needs camera access to scan QR codes." + "Open Settings" button (deep-links to app settings on device)

**Offline behavior:**
- Camera and QR decoding work fully offline
- On scan: check-in recorded to local SQLite immediately; show success result with sync indicator *(V1.6: a guest at a charging gym sees "Check-in saved — will be verified" instead, see below)*
- Sync fires automatically when connectivity returns *(V1.6: a guest's queued scan is validated on sync under FR-159; a denial surfaces as the MA-09 post-sync denial notice)*

**MA-10 Result States (full-screen overlays, no navigation bar):**

**Success — Online:**
```
[Full-screen green overlay]
  ✓  (large checkmark icon)
  "Checked in"
  "08:14 AM"
  [auto-dismisses after 2.5 seconds]
```

**Success — Offline:**
```
[Full-screen green overlay]
  ✓
  "Checked in"
  "08:14 AM  ·  Syncing…"
  [auto-dismisses after 2.5 seconds]
```

**Denied — Expired:**
```
[Full-screen red overlay]
  ✕  (large X icon)
  "Access denied"
  "Your membership has expired.
   Please see the front desk."
  [See front desk] button → closes overlay, returns to MA-09
  [does NOT auto-dismiss — requires tap]
```

**Already Checked In:**
```
[Full-screen amber overlay]
  ⚠  (warning icon)
  "Already checked in"
  "You're already checked in.
   See front desk if you need help."
  [OK] button
  [does NOT auto-dismiss]
```

**Wrong QR:**
```
[Full-screen amber overlay]
  ⚠
  "QR not recognised"
  "Make sure you're scanning your
   gym's QR code."
  [Try again] button → closes overlay, returns to scanning state
  [does NOT auto-dismiss]
```

**Scanning timeout (15 seconds without a detected QR):**
- Brief instructional nudge below the viewfinder replaces the static label: "Having trouble? Move closer to the QR code." Viewfinder continues to scan; this is informational only.

**V1.6 — Session guests *(FR-159, FR-161; Story 19.11)*.** These states apply only to a Pay-per-session member, plan price > 0, at a gym with Charge guests per session on. Everyone else gets the five states above, unchanged. The app refreshes the gym's charging flag on launch, on foreground, and on check-in screen focus, which is invisible to the member; the server's rule always governs.

**Mock:** [mockups/key-ma10-session-required.html](mockups/key-ma10-session-required.html) *(Pay for your session; Check-in saved — will be verified)*

**Pay for your session** *(new, UX-DR8 pattern)*:
```
[Full-screen info overlay — {colors.info}]
  🎟  (large ticket icon, MaterialIcons `confirmation_number`)
  "Pay for your session"
  "You need a paid session to check in today.
   2,000 XAF covers the whole day."
  [Pay now]             ← primary; only when the gym has Tara Money connected → MA-17
  [See the front desk]  ← secondary when Pay now shows; primary otherwise → closes overlay, returns to MA-09
  [does NOT auto-dismiss — requires tap]
```
- Title is fixed by the PRD/epics: "Pay for your session" / "Payez votre séance".
- Body: "You need a paid session to check in today." / "Il vous faut une séance payée pour vous enregistrer aujourd'hui." Second line "[price] covers the whole day." / "[prix] couvre toute la journée." The price is the plan price shown on the member's own plan.
- Buttons: "Pay now" / "Payer maintenant"; "See the front desk" / "Voir l'accueil". EN follows the PRD's "See the front desk", not the shipped `checkin.seeFrontDesk` "See front desk", so this gets a new key. FR reuses the shipped "Voir l'accueil" verbatim.
- Colour `{colors.info}`, not `{colors.danger}`. This is a recoverable, one-tap state and must not read as "expired". Red stays reserved for an expired membership.
- Haptic: notification error (UX-DR15: denial haptic; no attendance was recorded).
- How the app knows: `check_in()` returns `null` as for expired; at a charging gym the app reads the member's latest `session_attempts` row to choose this state over Denied — Expired (Architecture Decision AD-29/AD-31).
- **Older app builds** (before Story 19.11) show their Denied — Expired overlay ("Your membership has expired. Please see the front desk.") for this refusal. The guest is not admitted, and the copy is accepted as wrong (decision 1, 2026-10-11). The owner is warned in the AD-13 Charge-guests confirmation, and no minimum-version gate exists.

**Check-in saved — will be verified** *(new; replaces Success — Offline for guests at a charging gym)*:
```
[Full-screen info overlay — {colors.info}]
  ⏳  (MaterialIcons `hourglass_top`)
  "Check-in saved — your session will be verified"
  "08:14 AM · We'll check your session when you're back online."
  [OK]
  [does NOT auto-dismiss — requires tap]
```
- Copy: "Check-in saved — your session will be verified" / "Enregistrement sauvegardé — votre séance sera vérifiée". Sub-line "We'll check your session when you're back online." / "Nous vérifierons votre séance dès votre retour en ligne." These are the final wording, settling FR-161's UX wording deferral.
- Colour `{colors.info}`, not green: it is not a confirmed visit yet. It requires a tap so the guest registers the difference from a green success. Haptic: notification warning.
- The app uses its cached charging flag. If the gym turned charging on while the member was offline, the member may see the plain green offline success, and the sync may later be denied. The post-sync denial notice on MA-09 covers that case.

**Success — free session used** *(variant of Success — Online, V1.6, Epic 20)*: same green overlay and timing, with the sub-line "08:14 AM · Free session used" / "08h14 · Séance gratuite utilisée". Optional reassurance that nothing was charged. A paid-session consumption uses the unchanged Success — Online, and a covered re-entry the same day is also a plain success: no "covered" hint, since it costs nothing.

---

### MA-11 · History

**Purpose:** Member views their full payment and attendance history.

**V1.5 change:** no longer a bottom-tab destination — reached from Profile (MA-12) via a "History" row. Layout changes from a tab-bar screen to a pushed sub-screen (back arrow to Profile, no tab bar) — same content and components otherwise, unchanged from V1.0.

**Layout:**
```
┌──────────────────────────────────┐
│  ← (back to Profile)             │
│  History                         │
├─────────────────┬────────────────┤
│    Payments     │   Check-ins    │  ← segmented control
├─────────────────┴────────────────┤
│  [event row]         [date/time] │
│  [event row]         [date/time] │
│  [event row]         [date/time] │
│  ...                             │
└──────────────────────────────────┘
```

**Components:**
- Segmented control: "Payments" | "Check-ins" (sticky on scroll)
- **Payments tab:** Reverse-chronological list. Row: date (left), plan name + method (middle), amount in XAF (right), status badge (Verified / Pending / Failed). Tappable → MA-14 Payment Detail.
- **Check-ins tab:** Reverse-chronological list. Row: date + time (left), gym name (center), duration if checked-out (right). Not tappable in V1.
- Pull-to-refresh on both tabs
- Infinite scroll (load 20 records per page; next page loads on scroll near bottom)

**Empty states:**
- Payments tab: "No payments on record yet."
- Check-ins tab: "No check-ins yet. Scan the QR at your gym to get started." [Check In] button → navigates to MA-10

**Loading:** 5–6 skeleton rows per tab; each matches expected row height.

**V1.6 *(Story 19.11, FR-158)*:** a Payments row whose purpose is `session` shows "Session" / "Séance" where a renewal shows the plan name, alongside the shipped "Registration fee" / "Frais d'inscription" label. It keeps the same Verified / Pending / Failed badge set. A late-confirmed Tara session payment is Verified. A flagged one (wrong account, mismatch) shows Failed, because it never bought a session. Free sessions never appear here (FR-158). The Check-ins tab is unchanged: a refused scan is not a check-in, so it is never listed.

---

### MA-12 · Profile

**Purpose:** Member views and edits their profile, changes language, reviews History, manages notification preferences, and manages their session.

**V1.5 change:** gains a "History" row (→ MA-11, moved off the tab bar) and a "Notification Preferences" section (in-page — this section documents the already-shipped V1.0 Story 6.4 behavior, undocumented until this update, plus the two new V1.5 toggles).

**Mock:** [mockups/key-ma12-profile.html](mockups/key-ma12-profile.html)

**Layout:**
```
┌──────────────────────────────────┐
│  Profile                         │
│                                  │
│  [Avatar, 64px, centered]        │
│  [Member Full Name]              │
│  [Gym Name]  ·  [Plan Name]      │
│                                  │
│  ┌────────────────────────────┐  │  ← flat Card: account section
│  │(person) Edit profile      →│  │
│  │(clock)  History            →│  │  ← V1.5: moved here from tab bar
│  │(globe)  Language  [EN][FR] │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │  ← flat Card: notifications section
│  │(bell) Renewal & payment  ⊙ │  │
│  │(bell) Quiet-gym alerts ⊙off│  │  ← V1.5, default off (FR-113)
│  │(bell) Class reminders  ⊙on │  │  ← V1.5, default on, opt-out (FR-116)
│  └────────────────────────────┘  │
│                                  │
│  (logout) Log out                │  ← standalone row, danger-tinted chip
├──────────────────────────────────┤
│ [Home][Check In][Classes][Progress][Me] │
└──────────────────────────────────┘
```

**Components:**
- Avatar (tappable only in edit mode)
- Name, gym name, plan name (read-only display)
- *(Epic 15)* Account rows (Edit profile / History / Language) grouped into one `flat` Card, each row gaining a leading Icon Chip (`person`/`history`/`language` MaterialIcons glyphs, `primary`-tinted) — replaces the previous bare hairline-divided rows; navigation destinations and tap targets unchanged
- "Edit profile" row → inline edit section: name field (pre-filled, editable) + photo upload circle; phone number shown as non-editable with label "Contact your gym to change your number"
- "History" row → pushes MA-11
- Language row: segmented EN | FR toggle — tapping the non-active option switches immediately; no reload required
- **Notifications section** *(Epic 15: own `flat` Card, separate from the account Card above — grouping already-independent toggles doesn't imply they share a save action)*: one toggle row per notification category, each with a leading `bell`-glyph Icon Chip. Existing V1.0 categories (subscription lifecycle N-01–N-03, payment N-04–N-05) already ship as a single "Renewal & payment reminders" toggle (this documents current shipped behavior). V1.5 adds two more rows: "Quiet-gym alerts" (default **off** — opt-in, FR-113) and "Class reminders" (default **on** — opt-out, FR-116); each is an independent toggle, saved immediately on change (no separate Save action)
- "Log out" row *(Epic 15: standalone, outside both Cards, `danger`-tinted Icon Chip — visually separated so it doesn't read as just another settings row)* → bottom sheet: "Log out of GymOS?" [Log out] [Cancel]

**Interactions:**
- Language change: immediately re-renders all app strings; preference saved to account; screen reader announces the change in the new language
- Edit profile save: spinner during save; success → collapses to read-only; failure → inline error below name field
- Notification toggle: optimistic UI (flips immediately), reverts with an inline error toast if the save fails
- Log out: clears local tokens; navigates to MA-01

**V1.6:** no change. The Rewards card lives on Home (see MA-09), and there is no reward notification toggle, because no reward push ships in V1.6 (FR-169).

---

### MA-13 · Plan Details

**Purpose:** Member views full details of their current membership plan.

**Layout:**
```
┌──────────────────────────────────┐
│  ← (back)                        │
│  Plan Details                    │
├──────────────────────────────────┤
│  [Plan Name]           [Status]  │
│  [Gym Name]                      │
│                                  │
│  Plan type:   Monthly            │
│  Price:       25,000 XAF         │
│  Duration:    1 month            │
│  Active from: 01 Jul 2026        │
│  Expires:     31 Jul 2026        │
│  Billing:     Monthly            │
│  Access:      Floor access       │
└──────────────────────────────────┘
```

**Components:** Read-only detail card. No member-facing actions (plan changes require admin).

**V1.6 — Pay-per-session variant *(FR-156, FR-173)*:** Plan type reads "Pay-per-session" / "Paiement à la séance" (shipped). The "Price" label becomes "Price per session" / "Prix par séance". Duration and Expires use the shipped "No fixed duration" / "Pas de durée fixe" and "No expiry" / "Pas d'expiration". Billing is hidden. At a charging gym, add one row: "Sessions: one paid session covers a whole day; unused sessions lapse after 7 days." / "Séances : une séance payée couvre toute la journée ; une séance non utilisée expire après 7 jours." The 7 is read from config. Session counts are not repeated here; they live on Home.

---

### MA-14 · Payment Detail

**Purpose:** Receipt view for a single payment.

**Layout:**
```
┌──────────────────────────────────┐
│  ← (back to History)             │
│  Payment Receipt                 │
├──────────────────────────────────┤
│  [Gym Logo]  [Gym Name]          │
│                                  │
│  Member:       [Name]            │
│  Plan:         [Plan Name]       │
│  Amount:       25,000 XAF        │
│  Method:       Cash              │
│  Date:         04 Jul 2026       │
│  Reference:    [transaction ref] │
│  Recorded by:  [Actor Name]      │
│  Status:       Verified          │
└──────────────────────────────────┘
```

**Components:** Read-only receipt. All fields from FR-041. No member-initiated refund action.

**V1.6 *(Stories 19.4, 19.11)*:** for a `session` payment, the "Plan" row becomes "For: Session — [plan name]" / "Objet : Séance — [nom du forfait]". Add a row "Session use by: [date]" / "Séance à utiliser avant le : [date]" while unused, or "Used on: [covered day]" / "Utilisée le : [jour]" once consumed. This follows the shipped registration-fee receipt label pattern.

---

### MA-15 · Progress *(V1.5)*

**Purpose:** Member's private trend view of their body metrics and photos over time — the screen the Progress tab exists to give members a reason to open the app on a non-visit day (PRD Section 3.2).

**Layout:**
```
┌──────────────────────────────────┐
│  Progress                        │
│                                  │
│  Current weight        [+ Log]   │
│  78.4 kg   (-2.4 kg since start) │
│                                  │
│  ┌────────────────────────────┐  │
│  │   [weight trend line chart]│  │
│  └────────────────────────────┘  │
│                                  │
│  Measurements                    │
│  ─────────────────────────────── │
│  Waist    76 cm   (-3 cm)        │
│  Chest    98 cm   (+1 cm)        │
│  ...                             │
│                                  │
│  Photos                          │
│  ─────────────────────────────── │
│  [thumb] [thumb] [thumb] [thumb] │  ← reverse-chronological grid
└──────────────────────────────────┘
```

**Components:**
- **Header row:** current weight + delta since the member's starting weight; color follows goal type — for a directional goal (Lose Weight / Build Muscle), green if the delta trends toward that goal, neutral gray otherwise; for a non-directional goal (Improve Fitness / General Wellness), always neutral gray regardless of trend, since there's no "right direction" to reward. Never red on this screen — it is not a judgment screen. "+ Log" opens the Log Entry sheet.
- **Weight trend chart:** simple line chart, all logged weight entries in chronological order; X-axis dates, Y-axis kg; tapping a point shows that entry's exact value + date in a small tooltip. Renders via the RN charting library already in use elsewhere in the app (implementer's choice if none yet adopted — no new dependency mandated here); single series, `accent` token color, no legend needed.
- **Measurements section:** one row per measurement field that has ≥2 logged values (waist/chest/hips/arms/thighs, FR-094); each row shows latest value + delta from the previous entry; a field with 0–1 entries is omitted from this list, not shown with an empty delta
- **Photo timeline:** grid of thumbnails, reverse-chronological; a small lock icon overlays any thumbnail not currently shared with the member's coach (shared = no icon); tapping a thumbnail opens it full-screen with the per-photo share toggle (Story 10.2)

**Log Entry sheet** (bottom sheet, triggered from "+ Log" here or from Home if surfaced there):
- Fields, all optional, any subset may be filled: Weight (kg), Waist/Chest/Hips/Arms/Thighs (cm), Photo (camera or gallery), Note (free text)
- No field is required — a member can log just a photo, or just a note, or everything at once (FR-093/FR-094)
- New photos default to **not shared** with the coach — sharing is an explicit opt-in the member sets afterward from the photo detail view, never a blanket setting (Story 10.2)
- [Save entry] — on save, entry is stamped with a timestamp and syncs offline-safely via `client_id` (same pattern as check-in queueing, FR-097)

**Empty state (no entries yet):** "Log your first entry to start tracking your progress." [+ Log] button, same action as the header's.

**Offline behavior:** previously-synced chart and measurement data render from local cache. Logging a new entry queues locally and syncs on reconnect — the only other V1.5 flow besides check-in that works fully offline.

**Privacy note (drives every visibility rule on this screen):** progress data and photos are visible only to the member and their currently-assigned coach (if shared, for photos) — never Receptionist, Manager, Supervisor, Owner, or other members (FR-095). This is enforced at the RLS layer, not just hidden in this UI.

---

### MA-16 · Classes *(V1.5)*

**Purpose:** Member browses and books class sessions, and manages their own upcoming bookings.

**Layout:**
```
┌──────────────────────────────────┐
│  Classes                         │
├─────────────────┬────────────────┤
│    Available    │  My Bookings   │  ← segmented control
├─────────────────┴────────────────┤
│  HIIT · Tue 6:00 PM              │
│  Coach Emmanuel · 8/15 spots     │
│                        [ Book ]  │
│  ─────────────────────────────── │
│  Yoga · Wed 7:00 AM              │
│  Coach Fatima · 15/15 — Full     │
│                        [ Full ]  │
│  ...                             │
└──────────────────────────────────┘
```

**Components:**
- Segmented control: "Available" | "My Bookings" (mirrors the History screen's pattern)
- **Available tab:** upcoming sessions, chronological. Row: class name + day/time, assigned coach, capacity as "booked/total"; action button is "Book" (enabled) or "Full" (disabled, gray) per current capacity
- **My Bookings tab:** the member's own upcoming booked sessions. Row: class name + day/time; action button is "Cancel" if before the gym's cancellation cutoff (default 2 hours before start), or a static "Cancellation closed" label if past it (FR-106)
- Tapping a row (either tab) expands the class description inline — no separate detail screen

**Interactions:**
- **Book:** tap → immediate optimistic UI (button flips to a brief spinner, then either confirms or reverts); server enforces capacity atomically (`book_class_session()`, Architecture Decision AD-21) so a race against another member booking the last spot is possible — if the server rejects because it filled in the interim, the button reverts to "Full" with a toast: "That spot was just taken — try another session."
- **Cancel:** tap → inline confirm ("Cancel this booking?" [Keep] [Cancel booking]), no reason required; on confirm, the row moves out of My Bookings and the spot frees immediately in Available

**States:**
- **"This class is full"** (FR-105): shown as the row's own disabled "Full" button state — no separate error dialog needed, the state is visible before the member taps
- Booking/cancellation is never a payment step — no price, no payment method shown anywhere on this screen (FR-106)

**Empty states:**
- Available tab: "No upcoming classes scheduled. Check back soon."
- My Bookings tab: "You haven't booked any classes yet." with a link that switches to the Available tab

**Offline behavior:** this screen requires connectivity (unlike Check-In and Progress) — booking/cancellation are not queued offline, given the concurrency-sensitive capacity check; if offline, the screen shows a persistent banner ("You're offline — classes can't be booked right now") over the last-synced list.

**V1.6 *(FR-174)*:** no change. Booking and cancelling stay free for a guest: no price and no session requirement on this screen. A session is consumed only when staff mark the guest attended (AD-18). There is no "attending uses a session" hint here, since booking is not a payment step (FR-106). FR class strings on this screen follow the session/class terminology rule in Voice and Tone.

---

### MA-17 · Pay for Session *(V1.6, FR-158, Story 19.5/19.11)*

**Purpose:** A guest pays one session's price by Tara Money from the app, then scans in. It mirrors the shipped In-app Renewal (`/renew`) flow and reuses its phases and payment-status subscription.

**Entry:** MA-10 "Pay for your session" → [Pay now]; MA-09 quick action [Pay for a session]. It is offered only when the gym has charging on, Tara Money connected (FR-127), and the member is on Pay-per-session with price > 0. Otherwise neither entry point renders.

**Layout:**
```
┌──────────────────────────────────┐
│  ← (back)                        │
│  Pay for your session            │
├──────────────────────────────────┤
│  ┌────────────────────────────┐  │  ← flat Card
│  │ Drop-in                     │  │     plan name
│  │ 2,000 XAF                   │  │  ← statNumeral
│  │ Covers the whole day.       │  │
│  │ Unused sessions lapse after │  │
│  │ 7 days.                     │  │
│  └────────────────────────────┘  │
│  Paying with                     │
│  [+237 ▾][6XX XXX XXX         ]  │  ← editable, defaults to member phone
│  "Defaults to your registered…"  │
│                                  │
│  [         Pay 2,000 XAF       ] │  ← primary Button
└──────────────────────────────────┘
```

**Phases** (same as `/renew`: idle → sending → pending → stillWaiting at 45 s → verified / flagged):
| Phase | EN | FR |
|---|---|---|
| Title | "Pay for your session" | "Payez votre séance" |
| Price caption | "Covers the whole day." / "Unused sessions lapse after [7] days." | "Couvre toute la journée." / "Une séance non utilisée expire après [7] jours." |
| Payer phone | reuse `renew.payerPhone` / `renew.payerPhoneHint` verbatim | reuse verbatim |
| Confirm button | "Pay [price]" | "Payer [prix]" |
| Sending | reuse `renew.sendingPaymentRequest` "Sending payment request…" | reuse verbatim |
| Pending | reuse `renew.pending.title` "Payment request sent"; description "Check your phone and approve the prompt to pay for your session." | reuse title; "Vérifiez votre téléphone et approuvez l'invite pour payer votre séance." |
| Still waiting | reuse `renew.pending.stillWaiting` + "You can close this — if the payment goes through, your session will appear on Home." | reuse + "Vous pouvez fermer — si le paiement aboutit, votre séance apparaîtra sur l'accueil." |
| Failed / flagged | reuse `renew.pending.failed` "This payment wasn't approved. You can try again." | reuse verbatim |
| Success | "Session paid" / "Scan the QR code to check in." + [Scan now] → MA-10 | "Séance payée" / "Scannez le QR code pour vous enregistrer." + [Scanner] → MA-10 |

**Errors** (inline above the button; the button stays available unless noted):
| Code | EN | FR |
|---|---|---|
| Payment already in progress (app or desk) | reuse `renew.errors.paymentAlreadyPending` verbatim | reuse verbatim |
| Tara unavailable / credentials invalid | "Your gym's payment connection isn't working right now. See the front desk to pay with cash." | "La connexion de paiement de votre salle ne fonctionne pas actuellement. Voir l'accueil pour payer en espèces." |
| Charging turned off meanwhile | "You don't need to pay for a session at this gym right now." + [Back] | "Vous n'avez pas besoin de payer de séance dans cette salle pour le moment." + [Retour] |
| Plan changed / price 0 meanwhile | "Your plan doesn't need a session payment." + [Back] | "Votre forfait ne nécessite pas de paiement de séance." + [Retour] |
| Payer phone invalid | reuse `renew.errors.payerPhoneInvalid` | reuse |
| Other | reuse `renew.errors.initiateFailed` | reuse |

**Rules:**
- The amount is display-only. The server reads the plan price at payment time, and the client never sends it.
- A late Tara confirmation (after the 10-minute stale window) still creates the session (FR-158). The member may already have left this screen, and the session appears on Home's status card at next render. No notification is sent.
- A wrong-account or mismatch outcome never creates a session. The member sees the Failed phase, and staff see a discrepancy on AD-09.
- Haptic on success: notification success. On failure: notification error.
- Requires connectivity; if offline, the confirm button is disabled with the shipped offline banner.

---

### In-app Renewal (`/renew`) *(shipped Story 4.15; documented V1.6)*

**Purpose:** A subscriber renews their own plan by Tara Money (FR-140). It is documented here because MA-17 mirrors it and V1.6 subscriber stamps can come from it (FR-167).

- **Entry:** Home quick action [Renew] (`home.renew`), shown first in the quick-action row for the three renewal-eligible statuses (expiring soon, grace period, expired) when the gym has Tara Money connected. Check In stays alongside it except when expired. When not connected, the same slot is "See front desk", which opens a sheet: "Renew with cash" / "Your gym's mobile money payment isn't available right now. See front desk to renew with cash." (shipped `home.seeFrontDeskTitle/Body`).
- **Screen:** pushed full-screen route (back arrow, no tab bar). It shows the plan, the price, and "Paying with" (payer phone, editable, defaulting to the member's number), then [Confirm Renewal].
- **Phases:** idle → sending → pending ("Payment request sent") → stillWaiting at 45 s → verified ("Renewal complete!" + [Done]) / flagged ("This payment wasn't approved. You can try again."). Polling every 5 s backs up the realtime payment-status subscription.
- **Errors:** shipped `renew.errors.*` (load failed, no plan, not eligible, payment already pending, gym credentials unavailable, mobile money disabled, payer phone invalid).
- **V1.6:** an on-time renewal through this screen earns a subscriber stamp; any free days granted appear on the Rewards card (MA-09). The screen itself is unchanged.

---

### Awaiting Registration (`/awaiting-registration`) *(shipped Story 18.7, FR-155; documented V1.6)*

**Purpose:** A neutral blocked state for a member whose registration fee staff have not yet settled. Members never pay the fee in the app (FR-148).

- **Presentation:** a root guard replaces the whole tab app, like the gym-suspended screen. It shows the title "Registration not complete" / "Inscription non terminée" and the message "Your registration isn't complete yet. Please contact your gym to finish it." / "Votre inscription n'est pas encore terminée. Veuillez contacter votre salle pour la finaliser."
- **Actions:** [Check again] (`awaitingRegistration.checkAgain`) re-reads the session. It shows "Checking…", then "Your registration is still not complete." or "Couldn't check right now. Please try again." inline with `accessibilityRole="alert"`. [Log out] uses the shared confirm. There is no payment option and no billing language.
- **V1.6 relationship:** FR-159 says "Pay for your session" mirrors this state. It mirrors the *tone* (plain, no codes, tells the member what to do), but it differs in kind: it is a check-in result overlay with a payment action, not a whole-app block. A member awaiting the registration fee never reaches the check-in gate, so they never see "Pay for your session". The desk also cannot sell them a session (Record Session Payment refuses with "Settle the registration fee first").

---

## Screen Reference — Admin Dashboard

> All pages share: fixed left sidebar, top bar (gym name + logged-in user name + role pill), and role-filtered navigation. Content occupies the remaining viewport width.

---

### AD-01 · Login

**Layout:**
```
[Centered card, max 400px, vertically centered on page]

[GymOS logo]
"Sign in to [Gym Name]"

Email address or phone number *   [input]
Password *                        [input + show/hide toggle]

[          Sign in          ]

"Forgot password?" link
```

*(V1.5: the identifier field accepts an email address **or** a phone number — it was email-only. Story 9.1's staff provisioning creates Supervisor/Manager/Receptionist/Coach accounts from a phone number with **no email**, so an email-only field left every non-Owner role unable to sign in at all. Owners are unaffected either way: gym creation sets both an email and a phone. Confirmed against Supabase that those accounts authenticate by phone with or without the leading "+", so this is an identifier change only — staff accounts need no email backfill.)*

**Interactions:**
- Form submits on Enter key from either field
- On submit: spinner on button; button disabled
- On success: redirect to AD-02 or originally-requested deep link

**Error states:**
- Invalid credentials: inline below password — "Email, phone number or password is incorrect." *(V1.5: was "Email or password is incorrect.")*
- Account locked: "Your account has been locked. Contact your gym administrator."
- Network error: "Couldn't connect. Check your internet connection."

---

### AD-02 · Overview

**Purpose:** Central dashboard: live check-in count, expiring members, revenue summary, real-time front-desk alerts.

**Dashboard layout (desktop ≥ 1024px):**
```
┌──────────────────────────────────────────────────────────────────┐
│ Sidebar │ Overview                                               │
│         ├────────────────────────────────────────────────────────│
│         │ [Front-Desk Alert Panel — slides in when alerts exist] │
│         ├────────────────────────────────────────────────────────│
│         │ [Checked in now]  [Expiring this week]  [Revenue MTD]  │
│         ├────────────────────────────────────────────────────────│
│         │ Currently Checked In                      [View all →] │
│         │ ┌──────────────────────────────────────────────────┐   │
│         │ │ Name   Check-in time   Status   [Check out]      │   │
│         │ └──────────────────────────────────────────────────┘   │
│         ├────────────────────────────────────────────────────────│
│         │ Expiring This Week                        [View all →] │
│         │ ┌──────────────────────────────────────────────────┐   │
│         │ │ Name   Plan   Expiry date   Status   [Renew]     │   │
│         │ └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

**Components:**
- **Front-Desk Alert Panel** (see Cross-Cutting Components): renders at the top of the content area; pushes page content down — no z-index overlay
- **Stat cards row (3 cards):**
  - "Checked in now: N" → click navigates to AD-11
  - "Expiring this week: N" → click navigates to AD-08 filtered to expiring_soon
  - "Revenue this month: XAF N" → click navigates to AD-09 filtered to current month
  - Values refresh on page load and via polling every 60 seconds
- **Currently Checked-In table:** Name + avatar, Check-in time, Status badge, "Check Out" action; max 10 rows; sorted by check-in time ascending; "View all →" links to AD-11
- **Expiring This Week table:** Name, Plan, Expiry date, Status badge, "Renew" button (→ Inline Renewal Panel); max 10 rows; "View all →" links to AD-08

**Loading:** 3 skeleton stat cards; 5 skeleton table rows per table.

**Empty states:**
- Checked-in table: "No one is checked in right now."
- Expiring table: "No members expiring in the next 7 days."

**V2 amendment (FR-143).** The three cards above are joined by a second row of gym-health cards. The original three answer "what is happening right now"; the second row answers "how is the gym doing" — the question an Owner opens the dashboard to ask.

- **Row 2 cards (4):**
  - "Active members: N" → AD-08 filtered to active + expiring_soon *(amended 2026-09-10, Story 17.2: was "AD-03 filtered to active". A member in their last 7 days can still check in, and AD-03's status filter can match a non-current subscription row after a renewal, so the card and its target could disagree)*
  - "New this month: N" → AD-03 *(counted by join date, not record creation — Story 17.2, 2026-09-10)*
  - "Today's classes: N" → AD-18
  - "At risk: N" → AD-08 filtered to grace_period + expired
- **"At risk"** counts `grace_period` + `expired` combined, and is the only card that renders in the alert colour when non-zero — a gym with zero at-risk members must not see a red number on its dashboard.
- **Revenue MTD is net:** verified payments minus refunds recorded in the same calendar month, in gym-local time. Refunds are stored in their own table with positive amounts, not as negative payment rows, so a gross figure would overstate takings to the Owner in any month containing a refund.
- **Row 2 is Manager-plus.** A Receptionist sees only the original three cards, and row 2 is absent from the DOM rather than CSS-hidden — headcount, growth, and churn-risk figures are management information, not front-desk information. (AD-02's minimum role is Receptionist, so this gate is load-bearing.)

**Loading (row 2):** 4 skeleton cards, streaming in their own boundary independently of row 1 — a slow aggregate must never delay the operational cards above it, which are the ones the front desk needs in real time.

**Shipped drift, recorded V1.6:** the Revenue this month card already carries a sub-line "of which registration fees: XAF N" / "dont frais d'inscription : N XAF" (Epic 18). It shows when the gym has a fee set or fee revenue this month is > 0.

**V1.6 amendment — Guest sessions *(FR-162, FR-163; Stories 19.8, 19.10)*:**

**Mock:** [mockups/key-ad02-guest-sessions.html](mockups/key-ad02-guest-sessions.html) *(Owner view, charging on, Guest sessions card set to Today)*

- **Session revenue line.** Under the Revenue this month card, a second sub-line reads "Guest sessions: XAF N" / "Séances des invités : N XAF". This is net verified session payments minus their refunds for the gym-local month (`gym_session_revenue_mtd()`). Session payments are excluded from the card's headline (subscription) figure, so this line is **in addition to** the headline, not "of which". It shows when charging is on or session revenue this month is > 0. A sub-line rather than a new stat card keeps row 1 at three cards and follows the shipped fee sub-line pattern. If the read fails, the line hides; the headline still renders.
- **Session-required alerts** arrive in the same Front-Desk Alert Panel at the top (see Cross-Cutting Components). No layout change.
- **Guest sessions card** (Owner, Supervisor, Manager; **absent from the DOM** for Receptionist and Coach, and absent for every role while charging is off):
```
┌─ Guest sessions ───────────────────────────── [ Today | This month ] ─┐
│  41              6                      8                               │
│  Paid sessions   Blocked attempts       Free sessions given             │
│  →               4 members →            →                               │
└─────────────────────────────────────────────────────────────────────────┘
```
  - Placement: its own full-width row **below row 2**, in its own Suspense boundary, because its period control does not fit row 2's four-card grid. It uses the shipped stat-card visual with three `statNumeral`-weight figures.
  - Period control: a segmented control "Today" / "Aujourd'hui" and "This month" / "Ce mois-ci", gym-local. It defaults to Today and is remembered per user in `localStorage` (convenience only).
  - Figures (EN / FR): "Paid sessions" / "Séances payées"; "Blocked attempts" / "Tentatives bloquées" with the sub-line "[N] members" / "[N] membres" (distinct members blocked); "Free sessions given" / "Séances gratuites offertes", which reads 0 until Epic 20 ships.
  - Each figure is a link to AD-22 on the matching tab and period. The card title is fixed: "Guest sessions" / "Séances des invités".
  - Zero values render as "0", not an empty state. When charging is turned off mid-month the card disappears; past data stays reachable through AD-09 (Purpose: Session) and AD-12. There is no "walk-away" metric in V1.6, since FR-163 does not ask for one.
  - **Loading:** one skeleton card at full width. **Error:** "Couldn't load guest sessions." / "Impossible de charger les séances des invités." with [Retry] inside the card. Other cards are unaffected.

---

### AD-03 · Members — List

**Purpose:** Search, filter, and act on the full member roster.

**Layout (desktop):**
```
Members                                [Import CSV]  [Export CSV]
[🔍 Search name or phone]  [Status ▾]              [+ Add Member]

┌─────────────────────────────────────────────────────────────────┐
│ [Av] Name   Phone   Plan   Status   Expiry   Last check-in   Act│
│ ...                                                             │
└─────────────────────────────────────────────────────────────────┘
[← 1 2 3 →]  (25 rows/page)
```

**Components:**
- Search input (name + phone; live filter; 300ms debounce; ✕ to clear)
- Status filter dropdown: All | Active | Expiring Soon | Grace Period | Expired | Deactivated
- "+ Add Member" (Manager+ only; absent for Receptionist)
- "Import CSV" (Manager+ only; opens AD-07 modal)
- "Export CSV" (Receptionist+; exports filtered view; max 1,000 rows; spinner while generating; shows "Apply a filter to narrow results" if > 1,000 rows)
- **Members table:**
  - Columns: Avatar + Name (linked), Phone, Plan, Status badge, Expiry date, Last Check-in, Actions
  - Status badges: Active (green) | Expiring Soon (orange) | Grace Period (orange) | Expired (red) | Deactivated (gray)
  - Actions: "View" (all roles) | "Edit" (Manager+) | "Deactivate" / "Reactivate" (Manager+) | "Invite" (Manager+)
  - Sortable: Name, Status, Expiry Date (arrow indicator on active column)
  - Row click (outside Actions cell) → AD-04
  - Paginated: 25 rows/page

**Empty states:**
- No members: "No members yet. Import a CSV or add one manually." [Import CSV] [Add Member] (Manager+ only sees buttons)
- Search/filter returns nothing: "No members match your search. Try a different name, phone number, or filter."

**Loading:** 8 skeleton rows.

---

### AD-04 · Member — Detail

**Purpose:** Full read/edit view of a single member's record.

**Layout (desktop):**
```
← Members  /  [Member Name]
                                              [Edit] [Deactivate] [Send Invite]
┌────────────────────────────────────────────────────────────────────────────┐
│ [Avatar, 72px]  [Full Name]  [Status badge]                                │
│ Phone: [number]   Plan: [name]   Joined: [date]   Expires: [date]          │
└────────────────────────────────────────────────────────────────────────────┘

[ Subscription ] [ Payments ] [ Attendance ] [ Coach Notes* ]
                                              *visible if coach assigned

[Tab content area]
```

**Components:**
- Breadcrumb: "Members → [Member Name]"
- Member header: avatar, name, status badge, quick stats
- Action buttons (Manager+): Edit → AD-05; Deactivate → confirmation dialog; Send Invite → AD-06 modal
- **Subscription tab:** plan, status, expiry, billing interval, assigned coach; "Renew" button (Manager+) → Inline Renewal Panel
- **Payments tab:** payment history scoped to this member; tappable rows
- **Attendance tab:** check-in/out log for this member; date, time, duration
- **Coach Notes tab** (visible only if member has an assigned coach): Manager/Owner see all coaches' notes; assigned Coach sees only their own; reverse-chronological

**Deactivation confirmation dialog:**
- Title: "Deactivate [Member Name]?"
- Body: "They'll lose gym access immediately. Their history is preserved."
- Reason field (required text input, labeled "Reason for deactivation" — blank blocks confirm)
- Buttons: [Cancel] [Deactivate]

**Shipped drift, recorded V1.6 — member detail is a modal.** The tabbed `/members/:id` page above was never built. Member detail ships as the **View mode of `MemberModal.tsx`**, opened from an AD-03 row. It is a single scrolling modal with read-only Phone, Plan, Join Date, Subscription Status, Expiry Date, and Registration fee fields, plus coach assignment history. V1.6 adds its blocks as **sections inside that modal**, not as new tabs. The tabbed layout stays the target if the page is ever built. **Registration-fee dialogs** (Collect / Waive / Void, Epic 18: `CollectRegistrationFeeDialog`, `WaiveRegistrationFeeDialog`, `VoidRegistrationFeeDialog`, opened from AD-03 row actions) are shipped and not specced in this spine; see Story 18.6 in `epics.md`. V1.6 changes only the Waive dialog's reason field (see AD-05).

**V1.6 — Sessions, Rewards and desk payment *(FR-159, FR-169, FR-170; Stories 19.9, 20.5; user decision 2026-10-11)*:**

```
[Ange T.]  [Pay per session]                 [Record session payment]   ← V1.6 action
Phone … Plan: Drop-in (2,000 XAF / session) …

── Sessions ──────────────────────────────────────────────── V1.6
Unused      Paid · 11 Oct 09:02 · Cash · Aicha M.     Lapses 18 Oct
            Free · earned 02 Oct                       Lapses 01 Dec
Used        Paid · 09 Oct · covered day Thu 09 Oct
Payments    → AD-09 filtered to this member, Purpose: Session

── Rewards ───────────────────────────────────────────────── V1.6
Guest progress       3 / 5        Subscriber progress   0 / 3
Free sessions        1 · lapses 01 Dec
(no edit controls — balances change only by the program's rules)
```

- **[Record session payment] *(user decision 2026-10-11)*.** This is the pre-scan desk entry point for UJ-11's "pays Aicha at the desk, then scans". It is shown in the modal header to every role that can record payments (Receptionist and up), **only** for a member on Pay-per-session, price > 0, at a gym with charging on. Otherwise it is absent from the DOM. It opens the **Record Session Payment Panel** (Cross-Cutting Components), the same panel the session-required alert opens. It is not added to AD-10.
- **Sessions section:** rendered for a Pay-per-session member at a charging gym, or for any member who holds session rows. It lists:
  - **Unused** sessions: source (Paid with time, method, and recorded-by / Free with earned date) and lapse date, soonest first.
  - **Used** sessions: date and covered day.
  - **Lapsed or voided** sessions as muted rows: "Lapsed [date]" / "Expirée le [date]" and "Voided by refund [date]" / "Annulée par remboursement le [date]", for the last 90 days.
  - A link to AD-09 filtered to this member and Purpose: Session.

  Labels (EN / FR): "Sessions" / "Séances"; "Unused" / "Non utilisées"; "Used" / "Utilisées"; "Lapses [date]" / "Expire le [date]"; "Covered day" / "Jour couvert"; "Paid" / "Payée"; "Free" / "Gratuite". **Empty:** "No sessions yet." / "Aucune séance pour le moment."
- **Rewards section:** rendered when the gym's loyalty program is on, or the member holds an unexpired free session (Story 20.5). It shows **both** counters to staff, "Guest progress" / "Progression invité" and "Subscriber progress" / "Progression abonné" ("3 / 5" format), plus free sessions with expiry and unused paid sessions with lapse date (the latter shared with the Sessions section, not repeated). Values come only from `effective_loyalty`. There is **no edit control for any role**, Super Admin included (FR-170), and no "adjust" affordance even disabled. A muted line reads "Balances change only through the program's rules." / "Les soldes ne changent que selon les règles du programme."
- **Coach:** sees nothing new (Story 19.9). Neither section renders in AD-15.

---

### AD-05 · Member — Create / Edit

**Purpose:** Create a new member record or edit an existing one. Manager+ only.

**Presentation:** Full-screen modal on desktop (max-width 640px, centered, scrollable).

**Layout:**
```
[Add Member / Edit Member]                                         [✕]

── Identity ─────────────────────────────────────────────────────────
Full Name *             [                               ]
Phone *                 [+237 ▾] [                     ]
Email                   [                               ]
Date of Birth           [date picker                    ]
Profile Photo           [upload circle + preview        ]

── Membership ───────────────────────────────────────────────────────
Plan *                  [dropdown of gym's plans        ]
Join Date *             [date picker                    ]
Subscription Status *   [Active ▾]
Expiry Date *           [date picker]  (hidden if Pay-per-session)
Billing Interval        [Monthly | Annual]

── Assignment ───────────────────────────────────────────────────────
Assigned Coach          [dropdown of gym coaches        ]
Emergency Contact       [                               ]

[Cancel]                                              [Save]
```

**Interactions:**
- Expiry Date field: hidden (and value cleared) when selected plan type is Pay-per-session
- Coach dropdown: only users with Coach role in this gym
- "Save": validates all required fields; spinner; success → modal closes + list refreshes + toast "Member saved."
- "Cancel": if form is dirty → "Discard changes?" [Discard] [Keep editing]; if clean → close immediately

**V1.6 — "Session guest" waiver preset *(FR-156, Story 19.3)*.** The form itself is unchanged. The shipped Waive registration fee dialog (Epic 18, not specced here; see AD-04's drift note) gains a one-tap preset chip above its Reason field: "Session guest" / "Invité à la séance". Tapping it fills the mandatory reason with that text, which meets the dialog's 10-character minimum. The field stays editable, so free text is still possible. There is no automatic waiver for Pay-per-session plans.

---

### AD-06 · Member — Invite

**Presentation:** Small modal (max-width 480px).

**Layout:**
```
[Member Invite]                                                    [✕]

[Avatar] [Member Name]  ·  [Gym Name]

Invite message:
┌────────────────────────────────────────────────────────────────┐
│ [Member Name], you've been added to [Gym Name] on GymOS.       │
│ Download the app and get started: [deep link]                  │
└────────────────────────────────────────────────────────────────┘
(read-only text box)

[Copy message]   [Share via WhatsApp*]   (* hidden if unavailable)

[Close]
```

**Interactions:**
- "Copy message" → clipboard; button label → "Copied ✓" for 2 seconds
- "Share via WhatsApp": opens WhatsApp with message pre-filled
- Deep link encodes member's phone number for pre-fill at MA-02

---

### AD-07 · CSV Import

**Presentation:** Full-screen modal (max-width 720px). Manager+ only.

**Step 1 — Upload:**
```
[CSV Import]                                                       [✕]

[Download template ↓]

┌────────────────────────────────────────────────────────────────┐
│        Drag your CSV here, or  [Browse]                        │
│        Accepted: .csv files only                               │
└────────────────────────────────────────────────────────────────┘
Selected file: [filename.csv]  [Remove]

[Cancel]                                        [Validate →]
```

**Step 2a — Validation Success:**
```
✓  43 members ready to import. No errors found.

   Preview (first 5 rows):
   Name      | Phone       | Plan    | Status  | Expiry
   Amara K.  | +237 6XX…   | Monthly | active  | 2026-08-01

[Cancel]                                [Confirm Import →]
```

**Step 2b — Validation Failure:**
```
✕  Import blocked — 3 errors found. Correct your CSV and re-upload.

   Row | Column      | Error
   3   | phone       | Invalid format — expected E.164 (+237...)
   7   | plan_type   | Plan "Premium" not configured for this gym
   12  | expiry_date | Required for non-session plans — field is empty

[Cancel]                                [Re-upload CSV]
```

**Post-import (> 100 records):** Progress indicator "Importing 43 of 450 members…" (polling). On complete: modal closes; list refreshes; toast "450 members imported."

**Mid-import failure:** "Import failed. No records were saved (all-or-nothing). Fix and re-import."

---

### AD-08 · Subscriptions

**Purpose:** Full subscription list with renewal capability. Manager+ only.

**Layout (desktop):**
```
Subscriptions

[Status filter ▾]  [Plan filter ▾]                    [Export CSV]

┌─────────────────────────────────────────────────────────────────┐
│ Member      Plan      Status      Expiry    Last Payment   Act  │
│ Amara K.    Monthly   Grace →     Jul 02    Jun 01         [R]  │
│ Jean B.     Monthly   Active      Aug 01    Jul 01          –   │
└─────────────────────────────────────────────────────────────────┘
[← 1 2 3 →]  (25 rows/page)
```

**Components:**
- Filters: Status (All | Active | Expiring Soon | Grace Period | Expired), Plan type
- Export CSV (max 1,000 rows; same column schema as Members export)
- Table sortable: Name, Status, Expiry date
- Expiry date: within 7 days → orange text; past-due → red text
- Actions: "Renew" for non-active → Inline Renewal Panel; "–" for active members
- Paginated: 25 rows/page

**Empty state:** "No subscriptions on record yet."

**V1.6:** the Last Payment column ignores `session` payments, because a session is never a renewal (Architecture Decision AD-27). Session payments are distinguished on AD-09, not here.

---

### AD-09 · Payments

**Purpose:** Full payment ledger with manual payment recording and verification queue.

**Layout (desktop):**
```
Payments                                            [+ Record Payment]

[Date range]  [Method ▾]  [Status ▾]               [Export CSV]

┌─ Verification Queue ─────────────────────────────────────────────┐
│  ⚠  3 payments awaiting verification                             │
│  Member     Amount    Method   Receptionist   Note      Actions  │
│  Amara K.   25,000    Cash     Claire N.      "Paid…"   [Verify] │
│                                                          [Flag]  │
└──────────────────────────────────────────────────────────────────┘

All Payments
┌─────────────────────────────────────────────────────────────────┐
│ Member   Amount   Method   Status    Date    Actor   Note       │
│ ...                                                             │
└─────────────────────────────────────────────────────────────────┘
[← 1 2 3 →]  (50 rows/page)
```

**Components:**
- Date range picker: defaults to today; presets: Today | This week | This month | Custom
- Method filter: All | Mobile Money | Cash | Bank Transfer | Manual Mobile Money
- Status filter: All | Pending Verification | Verified | Flagged | Failed
- Export CSV (max 1,000 rows)
- **Verification Queue section:** rendered only when ≥1 pending item exists; collapsible; per-row: "Verify" → confirmation dialog; "Flag for Review" → reason prompt (required)
- On verify: row disappears from queue; count decrements; status updates in All Payments table
- **All Payments table:** 50 rows/page; sortable by Date (default desc), Amount, Member name
- Discrepancy rows: amber highlight + "Discrepancy" tag in Status column

**Empty states:**
- No payments: "No payments recorded yet."
- Filter returns nothing: "No payments match these filters." [Clear filters]

**V1.6 — Session payments *(FR-158, FR-162; Stories 19.2, 19.4, 19.8, 19.9)*.** The page also ships a [+ Record Refund] action and a Record Refund modal (member → payment to refund → amount → reason ≥ 10 chars) and a Discrepancies section, all undocumented until now. V1.6 amends:

- **Purpose column + filter:** a new filter "Purpose" / "Objet" with All | Renewal | Registration fee | Session. Row labels: "Renewal" / "Renouvellement", "Registration fee" / "Frais d'inscription" (shipped), "Session" / "Séance". The CSV export carries the purpose.
- **Desk session payments** are recorded `verified`, so they never enter the Verification Queue (FR-158). They appear directly in All Payments with the recording staff member as Actor.
- **Flagged reason label *(Story 19.2 `[UX]`)*:** a flagged row shows a reason tag next to the Flagged badge. Wording reuses the shipped Discrepancies vocabulary where it exists:
  | Code | EN | FR |
  |---|---|---|
  | `late_confirmation` | "Confirmed late" | "Confirmé en retard" |
  | `wrong_account` | "Wrong Account Settlement" (shipped) | "Règlement sur le mauvais compte" (shipped) |
  | `expired_attempt` | "Attempt expired" | "Tentative expirée" |
  | `reconciliation_mismatch` | "Amount Mismatch" (shipped) | "Écart de montant" (shipped) |
  A late-confirmed **session** payment shows Verified plus the "Confirmed late" tag, because the session was granted. A wrong-account or mismatch session payment stays a discrepancy row (amber, "Discrepancy" tag) and never shows a linked session.
- **Session refund notices *(FR-162)*.** When the payment picked in the Record Refund modal is a `session` payment, an info box (`{colors.info}` border) above [Record Refund] states what will happen. The text updates live as the amount changes:
  | Case | EN | FR |
  |---|---|---|
  | Full amount, session unused | "This refunds the whole session. [Name]'s unused session will be cancelled and can't be used." | "Ce remboursement couvre toute la séance. La séance non utilisée de [Nom] sera annulée et ne pourra plus servir." |
  | Partial amount, session unused | "This is a partial refund. [Name] keeps the session and can still use it." | "Ceci est un remboursement partiel. [Nom] garde sa séance et peut encore l'utiliser." |
  | Session already used | "This session was used on [date]. The visit stays counted." + when loyalty is on: "The loyalty stamp it earned is removed; a free session already earned is kept." | "Cette séance a été utilisée le [date]. La visite reste comptée." + "Le tampon de fidélité gagné est retiré ; une séance gratuite déjà obtenue est conservée." |
  | Renewal payment, loyalty on | "Loyalty stamps and free days from this renewal are not removed." | "Les tampons de fidélité et jours offerts de ce renouvellement ne sont pas retirés." |
  If a consumption races the refund, the server resolves it to exactly one outcome (Architecture Decision AD-28). The success toast names what actually happened, "Refund recorded. The session was cancelled." / "Remboursement enregistré. La séance a été annulée." or "Refund recorded. The session had already been used." / "Remboursement enregistré. La séance avait déjà été utilisée.", so a race is never hidden.
- **Grouping for AD-22:** paid-session lists group by recording staff on AD-22, not here; AD-09 only filters.

---

### AD-10 · Manual Payment Entry

**Presentation:** Modal (max-width 480px).

**Layout:**
```
[Record Payment]                                                   [✕]

Member *           [Search by name or phone           ▾]
Payment Method *   [Cash ▾]
Amount (XAF) *     [                                  ]
Reason / Note *    [                                  ]
                   [character count: 0 / min 10       ]
Date *             [04 Jul 2026 (today)               ]
Recorded by        [Current user — auto-filled, non-editable]

[Cancel]                                    [Record Payment]
```

**Interactions:**
- Member search: type-to-filter dropdown; name + phone; must select from results
- Amount: numeric; formatted with thousands separator visually; stored as integer
- Note: character count shown; minimum 10 characters
- Date: cannot be a future date
- "Record Payment": spinner; success → modal closes + payment appears in Verification Queue + toast

**V1.6 *(user decision 2026-10-11)*:** unchanged. AD-10 gets **no** Session purpose. Session payments are fixed-price, take effect immediately, and skip the queue (FR-158, amending FR-038), so they are recorded only through the Record Session Payment Panel. That panel opens from the session-required alert, AD-04 [Record session payment], or an AD-18 marking refusal. If AD-10's member search selects a Pay-per-session member at a charging gym, a hint under the member field reads "To sell a session, use Record session payment on the member's page." / "Pour vendre une séance, utilisez Enregistrer le paiement de la séance sur la fiche du membre." The hint stops a session being recorded as a free-amount payment.

---

### AD-11 · Attendance

**Purpose:** View who is currently in the gym; manage check-in log; see front-desk alerts.

**Layout (desktop):**
```
Attendance

[Front-Desk Alert Panel — identical to AD-02, real-time]

Currently Checked In   (N members)                      [Refresh]
┌─────────────────────────────────────────────────────────────────┐
│ Name          Check-in time   Status          [Check Out]       │
└─────────────────────────────────────────────────────────────────┘

Daily Log
[Date range filter]  [🔍 Member search]

┌─────────────────────────────────────────────────────────────────┐
│ Member        Check-in       Check-out     Duration             │
│ Amara K.      08:14 AM       10:02 AM      1h 48m               │
│ Jean B.       09:30 AM       —             Open                 │
└─────────────────────────────────────────────────────────────────┘
[← 1 2 3 →]  (50 rows/page)
```

**Components:**
- **Front-Desk Alert Panel** (identical to AD-02 — same real-time alerts)
- **Currently Checked-In table:** refreshes via Supabase Realtime; "Check Out" per row → "Check out [Name]?" [Check Out] [Cancel]; records checkout + audit log
- **Daily Log:** date range picker (defaults to today); member search; 50 rows/page; sortable by check-in time

**Empty states:**
- Checked-in: "No one is checked in right now."
- Log: "No check-ins recorded for this period."

**V1.6 *(FR-160)*:** the alert panel gains the session-required variant (Cross-Cutting Components). A blocked guest scan is **not** an attendance event, so it never appears in Currently Checked-In or the Daily Log. Blocked attempts are listed only on AD-22.

---

### AD-18 · Classes — List & Attendance *(V1.5)*

**Purpose:** View scheduled classes and sessions, booking counts, and mark attendance. Receptionist+ can view and mark attendance; create/edit is Manager+ only (AD-19).

**Layout:**
```
Classes                                            [+ Create class]  ← Manager+ only

┌─────────────────────────────────────────────────────────────────┐
│ Class      Coach       Schedule           Next session  Booked   │
│ HIIT       Emmanuel    Tue/Thu 6:00 PM    Tue Aug 12     8/15    │
│ Yoga       Fatima      Wed 7:00 AM        Wed Aug 13    15/15    │
└─────────────────────────────────────────────────────────────────┘

[Row expanded — Tue Aug 12 session]
┌─────────────────────────────────────────────────────────────────┐
│ Booked members                              [Mark attendance]    │
│ Amara K.                                    [ ] Attended         │
│ Jean B.                                     [ ] Attended         │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- Class list: name, assigned coach, schedule (one-off date or recurring pattern), next upcoming session date, booking count vs. capacity for that session
- Row click expands to the next session's booked-member list (Receptionist+): checkbox per member to mark attendance; an expired member's checkbox is disabled with the same front-desk-alert trigger as floor check-in (FR-107) — attendance marking is rejected the same way, and it surfaces the alert
- "+ Create class" button: Manager+ only, absent from the DOM for Receptionist — opens AD-19
- Class row also has an "Edit" action (Manager+ only) → opens AD-19 pre-filled

**Empty state:** "No classes scheduled yet." + [+ Create class] (Manager+ only; Receptionist sees the message with no action)

**V1.6 — Marking a session guest *(FR-174, Story 19.7)*.** This applies to a Pay-per-session member, price > 0, at a gym with charging on.
- The guest's "Attended" checkbox stays **enabled**, unlike an expired member's. The list does not know in advance whether a guest holds a session, and the story specifies refusal-then-action.
- **Has a usable session, or today is already covered:** marks normally. It consumes a session only if none covers the gym-local day yet; a second class or a floor visit the same day costs nothing. No extra UI.
- **No usable session (`session_required`):** the checkbox reverts to unchecked. An inline row message (`{colors.info}` left border, `role="alert"`) appears under the member's name:
  ```
  Ange T.                                              [ ] Attended
  ▏ No paid session — attendance was not recorded.
  ▏ A front-desk alert has been raised.        [Record session payment]
  ```
  EN: "No paid session — attendance was not recorded. A front-desk alert has been raised." FR: "Aucune séance payée — la présence au cours n'a pas été enregistrée. Une alerte a été envoyée à l'accueil." This follows the shipped `classes.attendance.memberExpired` pattern. [Record session payment] / [Enregistrer le paiement de la séance] opens the Record Session Payment Panel in place. On success the inline message changes to "Session recorded — mark attendance again." / "Séance enregistrée — marquez à nouveau la présence.", and the checkbox regains focus. The receptionist re-checks it; the system does not auto-mark. The refusal counts as a blocked attempt and raises the same alert (FR-174).
- Re-marking a member already marked attended is a no-op.
- FR strings for class occurrences on this page follow the session/class terminology rule (Voice and Tone): "Prochaine séance" → "Prochain cours", "Aucune séance à venir" → "Aucun cours à venir".

---

### AD-19 · Classes — Create / Edit *(V1.5, modal on AD-18)*

**Purpose:** Manager or Owner defines a class's schedule and capacity.

**Layout:**
```
Create Class                                          [x]

Name *              [                          ]
Description         [                          ]
Assigned Coach *     [Select coach ▾]
Capacity *           [  15  ] members

Schedule *
  ○ One-off    ● Recurring
  Days          [Tue] [Thu]
  Time          [ 6:00 PM ]
  Starting      [ 12 Aug 2026 ]

                                    [Cancel]  [Create class]
```

**Component behaviors:**
- Coach dropdown: lists this gym's Coach-role staff only (tenant-scoped)
- Capacity: positive integer, minimum 1
- Schedule: one-off requires a single date+time; recurring requires ≥1 day-of-week + a time + a start date
- Save: validates all required fields inline before submit; on success, closes modal and the new/edited class appears in AD-18's list immediately

---

### AD-12 · Audit Log

**Purpose:** Read-only, append-only action record. Manager+ only.

**Layout:**
```
Audit Log

[Date range]  [Actor ▾]                    [Export CSV — Owner only]

┌─────────────────────────────────────────────────────────────────┐
│ Timestamp     Actor        Action         Target      Details   │
│ 08:22 AM      Claire N.    Payment entry  Amara K.    Cash…     │
│ 08:22 AM      System       pg_cron run    —           Success   │
└─────────────────────────────────────────────────────────────────┘
[← 1 2 3 →]  (50 rows/page; default: newest first)
```

**Read-only enforcement (critical):**
- No hover state implying editability on any row
- No right-click context menu
- No row selection checkbox
- No edit, delete, or flag buttons anywhere on this page

**Components:**
- Date range picker (default: last 7 days)
- Actor filter: dropdown from all actors in this gym's log
- Export CSV (Owner only)
- Table columns: Timestamp, Actor (display name + role), Action type, Target entity, Details (key-value pairs)

**Empty state:** "No audit records for this period."

**V1.6 — New action labels *(FR-080 amended by FR-157, FR-162, FR-164, FR-170, FR-171, FR-173)*.** Settings changes show "old → new" in Details. Rule-driven events (consumption, stamps, lapses, resets) show Actor "System" when no staff member acted.

| Event | EN | FR |
|---|---|---|
| Charge guests toggled | "Charge guests per session changed" | "Facturation des invités à la séance modifiée" |
| Desk session payment | "Session payment recorded" | "Paiement de séance enregistré" |
| Tara session payment | "Session paid by Tara Money" | "Séance payée par Tara Money" |
| Late Tara confirmation | "Session paid late by Tara Money (session granted)" | "Séance payée en retard par Tara Money (séance accordée)" |
| Session consumed | "Session used" | "Séance utilisée" |
| Blocked attempt | "Check-in blocked — no paid session" | "Enregistrement bloqué — aucune séance payée" |
| Refund voids session | "Session cancelled by refund" | "Séance annulée par remboursement" |
| Refund after consumption | "Refund of a used session" | "Remboursement d'une séance utilisée" |
| Paid session lapsed | "Paid session lapsed" | "Séance payée expirée" |
| Plan type/price changed | "Plan type or price changed" | "Type ou prix de formule modifié" |
| Loyalty config changed | "Loyalty program changed" | "Programme de fidélité modifié" |
| Stamp earned | "Loyalty stamp earned" | "Tampon de fidélité gagné" |
| Stamp reversed | "Loyalty stamp removed (refund)" | "Tampon de fidélité retiré (remboursement)" |
| Reward granted | "Loyalty reward granted" | "Récompense de fidélité accordée" |
| Free session used | "Free session used" | "Séance gratuite utilisée" |
| Free session lapsed | "Free session lapsed" | "Séance gratuite expirée" |
| Progress reset | "Loyalty progress reset" | "Progression de fidélité remise à zéro" |
| Category changed | "Gym category changed" | "Catégorie de la salle modifiée" |

Labels follow the shipped `audit.actionTypes` style (short, past tense, sentence case). The exact event-code-to-label mapping is settled in each story.

---

### AD-13 · Settings

**Purpose:** Gym configuration. Owner and Supervisor *(V1.5: "Manager-plus" access — Supervisor gets the same Settings footprint as Owner)*.

**Layout:**
```
Settings                                              [Save Settings]

── Branding ──────────────────────────────────────────────────────────
Gym Name *         [                               ]
Logo               [preview thumbnail] [Upload new] [Remove]
Primary Colour *   [#E0971F  ] [live color swatch]

── Localization ──────────────────────────────────────────────────────
Default Language   [English ▾]
Timezone *         [Africa/Douala (GMT+1) ▾]

── Membership ────────────────────────────────────────────────────────
Grace Period *     [  3  ] days
Gym Capacity *     [ 50  ] members

── Front-Desk Alerts ─────────────────────────────────────────────────
Alert auto-dismiss [ 30  ] minutes

── QR Code ───────────────────────────────────────────────────────────
[QR code preview, 120×120px]
[Download QR code ↓]   [Regenerate QR code]

── Staff ──────────────────────────────────────────────────────────── V1.5
[N] staff members                              [Manage staff →]  ← opens AD-16

── Payment Account ───────────────────────────────────────────────────  V1.5
Tara Money           [Not connected]     [Connect payment account →]

── Charge guests per session ──────────────────────────────────────── V1.6
Charge guests per session   [ Off ◯ ]   ← writes on confirm, not on Save Settings
Pay-per-session members need a paid session to check in or attend a class.
One session covers the whole day.

── Loyalty program ────────────────────────────────────────────────── V1.6
Loyalty program             [ Off ◯ ]
Guests      1 free session every [  5 ] paid sessions        (2–50)
            ≈ 17% — 1 free session per 5 paid
Subscribers [ 30 ] free days every [  3 ] on-time renewals   (1–30 days, 3–24 renewals)
            ≈ 25% — 30 days per 3 renewals of a 30-day plan (Monthly)
ⓘ Guests earn nothing while Charge guests per session is off.   ← only when charging is off
                                              [Save loyalty program]
```
*(V1.6: **Category** sits in the Branding block, under Primary Colour — `Category  [Gym ▾]  [Save category]`.)*

**Component behaviors:**
- Primary Colour hex input: live swatch updates as user types valid hex
- Logo upload: image/* only; max 5MB; preview updates after selection; gym name is fallback if no logo
- QR Download: PNG download of current code
- QR Regenerate: confirmation dialog before action (see below)
- Save: single button saves all sections; spinner; success toast "Settings saved."
- **Staff row** *(V1.5)*: shows a live count; "Manage staff →" navigates to AD-16 (its own page, not inline — the list/add/edit/deactivate interaction is too involved for an inline section)
- **Payment Account row** *(V1.5, FR-126)*: shows connection status ("Not connected" / "Connected — [merchant name]"); "Connect payment account →" opens the connect flow below. This row is purely additive — a gym with no Tara Money connection keeps operating on cash and manual entry exactly as before (FR-127); nothing here is a prerequisite for anything else in Settings

**Regenerate QR confirmation:**
- Title: "Regenerate QR code?"
- Body: "This will invalidate the current code immediately. Any printed or displayed copies will stop working. You will need to replace them."
- [Cancel] [Regenerate]

**Connect Payment Account flow** *(V1.5, FR-126, modal on AD-13)*:
```
Connect Payment Account                                [x]

Connect your gym's own Tara Money account so member
mobile-money payments settle directly to you.

Tara Money Merchant ID *    [                    ]
Tara Money API Key *        [                    ]

  This is stored encrypted and is never shown again
  after saving, including to you.

                                    [Cancel]  [Connect]
```
- On save: credentials are sent directly to the payment service and stored in Supabase Vault — never persisted client-side, never logged (NFR-017)
- On success: modal closes, Settings row updates to "Connected — [merchant name]"; a "pay by Tara Money" action now appears alongside cash wherever a payment is collected (front desk, member self-service renewal)
- On failure (invalid credentials): inline error below the API Key field, connection status unchanged
- **Disconnect / credentials invalid in production:** if a connected gym's credentials become invalid or are revoked, the Owner sees a persistent Settings banner ("Your payment account needs attention — reconnect to keep accepting Tara Money") rather than a silent failure (FR-128); mobile-money payment attempts fail gracefully for members in the meantime and direct them to the front desk

**Shipped drift, recorded V1.6:** the Membership block also carries a **Registration fee** field (XAF, "0 means no registration fee") with its own [Save fee] button and toast "Registration fee saved." (Epic 18, Story 18.1). It is outside the Save Settings payload, written by its own setter (Architecture Decision AD-32). It is not specced further here. Its per-field save is the precedent the V1.6 sections follow.

**V1.6 — Save model *(Architecture Decision AD-32; Story 21.2)*.** Each V1.6 setting has its own setter RPC, so each V1.6 section **saves on its own** and is **excluded from [Save Settings]**. A general save can therefore never revert, or be blocked by, a V1.6 setting. The page hint "Save applies changes across every section below." gains the clause "…except Registration fee, Charge guests per session, Loyalty program and Category, which save on their own." / "…sauf Frais d'inscription, Facturation des invités à la séance, Programme de fidélité et Catégorie, qui s'enregistrent séparément." Unsaved edits in a V1.6 section are kept when [Save Settings] runs, and vice versa.
| Section | Write trigger | Confirmation | Success toast (EN / FR) |
|---|---|---|---|
| Charge guests per session | Toggle → dialog → [Start charging] / [Stop charging] | Always, both directions | "Guests now pay per session." / "Les invités paient désormais à la séance." · "Guests no longer pay per session." / "Les invités ne paient plus à la séance." |
| Loyalty program | [Save loyalty program] / [Enregistrer le programme de fidélité] | None (inline notes instead) | "Loyalty program saved." / "Programme de fidélité enregistré." |
| Category | [Save category] / [Enregistrer la catégorie], enabled only when changed | None | "Category saved." / "Catégorie enregistrée." |

**V1.6 — Charge guests per session *(FR-157, Story 19.9)*.** Owner and Supervisor only; absent from the DOM for everyone else. Label: "Charge guests per session" / "Faire payer les invités à la séance". Helper: "Pay-per-session members need a paid session to check in or attend a class. One session covers the whole day." / "Les membres en Paiement à la séance doivent avoir une séance payée pour s'enregistrer ou assister à un cours. Une séance couvre toute la journée." The toggle does not flip until the dialog is confirmed. Cancel leaves it unchanged.

*Turn-on confirmation* (modal; Escape disabled, as for other confirmations with consequences):
```
Start charging guests per session?                                    [✕]

12 Pay-per-session members will need a paid session at their next visit.

This applies from now on. Past visits and anyone already checked in
are not affected.

⚠ Guests using an older version of the member app will see an
  "expired" message when refused, until they update the app.

[Cancel]                                            [Start charging]
```
- Title: "Start charging guests per session?" / "Faire payer les invités à la séance ?"
- Count line (fixed template, Story 19.9; plural-aware; count from `guest_charging_impact()`): "[N] Pay-per-session members will need a paid session at their next visit." / "[N] membres en Paiement à la séance devront avoir une séance payée lors de leur prochaine visite." For one member: "1 Pay-per-session member will need…" / "1 membre en Paiement à la séance devra…". For zero: "No members are on a Pay-per-session plan yet." / "Aucun membre n'a encore de formule Paiement à la séance."
- Scope line: "This applies from now on. Past visits and anyone already checked in are not affected." / "Cela s'applique à partir de maintenant. Les visites passées et les membres déjà présents ne sont pas concernés."
- Old-app warning (decision 1, 2026-10-11; `{colors.warning}` box with `warning` icon): "Guests using an older version of the member app will see an "expired" message when refused, until they update the app." / "Les invités qui utilisent une ancienne version de l'application verront un message « adhésion expirée » en cas de refus, jusqu'à ce qu'ils la mettent à jour."
- Buttons: [Cancel] / [Annuler] and [Start charging] / [Activer la facturation]. The confirm button is labelled with the action (Accessibility Floor).
- If the count fails to load: the count line reads "Couldn't count affected members." / "Impossible de compter les membres concernés." with [Retry]. [Start charging] stays disabled until the count loads, because FR-157 requires the owner to see it before confirming.

*Turn-off confirmation* (sources require none; added because the switch is a kill switch with member-visible effect):
- Title: "Stop charging guests per session?" / "Arrêter de faire payer les invités à la séance ?"
- Body: "From now on, Pay-per-session members check in without a paid session. Sessions already paid are kept but not used while charging is off, and still lapse 7 days after payment." / "Dès maintenant, les membres en Paiement à la séance s'enregistrent sans séance payée. Les séances déjà payées sont conservées mais non utilisées tant que la facturation est désactivée, et expirent toujours 7 jours après le paiement." If loyalty is on, add: "Guests stop earning loyalty stamps." / "Les invités cessent de gagner des tampons de fidélité."
- Buttons: [Cancel] / [Annuler] and [Stop charging] / [Arrêter la facturation].

**V1.6 — Loyalty program *(FR-164, FR-165, Story 20.5)*.** Owner and Supervisor only. Section title "Loyalty program" / "Programme de fidélité". Switch label "Loyalty program" / "Programme de fidélité".
- **Fields:**
  - "Guests: 1 free session every [N] paid sessions" / "Invités : 1 séance gratuite toutes les [N] séances payées" (N 2–50).
  - "Subscribers: [R] free days every [K] on-time renewals" / "Abonnés : [R] jours offerts tous les [K] renouvellements à temps" (R 1–30, K 3–24).
  - Each input shows its range as helper text, for example "2 to 50" / "de 2 à 50".
  - While the switch is off, the inputs are disabled and keep their last values. Saving with the switch off stores only the switch. N/K/R are required only when switching on, and empty on a gym that never configured them.
- **Live discount readout** (Story 20.5 `[UX]`), recomputed as the user types and shown under each rule in `small` muted text with `aria-live="polite"`:
  - Guest: "1 free session per [N] paid ≈ [x]%" / "1 séance gratuite pour [N] payées ≈ [x] %", where x = round(100 / (N + 1)).
  - Subscriber: "[R] days per [K] renewals of a [D]-day plan ≈ [x]%" / "[R] jours pour [K] renouvellements d'une formule de [D] jours ≈ [x] %", where x = round(100 × R / (K × D + R)).
  - "≈" is used (epics wording) over the PRD's "= about"; its accessible text reads "about" / "environ".
  - D comes from the gym's own active non-session plans: one readout line per distinct duration, naming the plan ("…of a 30-day plan (Monthly)"), up to 3 lines. With no subscription plans, the subscriber readout is hidden. A single assumed 30-day plan would misstate the cost for annual plans.
  - Out-of-range input hides that readout rather than computing a nonsense percent.
- **Charging-off notice** (FR-157/FR-165): when Charge guests per session is off, an info line under the Guests rule reads "Guests earn nothing while Charge guests per session is off." / "Les invités ne gagnent rien tant que la facturation à la séance est désactivée."
- **Lowered-threshold note** (FR-164): when N or K is lower than the saved value, this shows above the save button before saving: "Members already at or above the new number earn one reward at their next qualifying visit or renewal. No progress is erased." / "Les membres déjà au niveau du nouveau seuil ou au-delà gagnent une récompense lors de leur prochaine visite ou renouvellement éligible. Aucune progression n'est effacée."
- **Switching off**: an inline note (no dialog) while the switch is off and unsaved reads "No new stamps are earned while the program is off. Free sessions already earned stay usable until they lapse." / "Aucun tampon n'est gagné tant que le programme est désactivé. Les séances gratuites déjà obtenues restent utilisables jusqu'à leur expiration."
- Validation: see Form Validation Rules. The 7-, 60-, and 90-day windows are platform data with no UI in V1.6 (Story 20.1).

**V1.6 — Category *(FR-171, Story 21.2)*.** Owner and Supervisor only. It sits in the Branding (gym profile) block. Label "Category" / "Catégorie". A select of five options showing labels in the user's language: Gym / Salle de sport, Pilates Studio / Studio Pilates, Yoga Studio / Studio Yoga, Fitness Center / Centre de fitness, Other / Autre (user decision 2026-10-11, Story 21.1 pairs canonical). Helper text: "Describes your business. It doesn't change how GymOS works." / "Décrit votre activité. Cela ne change pas le fonctionnement de GymOS." "Other" has no free-text field. Saved by its own [Save category] through `set_gym_category`. It is **not** part of the Save Settings payload. A refusal shows the typed error inline: "Couldn't save the category. Try again." / "Impossible d'enregistrer la catégorie. Réessayez." A no-op save (same value) is disabled.

---

### AD-16 · Staff — List *(V1.5)*

**Purpose:** Owner or Supervisor views and manages their gym's staff. FR-120.

**Layout:**
```
← Settings  /  Staff                                  [+ Add staff]

┌─────────────────────────────────────────────────────────────────┐
│ Name          Role            Status              │
│ Aicha M.      Receptionist    Active               │
│ Emmanuel T.   Coach           Active               │
│ Fatima B.     Supervisor      Pending activation    │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- List: name, role, status (Active / Pending activation / Deactivated)
- Row click → inline expand or a lightweight detail panel with Edit and Deactivate actions
- "+ Add staff" opens AD-17
- Visible to Owner and Supervisor only — absent from the sidebar/DOM for every other role, including Manager (FR-089: Manager gets no staff-creation grant at all, not even a hidden one)

**Edit action:**
- Opens AD-17 pre-filled with the staff member's current name/role
- **Role-ceiling enforcement (NFR-013):** the Role dropdown only ever offers roles the acting user is structurally permitted to assign — an Owner sees Supervisor/Manager/Receptionist/Coach; a Supervisor sees only Manager/Receptionist/Coach (never Supervisor or Owner). This isn't just a UI filter — `update_staff_role()`'s RPC allowlist rejects the same set server-side, so the UI constraint and the enforcement are the same boundary, not two separately-maintained lists
- Editing your own row: the Role field is present but disabled with a tooltip "You can't change your own role" — self-escalation is rejected at the RPC layer regardless, this just avoids a round-trip to discover that

**Deactivate action:**
- Confirmation dialog, **reason required** (free text, not optional): "Deactivate [Name]? They'll lose gym access immediately. Reason (required): [________]"
- [Cancel] [Deactivate]
- On confirm: status updates to "Deactivated" in the list immediately (this is enforced at the RLS/auth-hook layer, not just a status flag — see the Immediate Access Revocation state pattern)
- If the deactivated staff member is a Coach: no additional warning — their session notes and any authored workout plans are retained and stay visible to Owner/Manager per FR-089's data-retention rule; this is silent/automatic, not a choice presented in the dialog

**Empty state:** "No staff yet. Add your first staff member to get started." + [+ Add staff]

---

### AD-17 · Staff — Add / Edit *(V1.5, modal on AD-16)*

**Purpose:** Create a new staff account or edit an existing one, with the role-ceiling enforced in the form itself.

**Layout:**
```
Add Staff Member                                       [x]

Full Name *          [                          ]
Phone (E.164) *      [ +237                     ]
Role *                [Select role ▾]              ← options are role-ceiling-filtered, see AD-16

                                    [Cancel]  [Create]
```

**Component behaviors:**
- Phone: E.164 format validation inline (e.g. "+237 6XX XXX XXX"), same pattern as the Member Create form
- Role dropdown: filtered per the acting user's own role (see AD-16's Edit action note) — a Manager never reaches this screen at all (FR-089)
- On Create: calls `create_staff_member()`; on success, modal closes and the new staff member appears in AD-16's list with status "Pending activation"; an SMS with a temporary password and the dashboard link is sent automatically (Story 9.2, reusing the existing Story 1.11 temp-password mechanism) — no separate "send invite" step
- On rejection (role-ceiling check fails server-side, e.g. a stale client trying to assign a role the RPC no longer permits): inline error "You don't have permission to assign that role," Role field highlighted

---

### AD-14 · Coach Portal — Member List

**Purpose:** Coach's view of their assigned members only. Coach role only.

**Layout:**
```
Coach Portal

[🔍 Search by name]   [Sort: Name ▾]

┌─────────────────────────────────────────────────────────────────┐
│ [Av] Name         Plan         Status       Expiry   Last note  │
│      Amara K.     Monthly      Active        Aug 01  "Focused…" │
│      Jean B.      Coach inc.   Expiring!    Jul 07   —          │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- Search (name only; scoped to assigned members)
- Sort: Name A–Z / Z–A | Status | Expiry date
- Columns: Avatar + Name, Plan, Status badge (read-only; informational), Expiry date, Last note snippet
- Row click → AD-15
- No payment, deactivation, or settings actions — absent from the DOM for Coach role

**Empty state:** "No members have been assigned to you yet. Ask your Manager, Owner, or Supervisor to assign members." *(V1.5, Story 9.4: copy amended to include all three roles that can now perform assignment — was "Ask your manager" only, predating the Supervisor role)*

---

### AD-15 · Coach Portal — Member Detail

**Purpose:** Coach views an assigned member's profile and manages session notes, progress trends, and their workout plan.

**V1.5 change:** restructured from a single Session Notes view into three tabs — Session Notes (unchanged from V1.0) plus two new tabs, Progress and Workout Plan (FR-122). Confirmed with user (2026-08-11): desktop three-tab layout, distinct from the Member App's separate 5-tab bottom nav decision.

**Layout:**
```
← Coach Portal  /  [Member Name]

┌────────────────────────────────────────────────────────────────┐
│ [Avatar, 56px]  [Full Name]              [Status badge]        │
│ Plan: [name]    Expires: [date]                                │
│ Goal: [goal]    Experience: [level]                            │
│ Phone: [number]                                                │
└────────────────────────────────────────────────────────────────┘

[Amber info bar — shown if expired]
"This member's membership has expired. Contact your receptionist."

┌─────────────┬──────────────┬────────────────┐
│ Session Notes│  Progress   │  Workout Plan  │  ← tabs, V1.5
└─────────────┴──────────────┴────────────────┘
```

**Session Notes tab (unchanged from V1.0):**
```
Session Notes                                        [+ Add note]

────────────────────────────────────────────────────────────────
[Note text]
Fatima B.  ·  04 Jul 2026, 09:22        [Edit — own notes only]
────────────────────────────────────────────────────────────────
```
- "**+ Add note**": opens inline textarea at the top of the notes list; auto-expands; character count shown; [Save note] [Cancel]
- **Note editing (own notes only):** "Edit" appears on hover; inline editable textarea; saved note shows "Edited [timestamp]" appended
- Coach cannot edit other coaches' notes
- **Empty state:** "No session notes yet. Add the first note above."

**Progress tab** *(V1.5, FR-122, Story 10.4)*:
```
[Same weight trend chart + measurements as MA-15, read-only]

Shared Photos
[thumb] [thumb]                          ← only photos this member has shared with THIS coach

Coach Notes                                           [+ Add note]
[Note text]  ·  Emmanuel T.  ·  04 Jul 2026
```
- Weight/measurement trends and shared-photo timeline: same visual pattern as the member's own MA-15, read-only for the coach
- **Never shows unshared photos** — a photo with sharing off is absent from this view entirely, not shown blurred or locked (Story 10.4)
- Coach can add a note (same interaction pattern as Session Notes) but **cannot edit or delete the member's own progress entries** — those stay member-owned
- **Empty state:** "No progress data logged yet."
- If this member is not currently assigned to this coach and the coach reaches this URL by any means (e.g. a stale bookmark after reassignment): the tab is invisible/unreadable, RLS blocks the query the same way it already blocks an unassigned member's profile (Story 10.4)

**Workout Plan tab** *(V1.5, FR-122, Story 13.2)*:
```
[Plan Name]                                    [Edit]  [+ New plan]

1. Squat            3 sets × 10 reps
   Note: "focus on depth"
2. Bench Press       3 sets × 8 reps
3. Deadlift          1 set × 5 reps
   [drag handle — reorder]
```
- Ordered exercise list: each row has exercise name (from the shared library, Story 13.1), sets, reps, an optional note; drag-to-reorder
- Exercises are added from the shared library — platform defaults plus this gym's own custom entries (Story 13.1); no free-typing an exercise name outside the library
- Edits save immediately; the member sees the update on their next app open (no push notification for plan edits)
- A plan belongs to exactly one member — there's no "assign to another member" action anywhere on this screen (FR-110)
- **Coach reassignment / plan handoff** (Story 13.4): if this plan was authored by a previous coach, this coach sees it (read-only) with a banner — "This plan was written by [Previous Coach Name]. Take ownership to make changes." [Take ownership] — until they explicitly take ownership, Edit/reorder controls are disabled, mirroring the V1.0 session-note handoff pattern
- **Empty state:** "No workout plan yet." + [+ New plan]

---

### AD-20 · Coach Portal — Overview

**Purpose:** The Coach's portal home. Summarises their own caseload — what they are teaching, who needs them, who has been active. Coach role only. *(V2, FR-146.)*

**Layout:**
```
Coach Portal
[ Overview ] [ My Members ] [ My Classes ]        ← Portal sub-nav (FR-144)

┌──────────────────────────┐ ┌──────────────────────────┐
│ My Next Sessions         │ │ My Members At A Glance   │
│ Mon 18:00 · HIIT  8/15   │ │ 12 assigned              │
│ Wed 07:00 · Core  5/10   │ │ 9 active · 2 expiring    │
│ Fri 18:00 · HIIT 11/15   │ │ 1 expired                │
│                [All →]   │ │                [All →]   │
└──────────────────────────┘ └──────────────────────────┘
┌──────────────────────────┐ ┌──────────────────────────┐
│ Needs Follow-Up          │ │ Recent Progress Activity │
│ Amara K.   no note 21d   │ │ Jean B.   logged 2d ago  │
│ Jean B.    no note yet   │ │ Amara K.  logged 5d ago  │
└──────────────────────────┘ └──────────────────────────┘
```

**Components:**
- **Portal sub-navigation:** Overview (AD-20) · My Members (AD-14) · My Classes (AD-21); active surface indicated; renders on all three routes plus AD-15
- **My Next Sessions:** upcoming `class_sessions` for classes where `coach_id` is this Coach, with `scheduled_at` and booked/capacity; row → that class in AD-21
- **My Members At A Glance:** assigned-member count broken down by subscription status; "All →" links to AD-14
- **Needs Follow-Up:** assigned members whose most recent session note *authored by this Coach* is older than the follow-up threshold, or who have no note at all; row → AD-15 Session Notes tab. Threshold: 14 gym-local calendar days *(decided 2026-09-10, Story 17.5)*
- **Recent Progress Activity:** assigned members who logged progress entries recently; row → AD-15 Progress tab. "Recently": latest entry within the last 7 gym-local calendar days *(decided 2026-09-10, Story 17.5)*. **Progress photos are never surfaced here** — `progress_photos` carries its own separate sharing consent, and logging an entry is not consent to appear photographically on a summary screen
- Check-in recency is deliberately **not** a Needs Follow-Up signal — the Coach role has no read access to attendance events, and this screen does not widen that

**Empty state (no assigned members at all):** the AD-14 copy rather than four empty widgets — "No members have been assigned to you yet. Ask your Manager, Owner, or Supervisor to assign members." *(Amended 2026-09-10, Story 17.5, decided with the product owner: when the Coach has no assigned members but does have upcoming sessions, My Next Sessions still renders, with this copy in place of the three member widgets. The page is only this copy when there are no assigned members and no upcoming sessions.)*

**Loading:** 4 skeleton widget cards. Each widget reads a different source; any one failing renders its own error state while the other three still render.

---

### AD-21 · Coach Portal — My Classes

**Purpose:** The classes this Coach is assigned to teach, and who is booked into each session. Read-only. Coach role only. *(V2, FR-145.)*

**Layout:**
```
Coach Portal
[ Overview ] [ My Members ] [ My Classes ]

┌────────────────────────────────────────────────────────────────┐
│ HIIT Circuit          Mon/Wed/Fri 18:00      Capacity 15       │
│  ▾ Fri 12 Sep · 18:00                             11/15 booked │
│      Amara K.          ✓ attended                              │
│      Jean B.           —                                       │
│      Fatima N.         —                                       │
│  ▸ Mon 15 Sep · 18:00                              8/15 booked │
├────────────────────────────────────────────────────────────────┤
│ Core Strength         Wed 07:00               Capacity 10      │
│  ▸ Wed 17 Sep · 07:00                              5/10 booked │
└────────────────────────────────────────────────────────────────┘
```

**Components:**
- Class list: only classes whose `coach_id` resolves to this Coach's own member row, resolved server-side from the session — never from a client-supplied coach ID
- Per class: name, schedule, capacity; expandable to its sessions from 00:00 today in the gym's timezone onward (not strictly future — today's session stays visible with its attendance), each with `scheduled_at` and booked count *(amended 2026-09-10, Story 17.4)*
- **The class list, sessions and booked counts are served by a `SECURITY DEFINER` function, `list_my_classes()`, returning aggregates only — no member identity.** A Coach has no RLS read on `class_bookings`, so counts cannot come from plain reads. Times are shown in the gym's timezone, 24-hour *(amended 2026-09-10, Story 17.4)*
- Per session: the booked-member roster — name and attendance status only
- **The roster is served by a `SECURITY DEFINER` RPC returning exactly `(member_id, member_name, attended_at)`.** It cannot be built from plain RLS reads: a Coach's `members` access is limited to their *assigned* members, and most people booked into a class are not their coaching clients, so a direct read would render blank names. The RPC also avoids exposing member phone numbers, which a row-level widening would have handed over
- **No write controls anywhere on this screen** — no create, edit, reschedule, or mark-attendance action, absent from the DOM rather than disabled. Class creation/editing is Manager/Supervisor/Owner (AD-19); class attendance is Receptionist-and-above. `attended_at` is displayed as read-only status
- A Coach reaches a roster only for a session belonging to one of their own classes; another coach's session, another gym's session, and a deactivated Coach all return empty

**Empty state:** "You are not assigned to any classes yet. Your manager schedules classes and assigns a coach."

**Loading:** 3 skeleton class rows.

**V1.6 *(FR-174)*:** no change. The roster stays read-only with no mark control, so a Coach can never mark a charging-gym guest attended.

---

### AD-22 · Guest Sessions (drill-down) *(V1.6, FR-163, Story 19.10)*

**Purpose:** Answers "is the desk collecting?" behind each figure on the AD-02 Guest sessions card. Owner, Supervisor, and Manager only. The RPCs refuse other roles. This is one new page with three tabs, because no existing surface lists blocked attempts or free sessions, so a new list was unavoidable. Paid sessions could have been an AD-09 filter, but grouping by staff and the refunds-after-use flag need their own columns.

**Layout:**
```
← Overview  /  Guest sessions                       [ Today | This month ]

[ Paid (41) ] [ Blocked attempts (6) ] [ Free given (8) ]

Paid — grouped by: [ Recorded by ▾ | None ]
┌──────────────────────────────────────────────────────────────────────────┐
│ ▾ Aicha M. — 29 sessions · 58,000 XAF                                     │
│   Member     Time           Method      Used          Refund              │
│   Ange T.    11 Oct 09:02   Cash        Thu 11 Oct    —                   │
│   Paul E.    11 Oct 17:40   Cash        —             Refunded after use  │
│ ▸ Tara Money (in app) — 9 sessions · 18,000 XAF                           │
└──────────────────────────────────────────────────────────────────────────┘
```

**Tabs** (labels EN / FR; counts match the card for the same period):
- **Paid** / **Payées**
  - Columns: Member, Time, Method, Recorded by, Used ("covered day" or "—"), Refund.
  - The Refund column reads "Refunded" / "Remboursée", "Refunded after use" / "Remboursée après utilisation", or "—".
  - Grouping control "Recorded by" / "Enregistré par" (default) or "None" / "Aucun". Group header: "[staff name] — [N] sessions · [sum] XAF". Tara payments group under "Tara Money (in app)" / "Tara Money (dans l'app)".
  - A filter chip "Refunded after use only" / "Remboursées après utilisation uniquement" narrows to FR-163's signal.
- **Blocked attempts** / **Tentatives bloquées**
  - Columns: Member, Time, Source ("Check-in" / "Enregistrement" or "Class: [name]" / "Cours : [nom]"). There is no "paid later" or walk-away column, since FR-163 asks only for the counts and the list.
  - Header line: "[N] attempts · [M] members" / "[N] tentatives · [M] membres".
  - Offline-synced attempts show their scan time with the note "(synced [time])" / "(synchronisé à [heure])".
- **Free given** / **Gratuites offertes**
  - Columns: Member, Earned, Use by, Status ("Unused" / "Non utilisée", "Used [date]" / "Utilisée le [date]", "Lapsed" / "Expirée").
  - Before Epic 20 ships, or with loyalty never enabled, this tab shows its empty state.

**Interactions:** a member name opens AD-04 (modal). The period control mirrors AD-02 and is carried in the URL. Lists are paginated at 50 rows/page. Counts are server-side aggregates (FR-143 `max_rows` caveat); rows are paged reads.

**Empty states:** Paid: "No paid guest sessions in this period." / "Aucune séance payée sur cette période." Blocked: "No blocked attempts in this period." / "Aucune tentative bloquée sur cette période." Free: "No free sessions given in this period." / "Aucune séance gratuite offerte sur cette période."

**Loading:** 6 skeleton rows. **Error:** page-level error with [Refresh], as for AD-03.

---

### AD-23 · Plans *(shipped; documented V1.6 with the FR-173 plan-type lock)*

**Purpose:** Manager-plus creates, edits, and deletes the gym's membership plans. It shipped before V1.5 and was never in this spine. It is documented here because V1.6's gate keys on plan type and price.

**Layout (as shipped):**
```
Plans                                                     [+ Add Plan]
┌─────────────────────────────────────────────────────────────────┐
│ Monthly        Monthly          XAF 25,000 / monthly   30 days  [⋯]│
│ Drop-in        Pay-per-session  XAF 2,000 / monthly    No fixed duration — billed per visit [⋯]│
└─────────────────────────────────────────────────────────────────┘
```
- Row actions menu: Edit (opens PlanModal), Delete (confirm "Delete [name]" / "This cannot be undone."; blocked with "Cannot delete [name] — [N] subscriptions use this plan.").
- PlanModal fields: Plan Name, Plan Type (Pay-per-session / Monthly / Coach-inclusive / Class-only), Price (XAF), Duration (days), Billing Interval, Annual Discount (%). The shipped `plans.modal.*` labels and errors apply.

**V1.6 amendments *(FR-173, Story 19.3)*:**
- **Plan type lock:** when the plan has any subscription, Plan Type renders read-only, with a lock icon and the reason beneath: "This plan has members, so its type can't be changed. Create a new plan instead." / "Cette formule a des membres : son type ne peut pas être modifié. Créez plutôt une nouvelle formule." The server refusal of a stale type change reuses the same copy inline on the field.
- **Pay-per-session price label:** "Price per session (XAF) *" / "Prix par séance (XAF) *". In the list, the row reads "XAF 2,000 / session" / "XAF 2 000 / séance" instead of the shipped "/ monthly", since the price is now a real per-visit charge. When editing the price of a Pay-per-session plan that has subscriptions, a helper reads "Changing the price doesn't affect sessions already paid." / "Modifier le prix ne change pas les séances déjà payées."
- **Price 0:** for Pay-per-session, a helper reads "At 0 XAF, members on this plan never need a paid session." / "À 0 XAF, les membres de cette formule n'ont jamais besoin de séance payée." (FR-156 exemption).
- Type and price changes are saved through `update_plan_pricing`. Every change is audited ("Plan type or price changed", AD-12).

---

## Screen Reference — Super Admin Dashboard

---

### SA-02 · Gym List

**Layout:**
```
Gyms                                                  [+ Create Gym]

[🔍 Search gym name]   [Status ▾]

┌─────────────────────────────────────────────────────────────────┐
│ Gym Name       Owner       Created     Members   Tier    Status │
│ FitZone Ynd.   Paul N.     2026-06-01  45        Grind   Active │
└─────────────────────────────────────────────────────────────────┘
[← 1 2 3 →]
```

**Components:** Search, Status filter (All | Active | Suspended | Deactivated), "+ Create Gym" → SA-04 modal, sortable table, context-sensitive row actions (Suspend / Deactivate / Reinstate based on current status), row click → SA-03.

**Empty state:** "No gyms on the platform yet. Create the first one." [Create Gym]

**V1.6 *(FR-171, Story 21.1)*:** a **Category** column / "Catégorie", placed after Gym Name, shows the label in the admin's language as plain text, not a chip. There is no category filter in V1.6, because the stories do not require one and V1.7's directory is where filtering matters.

---

### SA-03 · Gym Detail

**Layout:**
```
← Gyms  /  FitZone Yaoundé

┌────────────────────────────────────────────────────────────────┐
│ Gym Name:     FitZone Yaoundé                                  │
│ Owner:        Paul Nkusu  (+237 6XX XXX XXX)                   │
│ Created:      2026-06-01                                       │
│ Tier:         Grind (31–100 members)              [Change]     │
│ Member count: 45 / 100                        [Override cap]   │
│ Status:       Active              [Suspend]  [Deactivate]      │
└────────────────────────────────────────────────────────────────┘

[Access gym data — requires reason (audit-logged)]

Tabs: [ Audit trail ]
```

**Components:**
- "Change" tier: dropdown → confirmation "Change FitZone from Grind to Elite? Existing members unaffected." [Confirm] [Cancel]
- "Override cap": numeric input inline; confirm to save
- Status actions (context-sensitive); each requires a reason in confirmation dialog
- **"Access gym data" escalation:** mandatory reason textarea → access granted + audit-logged; all SA data access to this gym is recorded

**V1.6 *(FR-171, Story 21.1)*:** a row is added under Owner: `Category:  Yoga Studio   [Change]`. [Change] turns the value into an inline select of the five labels with [Save] [Cancel]. Save calls `set_gym_category`, then shows the new label and the toast "Category updated." / "Catégorie mise à jour." A refusal shows the typed error inline. No confirmation is needed: the change is descriptive and audited. SA-03 does **not** show Charge guests per session or Loyalty program state. Super Admin cannot write them (Architecture Decision AD-32), and V1.6 adds no support view.

---

### SA-04 · Create Gym

**Presentation:** Modal (max-width 480px) on SA-02.

**Layout:**
```
[Create Gym]                                                      [✕]

Gym Name *         [                               ]
Owner Name *       [                               ]
Owner Phone *      [+237 ▾] [                     ]
Subscription Tier *[dropdown of current tiers     ]
Category *         [Gym ▾]                           ← V1.6
Status             [Active  ▾]

[Cancel]                                        [Create Gym]
```

**On submit:** Creates gym + owner account; sends SMS to owner; toast "Gym created. SMS sent to [number]."; modal closes; list refreshes.

**V1.6 *(FR-171, Story 21.1)*:** **Category \*** is a required select defaulting to "Gym" / "Salle de sport". It is validated client-side and re-checked server-side before the first write. "Other" / "Autre" opens no free-text field. A gym created after Story 19.12 starts with Charge guests per session **on**. SA-04 does not show or set that switch; the Owner manages it in Settings.

---

### SA-05 · Platform Metrics

**Layout:**
```
Platform Metrics

┌───────────────┐  ┌───────────────┐  ┌────────────────────┐
│ Total Gyms    │  │ Total Members │  │ Total Payments     │
│ 12            │  │ 843           │  │ XAF 4,230,000      │
└───────────────┘  └───────────────┘  └────────────────────┘

Active gyms: 10  |  Suspended: 1  |  Deactivated: 1
```

Read-only stat cards. No filters in V1. Values load on page arrival.

---

### SA-06 · Tier Management

**Layout:**
```
Tier Management                                        [+ Add Tier]

┌────────────────────────────────────────────────────────────────┐
│ Hustle         1–30 members                                    │
│ Monthly: XAF 15,000   Annual: XAF 150,000   [Edit] [Delete]   │
├────────────────────────────────────────────────────────────────┤
│ Grind          31–100 members                                  │
│ Monthly: XAF 35,000   Annual: XAF 350,000   [Edit] [Delete]   │
├────────────────────────────────────────────────────────────────┤
│ Elite          > 100 members (no cap)                          │
│ Monthly: XAF 75,000   Annual: XAF 750,000   [Edit] [Delete]   │
└────────────────────────────────────────────────────────────────┘
```

**Delete guard:** If ≥1 gym uses the tier: "Cannot delete Grind — 3 gyms are on this tier. Reassign them before deleting." Delete is blocked, not just warned.

---

### SA-07 · Billing *(V1.5, FR-131/FR-135, Story 11.5)*

**Purpose:** Super Admin sees every gym's SaaS (platform) billing status in one place, with manual override actions for operating the beta.

**Layout:**
```
Billing

[🔍 Search gym]  [Filter: All statuses ▾]

┌──────────────────────────────────────────────────────────────────────────┐
│ Gym          Tier    Interval  Status       Next billing  Last payment  Failed │
│ Martin Fit.  Grind   Monthly   Active       01 Sep 2026    01 Aug 2026   0     │
│ Yaoundé Gym  Hustle  Monthly   Past due     05 Aug 2026    05 Jul 2026   1     │
│ Beta Test 1  Free    —         Active       —              —            0     │
│ Douala Box   Elite   Annual    Suspended    —              12 Jun 2026   3     │
└──────────────────────────────────────────────────────────────────────────┘
```

**Components:**
- Table columns: gym name, tier, billing interval, SaaS status (Active / Past due / Grace period / Suspended, per Story 11.2's lifecycle), next billing date, last successful payment date, failed-attempt count
- Status badge colors: Active = green, Past due = amber, Grace period = orange, Suspended = red — same badge visual language as member subscription status elsewhere in the product
- Filter by status; search by gym name
- Row click → expands inline with override actions

**Row override actions** (all require explicit confirmation, all audit-logged with actor/action/target gym/timestamp — FR-080):
- **Mark payment received (out-of-band):** for a payment confirmed outside Tara Money (e.g. bank transfer during the beta). Confirm dialog: "Mark [Gym]'s payment as received? This will not create a Tara Money transaction record." [Cancel] [Mark received]
- **Apply credit / free period:** grants N days or one billing cycle free. Confirm dialog with a reason field (required, same pattern as staff deactivation): "Grant [Gym] a free period. Reason: [________]"
- **Trigger retry:** manually re-attempts a failed/pending charge outside the normal reminder schedule
- **Suspend / Reactivate:** manual override of the automated lifecycle — same underlying `private.current_gym_status()` mechanism Story 11.4 uses for automatic suspension (Architecture Decision AD-3), so a manual suspension takes effect at the RLS/auth-hook layer immediately, exactly like the automated path. Confirm dialog: "Suspend [Gym]? All staff and members will lose access immediately." [Cancel] [Suspend]

**Empty state:** not applicable — every gym appears in this table regardless of tier or status, including Free/Test tier gyms (Story 11.2's 0 XAF gyms still run the full billing lifecycle so this view stays accurate for them too).

---

## Cross-Cutting Components

### App Launch (Splash Screen)

*(Epic 15)* Fixes an unbranded default: `apps/mobile`'s current splash `backgroundColor` (`#208AEF`) and `icon.png`/`splash-icon.png` are Expo-starter placeholders, never replaced — not a prior design decision.

- Background: mobile dark theme's `background` (`#0A0F17`), not the platform light `background` token — the splash is the app's own chrome, not a gym-branded member surface, so it does not take a per-gym override
- Mark: the bar-glyph cropped from `apps/dashboard/public/gymos-logo-full-white.webp`, rendered in `accent` orange, centered, sized per Expo's splash `imageWidth` convention (existing config key)
- No gym logo, no gym name — the splash renders before any gym context is known (matches onboarding's own platform-shell-only rule, Foundation)
- No animation beyond Expo's default splash → app cross-fade
- Mock: [mockups/key-launch-splash.html](mockups/key-launch-splash.html)

### Member App Component Library

*(Epic 15)* Behavioral rules for the shared components introduced to fix the "reads as a color swap" finding (`.memlog.md`) — root cause was never missing color, but missing elevation/iconography/containment. Visual specs (radius, shadow, spacing) live in `DESIGN.md`'s Elevation & Depth / Shapes / Components.

**Card — flat vs. raised:** `flat` (bordered, no shadow) is for passive containers grouping related read-only content. `raised` (shadow, no border) is for the single most important actionable element on a screen — used sparingly, not on every card, or nothing "lifts" relative to anything else. A screen has at most one `raised` card in its primary content area.

**Icon Chip:** every List Item and section header gains a leading icon chip. Icon choice is semantic, not decorative — reuses `MaterialIcons` (already the app's icon set) with a tint keyed to the same semantic colors as Status Badge (`success`/`warning`/`danger`/`neutral`) where the item has a status; `accent`/`primary` tint for non-status items (e.g., a class booking).

**List Item:** replaces bare hairline-divided rows (Recent Activity, Upcoming Classes, Profile's settings rows) with: Icon Chip + title + trailing meta (timestamp, chevron), the group wrapped in one `flat` Card rather than sitting directly on the screen background. Tap targets and navigation destinations are unchanged from the pre-Epic-15 spec — this is a containment/legibility change, not a new IA.

**Stat Tile:** a `raised` Card containing one `statNumeral` + one `small` caption. Reserved for data the member already sees in prose elsewhere on the screen (e.g., "Expires in 12 days" — the status card's existing expiry text, given numeral emphasis) — this pass does not introduce new metrics or new backend queries.

**Loyalty Progress *(V1.6, `{components.loyaltyProgress}`)*:** "n / N" as a `statNumeral`, followed by a stamp row of N segments, with filled segments in `{colors.accent}` (the gym colour on member surfaces). When N > 12 the row becomes a continuous bar, so 50 tiny segments never render. A caption in `small` sits underneath. It is a read-only display with no tap action. Its accessible label is the sentence, not the glyphs: "3 of 5 paid sessions toward your next free session" / "3 séances payées sur 5 avant votre prochaine séance gratuite". It is used only inside the Rewards card.

**Session Chip *(V1.6, `{components.sessionChip}`)*:** a List Item variant for one session: an Icon Chip (ticket glyph `confirmation_number` in `{colors.accent}` for paid; gift glyph `card_giftcard` in `{colors.success}` for free; `{colors.neutral}` for dormant) plus a title ("Paid session" / "Free session") and a trailing "use by [date]". The rows live inside the Rewards card's `flat` Card. They are not tappable in V1.6.

**Rewards card *(V1.6)*:** a `flat` Card on Home grouping Loyalty Progress and Session Chips. Behaviour and copy are in MA-09. It never takes the `raised` treatment.

### Front-Desk Alert Panel

Appears on AD-02 (Overview) and AD-11 (Attendance). Powered by Supabase Realtime. Visible to Receptionist, Manager, and Owner; absent from Coach Portal.

**Panel structure:**
```
┌───────────────────────────────────────────────────────────────────┐
│ 🟡 GRACE PERIOD                                                   │
│ [Avatar 40px] Amara K.  ·  Grace period  ·  Expires in 1 day    │
│                                                  [Renew]  [✕]   │
├───────────────────────────────────────────────────────────────────┤
│ 🔴 ACCESS DENIED                                                  │
│ [Avatar 40px] Jean B.  ·  Expired 21 days ago                   │
│               Collect payment to restore access  [Renew]  [✕]   │
└───────────────────────────────────────────────────────────────────┘
```

**Behaviour rules:**
- Panel renders at the top of the page content area (below top bar, above page heading); it **pushes** page content down — not a z-index overlay
- Max 5 alerts visible simultaneously; 6th+ accessible by scrolling within the panel (fixed max-height ~320px; internal scroll)
- Newest alert at the top; existing alerts shift down on new arrival
- **Yellow alert:** `expiring_soon` or `grace_period` — check-in was accepted; entry allowed
- **Red alert:** `expired` — check-in was rejected; entry denied
- **Alert content:** avatar (falls back to initials if no photo), member name, status label, days-until/since message, [Renew] button, [✕] dismiss
- **[✕] Dismiss:** writes `dismissed_at` + dismissing user ID to alert record; no undo
- **Auto-dismiss:** after gym-configured duration (default 30 min); system writes `dismissed_at`
- **Panel invisible** when alert count = 0 (no empty state)
- **New alert for same member** fires if they scan again after their alert was dismissed without renewal
- **Alert arrival animation:** new alert slides in at top of stack; existing alerts slide down; no sound; no browser notification
- **ARIA:** `aria-live="assertive"` for red alerts; `aria-live="polite"` for yellow alerts

**V1.6 — Session-required variant *(FR-160; Stories 19.6b, 19.9)*.** This is a new `kind = 'session_required'` variant of the same single component (UX-DR2, no fork). The panel branches on `kind`, and subscription alerts are unchanged.
```
├───────────────────────────────────────────────────────────────────┤
│ 🔵 SESSION REQUIRED                                               │
│ [Avatar 40px] Ange T.  ·  No paid session  ·  09:12               │
│               ⟳ Mobile money payment in progress                  │
│                          [Record session payment]  [✕]            │
└───────────────────────────────────────────────────────────────────┘
```
- **Colour:** `{colors.info}` with an info glyph. Not red: it is a denial but recoverable in one tap at the desk, and red keeps meaning "expired".
- **Header** "SESSION REQUIRED" / "SÉANCE REQUISE". **Body:** "[Name] · No paid session · [time of attempt]". Under it: "Record a payment so they can scan again." / "Enregistrez un paiement pour que le membre puisse scanner à nouveau." This follows the denied-alert body pattern.
- **Source:** a class-marking refusal (FR-174) adds "From class: [class name]" / "Depuis le cours : [nom du cours]". An offline attempt that synced late adds "Scanned offline at [time]" / "Scanné hors ligne à [heure]", so an alert arriving hours later makes sense.
- **Payment in flight** (FR-160): when a Tara session payment for the member is pending, the line "Mobile money payment in progress" / "Paiement mobile money en cours" appears with a spinner glyph. [Record session payment] stays visible, but the panel will refuse with "already in progress" (see the Record Session Payment Panel).
- **Action:** [Record session payment] / [Enregistrer le paiement de la séance] opens the Record Session Payment Panel inline, in the same place the Inline Renewal Panel opens. There is no [Renew] on this variant.
- **Dismissal:** recording the session payment dismisses the alert server-side, and the panel updates through realtime. Manual [✕] and gym auto-dismiss apply as for other alerts: a guest who walked away should not pin the panel. Dismissal never changes the Guest sessions figures, which count `session_attempts`, not alerts (Architecture Decision AD-31).
- **Dedupe:** one active session alert per member. A new scan after dismissal raises a new one, as for subscription alerts.
- **ARIA:** `aria-live="assertive"`, as for red alerts, because it is a denial that needs action now.
- **Delivery:** same realtime channel and same polling fallback (Architecture Decision AD-20); session alerts are included in polled results.

### Record Session Payment Panel *(V1.6)*

Triggered by: [Record session payment] on a session-required alert; on AD-04 member detail (pre-scan desk payment, user decision 2026-10-11); and in-row on an AD-18 marking refusal. Receptionist+. It is a sibling of the Inline Renewal Panel, not a reuse, because the session amount is fixed and there is no plan or start date. It uses the same presentation: inline within or beside the trigger, as a 320px right drawer on tablet, and inside the AD-04 modal as an inline expanding section.

**Panel content:**
```
Record session payment                                         [✕]
[Avatar 40px] Ange T.  ·  Drop-in (Pay-per-session)

Amount          2,000 XAF   (plan price — fixed)
Payment method  [Cash                           ▾]
Note            [                               ]  (optional)
Recorded by     Aicha M.

[Cancel]                          [Record session payment →]
```
- **Title:** "Record session payment" / "Enregistrer le paiement de la séance".
- **Amount:** "Amount" / "Montant", shown read-only with the caption "plan price — fixed" / "prix de la formule — fixe". The client never sends it (FR-158).
- **Method:** "Cash" / "Manual Mobile Money" for any role that can record payments. "Bank Transfer" is listed **only** for Manager, Supervisor, and Owner, and is absent from the DOM for a Receptionist. Labels reuse the shipped `payments.methods.*`. It defaults to Cash.
- **Note:** optional (FR-158 amends FR-038). Label "Note (optional)" / "Note (facultatif)". There is no pre-fill and no minimum.
- **Two-tap straight-through:** open the panel, then confirm. The default is a cash session.
- **[Record session payment →]:** shows a spinner. On success the panel closes and the toast reads "Session recorded for [Name]. Ask them to scan again." / "Séance enregistrée pour [Nom]. Demandez-lui de scanner à nouveau." The alert (if any) dismisses and AD-04's Sessions section updates. From AD-18, the row message changes to "Session recorded — mark attendance again."
- **Refusals** (inline above the buttons; the panel stays open; each maps to a distinct server code, Story 19.4):
  | Code | EN | FR |
  |---|---|---|
  | Payment already in progress | "A mobile money payment for [Name] is already in progress. Wait for it to finish, then check again." | "Un paiement mobile money pour [Nom] est déjà en cours. Attendez qu'il se termine, puis vérifiez à nouveau." |
  | Charging is off | "Charge guests per session is off at this gym, so no session is needed." | "La facturation des invités à la séance est désactivée dans cette salle : aucune séance n'est nécessaire." |
  | Not on Pay-per-session | "[Name] isn't on a Pay-per-session plan." | "[Nom] n'a pas de formule Paiement à la séance." |
  | Plan price is 0 | "[Name]'s plan is free, so no session payment is needed." | "La formule de [Nom] est gratuite : aucun paiement de séance n'est nécessaire." |
  | Member deactivated | "[Name] is deactivated. Reactivate them first." | "[Nom] est désactivé. Réactivez ce membre d'abord." |
  | Awaiting registration fee | "Settle [Name]'s registration fee first." | "Réglez d'abord les frais d'inscription de [Nom]." |
  | Gym suspended | "Payments can't be recorded while the gym is suspended." | "Impossible d'enregistrer un paiement tant que la salle est suspendue." |
  | Bank transfer not permitted (stale client) | reuse global "You don't have permission to do that." | reuse global |
  | Network | "Couldn't record the session. Check your connection and try again." | "Impossible d'enregistrer la séance. Vérifiez votre connexion et réessayez." |
- **Double entry:** two staff recording for the same member at once both succeed (Story 19.4). Both show on AD-22 under each recorder, so there is no client-side lock or warning.
- **[Cancel] / [✕]:** closes the panel; the alert remains.

### Inline Renewal Panel

Triggered by: [Renew] on front-desk alert; [Renew] on Subscriptions page; [Renew] on Overview expiring table. Receptionist+.

**Presentation:** Expands inline within or adjacent to the triggering alert/row. Does NOT navigate away. On tablet (768–1023px): opens as a right-side drawer (320px).

**Panel content:**
```
Renew Membership                                               [✕]
[Avatar 40px] Amara K.

Plan            [Monthly                                ▾]
New start date  [04 Jul 2026                   ] (editable)
Renewal price   XAF 25,000  (auto-calculated, read-only)
Payment method  [Cash                           ▾]
Note *          [Paid at desk                   ]

[Cancel]                             [Confirm Renewal →]
```

**3-tap straight-through sequence:**
1. Tap [Renew] on alert → panel opens pre-populated
2. (No changes needed for default cash renewal)
3. Tap [Confirm Renewal →]

**Interaction rules:**
- Plan selector: defaults to member's current plan; changing plan recalculates renewal price
- Start date: defaults to today; backdating allowed to member's original expiry date; no future dating
- Payment method: Cash | Bank Transfer | Manual Mobile Money
- Note: pre-filled "Paid at desk" for Cash; cleared when method changes; required
- [Confirm Renewal]: spinner; on success → payment recorded, subscription → Active, new expiry set, alert dismisses, member receives push N-04, panel closes; on failure → inline error "Renewal failed. Check your connection and try again." — panel stays open
- [Cancel] / [✕]: close panel; alert remains

---

## Form Validation Rules

### Global Rules

- Required fields marked `*`
- Validation runs on form **submit** (not per-keystroke), except live-search inputs
- Errors: inline below the relevant field; field border transitions to error state; all errors shown simultaneously on submit
- On server validation failure: per-field errors mapped to their fields; unmapped errors shown as summary above the submit button
- On network failure: "Something went wrong. Check your connection and try again." above the submit button

### Member App

**MA-02 Phone Number Entry**
| Field | Rule | Error |
|---|---|---|
| Phone | Required; valid E.164 after prefix prepend; number exists in system | "Enter a valid phone number (e.g. +237 6 XX XX XX XX)" / "This number isn't registered. Contact your gym." |

**MA-03 OTP**
| Field | Rule | Error |
|---|---|---|
| OTP | 6 digits; numeric | "Incorrect code. Try again." (per-attempt, inline below boxes) |
| Resend | Max 3 resends | → Navigate to MA-04 |

**MA-05 Profile Setup**
| Field | Rule | Error |
|---|---|---|
| Full name | Required; ≥1 non-space character; ≤100 chars | "Please enter your name" |
| Profile photo | Optional; image file type; ≤5MB if provided | "Photo too large. Choose an image under 5MB." |

**MA-06 / MA-07 Goal / Experience**
| Field | Rule | Error |
|---|---|---|
| Selection | Required — one of the presented options | Continue button stays disabled; no inline error |

### Admin Dashboard

**AD-05 Member Create / Edit**
| Field | Rule | Error |
|---|---|---|
| Full Name | Required; ≥2 chars; ≤100 chars | "Full name is required" |
| Phone | Required; valid E.164; unique in the system | "Enter a valid phone number" / "This phone number is already registered" |
| Plan | Required | "Select a plan" |
| Join Date | Required; not a future date | "Join date is required" / "Join date cannot be in the future" |
| Subscription Status | Required | "Select a subscription status" |
| Expiry Date | Required if plan is not Pay-per-session | "Expiry date is required for this plan type" |
| Expiry Date | If provided: must be ≥ Join Date | "Expiry date must be on or after the join date" |
| Email | Optional; valid email format if provided | "Enter a valid email address" |
| Date of Birth | Optional; in the past; person ≥10 years old | "Enter a valid date of birth" |

**AD-07 CSV Import — per-row**
| Column | Rule | Error |
|---|---|---|
| member_name | Required; non-empty | "Member name is required" |
| phone | Required; valid E.164 | "Invalid format — expected E.164 (e.g. +237...)" |
| plan_type | Required; matches a plan configured for this gym (case-insensitive) | "Plan '[value]' is not configured for this gym" |
| join_date | Required; YYYY-MM-DD | "Invalid date format — use YYYY-MM-DD" |
| subscription_status | Required; one of: active / expiring_soon / grace_period / expired | "Invalid status — must be one of: active, expiring_soon, grace_period, expired" |
| expiry_date | Required if plan is not pay_per_session; YYYY-MM-DD | "Expiry date is required for this plan type" / "Invalid date format — use YYYY-MM-DD" |

**AD-10 Manual Payment Entry**
| Field | Rule | Error |
|---|---|---|
| Member | Required; must select from dropdown | "Select a member" |
| Payment Method | Required | "Select a payment method" |
| Amount | Required; positive integer; ≤10,000,000 XAF | "Enter a valid amount" |
| Reason / Note | Required; ≥10 characters | "Add a note (at least 10 characters)" |
| Date | Required; not a future date | "Select a valid date" |

**AD-13 Settings**
| Field | Rule | Error |
|---|---|---|
| Gym Name | Required; ≥2 chars | "Gym name is required" |
| Primary Colour | Required; valid hex (#RRGGBB) | "Enter a valid hex colour (e.g. #E0971F)" |
| Logo | Optional; image file; ≤5MB | "Image too large — maximum 5MB" |
| Grace Period | Required; integer 1–30 | "Grace period must be between 1 and 30 days" |
| Gym Capacity | Required; positive integer | "Enter the gym's member capacity" |
| Alert Auto-Dismiss | Required; integer 1–120 | "Auto-dismiss must be between 1 and 120 minutes" |

**Inline Renewal Panel** *(cross-cutting component, no page ID — corrected from this table's prior stray "AD-16" label, which collided with no entry in the Surface Index and is reassigned to Staff — List, V1.5)*
| Field | Rule | Error |
|---|---|---|
| Plan | Required | "Select a plan" |
| Start Date | Required; not a future date | "Select a valid start date" |
| Payment Method | Required | "Select a payment method" |
| Note | Required; ≥5 characters | "Add a note describing this renewal" |

**SA-04 Create Gym**
| Field | Rule | Error |
|---|---|---|
| Gym Name | Required; unique on platform | "Gym name is required" / "A gym with this name already exists" |
| Owner Name | Required | "Owner name is required" |
| Owner Phone | Required; valid E.164; unique on platform | "Enter a valid phone number" / "This phone number is already registered" |
| Tier | Required | "Select a subscription tier" |

**SA-06 Tier Create / Edit**
| Field | Rule | Error |
|---|---|---|
| Tier Name | Required; unique | "Tier name is required" / "This name is already in use" |
| Member cap (min) | Required; positive integer | "Enter a minimum member count" |
| Member cap (max) | Optional (blank = unlimited); if set: must be > min | "Maximum must be greater than minimum" |
| Monthly price | Required; non-negative integer | "Enter a valid monthly price in XAF" |
| Annual price | Required; non-negative integer; ≤ monthly × 12 | "Annual price must not exceed 12 × the monthly price" |

**AD-17 Staff Add / Edit** *(V1.5)*
| Field | Rule | Error |
|---|---|---|
| Full Name | Required; ≥2 chars; ≤100 chars | "Full name is required" |
| Phone | Required; valid E.164; unique in the system | "Enter a valid phone number" / "This phone number is already registered" |
| Role | Required; must be within the acting user's role-ceiling allowlist (client-filtered, server-enforced) | "Select a role" / "You don't have permission to assign that role" (server rejection) |

**AD-19 Classes Create / Edit** *(V1.5)*
| Field | Rule | Error |
|---|---|---|
| Name | Required; ≥2 chars | "Class name is required" |
| Assigned Coach | Required; must be a Coach-role staff member at this gym | "Select a coach" |
| Capacity | Required; positive integer | "Enter a capacity" |
| Schedule type | Required: One-off or Recurring | "Select a schedule type" |
| Days (if Recurring) | Required; ≥1 day selected | "Select at least one day" |
| Time | Required | "Select a time" |
| Start date | Required; not in the past | "Select a valid start date" |

**AD-13 Connect Payment Account** *(V1.5)*
| Field | Rule | Error |
|---|---|---|
| Tara Money Merchant ID | Required | "Merchant ID is required" |
| Tara Money API Key | Required | "API key is required" |
| (server) | Credentials must authenticate against Tara Money | "Couldn't connect — check your Merchant ID and API Key" |

**MA-15 Progress — Log Entry** *(V1.5)*
| Field | Rule | Error |
|---|---|---|
| Weight | Optional; positive number, 1 decimal place; plausible range (20–300 kg) | "Enter a valid weight" |
| Measurements (each) | Optional; positive number; plausible range (10–300 cm) | "Enter a valid measurement" |
| Photo | Optional; image file type; ≤5MB | "Photo too large. Choose an image under 5MB." |
| Note | Optional; ≤500 chars | "Note is too long" |
| (all fields) | At least one field must be filled to save | "Add at least one entry (weight, a measurement, a photo, or a note)" |

**AD-13 Loyalty program** *(V1.6, FR-164, Story 20.1/20.5)*. Validated on [Save loyalty program] (submit-only, UX-DR11). Rules apply only when the switch is on. With it off, the fields are disabled and not validated.
| Field | Rule | Error (EN / FR) |
|---|---|---|
| N — paid sessions per free session | Required; whole number 2–50 | "Enter a whole number from 2 to 50" / "Saisissez un nombre entier de 2 à 50" |
| K — on-time renewals per reward | Required; whole number 3–24 | "Enter a whole number from 3 to 24" / "Saisissez un nombre entier de 3 à 24" |
| R — free days per reward | Required; whole number 1–30 | "Enter a whole number from 1 to 30" / "Saisissez un nombre entier de 1 à 30" |
| (server) | Setter refuses (role, range) | Mapped to the field if the code names one; otherwise the summary "Couldn't save the loyalty program. Try again." / "Impossible d'enregistrer le programme de fidélité. Réessayez." |

**AD-13 Charge guests per session** *(V1.6)*: no fields. The only gate is the confirmation dialog, and [Start charging] is disabled until the affected-member count has loaded. Server refusal: "Couldn't change this setting. Try again." / "Impossible de modifier ce paramètre. Réessayez." The toggle stays at its stored value.

**AD-13 Category** *(V1.6, Story 21.2)* and **SA-04 / SA-03 Category** *(V1.6, Story 21.1)*
| Field | Rule | Error (EN / FR) |
|---|---|---|
| Category | Required; one of `gym`, `pilates_studio`, `yoga_studio`, `fitness_center`, `other` (`gymCategorySchema`), checked client- and server-side | "Select a category" / "Sélectionnez une catégorie" |

**Record Session Payment Panel** *(V1.6, Story 19.4)*
| Field | Rule | Error (EN / FR) |
|---|---|---|
| Payment method | Required; Bank Transfer only for Manager+ (client-filtered, server-enforced) | "Select a payment method" / "Sélectionnez un mode de paiement" |
| Note | Optional; ≤ 200 chars (matches the waive-reason cap) | "Note is too long (200 characters max)" / "La note est trop longue (200 caractères max.)" |
| Amount | Not an input; read server-side | — |

**MA-17 Pay for Session** *(V1.6)*
| Field | Rule | Error (EN / FR) |
|---|---|---|
| Paying with (payer phone) | Required; valid E.164 (same rule as `/renew`) | reuse `renew.errors.payerPhoneInvalid`: "Enter a valid phone number" / "Entrez un numéro de téléphone valide" |

**AD-23 Plans — Edit** *(V1.6 additions, FR-173)*
| Field | Rule | Error (EN / FR) |
|---|---|---|
| Plan Type | Read-only when the plan has subscriptions; the server refuses a stale change | "This plan has members, so its type can't be changed. Create a new plan instead." / "Cette formule a des membres : son type ne peut pas être modifié. Créez plutôt une nouvelle formule." |
| Price (Pay-per-session) | Shipped rule unchanged (whole XAF ≥ 0) | shipped `plans.modal.errors.priceInvalid` |

**Waive registration fee — "Session guest" preset** *(V1.6)*: the preset text satisfies the shipped 10–200 character reason rule, so no new error is needed.

---

## State Patterns

### Empty States

| Surface / Context | Copy | Primary action |
|---|---|---|
| MA-09 Home — no recent activity | "No activity yet — check in for the first time!" | None |
| MA-11 History — Payments tab | "No payments on record yet." | None |
| MA-11 History — Check-ins tab | "No check-ins yet. Scan the QR at your gym to get started." | [Check In] → MA-10 |
| AD-02 Currently Checked-In | "No one is checked in right now." | None |
| AD-02 Expiring This Week | "No members expiring in the next 7 days." | None |
| AD-03 Members — no members | "No members yet. Import a CSV or add one manually." | [Import CSV] [Add Member] (Manager+ only) |
| AD-03 Members — search/filter empty | "No members match your search. Try a different name, phone, or filter." | [Clear search] |
| AD-08 Subscriptions — empty | "No subscriptions on record." | [Add Member] |
| AD-09 Payments — empty | "No payments recorded yet." | [Record Payment] |
| AD-09 Payments — filter empty | "No payments match these filters." | [Clear filters] |
| AD-11 Currently Checked-In | "No one is checked in right now." | None |
| AD-11 Daily Log | "No check-ins recorded for this period." | [Change date range] |
| AD-12 Audit Log | "No audit records for this period." | [Change date range] |
| AD-14 Coach Portal — no members | "No members have been assigned to you yet. Ask your manager." | None |
| AD-14 Coach Portal — search empty | "No members match '[term]'." | [Clear search] |
| AD-15 Session Notes | "No session notes yet. Add the first note above." | (Inline add always visible above) |
| SA-02 Gym List | "No gyms on the platform yet. Create the first one." | [Create Gym] |
| SA-06 Tiers | "No tiers configured. Add your first tier." | [Add Tier] |
| MA-15 Progress *(V1.5)* | "Log your first entry to start tracking your progress." | [+ Log] |
| MA-16 Classes — Available *(V1.5)* | "No upcoming classes scheduled. Check back soon." | None |
| MA-16 Classes — My Bookings *(V1.5)* | "You haven't booked any classes yet." | [Browse classes] → switches to Available tab |
| AD-15 Progress tab *(V1.5)* | "No progress data logged yet." | None |
| AD-15 Workout Plan tab *(V1.5)* | "No workout plan yet." | [+ New plan] |
| AD-16 Staff — no staff *(V1.5)* | "No staff yet. Add your first staff member to get started." | [+ Add staff] |
| AD-18 Classes — no classes *(V1.5)* | "No classes scheduled yet." | [+ Create class] (Manager+ only) |
| SA-07 Billing *(V1.5)* | Not applicable — every gym always appears in this table | — |
| AD-02 Guest sessions card *(V1.6)* | Not an empty state — zero figures render as "0"; the card is **absent** (not empty) when charging is off or for Receptionist/Coach | Figure links still open AD-22 |
| AD-22 Paid *(V1.6)* | "No paid guest sessions in this period." / "Aucune séance payée sur cette période." | Period control |
| AD-22 Blocked attempts *(V1.6)* | "No blocked attempts in this period." / "Aucune tentative bloquée sur cette période." | Period control |
| AD-22 Free given *(V1.6)* | "No free sessions given in this period." / "Aucune séance gratuite offerte sur cette période." | Period control |
| AD-04 Sessions section *(V1.6)* | "No sessions yet." / "Aucune séance pour le moment." | [Record session payment] (header action) |
| MA-09 Rewards card *(V1.6)* | Not an empty state — **absent** when the program is off and the member holds nothing (Story 20.6) | — |
| MA-09 Guest status card, no session *(V1.6)* | "No paid session — pay before you scan." | [Pay for a session] when Tara is connected |

### Loading States

**Timing rules:**
- < 300ms: show nothing (no skeleton flash on fast connections)
- 300ms–1000ms: skeleton loaders matching expected content shape
- > 1000ms: skeleton + "Still loading…" label at the 3-second mark
- Sections load independently; slow tables must not block fast stat cards

| Context | Skeleton shape |
|---|---|
| MA-09 Status card | Rounded rectangle, ~80px tall, full-width |
| MA-09 Recent activity | 2–3 rows, ~44px each |
| MA-10 Camera | Native platform camera loading indicator |
| MA-11 History rows | 5–6 rows, ~48px each |
| AD-02 Stat cards | 3 cards, same dimensions as real cards |
| AD-02 Tables | 5 rows, correct column proportions |
| AD-03 Members table | 8 rows |
| AD-08 Subscriptions | 6 rows |
| AD-09 Verification queue | 2–3 rows |
| AD-09 Payments table | 6 rows |
| AD-11 Checked-in | 3 rows |
| AD-11 Daily log | 6 rows |
| AD-14 Coach member list | 4 rows |
| SA-02 Gym list | 5 rows |
| SA-05 Metrics | 3 stat cards |
| MA-15 Progress chart *(V1.5)* | Rounded rectangle, ~160px tall, full-width |
| MA-16 Classes list *(V1.5)* | 4 rows |
| AD-16 Staff list *(V1.5)* | 4 rows |
| AD-18 Classes list *(V1.5)* | 4 rows |
| SA-07 Billing table *(V1.5)* | 6 rows |
| AD-02 Guest sessions card *(V1.6)* | 1 full-width card, own Suspense boundary |
| AD-22 Guest sessions lists *(V1.6)* | 6 rows |
| AD-04 Sessions / Rewards sections *(V1.6)* | 3 rows each, inside the modal |
| AD-13 Charge-guests confirmation count *(V1.6)* | Inline spinner in the count line; [Start charging] disabled |
| MA-09 Rewards card *(V1.6)* | Rounded rectangle, ~120px tall; rendered only once the member is known to qualify (no flash for non-qualifying members) |
| MA-17 Pay for Session *(V1.6)* | Price card skeleton ~96px; then the shipped `/renew` phase spinners |

**Button loading state:** Spinner replaces label text; button width does not change (prevents layout shift); button disabled during request.

**Alert panel:** No loading state — alerts arrive via Supabase Realtime push and appear with slide animation.

### Error States

**Global:**
- **Network unavailable — Member App:** Persistent amber banner below branded header: "You're offline — check-in still works." Hides when connectivity returns.
- **Network unavailable — Dashboard:** Persistent amber banner below top bar: "You're offline. Data may be outdated." with [Refresh] button.
- **Auth session expired:** Redirect to login; toast: "Your session expired. Please log in again."
- **Permission denied (RLS rejection):** Inline in context of the attempted action: "You don't have permission to do that." No modal; no redirect.
- **Unexpected server error (5xx):** Content area replaced with: "Something went wrong on our end. Try refreshing the page." [Refresh page].

**Per-screen:**

| Screen | Scenario | Treatment |
|---|---|---|
| MA-02 | Phone not in system | Inline below input |
| MA-02 | Network failure | Inline + retry link |
| MA-03 | Wrong OTP | Boxes shake + clear + inline error |
| MA-03 | Network failure | Inline + retry |
| MA-05 | Photo > 5MB | Inline below upload zone |
| MA-05 | Photo upload failure | Toast "Photo upload failed. Try again." |
| MA-08 | Save failure | Inline below button |
| MA-09 | Data load failure | Error card in status area: "Couldn't load your info. Pull down to refresh." |
| MA-10 | Camera permission denied | Replace viewfinder: lock icon + "GymOS needs camera access." + [Open Settings] |
| MA-10 | Expired member scan | Full-screen red result: "Access denied — see front desk" |
| AD-01 | Wrong credentials | Inline below password field |
| AD-01 | Network failure | Inline above button |
| AD-02 | Renewal failure | Inline inside Inline Renewal Panel; panel stays open |
| AD-03 | Load failure | Page-level error with [Refresh] |
| AD-05 | Save failure | Inline above [Save] |
| AD-05 | Phone already registered | Per-field inline on Phone field |
| AD-07 | Validation errors | Step 2b error view with per-row table |
| AD-07 | Mid-import failure | Error toast; zero records saved |
| AD-09 | Payment record failure | Inline inside modal |
| AD-13 | QR regenerate failure | Toast "Couldn't regenerate. Try again." |
| AD-13 | Logo upload failure | Inline below upload zone |
| AD-13 | Save failure | Scroll to first error; per-field errors shown |
| SA-04 | Gym name already exists | Per-field inline on Gym Name |
| SA-06 | Delete blocked (gyms on tier) | Inline in confirmation: "Cannot delete — [N] gyms use this tier." |
| MA-16 *(V1.5)* | Booking lost the capacity race | Button reverts from spinner to "Full"; toast: "That spot was just taken — try another session." |
| AD-17 *(V1.5)* | Role-ceiling rejected server-side | Inline: "You don't have permission to assign that role." Role field highlighted. |
| AD-13 *(V1.5)* | Tara Money credentials invalid | Inline below API Key field on Connect; persistent Settings banner if a previously-working connection later fails |
| MA-15 *(V1.5)* | Data load failure (no cache yet) | Error card in place of the chart: "Couldn't load your progress. Pull down to refresh." — same pattern as MA-09's home-load failure |
| AD-16 *(V1.5)* | Staff list load failure | Page-level error with [Refresh], same treatment as AD-03 |
| AD-18 *(V1.5)* | Classes list load failure | Page-level error with [Refresh], same treatment as AD-03 |
| MA-10 *(V1.6)* | Guest at a charging gym, no usable session | Full-screen info overlay "Pay for your session" (see MA-10); not the red Denied state |
| MA-17 *(V1.6)* | Payment already in progress / Tara unavailable / flagged | Inline messages per MA-17 errors table; failed phase reuses `renew.pending.failed` |
| AD-02 *(V1.6)* | Guest sessions summary load failure | In-card error + [Retry]; other cards unaffected |
| AD-02 *(V1.6)* | Session revenue read fails | Sub-line hidden; headline revenue still shown |
| AD-04 / alert / AD-18 *(V1.6)* | Record session payment refused | Inline coded message inside the panel (see Record Session Payment Panel); panel stays open |
| AD-13 *(V1.6)* | Charge-guests impact count fails | Count line error + [Retry]; [Start charging] disabled |
| AD-13 *(V1.6)* | Loyalty or category setter refuses | Per-field inline where mapped, otherwise section-level summary; other sections unaffected |
| AD-18 *(V1.6)* | Marking refused `session_required` | Inline row message + [Record session payment]; checkbox reverts |
| AD-23 *(V1.6)* | Plan type change refused (plan has subscriptions) | Inline on Plan Type with the lock reason |
| SA-03 / SA-04 *(V1.6)* | Category setter refuses | Inline typed error on the Category field |
| SA-07 *(V1.5)* | Row override action fails (mark paid / credit / retry / suspend) | Inline error in the row's expanded panel, action not applied; the row's status is not optimistically updated for Suspend/Reactivate specifically, given the access-denial stakes of a false-positive success |

### V1.5 — New State Patterns

These four states are new state-machine concepts V1.5 introduces, not covered by the generic Empty/Loading/Error taxonomy above — each has security or privacy weight, so each gets its own explicit spec rather than being folded into a generic "error."

**Gym suspended (SaaS non-payment, FR-131/FR-132):**
- Takes effect at the RLS/auth-hook layer on the gym's *next* request after `suspended` status is reached — not a poll, not a client-side check; the client simply starts getting denied
- **Member-facing:** the entire app shows a single full-screen neutral state replacing all tabs: "GymOS is temporarily unavailable for this gym. Please check back later." No billing, payment, or subscription language anywhere on this screen — that relationship is between GymOS and the Owner only (FR-132, see Voice and Tone)
- **Staff-facing (Owner):** the Owner specifically sees the billing-aware version: "Your GymOS subscription payment is overdue. Pay now to restore access for your whole team." with a one-tap pay action, since the Owner is the one party who needs to act
- **Staff-facing (Manager/Receptionist/Coach, not Owner):** same neutral treatment as members — they aren't the billing relationship either, and shouldn't see GymOS's dunning language
- **Reversal:** the instant a SaaS payment succeeds, the gym returns to `active` and every blocked user regains access on their next request — no manual re-provisioning step, symmetric with how suspension took effect

**Immediate access revocation (staff role change or deactivation, NFR-013):**
- On a role edit or deactivation, the affected staff member's *current, already-logged-in* session is denied on its very next request — not "next login," not "next token refresh." There is no client-visible warning beforehand; the next action they take (a page navigation, a Server Action) simply fails
- Treatment: same as the existing "Permission denied (RLS rejection)" global error state — "You don't have permission to do that." — reused rather than inventing a new denial message, since from the affected user's client perspective it's indistinguishable from any other RLS denial

**Class capacity race (FR-105, Architecture Decision AD-21):**
- The "Full" button state is the *steady-state* signal (visible before tapping, once the row has loaded current capacity) — the race condition only surfaces when two members tap "Book" on the last spot within the same request window
- Loser's client: optimistic spinner reverts, toast fires (see Error States table above), row's button state updates to "Full"
- This is treated as an expected, named outcome (documented copy, above) — not a generic network-error fallback

**Progress photo share revoke (Story 10.2):**
- Revoking a previously-shared photo takes effect within the signed URL's short lifetime — there is no "delete from coach's device" mechanic (that's not achievable), so the guarantee is forward-only: no *new* access is granted after revoke, not retroactive proof the coach never viewed it while it was shared
- Member-facing treatment: toggle flips immediately (optimistic), no confirmation dialog required for revoke (unlike deactivation/suspension, this is reversible and low-stakes to undo) — sharing it again is just as easy as revoking it

### V1.6 — New State Patterns

V1.6 adds a per-gym session state machine and a loyalty ledger. Every state below is behind a per-gym switch. **Charging off is the default for every gym that existed at release, and loyalty is off by default.** Until an Owner or Supervisor turns a switch on, every surface renders exactly as before V1.6. *Exempt* means a member not on Pay-per-session, or on a Pay-per-session plan priced 0 XAF; they behave as before even at a charging gym.

**Session states *(FR-156–FR-163, FR-174)*:**
| State | Rule | Member app | Dashboard |
|---|---|---|---|
| Charging off | Kill switch: the gym runs the pre-V1.6 path | No session UI anywhere | No Guest sessions card, no session alerts, no Sessions section; AD-13 toggle off |
| Charging on | From the moment it is confirmed; open check-ins and past attendance untouched. Gyms created after Story 19.12 start on | Guest status card, Pay for your session, will-be-verified | Card, alerts, Sessions section, Record session payment |
| Exempt | Not Pay-per-session, or price 0 | Unchanged | Unchanged; no [Record session payment] |
| Session required (denied) | No usable session at scan or class mark; no attendance; attempt stored; alert raised | MA-10 "Pay for your session" (`{colors.info}`, requires tap) | Session-required alert; blocked count +1; AD-18 inline refusal |
| Session required — old app build | Same server outcome; old builds map `null` to expired | Old Denied — Expired overlay (accepted, decision 1) | Owner warned in the turn-on confirmation |
| Payment in flight | A Tara session payment is pending; a second app or desk payment is refused; stale after 10 min → flagged `expired_attempt` | MA-17 pending / stillWaiting; "already in progress" | Alert shows "Mobile money payment in progress"; panel refuses |
| Paid session unused | Usable 7 days from payment | Status card count + soonest date; Rewards card row | AD-04 Unused list with lapse date |
| Day covered | First check-in or class mark consumes; same gym-local day re-entry and extra classes are free; a visit open at midnight stays covered; covered day fixed at consumption | Plain success; status card "Today covered" | AD-04 Used list with covered day |
| Paid session lapsed | Unused after 7 days; daily sweep records it | Drops off silently | AD-04 muted "Lapsed [date]"; AD-12 entry |
| Offline scan — saved | Guest at a charging gym (per cached flag) scans offline | "Check-in saved — your session will be verified" (`{colors.info}`, requires tap); banner "waiting to be verified" | — |
| Offline scan — verified on sync | A usable session exists (including one paid after the scan, within the auto-timeout window) | Silent (banner clears) | Attendance recorded normally |
| Offline scan — denied on sync | No session; stored as an attempt, deduped by scan id; alert raised, possibly hours later | Post-sync denial notice on next Home render, never silent | Alert with "Scanned offline at [time]"; blocked count |
| Offline sync failed permanently | Discarded as FR-061 today | Unchanged | Not counted |
| Stale charging flag | App refreshes on launch, foreground, and check-in focus; the server rule at sync governs | A plain green offline success may later be denied → denial notice | — |
| Late Tara confirmation | After `expired_attempt`: session **is** created, reason `late_confirmation`, staff audit | Session appears on Home at next render; no push | AD-09 Verified + "Confirmed late"; AD-12 |
| Wrong account / mismatch | Never creates a session | MA-17 Failed phase | AD-09 discrepancy row + reason tag |
| Refund — full, unused | Session cancelled atomically | Count drops at next render | AD-09 notice + toast; AD-04 "Voided by refund" |
| Refund — partial | Session kept | Unchanged | AD-09 partial notice |
| Refund — after use | Visit stays counted; guest stamp reversed (floor 0); free session already earned kept | Progress may drop by 1 | AD-09 used notice; AD-22 "Refunded after use" |
| Refund — renewal | No stamp or free-day reversal | Unchanged | AD-09 renewal notice (loyalty on) |
| Class marking denied | `session_required`; not marked; alert + attempt | — | AD-18 inline refusal + in-place payment, then mark again |
| Guest sessions card absent | Charging off, or role Receptionist/Coach | — | Absent from the DOM |
| Plan type locked | Plan has subscriptions | — | AD-23 read-only type + reason |

**Loyalty states *(FR-164–FR-170)*:**
| State | Rule | Member app | Dashboard |
|---|---|---|---|
| Loyalty off (default) | Nothing earned | No Rewards card unless an unexpired free session is held | No Rewards section (same exception); AD-13 switch off |
| Loyalty on, charging off | Guest rule earns nothing; subscriber rule works | Subscriber progress only | AD-13 charging-off notice |
| Stamp earned | Guest: per consumed **paid** session (not free, not covered re-entry). Subscriber: per on-time renewal, max one per period | Progress +1 at next render | AD-04 progress; AD-12 |
| Reward — free session | At N: free session valid 60 days, counter → 0, granted once | "Free session earned — valid for 60 days" once, then a free session row; "0 / 5" | AD-04; AD-22 Free given |
| Reward — free days | At K: renewed expiry + R days, counter → 0 | "[R] free days added — your new renewal date is [date]"; status card expiry moves | AD-04; AD-12 |
| Free session consumed | Consumed like paid (soonest-lapsing first; paid before free on tie); earns no stamp | Success with "Free session used" | AD-04 Used; AD-12 |
| Free session dormant | Member moved off Pay-per-session; kept until lapse | Neutral row "Usable when you're back on Pay-per-session" | AD-04 listed as unused |
| Free session lapsed | After 60 days | Drops off silently | AD-04 muted; AD-12 |
| Reset after idle | Guest: 90 days without a consumed paid session. Subscriber: the longer of 90 days and plan duration + grace. Read-time value, never stale | Card shows 0 at read time | AD-04 shows 0 at read time |
| Threshold lowered | Members at or above the new N/K earn one reward at the next qualifying event | — | AD-13 lowered-threshold note |
| Multi-gym member | Separate progress per gym | Active gym only | Per gym (RLS) |
| Balance edit | Impossible for every role (FR-170) | — | No control rendered, even disabled |

**Category *(FR-171/FR-172)*:** always set (existing gyms = Gym / Salle de sport). It is descriptive only, with no behaviour or wording change on any surface, and it never appears in the member app.

---

## Interaction Primitives

### Member App (Mobile)

**Touch targets:** Minimum 44×44pt on all tappable elements. Tab bar items span full cell width.

**Gestures:**
| Gesture | Where | Effect |
|---|---|---|
| Tap | All interactive elements | Primary action |
| Pull-to-refresh | MA-11 History (both tabs) | Refresh list |
| Swipe down | Modals, action sheets | Dismiss |
| Paste | MA-03 OTP input | Auto-fills all 6 boxes and auto-submits |
| Long press | Not used in V1 | — |
| Tap chart point | MA-15 Progress trend chart *(V1.5)* | Shows a tooltip with that entry's exact value + date |
| Toggle | MA-12 Notification rows; MA-15 photo share *(V1.5)* | Immediate optimistic flip, no confirmation |

**Keyboard:**
- Numeric keyboard auto-opens on: MA-02 (phone), MA-03 (OTP)
- Auto-capitalize words mode on: MA-05 (full name)
- OTP auto-advance: digit entry moves focus to next box; backspace from empty box moves to previous
- Keyboard dismissal: tap outside input or use Done/Return key

**Screen transitions:**
| Type | Animation |
|---|---|
| Onboarding step forward | Slide left |
| Back navigation | Slide right |
| Modal / action sheet open | Slide up from bottom |
| Modal / action sheet close | Slide down |
| Check-in result overlay | Fade in |
| Tab switch | Cross-fade |

**Haptic feedback:**
| Event | Haptic |
|---|---|
| Check-in success | Medium impact |
| Check-in denied | Notification error |
| OTP incorrect | Warning notification |
| Destructive action confirmed | Heavy impact |
| Check-in "Pay for your session" *(V1.6)* | Notification error (UX-DR15 denial haptic — nothing was recorded) |
| Check-in saved — will be verified *(V1.6)* | Warning notification (not success (unconfirmed), not error (nothing refused)) |
| Check-in success, free session used *(V1.6)* | Medium impact (same as any success) |
| MA-17 session payment verified *(V1.6)* | Success notification (matches a completed payment, distinct from check-in) |
| MA-17 payment failed / not approved *(V1.6)* | Notification error |

*(V1.6)* Check-in result overlays keep their fade-in. MA-17 pushes with slide-left and returns with slide-right, like `/renew`. On MA-17 success, [Scan now] replaces the route with MA-10, so Back does not return to a paid screen.

### Admin Dashboard (Desktop Web)

**Keyboard navigation:**
- Full keyboard traversal of all pages; no mouse-only actions
- Visible focus ring on all interactive elements; never `outline: none` without equivalent replacement
- Tables: Tab to rows; Enter to open detail or primary action
- Modals: focus trap; Escape closes (except destructive confirmations — Escape disabled there)
- Dropdowns: arrow keys to navigate; Enter to select; Escape to close
- Inline Renewal Panel tab order: Plan → Start Date → (Renewal Price — skip, read-only) → Payment Method → Note → Confirm Renewal → Cancel
- **Record Session Payment Panel tab order** *(V1.6)*: Payment Method → Note → Record session payment → Cancel (Amount is read-only and skipped, as Renewal Price is). Opening the panel moves focus to Payment Method; closing returns focus to the trigger ([Record session payment] on the alert, AD-04 header, or AD-18 row).
- **AD-18 marking refusal** *(V1.6)*: when the inline refusal appears, focus moves to its [Record session payment] button; after a successful payment focus returns to that member's Attended checkbox.
- **AD-13 V1.6 sections** *(V1.6)*: each section's own save button is in the tab order directly after its last field. The Charge-guests confirmation opens with focus on [Cancel], so Enter does not confirm by accident.
- **AD-15 Workout Plan exercise reordering** *(V1.5)*: drag handle is mouse-only by design (see Mouse behaviour below) — keyboard users get an equivalent "Move up" / "Move down" icon-button pair per row, both keyboard-focusable and announced ("Move [exercise name] up," "Move [exercise name] down")

**Mouse behaviour:**
- Table row hover: row background highlight; full row is clickable
- Alert dismiss [✕]: hover tooltip "Dismiss alert"
- Truncated text cells: hover tooltip shows full text
- Icon-only buttons: hover tooltip with action label
- Status badges: hover tooltip with full status description and date
- AD-15 Workout Plan exercise rows *(V1.5)*: drag handle appears on row hover; drag-and-drop reorder

**Real-time alert arrival:**
- No sound; no browser notification; no tab badge (V1)
- New alert slides into top of stack; existing alerts shift down
- ARIA live region announces arrival to screen readers

---

## Accessibility Floor

### Member App

| Requirement | Implementation |
|---|---|
| Screen reader support | All interactive elements have `accessibilityLabel`; decorative images have `accessibilityRole: 'none'` |
| Color independence | All status states communicated by color AND label text AND icon — never color alone |
| Check-in result | Result overlay uses accessibility "alert" role; announced immediately |
| OTP input labelling | Each box: "Digit 1 of 6" through "Digit 6 of 6" |
| Paste support | OTP paste supported; screen reader announces "Code pasted — verifying" |
| Camera denied state | [Open Settings] button is keyboard-focusable and describes its purpose |
| Touch targets | Minimum 44×44pt for all tappable elements |
| Font scaling | Layout adapts to system text size settings up to +2 steps without clipping |
| Language switch | Re-announces current screen title in new language after switch |
| Trend chart text-equivalent *(V1.5, MA-15)* | The weight trend chart is decorative to screen readers (`accessibilityRole: 'none'`); the header row's "78.4 kg (-2.4 kg since start)" text is the accessible summary, and the Measurements list below (already plain text rows) carries the same trend information non-visually — no chart-only data exists |
| Photo share status *(V1.5, MA-15)* | Each photo thumbnail's accessibility label states its share state explicitly: "Progress photo, 04 Aug 2026, not shared with coach" / "…, shared with coach" — not conveyed by the lock icon alone |
| Notification toggles *(V1.5, MA-12)* | Each toggle's accessible label states the setting name and current state: "Quiet-gym alerts, off" |
| Session result states *(V1.6, MA-10)* | "Pay for your session" and "Check-in saved — will be verified" use the accessibility `alert` role and are announced immediately, like every result overlay. They are communicated by colour **and** title **and** icon, so `{colors.info}` is never the only signal that this is not a success |
| Rewards progress *(V1.6, MA-09)* | The stamp row is decorative (`accessibilityRole: 'none'`). The progress block's label is the sentence "3 of 5 paid sessions toward your next free session" / "3 séances payées sur 5 avant votre prochaine séance gratuite" |
| Session rows *(V1.6, MA-09)* | Each Session Chip reads as one label: "Free session, use by 2 December" (dates spoken in full, not "2/12") |
| Post-sync denial notice *(V1.6, MA-09)* | Announced once on Home render (live region, polite); [Got it] has the label "Dismiss notice" / "Fermer l'avis" |
| MA-17 phases *(V1.6)* | Each phase change (pending, still waiting, success, failed) is announced through a polite live region, as on `/renew`'s `accessibilityRole="alert"` notes |

### Admin Dashboard

| Requirement | Implementation |
|---|---|
| Full keyboard navigation | Every action reachable without mouse |
| Focus indicators | Visible focus ring always present; never removed |
| Alert ARIA | `aria-live="assertive"` for red alerts; `aria-live="polite"` for yellow |
| Status badges | Badge text is the accessible label; color is supplementary |
| Tables | `<table>`, `<th scope="col">`, `<th scope="row">`; `aria-sort` on sorted columns |
| Modals | `aria-modal="true"`; focus trap; close button labeled "Close [dialog name]" |
| Form errors | Each error associated via `aria-describedby`; error summary on submit |
| Destructive confirmations | Confirm button labeled specifically: "Deactivate Amara K." not "Confirm" |
| Loading regions | `aria-busy="true"` on skeleton containers; removed when content resolves |
| Language toggle | `lang` on `<html>` updates on language change |
| Exercise reordering *(V1.5, AD-15)* | Keyboard-only "Move up"/"Move down" buttons per row, per the Interaction Primitives note above — drag alone is never the only way to reorder |
| Role-ceiling-filtered dropdowns *(V1.5, AD-17)* | The Role `<select>` only ever contains options the acting user may legally choose — screen reader users never encounter a role they'd then have rejected server-side |
| Session-required alert *(V1.6)* | `aria-live="assertive"`, the same as red denied alerts. The header text "SESSION REQUIRED" is the accessible signal, and `{colors.info}` is supplementary |
| Session alert in-flight line *(V1.6)* | Changes to "Mobile money payment in progress" are announced through the same assertive region only when it appears, not on every poll |
| Record session payment results *(V1.6)* | The success toast is in a polite live region. Refusal messages are `role="alert"` and associated to the panel via `aria-describedby` |
| AD-18 marking refusal *(V1.6)* | The inline row message is `role="alert"`, and focus moves to [Record session payment] (see Interaction Primitives) |
| Loyalty discount readout *(V1.6, AD-13)* | `aria-live="polite"`, updated after typing pauses (300 ms), with "≈" read as "about" / "environ" |
| Charge-guests confirmation *(V1.6, AD-13)* | The confirm button is labelled with the action, "Start charging" / "Stop charging", never "Confirm". The old-app warning is part of the dialog's `aria-describedby` |
| Guest sessions card *(V1.6, AD-02)* | The period control is a `radiogroup` with arrow-key navigation. Each figure link reads its full meaning: "41 paid sessions today, view list" |
| Plan type lock *(V1.6, AD-23)* | The read-only field uses `aria-readonly="true"` with the reason linked through `aria-describedby`, not conveyed by the lock icon alone |

**Color contrast:** All text meets WCAG 2.1 AA (4.5:1 for body; 3:1 for large text and UI components). See `DESIGN.md` for token values.

---

## Responsive & Platform Behaviour

### Member App

**Orientation:** Portrait primary. Landscape respected (not locked) but not optimised in V1. Camera viewfinder adapts to landscape.

**Safe areas:** All screens respect top (notch / dynamic island) and bottom (home bar) safe areas on both iOS and Android.

**Keyboard avoidance:** Input screens use `KeyboardAvoidingView`; active input scrolls into view above the keyboard. Behavior: `padding` on iOS, `height` on Android.

| Screen width | Behaviour |
|---|---|
| < 360px (very small Android) | Action rows and button pairs stack vertically; minimum 14sp text maintained |
| 360–430px (standard phones) | Nominal layout as designed |
| > 600px (tablet) | Content max-width 480px centered; additional padding on cards |

### Admin Dashboard — Responsive Breakpoints

| Viewport | Layout |
|---|---|
| ≥ 1280px (desktop) | Full sidebar 240px + full content; all table columns visible |
| 1024–1279px (small desktop) | Full sidebar 240px; secondary table columns hidden: Last Check-in, Actor |
| 768–1023px (tablet) | Sidebar collapses to 64px icon rail; hamburger (☰) in top bar reveals full sidebar as overlay; table columns: Name, Status, Expiry/Date, Actions only |
| < 768px (mobile) | Sidebar hidden (hamburger-only); persistent info banner "For the best experience, open on a desktop or tablet." (non-blocking); tables scroll horizontally |

**Table column priority (hidden first at narrow viewports):**
| Hidden at < 1024px | Hidden at < 768px | Always visible |
|---|---|---|
| Last Check-in, Actor, Duration | Phone, Email, Join Date, Billing Interval | Name, Status badge, Primary date column, Actions |

**Sidebar on tablet (768–1023px):**
- Icon rail (64px): active icon highlighted; hover tooltip shows nav label
- Hamburger in top bar: tapping opens full sidebar as left overlay with backdrop; tapping backdrop or a nav item closes it
- Icon rail always visible; overlay is additional

**Modals on tablet:**
- < 768px: full-screen
- ≥ 768px: centered card (max-width 640px) with backdrop

**Front-desk alert panel on tablet:**
- Max 3 alerts visible (vs 5 on desktop); avatar 32px; text truncated with hover tooltips
- *(V1.6)* The session-required variant keeps [Record session payment] visible; its in-flight line truncates first. The Record Session Payment Panel opens as the same 320px right drawer as the Inline Renewal Panel.

**Guest sessions card *(V1.6)*:** three figures side by side at ≥ 768px. Below 768px they stack vertically, and the period control moves under the title.

### Super Admin Dashboard

Same breakpoints as Admin Dashboard. Desktop primary; tablet supported; mobile shows info banner.

---

## Key Flows

### Flow 1 · Kwame's First Check-In *(UJ-1)*

**Protagonist:** Kwame, 28, office worker in Yaoundé. Has just received an SMS invite from his new gym.

**Entry:** SMS link → Play Store → installs GymOS → cold start.

1. **MA-01.** App opens. Device locale is French — Français is pre-highlighted. Kwame taps Français. All subsequent text renders in French.
2. **MA-02.** "+237" pre-filled. He types his number. Taps "Continuer."
3. **MA-03.** SMS arrives in ~12 seconds. He types the 6 digits. 6th digit auto-submits. OTP valid. Screen advances.
4. **MA-05–08.** He enters his name, selects "Prendre de la masse" (Build Muscle), selects "Débutant", confirms his pre-assigned Monthly plan. Taps "Confirmer et commencer."
5. **MA-09.** App loads in gym colours. Status card: "Actif — expire le 31 août 2026."
6. **MA-10.** Kwame taps Check-In tab. Camera activates immediately. He points at the QR on the gym wall.
7. **MA-10 Result — Success.** Green overlay: "Enregistré à 08h14." Auto-dismisses in 2.5 seconds.
8. **AD-11 (simultaneously).** Kwame's name appears in the Currently Checked-In table via Supabase Realtime. No alert (status is Active).

**Climax beat:** Scan-to-green-screen in under 2 seconds. No paperwork. No sign-in sheet. The app works the first time he uses it.

---

### Flow 2 · Amara's Grace Period — The Renewal Moment *(UJ-2a)*

**Protagonist:** Amara, monthly member. Status: `grace_period`. She doesn't know.

1. **MA-09.** Status card: "Période de grâce — expire le [date]" in orange. She doesn't read it carefully.
2. **MA-10.** She taps Check-In tab. Camera opens. She scans.
3. **Server accepts** check-in (grace period allows entry). Check-in recorded.
4. **MA-10 Result — Success.** Green overlay "Enregistré à 09h02." Auto-dismisses. Amara walks in.
5. **Dashboard — real-time (< 3 seconds).** Yellow alert slides into the panel on both AD-02 and AD-11: "🟡 PÉRIODE DE GRÂCE · Amara K. · Expire dans 1 jour · [Renouveler] [✕]"
6. **Receptionist taps [Renouveler].** Inline Renewal Panel opens. Plan: Mensuel (pre-populated). Start: aujourd'hui. Prix: 25 000 XAF. Méthode: Cash. Note: "Payé en caisse" (pre-filled).
7. **Receptionist taps [Confirmer le renouvellement].** Three taps total.
8. **Outcome.** Payment recorded. Status → Active. New expiry set. Alert dismisses. Amara receives push N-04.

**Climax beat:** 45 seconds. Amara has no idea anything was wrong. The money is collected at the door.

---

### Flow 3 · Amara Returns Expired *(UJ-2b)*

**Protagonist:** Amara, three weeks later. Status: `expired` (grace period ended).

1. **MA-09.** Status: "Abonnement expiré" (red). "Check In" quick-action replaced with "Voir la réception."
2. **MA-10.** She taps Check-In tab. Camera opens. She scans.
3. **Server rejects** check-in. Status is expired and beyond grace.
4. **MA-10 Result — Denied.** Full-screen red: "Accès refusé. Votre abonnement a expiré. Veuillez vous adresser à la réception." Does not auto-dismiss.
5. **Dashboard — real-time.** Red alert: "🔴 ACCÈS REFUSÉ · Amara K. · Expirée il y a 21 jours · Encaissez le paiement pour rétablir l'accès · [Renouveler] [✕]"
6. Receptionist spots Amara before she walks away. Taps [Renouveler]. Renewal panel → same flow → Confirm.

**Climax beat:** The system catches Amara at the door — not in a spreadsheet audit three days later.

---

### Flow 4 · Nadia Reconciles End-of-Day Payments *(UJ-3)*

**Protagonist:** Nadia, gym manager in Douala. 7 PM, end of shift.

1. **AD-09.** Opens Payments. Verification Queue: "3 paiements en attente de vérification."
2. Row 1: Jean B. | 25 000 XAF | Cash | Réceptionniste Claire N. | "Payé en caisse, membre confirmé" | 14:22.
3. Nadia cross-checks cash drawer. Matches. Taps "Vérifier." Confirmation → [Vérifier]. Row disappears; count decrements.
4. Repeats for rows 2 and 3.
5. **Queue gone.** Section no longer rendered.
6. **AD-11 cross-check.** 14 check-ins in the daily log. 14 payments in the ledger. All accounted for.

**Climax beat:** 7 PM, laptop closed. An audit trail that can't be altered, a cash drawer that matches.

---

### Flow 5 · Fatima Manages Her Clients *(UJ-4)*

**Protagonist:** Fatima, personal trainer, Coach role. Morning session prep.

1. **AD-14.** Logs in. Sidebar shows only "Portail Coach." 8 assigned clients. Marc shows "Expirant bientôt" (orange badge).
2. **Opens Éric.** Goal: Perdre du poids. Niveau: Débutant. Plan: Coach inclus. Expires in 12 days.
3. **Adds session note.** Taps [+ Ajouter une note]. Types note. Taps [Enregistrer]. Note appears: "Fatima B. · 04 Jul 2026, 09h22."
4. **Opens Marc.** Status: "Expirant bientôt." Amber info bar: "L'abonnement de Marc expire bientôt. Contactez votre réceptionniste." No Renew button.

**Climax beat:** Fatima's world is exactly the size of her 8 clients. The role boundary is invisible — it's just the interface.

---

### Flow 6 · Chidi Onboards a New Gym *(UJ-5)*

**Protagonist:** Chidi, GymOS platform staff, Super Admin.

1. **SA-02.** Clicks [+ Create Gym].
2. **SA-04.** Fills in: Gym Name: "FitZone Yaoundé" | Owner: Paul Nkusu | Phone: +237 6XX XXX XXX | Tier: Hustle | Status: Active. Clicks [Create Gym].
3. **Confirmation.** Toast: "Gym created. SMS sent to +237 6XX XXX XXX." Gym appears in list.
4. **Paul logs in** to Admin Dashboard. Opens Settings. Uploads logo. Sets primary colour. Timezone: Africa/Douala. Grace period: 3 days. Capacity: 50. Saves.
5. **CSV import.** Paul downloads template from Members → Import CSV. Fills in 45 members. Uploads. Validation passes. Confirms. 45 records created.

**Climax beat:** A gym that didn't exist this morning has 45 members on the platform by afternoon. Paul never touched a spreadsheet after the CSV.

---

### Flow 7 · Grace Staffs Her Gym *(V1.5, UJ-6)*

**Protagonist:** Grace, gym Owner, whose gym just joined the beta.

1. **AD-13 Settings.** Opens the new "Staff" row: "0 staff members." Taps [Manage staff →].
2. **AD-16.** Empty state: "No staff yet. Add your first staff member to get started." Taps [+ Add staff].
3. **AD-17.** Fills in: Name: "Aicha M." | Phone: +237 6XX XXX XXX | Role: Receptionist. Taps [Create].
4. **Confirmation.** Modal closes; Aicha appears in AD-16 with status "Pending activation." An SMS with a temp password and dashboard link is already on its way — Grace didn't send anything herself.
5. **Repeats for Emmanuel**, Role: Coach. Same flow, same four-minute rhythm.
6. **Emmanuel logs in** with his temp password, sets a real one, and lands in the Coach Portal — no other sidebar item is visible to him.
7. **Grace never contacts support.**

**Climax beat:** Four minutes, two staff accounts, zero support tickets. The role-ceiling check that would reject Grace trying to create another Owner never even surfaces — she was never offered that option in the first place.

---

### Flow 8 · Amara Tracks Her Progress *(V1.5, UJ-7)*

**Protagonist:** Amara, member, on a rest-day evening — not at the gym.

1. **Opens the app.** No check-in reason to be here tonight; taps the Progress tab (MA-15) instead of Home.
2. **MA-15, first visit.** Empty state: "Log your first entry to start tracking your progress." Taps [+ Log].
3. **Log Entry sheet.** Enters weight (68.2 kg) and waist (76 cm). Adds a photo from her camera roll. Leaves the note blank. Taps [Save entry].
4. **Sheet closes.** MA-15 now shows "68.2 kg" as her current weight — no prior entry to compare against yet, so no delta shown.
5. **Weeks later.** Same screen: "66.8 kg (-1.4 kg since start)," a trend line with three points, waist trending down 3 cm. She didn't train today. She opened the app anyway.

**Climax beat:** The photo she just uploaded is private by default — nobody at her gym, not even her coach, can see it until she explicitly shares it. That's not a setting she had to find; it's the state the app was already in.

---

### Flow 9 · Emmanuel Coaches With Real Data *(V1.5, UJ-8)*

**Protagonist:** Emmanuel, Coach role, reviewing an assigned client before their session.

1. **AD-14.** Opens his member list — Amara is on it (assigned).
2. **AD-15.** Three tabs now instead of one: Session Notes | Progress | Workout Plan. Opens Progress.
3. **Sees Amara's trend:** weight down, waist down, and two photos she's chosen to share with him — a third one from her camera roll is simply not there; he has no way to know it exists.
4. **Writes a coach note** on the plateau he's noticing in her arms measurement.
5. **Switches to Workout Plan.** Opens her existing plan, drags "Bicep Curl" below "Tricep Extension," swaps one exercise for another. Saves.
6. **A member he isn't assigned to** — he tries the same URL pattern out of curiosity. Blank. Not "access denied," just nothing there.

**Climax beat:** Emmanuel adjusted a real program based on real numbers, not what Amara remembered to tell him. The member he isn't assigned to doesn't just look empty — the query never ran.

---

### Flow 10 · Nadia Schedules a Week of Classes *(V1.5, UJ-9)*

**Protagonist:** Nadia, gym Manager, planning next week's schedule (also seen in Flow 4, reconciling payments — same gym, different afternoon).

1. **AD-18.** Empty-ish list, one existing class. Taps [+ Create class].
2. **AD-19.** Name: "HIIT" | Coach: Emmanuel | Capacity: 15 | Schedule: Recurring, Tue + Thu, 6:00 PM, starting 12 Aug. Taps [Create class].
3. **Modal closes.** HIIT now appears in AD-18 with its next session (Tue Aug 12) and a live "0/15" booking count.
4. **Members book from the app (MA-16)** across the week; by Tuesday morning the count reads "15/15" — the next member to try sees "Full" before they even tap.
5. **Tuesday, 6:55 PM.** The front desk's Receptionist opens AD-18, expands the Tuesday session, and checks off each booked member as they arrive — a separate record from floor check-in, but the same familiar interaction.
6. **60 minutes before the session**, every booked member got a push reminder (N-07) — Nadia didn't have to do anything for that to happen.

**Climax beat:** A class that existed only in Nadia's head on Monday runs itself by Tuesday evening — booking, capacity, reminders, and attendance, without her touching it again after creation.

---

### Flow 11 · Chidi Verifies the Payment Cutover *(V1.5, UJ-10)*

**Protagonist:** Chidi, GymOS platform staff, Super Admin — back at HQ, this time on the money side rather than onboarding (Flow 6).

1. **`supabase/.env` swap.** Points Tara Money credentials at the real, now-activated business account (`9FmIZg9GBB`) instead of the "Temporal" stand-in the original spike used. No code change — this is the `PaymentProvider` interface doing what it was built for.
2. **Re-runs the same exit criteria** that passed once already (2026-07-31): sandbox auth, an initiated payment returns a reference, the webhook lands and is processed, idempotency holds, one real-money round-trip completes.
3. **SA-07, weeks later, post-cutover.** Opens the Billing view — a different table from the one this flow is verifying (that one's `payments`, this one's `saas_billing_payments`), but Chidi checks both are behaving: no gym's Flow A settlement shows up misrouted to the platform account, and no gym shows a Flow B charge that landed in a gym's own account instead.
4. **Audit log cross-check.** Every Flow A payment's settlement account is verifiable against its own gym's connected credentials — not just asserted, provable (NFR-019).

**Climax beat:** One config value changed. The payment logic itself never moved — and the audit log is what lets Chidi *prove* that, not just claim it.

---

### Flow 12 · Ange Pays Per Session *(V1.6, UJ-11)*

**Protagonist:** Ange, a session guest who trains at Grace's gym three or four times a month and never wanted a monthly plan. Supporting cast: Aicha M. at the desk (Receptionist, Flow 7) and Grace (Owner, Flow 7).

**Entry:** Ange's first visit. Grace has already turned on "Charge guests per session" in AD-13 (the confirmation said how many Pay-per-session members would need a paid session at their next visit, and warned about older app versions). Grace has also set Loyalty to 1 free session per 5 paid.

1. **AD-05, then AD-03 row → Waive registration fee.** Aicha registers Ange and waives the registration fee with one tap on the "Session guest" preset. She puts Ange on the gym's Pay-per-session plan, 2,000 XAF a visit. *(Source note: AD-05 and waiving are Manager-plus, but UJ-11 has the desk do both. The flow keeps the PRD's names, and in practice a Manager performs this step.)*
2. **AD-04 (member modal) → [Record session payment].** Ange pays Aicha at the desk before scanning. The Record Session Payment Panel shows 2,000 XAF (fixed) and Cash; Aicha confirms. Toast: "Session recorded for Ange T. Ask them to scan again." *(Alternatively Ange taps [Pay for a session] on MA-09 and pays by Tara Money on MA-17, since Grace's gym has Tara connected.)*
3. **MA-10.** Ange scans the entrance QR like everyone else. Green: "Checked in." One payment covers her whole day; when she steps out and back in, the second scan costs nothing.
4. **One Thursday, MA-10.** She skips the payment and scans straight away. The app does not check her in: full-screen "Pay for your session" with [Pay now] and [See the front desk]. No attendance is recorded.
5. **AD-02 (simultaneously).** A "SESSION REQUIRED" alert slides into Aicha's panel: "Ange T. · No paid session". Aicha taps [Record session payment], collects 2,000 XAF in cash, and confirms. The alert dismisses itself.
6. **MA-10.** Ange scans again. Green: "Checked in."
7. **Her fifth paid visit, MA-09.** The Rewards card shows "Free session earned — valid for 60 days", and her progress is back at "0 / 5".
8. **Next visit, MA-10.** She scans and is checked in without paying: "Free session used."
9. **If she stays away.** After 90 days without a paid session her progress resets to 0. If she doesn't use the free session within 60 days, it lapses and drops off the card.
10. **Month end, AD-02.** Grace opens her Overview, switches the Guest sessions card to "This month", and reads 41 paid guest sessions, 6 blocked attempts, 8 free sessions given. She opens Paid on AD-22, grouped by Recorded by, and sees what the guest desk is actually earning.

**Climax beat:** The Thursday Ange forgot to pay costs her one extra scan, and costs the gym nothing. The app never pretended she was checked in, the desk caught it in real time, and at month end Grace can see what the guest desk is actually earning, down to who collected it.
