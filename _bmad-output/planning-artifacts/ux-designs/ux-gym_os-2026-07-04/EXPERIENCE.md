---
name: GymOS
status: draft
created: 2026-07-04
updated: 2026-07-04
sources:
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md
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
| Admin Dashboard | Next.js web app | Receptionist, Manager, Owner, Coach | Desktop browser |
| Super Admin Dashboard | Next.js web app (separate URL + auth) | GymOS platform staff | Desktop browser |

**Localization.** All UI strings, push notification copy, and error messages are available in English (EN) and French (FR). Language resolves in priority order: (1) user-saved preference stored on the account, (2) device/browser locale, (3) EN fallback. No string is hardcoded in the UI — all strings flow through the i18n layer. Date and monetary values follow locale conventions (e.g., "25 000 XAF" in FR; "25,000 XAF" in EN).

**Authentication.** Members authenticate via phone + OTP. Admin dashboard users (Owner, Manager, Receptionist, Coach) authenticate via email + password. Super Admin users authenticate via a separate credential flow on the Super Admin dashboard URL. All authenticated sessions carry a JWT with custom claims (`gym_id`, `role`) injected by the Supabase auth hook. A missing or malformed claim defaults to deny-all; the UI shows "You don't have permission to do that."

**Role-based rendering.** Navigation items, action buttons, and columns the current user cannot access are hidden — not disabled and not visible. The only exception: status information that helps a lower-permission user do their job (e.g., a Receptionist sees a member's subscription status even though they cannot edit it).

**Monetary display.** All monetary values are integers in XAF. Display as: "25 000 XAF" (FR) / "25,000 XAF" (EN). Never show decimal places for XAF.

---

## Surface Index — All Screens

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
| MA-09 | Home | `/home` | Post-onboarding; bottom tab |
| MA-10 | Check-In (+ result states) | `/checkin` | Bottom tab; Home quick-action |
| MA-11 | History | `/history` | Bottom tab |
| MA-12 | Profile | `/profile` | Bottom tab |
| MA-13 | Plan Details | `/plan` | Home quick-action |
| MA-14 | Payment Detail | `/history/payment/:id` | History → payment row |

### Admin Dashboard

| ID | Page | Route | Min Role |
|---|---|---|---|
| AD-01 | Login | `/login` | — |
| AD-02 | Overview | `/` | Receptionist |
| AD-03 | Members — List | `/members` | Receptionist |
| AD-04 | Member — Detail | `/members/:id` | Receptionist |
| AD-05 | Member — Create / Edit | `/members/new`, `/members/:id/edit` | Manager |
| AD-06 | Member — Invite | Modal on AD-03 / AD-04 | Manager |
| AD-07 | CSV Import | Modal on AD-03 | Manager |
| AD-08 | Subscriptions | `/subscriptions` | Manager |
| AD-09 | Payments | `/payments` | Receptionist |
| AD-10 | Manual Payment Entry | Modal on AD-09 / AD-02 | Receptionist |
| AD-11 | Attendance | `/attendance` | Receptionist |
| AD-12 | Audit Log | `/audit` | Manager |
| AD-13 | Settings | `/settings` | Owner |
| AD-14 | Coach Portal — Member List | `/coach` | Coach |
| AD-15 | Coach Portal — Member Detail | `/coach/:memberId` | Coach |

### Super Admin Dashboard

| ID | Page | Route |
|---|---|---|
| SA-01 | Login | `/login` |
| SA-02 | Gym List | `/gyms` |
| SA-03 | Gym Detail | `/gyms/:id` |
| SA-04 | Create Gym | Modal on SA-02 |
| SA-05 | Platform Metrics | `/metrics` |
| SA-06 | Tier Management | `/tiers` |

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
└── Bottom Tab Bar (always visible)
    ├── Tab 1: Home (MA-09)
    │    ├── → Check-In (MA-10)     [quick-action button]
    │    └── → Plan Details (MA-13) [quick-action button]
    ├── Tab 2: Check-In (MA-10)     [camera activates on tab entry]
    ├── Tab 3: History (MA-11)
    │    ├── → Plan Details (MA-13)
    │    └── → Payment Detail (MA-14)
    └── Tab 4: Profile (MA-12)
```

### Admin Dashboard IA

```
Admin Dashboard
├── Sidebar (role-filtered; see Navigation Structure)
│   ├── Overview          → AD-02
│   ├── Members           → AD-03 → AD-04 → AD-05 / AD-06 / AD-07
│   ├── Subscriptions     → AD-08
│   ├── Payments          → AD-09 → AD-10 (modal)
│   ├── Attendance        → AD-11
│   ├── Audit Log         → AD-12
│   ├── Settings          → AD-13
│   └── [Coach role only]
│       └── Coach Portal  → AD-14 → AD-15
└── Floating / Overlay
    ├── Front-Desk Alert Panel  [on AD-02, AD-11; real-time]
    └── Inline Renewal Panel    [within alert or Subscriptions row]
```

### Super Admin Dashboard IA

```
Super Admin Dashboard
└── Sidebar
    ├── Gyms      → SA-02 → SA-03; SA-04 (modal on SA-02)
    ├── Metrics   → SA-05
    └── Tiers     → SA-06
```

---

## Navigation Structure

### Member App — Bottom Tab Bar

| Tab index | Label | Icon type | Badge |
|---|---|---|---|
| 1 | Home | House icon | Red dot if status = expired; orange dot if expiring_soon or grace_period |
| 2 | Check In | QR / scan icon | None |
| 3 | History | Clock / list icon | None |
| 4 | Profile | Avatar / person icon | None |

**Rules:**
- Tab bar is rendered only for authenticated users. Onboarding screens have no tab bar.
- Active tab: accent color on icon + label; no indicator bar needed (color alone is sufficient given tab labeling).
- Tapping the active tab scrolls its screen back to the top (if scrollable).
- Check-In tab (Tab 2): activates the camera immediately on tab entry without requiring any further tap.
- Deep link from SMS invite (new member): app opens → if unauthenticated → MA-01 → MA-02 with phone number from deep link pre-populated.
- Deep link for returning authenticated user: open to MA-09 (Home).

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

| Nav item | Receptionist | Manager | Owner | Coach |
|---|---|---|---|---|
| Overview | ✓ | ✓ | ✓ | — |
| Members | ✓ | ✓ | ✓ | — |
| Subscriptions | — | ✓ | ✓ | — |
| Payments | ✓ | ✓ | ✓ | — |
| Attendance | ✓ | ✓ | ✓ | — |
| Audit Log | — | ✓ | ✓ | — |
| Settings | — | — | ✓ | — |
| Coach Portal | — | — | — | ✓ |

Coach role: sidebar renders only the "Coach Portal" link. All other items are absent from the DOM.

**Logout:** Clicking Logout shows a confirmation inline ("Log out of GymOS?" [Log out] [Cancel]) before clearing session.

### Super Admin Dashboard — Sidebar

Same structure as Admin Dashboard sidebar. 240px fixed on desktop. Links: Gyms | Metrics | Tiers.

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

**Layout:**
```
┌──────────────────────────────────┐
│ [Gym Logo] [Gym Name]   [avatar] │  ← branded header (gym colors applied)
├──────────────────────────────────┤
│  "Welcome back, [First Name]"    │  ← muted subtitle
│                                  │
│  ┌────────────────────────────┐  │
│  │  [Status badge]            │  │
│  │  Monthly Plan              │  │
│  │  Expires: 31 Aug 2026      │  │
│  └────────────────────────────┘  │
│                                  │
│  [Check In]        [View Plan]   │  ← quick actions (icon + label)
│                                  │
│  Recent Activity                 │
│  ─────────────────────────────── │
│  [event row]              [date] │
│  [event row]              [date] │
│                                  │
├──────────────────────────────────┤
│ [Home] [Check In] [History] [Me] │  ← bottom tab bar
└──────────────────────────────────┘
```

**Components:**
- **Branded header:** gym logo (left, max 40px height), gym name (center or right of logo), member avatar (right, 36px, tappable → navigates to MA-12)
- **Welcome text:** "Welcome back, [First Name]" in muted style
- **Subscription status card:**
  - Status badge: see Status Badge states below
  - Plan name
  - Expiry date formatted per locale
  - Tapping the card navigates to MA-13 (Plan Details)
- **Quick action buttons:** "Check In" (navigates to MA-10) + "View Plan" (navigates to MA-13); row of two equal-width buttons
- **Recent activity section:** last 2–3 combined events (check-ins + payments, reverse chronological); each row tappable; check-in rows navigate to History, payment rows navigate to MA-14

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
- On scan: check-in recorded to local SQLite immediately; show success result with sync indicator
- Sync fires automatically when connectivity returns

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

---

### MA-11 · History

**Purpose:** Member views their full payment and attendance history.

**Layout:**
```
┌──────────────────────────────────┐
│  History                         │
├─────────────────┬────────────────┤
│    Payments     │   Check-ins    │  ← segmented control
├─────────────────┴────────────────┤
│  [event row]         [date/time] │
│  [event row]         [date/time] │
│  [event row]         [date/time] │
│  ...                             │
├──────────────────────────────────┤
│ [Home] [Check In] [History] [Me] │
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

---

### MA-12 · Profile

**Purpose:** Member views and edits their profile, changes language, and manages their session.

**Layout:**
```
┌──────────────────────────────────┐
│  Profile                         │
│                                  │
│  [Avatar, 64px, centered]        │
│  [Member Full Name]              │
│  [Gym Name]  ·  [Plan Name]      │
│                                  │
├──────────────────────────────────┤
│  Edit profile                  → │
│  ─────────────────────────────── │
│  Language          [EN] [FR]     │
│  ─────────────────────────────── │
│  Log out                         │
├──────────────────────────────────┤
│ [Home] [Check In] [History] [Me] │
└──────────────────────────────────┘
```

**Components:**
- Avatar (tappable only in edit mode)
- Name, gym name, plan name (read-only display)
- "Edit profile" row → inline edit section: name field (pre-filled, editable) + photo upload circle; phone number shown as non-editable with label "Contact your gym to change your number"
- Language row: segmented EN | FR toggle — tapping the non-active option switches immediately; no reload required
- "Log out" row → bottom sheet: "Log out of GymOS?" [Log out] [Cancel]

**Interactions:**
- Language change: immediately re-renders all app strings; preference saved to account; screen reader announces the change in the new language
- Edit profile save: spinner during save; success → collapses to read-only; failure → inline error below name field
- Log out: clears local tokens; navigates to MA-01

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

Email address *   [input]
Password *        [input + show/hide toggle]

[          Sign in          ]

"Forgot password?" link
```

**Interactions:**
- Form submits on Enter key from either field
- On submit: spinner on button; button disabled
- On success: redirect to AD-02 or originally-requested deep link

**Error states:**
- Invalid credentials: inline below password — "Email or password is incorrect."
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

---

### AD-13 · Settings

**Purpose:** Gym configuration. Owner only.

**Layout:**
```
Settings                                              [Save Settings]

── Branding ──────────────────────────────────────────────────────────
Gym Name *         [                               ]
Logo               [preview thumbnail] [Upload new] [Remove]
Primary Color *    [#E0971F  ] [live color swatch]

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
```

**Component behaviors:**
- Primary Color hex input: live swatch updates as user types valid hex
- Logo upload: image/* only; max 5MB; preview updates after selection; gym name is fallback if no logo
- QR Download: PNG download of current code
- QR Regenerate: confirmation dialog before action (see below)
- Save: single button saves all sections; spinner; success toast "Settings saved."

**Regenerate QR confirmation:**
- Title: "Regenerate QR code?"
- Body: "This will invalidate the current code immediately. Any printed or displayed copies will stop working. You will need to replace them."
- [Cancel] [Regenerate]

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

**Empty state:** "No members have been assigned to you yet. Ask your manager to assign members."

---

### AD-15 · Coach Portal — Member Detail

**Purpose:** Coach views an assigned member's profile and manages session notes.

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

Session Notes                                        [+ Add note]

────────────────────────────────────────────────────────────────
[Note text]
Fatima B.  ·  04 Jul 2026, 09:22        [Edit — own notes only]
────────────────────────────────────────────────────────────────
[Note text]
Fatima B.  ·  01 Jul 2026, 11:05
────────────────────────────────────────────────────────────────
```

**Components:**
- Member header: all read-only; no renew button for Coach role
- **Status info bar** (conditional — amber, shown when expired): informational only; no action
- "**+ Add note**": opens inline textarea at the top of the notes list; auto-expands; character count shown; [Save note] [Cancel]
- **Note editing (own notes only):** "Edit" appears on hover; inline editable textarea; saved note shows "Edited [timestamp]" appended
- Coach cannot edit other coaches' notes

**Empty state (notes):** "No session notes yet. Add the first note above."

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
Status             [Active  ▾]

[Cancel]                                        [Create Gym]
```

**On submit:** Creates gym + owner account; sends SMS to owner; toast "Gym created. SMS sent to [number]."; modal closes; list refreshes.

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

## Cross-Cutting Components

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
| Primary Color | Required; valid hex (#RRGGBB) | "Enter a valid hex colour (e.g. #E0971F)" |
| Logo | Optional; image file; ≤5MB | "Image too large — maximum 5MB" |
| Grace Period | Required; integer 1–30 | "Grace period must be between 1 and 30 days" |
| Gym Capacity | Required; positive integer | "Enter the gym's member capacity" |
| Alert Auto-Dismiss | Required; integer 1–120 | "Auto-dismiss must be between 1 and 120 minutes" |

**AD-16 Inline Renewal Panel**
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

### Loading States

**Timing rules:**
- < 300ms: show nothing (no skeleton flash on fast connections)
- 300ms–1000ms: skeleton loaders matching expected content shape
- > 1000ms: skeleton + "Still loading…" label at the 3-second mark
- Sections load independently; slow tables must not block fast stat cards

| Context | Skeleton shape |
|---|---|
| MA-09 Status card | Rounded rectangle, ~88px tall, full-width |
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

### Admin Dashboard (Desktop Web)

**Keyboard navigation:**
- Full keyboard traversal of all pages; no mouse-only actions
- Visible focus ring on all interactive elements; never `outline: none` without equivalent replacement
- Tables: Tab to rows; Enter to open detail or primary action
- Modals: focus trap; Escape closes (except destructive confirmations — Escape disabled there)
- Dropdowns: arrow keys to navigate; Enter to select; Escape to close
- Inline Renewal Panel tab order: Plan → Start Date → (Renewal Price — skip, read-only) → Payment Method → Note → Confirm Renewal → Cancel

**Mouse behaviour:**
- Table row hover: row background highlight; full row is clickable
- Alert dismiss [✕]: hover tooltip "Dismiss alert"
- Truncated text cells: hover tooltip shows full text
- Icon-only buttons: hover tooltip with action label
- Status badges: hover tooltip with full status description and date

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

### Super Admin Dashboard

Same breakpoints as Admin Dashboard. Desktop primary; tablet supported; mobile shows info banner.

---

## Key Flows

### Flow 1 · Kwame's First Check-In

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

### Flow 2 · Amara's Grace Period — The Renewal Moment

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

### Flow 3 · Amara Returns Expired

**Protagonist:** Amara, three weeks later. Status: `expired` (grace period ended).

1. **MA-09.** Status: "Abonnement expiré" (red). "Check In" quick-action replaced with "Voir la réception."
2. **MA-10.** She taps Check-In tab. Camera opens. She scans.
3. **Server rejects** check-in. Status is expired and beyond grace.
4. **MA-10 Result — Denied.** Full-screen red: "Accès refusé. Votre abonnement a expiré. Veuillez vous adresser à la réception." Does not auto-dismiss.
5. **Dashboard — real-time.** Red alert: "🔴 ACCÈS REFUSÉ · Amara K. · Expirée il y a 21 jours · Encaissez le paiement pour rétablir l'accès · [Renouveler] [✕]"
6. Receptionist spots Amara before she walks away. Taps [Renouveler]. Renewal panel → same flow → Confirm.

**Climax beat:** The system catches Amara at the door — not in a spreadsheet audit three days later.

---

### Flow 4 · Nadia Reconciles End-of-Day Payments

**Protagonist:** Nadia, gym manager in Douala. 7 PM, end of shift.

1. **AD-09.** Opens Payments. Verification Queue: "3 paiements en attente de vérification."
2. Row 1: Jean B. | 25 000 XAF | Cash | Réceptionniste Claire N. | "Payé en caisse, membre confirmé" | 14:22.
3. Nadia cross-checks cash drawer. Matches. Taps "Vérifier." Confirmation → [Vérifier]. Row disappears; count decrements.
4. Repeats for rows 2 and 3.
5. **Queue gone.** Section no longer rendered.
6. **AD-11 cross-check.** 14 check-ins in the daily log. 14 payments in the ledger. All accounted for.

**Climax beat:** 7 PM, laptop closed. An audit trail that can't be altered, a cash drawer that matches.

---

### Flow 5 · Fatima Manages Her Clients

**Protagonist:** Fatima, personal trainer, Coach role. Morning session prep.

1. **AD-14.** Logs in. Sidebar shows only "Portail Coach." 8 assigned clients. Marc shows "Expirant bientôt" (orange badge).
2. **Opens Éric.** Goal: Perdre du poids. Niveau: Débutant. Plan: Coach inclus. Expires in 12 days.
3. **Adds session note.** Taps [+ Ajouter une note]. Types note. Taps [Enregistrer]. Note appears: "Fatima B. · 04 Jul 2026, 09h22."
4. **Opens Marc.** Status: "Expirant bientôt." Amber info bar: "L'abonnement de Marc expire bientôt. Contactez votre réceptionniste." No Renew button.

**Climax beat:** Fatima's world is exactly the size of her 8 clients. The role boundary is invisible — it's just the interface.

---

### Flow 6 · Chidi Onboards a New Gym

**Protagonist:** Chidi, GymOS platform staff, Super Admin.

1. **SA-02.** Clicks [+ Create Gym].
2. **SA-04.** Fills in: Gym Name: "FitZone Yaoundé" | Owner: Paul Nkusu | Phone: +237 6XX XXX XXX | Tier: Hustle | Status: Active. Clicks [Create Gym].
3. **Confirmation.** Toast: "Gym created. SMS sent to +237 6XX XXX XXX." Gym appears in list.
4. **Paul logs in** to Admin Dashboard. Opens Settings. Uploads logo. Sets primary colour. Timezone: Africa/Douala. Grace period: 3 days. Capacity: 50. Saves.
5. **CSV import.** Paul downloads template from Members → Import CSV. Fills in 45 members. Uploads. Validation passes. Confirms. 45 records created.

**Climax beat:** A gym that didn't exist this morning has 45 members on the platform by afternoon. Paul never touched a spreadsheet after the CSV.
