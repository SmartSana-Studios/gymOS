# Sprint Change Proposal — 2026-08-08

**Project:** gym_os
**Prepared by:** Correct Course workflow (BMad), with smartsana
**Trigger:** New requirement (stakeholder-initiated) — adopt a self-hosted Evolution API WhatsApp gateway as the primary OTP delivery channel and as the delivery mechanism for member invitations, with Super Admin-managed instance configuration.
**Related prior proposal:** 2026-07-14 (gym-owner activation temp-password SMS) — that proposal's root problem (Meta WhatsApp Business Platform template-approval friction for URL/dynamic content) is the same friction this change resolves for member invites, via a different (self-hosted, non-Cloud-API) channel.

---

## 1. Issue Summary

**Problem statement:** Two related gaps in the current messaging architecture:

1. OTP delivery (`send-sms-hook`) currently selects exactly one provider via a static `OTP_PROVIDER` env var (`twilio` / `twilio_whatsapp` / `sentdm`) — no fallback exists if the selected provider fails. The user wants to add Evolution API (a self-hosted WhatsApp gateway, already running) as the primary channel, with automatic fallback through the existing providers.
2. Member invitations (Story 2.5) have never been an automated backend send — the shipped design is explicitly client-only ("no Server Action, no persisted state"): staff copy a message or open a `wa.me` link from their own device. The user wants this automated via the same Evolution API gateway, eliminating the manual step and the WhatsApp Cloud API template-approval barrier entirely (Evolution API is not the official Business Platform, so no Meta template approval applies).

Because a self-hosted WhatsApp gateway is inherently less reliable than a managed provider (unofficial protocol, connection drops), the user also wants the specific instance ID configurable from the Super Admin dashboard, so a disconnected/replaced number can be pointed at without a code deployment.

**How this was discovered:** Raised directly by the user as a new capability request, not a bug or a failed implementation.

**Evidence:** Current `send-sms-hook/index.ts` implements single-provider selection only (`getProvider()`, a `switch` on `OTP_PROVIDER`, no chain/fallback logic). Current `InviteMemberModal.tsx` is confirmed client-only per its own code comment ("Client-side message composition only -- no Server Action, no persisted state (see Story 2.5 Scope Note #2/#3)"). No `EvolutionApiProvider` or Evolution API reference exists anywhere in the codebase today.

**Issue type:** New requirement emerged from stakeholder, overlapping with a technical-limitation fix (the same WhatsApp Cloud API friction documented in the 2026-07-14 proposal, resolved here via a different channel for a different flow).

---

## 2. Impact Analysis

### Epic Impact

- **Epic 1 (Platform Foundation & Gym Onboarding):** gains one new story — Super Admin Evolution API instance configuration (FR-071 extension) — plus one small bug-fix item folded into the same story: the Super Admin nav (`(admin)/layout.tsx`) has no logout control at all. A working `LogoutButton` component already exists in the codebase but is only wired into orphaned Supabase-starter-kit boilerplate routes (`app/protected/`, `app/page.tsx`), not the real admin layout — confirmed by direct inspection, not assumed. Epic not otherwise reopened.
- **Epic 2 (Member Onboarding & Management):** Story 2.1 (SMS/OTP Provider Sandbox Spike) is not redone, but gains a follow-up story: Evolution API sandbox spike + provider chain refactor of `send-sms-hook`. Story 2.5 (Member Invitation via Deep Link) is revised: automated send becomes the primary path; the original manual copy/share UI is kept as a failure-path fallback, not removed.
- No other epic affected. Story 1.11's `sendTempPasswordMessage.ts` (owner activation) is a related, un-migrated call site — explicitly out of scope for this proposal (see Section 4, Open Items).

### Story Impact

- **New story, Epic 1:** Super Admin — Evolution API Instance Configuration (includes wiring up the missing Logout control as a small bundled fix — see Section 4.3b).
- **New story, Epic 2:** Evolution API Sandbox Spike & OTP Provider Fallback Chain.
- **Revised story, Epic 2:** Story 2.5 — Member Invitation via Deep Link → automated send + resend + fallback.
- **Story 2.1:** no AC changes; gains a consumer/successor story, same precedent as the 2026-07-14 proposal's treatment of Story 2.1.

### Artifact Conflicts

- **PRD:** FR-071 gains a new Super Admin capability row (messaging instance management); FR-082 is rewritten (automated send replaces manual copy/share as the primary mechanism, with fallback). See Section 4.1.
- **Architecture:** OTP delivery moves from single-provider selection to an ordered fallback chain; a new `WhatsAppMessageProvider` interface is added alongside the existing `OtpDeliveryProvider` (different signature — free text vs. code+locale) to support invite sends; a new `messaging_provider_config` table (mirrors `tiers`' platform-wide, Super-Admin-CRUD shape) stores the instance ID; Infrastructure & Deployment gains a note that Evolution API is a self-hosted (already-running) service outside Supabase/Vercel's managed SLA, with the fallback chain as the explicit mitigation for that new dependency. See Section 4.2.
- **UX Design:** no existing mockup covers a Super Admin messaging-config page or an invite send-confirmation/resend state — both are new UI, not covered by `EXPERIENCE.md`/`DESIGN.md`. Flagged as a design gap the implementing story should extrapolate from existing Super Admin/dashboard patterns (same treatment 2026-08-04's notification-preferences entry gave an undocumented screen).
- **Other artifacts:** `docs/decisions.md` needs a new entry once the Evolution API spike completes (pass or fail), following the exact convention of the Notch Pay (Story 4.1) and SMS/OTP (Story 2.1) spike entries.

### Technical Impact

- `supabase/functions/send-sms-hook/index.ts`: `getProvider()`'s single-provider switch is replaced by an ordered chain runner over `OtpDeliveryProvider[]`; `OTP_PROVIDER` env var retired.
- New file: `supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.ts` (implements `OtpDeliveryProvider`).
- New file (Node/Next.js side, mirroring `sendTempPasswordMessage.ts`'s established Deno→Node porting pattern): `apps/dashboard/lib/messaging/sendMemberInviteViaEvolutionApi.ts`.
- New Server Action: `sendMemberInvite` in `apps/dashboard/app/(dashboard)/members/actions.ts`.
- `InviteMemberModal.tsx`: kept, repurposed as the failure-path fallback UI; gains a triggering "Send Invite" primary action wired to the new Server Action, a success confirmation state, and a resend affordance.
- New migration: `messaging_provider_config` table (public schema, one row, `instance_id`, `updated_by`, `updated_at`), RLS mirroring `tiers` (Super Admin CRUD), audit-logged writes via `log_audit_event`.
- New Super Admin page/section (Messaging settings) + `actions.ts` addition (`updateMessagingInstance` or similar).

---

## 3. Recommended Approach

**Selected path: Option 1 — Direct Adjustment.** Two new stories plus one story revision, entirely within the existing Epic 1/Epic 2 structure. Not a rollback (nothing shipped is being undone) and not an MVP/PRD scope reduction (this is additive capability, not a cut).

- **Option 2 (Rollback):** not applicable — no prior work is invalidated; Evolution API is a new addition alongside already-working providers.
- **Option 3 (MVP/PRD review):** not needed as a scope-reduction exercise. The PRD does get two edits (FR-071, FR-082), but both are additive, not a re-scoping of goals or MVP.
- **Option 1 (Direct Adjustment):** viable. Effort: **Medium** (new interface, new table, two new/revised stories, one new Super Admin page, provider-chain refactor). Risk: **Medium** — an unofficial/self-hosted WhatsApp gateway carries real connection-stability risk, which is exactly why (a) a sandbox spike gates it before production use, and (b) it's placed first in a fallback chain rather than as a sole provider, so OTP delivery never regresses in reliability even if Evolution API is unavailable.

**Rationale:** The fallback-chain design means this change is additive risk-free from a reliability standpoint — Evolution API can only improve delivery (lower friction, no template approval) or fall through to the already-proven Twilio/sent.dm path. The genuinely new risk surface is the member-invite flow gaining its first-ever automated send dependency, mitigated by keeping the manual flow as an explicit fallback (per user decision) and adding a resend affordance.

**Timeline impact:** One sandbox spike (short, per this project's established one-day-spike convention) gates the OTP chain and invite-send stories. The Super Admin instance-config story is independent and can proceed in parallel.

---

## 4. Detailed Change Proposals

### 4.1 PRD (`prd.md`)

**FR-071** (Section 6.14, Super Admin capabilities table) — add a row:

```
NEW row:
| Messaging instance management | View the active Evolution API WhatsApp instance ID and connection
status; update the instance ID used for platform-wide WhatsApp sends (OTP delivery and member
invitations) when a number disconnects, without a code deployment |
```

**FR-082** (Section 6.5, Member Management):

```
OLD:
When a Manager or Owner creates a new member record in the dashboard, the system generates a
personalized onboarding invitation. The invitation contains the member's name, the gym name, and
a deep link to the GymOS app (a custom URL scheme that opens the app or falls back to the Play
Store / App Store). The gym admin copies or sends this message — via SMS or WhatsApp — directly
from the dashboard. The deep link pre-associates the member's phone number, so the OTP screen is
the first thing they see in the app.

NEW:
When a Manager or Owner creates a new member record in the dashboard and clicks "Send Invite," the
system automatically sends a personalized onboarding invitation via WhatsApp, routed through the
self-hosted Evolution API gateway (FR-071). The invitation contains the member's name, the gym
name, and a deep link to the GymOS app. The deep link pre-associates the member's phone number, so
the OTP screen is the first thing they see in the app. Manager/Owner may resend at any time from
the member's row. If the automated send fails, the dashboard shows an inline error and falls back
to the manual copy/share-via-WhatsApp option as a safety net.
```

**Rationale:** documents the new Super Admin operational lever and the shift from manual to automated invite delivery, while preserving user-approved fallback and resend behavior.

### 4.2 Architecture (`architecture.md`)

**Authentication & Security — OTP delivery** (append to the existing `OtpDeliveryProvider` paragraph):

```
send-sms-hook no longer selects a single provider via the OTP_PROVIDER env var. It runs an ordered
fallback chain against the same OtpDeliveryProvider interface: EvolutionApiProvider →
TwilioWhatsAppProvider → TwilioSmsProvider → SentDmProvider. Each provider is tried in order; the
chain advances to the next provider only on failure (network error, non-2xx, or a DeliveryResult
with success:false); the first success short-circuits the chain. Each attempt is logged (provider
name, outcome). EvolutionApiProvider is gated by its own sandbox spike (mirroring Story 2.1/4.1's
precedent), recorded in docs/decisions.md, before it is added to the chain in production — a spike
failure does not block the existing three-provider chain, which remains the production path.
```

**New subsection — General (non-OTP) WhatsApp messaging:**

```
A second, narrower interface, WhatsAppMessageProvider (send(phone, message, locale):
Promise<DeliveryResult>, free text, no code/template constraint), supports sends that don't fit
OtpDeliveryProvider's code-shaped contract — starting with member invitations (FR-082). V1 ships
one implementation, EvolutionApiMessageProvider, called from a new Next.js Server Action
(sendMemberInvite) in apps/dashboard, following the same Deno→Node porting precedent
sendTempPasswordMessage.ts already established (Edge Function modules can't be imported into
Next.js). No new Edge Function is added — the two-Edge-Functions boundary (notch-pay-webhook,
send-sms-hook) is unchanged.
```

**New table — `messaging_provider_config`:** public schema, platform-wide (not gym-scoped, mirrors `tiers`), one row: `instance_id text`, `updated_by uuid`, `updated_at timestamptz`. RLS: Super Admin SELECT/UPDATE (same role-check shape as `tiers`); `send-sms-hook` and the new invite Server Action read it via their existing service-role clients. Writes are audit-logged (`log_audit_event`, actor + old/new instance ID), per FR-080 convention.

**Infrastructure & Deployment** — new note:

```
Evolution API runs as a self-hosted service (already provisioned and running, outside this
project's build/deploy pipeline) — the first platform dependency not covered by Supabase Cloud's
or Vercel's managed SLA (NFR-005). The OTP fallback chain (above) is the explicit mitigation:
Evolution API's availability never gates OTP delivery, only its priority within the chain.
```

### 4.3 New Story — Epic 1

```
As GymOS platform staff (Super Admin),
I want to view and update the active Evolution API instance ID from the Super Admin dashboard,
So that when a connected WhatsApp number disconnects, I can point the platform at a working
instance immediately, without a code deployment.

Acceptance Criteria:

Given the Super Admin Messaging settings page
When I view it
Then I see the currently configured Evolution API instance ID

Given a new instance ID (after reconnecting a number or provisioning a new one directly in
Evolution API's own admin panel — pairing/QR itself is out of scope for GymOS's UI)
When I enter it and save
Then messaging_provider_config is updated, the change takes effect for the next OTP/invite send
with no redeploy, and the change is audit-logged (actor, old value, new value, timestamp)

Given an empty or malformed instance ID
When I attempt to save
Then the save is rejected with an inline validation error and the previous value remains active
```

### 4.3b Bundled Fix — Epic 1 (same story): Wire Up Super Admin Logout

```
Given the Super Admin nav bar ((admin)/layout.tsx)
When it renders
Then a Logout control (reusing the existing LogoutButton component) appears alongside
Metrics/Tiers/Payment Providers/Language toggle

Given Super Admin clicks Logout
When the sign-out completes
Then the session ends and they're redirected to /auth/login (matching LogoutButton's existing
behavior — no new logic needed, just wiring it into the real layout)
```

**Note:** this is a bug fix (missing wiring), not new capability — bundled into the same story as instance configuration since both touch the same nav/layout surface, not because they're related in purpose.

### 4.4 New Story — Epic 2

```
As a developer,
I want to validate Evolution API against a real send/receive round-trip and wire it into an ordered
fallback chain ahead of the existing Twilio/sent.dm providers,
So that OTP delivery gains a lower-friction primary channel without weakening reliability if it's
unavailable.

Acceptance Criteria:

Given the already-running Evolution API instance
When I send a test OTP-shaped message and confirm delivery
Then the outcome is recorded in docs/decisions.md (send succeeds, response shape confirmed,
instance-disconnect behavior observed and documented)

Given the spike passes
When EvolutionApiProvider (implements OtpDeliveryProvider) is added to send-sms-hook
Then the OTP_PROVIDER env var is retired, and the hook tries providers in order — Evolution API →
Twilio WhatsApp → Twilio SMS → sent.dm — advancing to the next on any failure

Given the Evolution API instance is disconnected or misconfigured
When an OTP is requested
Then the chain falls through to Twilio WhatsApp (then SMS, then sent.dm) and the OTP still arrives

Given the spike fails
When that occurs
Then Evolution API is not added to the chain until a fix is validated and documented — the existing
three-provider chain (Twilio WhatsApp → Twilio SMS → sent.dm) ships and remains the production path
```

### 4.5 Revised Story — Epic 2, Story 2.5 (Member Invitation via Deep Link)

```
OLD Acceptance Criteria:
Given a newly created member record
When I click "Send Invite"
Then a message containing the member's name, gym name, and a deep link is generated for me to copy
or share via SMS/WhatsApp

NEW Acceptance Criteria:
Given a newly created member record
When I click "Send Invite"
Then the system automatically sends the personalized invitation (member's name, gym name, deep
link) via WhatsApp through the Evolution API gateway — no manual copy/share step required

Given the automated send succeeds
When it completes
Then the dashboard shows a confirmation ("Invite sent to [name] via WhatsApp")

Given the automated send fails (Evolution API unreachable, instance disconnected)
When the failure occurs
Then the dashboard shows an inline error and offers the existing manual copy/share-via-WhatsApp
flow as a fallback — the same UI Story 2.5 originally shipped, now demoted to a fallback path
rather than the primary flow

Given a member who was already sent an invite (successfully or not)
When Manager/Owner clicks "Send Invite" again from the member's row
Then a new automated send attempt is made via Evolution API (same success/failure/fallback
behavior as the original send) — resending is not blocked or rate-limited beyond what Evolution
API itself enforces

Given the member taps the deep link (unchanged from original)
When the app opens (or falls back to the Play Store/App Store)
Then the deep link's phone number is available to pre-associate at the OTP step
```

**Implementation note:** `InviteMemberModal.tsx`'s existing copy/wa.me UI is kept, not deleted — it becomes the failure-path fallback. New Server Action `sendMemberInvite` calls the new `EvolutionApiMessageProvider` (Node-side).

### Open Items (not in scope of this proposal, flagged for awareness)

- **Story 1.11's owner-activation temp-password send** (`sendTempPasswordMessage.ts`) still uses Twilio WhatsApp directly, not the new chain/Evolution API. Migrating it is a natural follow-up but was not requested here — left untouched.
- **Connection-status display** (live "connected/disconnected" indicator) for the Super Admin messaging page was considered and intentionally scoped out — V1 is instance-ID-only, per user decision.

---

## 5. Implementation Handoff

**Change scope classification: Moderate.** This spans a new external-integration spike, a new DB table + RLS + audit logging, a new interface, and two dashboard-facing flows (Super Admin + member dashboard) — beyond a single-file fix, but fully contained within the existing Epic 1/Epic 2 structure with no PRD MVP or architecture-pattern reversal.

**Routed to:** Developer agent (Amelia) for story implementation, following this proposal's four artifacts in dependency order:
1. Epic 1 story (Super Admin instance config) — independent, can start immediately.
2. Epic 2 spike story (Evolution API validation + chain) — gates the invite-send story.
3. Epic 2 Story 2.5 revision (automated invite + resend + fallback) — depends on (2)'s `EvolutionApiMessageProvider`/chain infrastructure existing.

**Success criteria:** OTP delivery never regresses (chain always falls through to the already-proven three-provider path); member invites send automatically with a working fallback and resend; Super Admin can redirect the platform to a new instance ID with zero deployment, audit-logged.

**PRD MVP impact:** None — additive capability, not a scope change.
