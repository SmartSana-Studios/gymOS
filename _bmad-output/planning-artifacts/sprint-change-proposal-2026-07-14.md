# Sprint Change Proposal — 2026-07-14

**Project:** gym_os
**Prepared by:** Correct Course workflow (BMad), with smartsana
**Trigger story:** Story 1.5 — Super Admin: Create & Onboard a Gym (status: `done`)
**Related story:** Story 2.1 — SMS/OTP Provider Sandbox Spike (status: `in-progress`)

---

## 1. Issue Summary

**Problem statement:** Story 1.5's gym-owner activation flow sends the new owner a Supabase password-recovery **link** via SMS (`sendInviteSms`, currently an unwired stub). While building Story 2.1's sent.dm message template, we learned that sending a URL/button over SMS/WhatsApp via sent.dm routes through Meta's WhatsApp Business Platform template-approval process (domain verification, Utility-category restrictions) — real friction for a V1 pilot, and not something the free pre-built OTP templates cover.

**How this was discovered:** While configuring a sent.dm template for the (still-stubbed) owner-invite link, the "Insert dynamic link"/button flow surfaced Meta's template-approval requirement for URL buttons. This is separate from Story 2.1's own member-OTP flow, which only ever needed plain-text codes and is unaffected.

**Evidence:**
- `apps/super-admin/app/(admin)/gyms/actions.ts` `createGym`: generates a link via `admin.auth.admin.generateLink({ type: "recovery", email })`, builds a custom `/auth/confirm?token_hash=...&type=recovery&next=/auth/update-password` URL, and passes it to `sendInviteSms` — never wired to a real provider, so no real owner has ever received this message.
- sent.dm dashboard (screenshots reviewed live): a "Call to action" URL button requires `urlType: dynamic` and routes through Meta's WhatsApp Business Platform template approval for anything beyond the 6 free pre-built OTP/verification templates.
- A structured team discussion (party mode: Architect, Dev, UX, PM personas) evaluated two replacements — (A) known temp password over SMS/WhatsApp, forced password-change on first login; (B) keep the link, switch delivery to real email — and the user decided on **Option A**.

**Issue type:** Failed approach requiring a different solution (the shipped mechanism doesn't survive contact with the messaging vendor's real constraints) — not a new requirement, not a strategic pivot, and not a misunderstanding of the PRD (see Section 3.1 — the PRD's own narrative already described credential-based SMS, not a link).

---

## 2. Impact Analysis

### Epic Impact

- **Epic 1 (Platform Foundation & Gym Onboarding):** Story 1.5 (`done`) needs a follow-up correction. Epic 1 itself is not reopened or invalidated — FR-071's "triggers owner SMS invite" is satisfied either way; only the *delivery mechanism* changes.
- **Epic 2 (Member Onboarding & Management):** No impact. Story 2.1's `OtpDeliveryProvider`/Twilio/sent.dm work is reused (not rebuilt) by the fix, but Epic 2's own scope, ACs, and sequencing are untouched.
- No other epic is affected.

### Story Impact

- **Story 1.5** (`done`): its mechanism (`generateLink`/recovery-link/`/auth/confirm` route) is superseded, not its stated AC. Story 1.5's file is left as the historical record of what was actually built and reviewed at the time — not rewritten — consistent with this project's append-only convention for corrections (see `docs/decisions.md`'s existing pattern of recording corrections against the story that necessitated them, e.g. Story 1.9→1.10, Story 1.5's own Decision 6 cross-reference in Story 2.1).
- **New story needed** (see Section 4/5): implements the temp-password mechanism, the must-change-password gate, and rewires `sendInviteSms` to use Story 2.1's `OtpDeliveryProvider`. Depends on Story 2.1 reaching a real, working provider (Twilio or sent.dm) — cannot ship before 2.1's real send test passes.
- **Story 2.1**: no AC or task changes. It gains one new consumer (the new story) of its already-built `OtpDeliveryProvider`/`TwilioSmsProvider`/`SentDmProvider` — no changes to Story 2.1 itself.

### Artifact Conflicts

- **PRD (`prd.md`):** No conflict, no edit needed. UJ-5 already reads *"The system creates the gym record and sends the owner an SMS with their login credentials"* — this describes Option A (credentials) more precisely than what Story 1.5 actually built (a link). FR-071 ("triggers owner SMS invite") is mechanism-agnostic. **No PRD text requires modification.**
- **Epics (`epics.md`):** No conflict, no edit needed. Story 1.5's AC reads *"the owner receives an SMS with login instructions"* — generic enough to already cover Option A without rewording.
- **Architecture (`architecture.md`):** No conflict, no edit needed. The Authentication & Security section specifies only *"Dashboard/Coach/Super Admin auth: Supabase Auth email + password... no alternative needed"* — this stays true under Option A (still email+password login; only how the initial password is set/communicated changes). The `generateLink`/recovery-link mechanism was never a documented architecture decision — it was an implementation choice made during Story 1.5's execution, so there is no architecture text to walk back.
- **UX Design (`EXPERIENCE.md`):** No conflict, no edit needed. SA-04's Create Gym mockup shows only Gym Name / Owner Name / Owner Phone / Tier / Status (no email field — email was already a known, flagged deviation added during Story 1.5, see its Dev Notes "Open Question 2"). The confirmation toast is generic: *"Gym created. SMS sent to [number]."* — compatible with either mechanism. AD-01's login mockup (`Email address *` / `Password *`) is unaffected — Option A keeps the exact same login form; it only changes how the first password is generated and delivered.
- **Other artifacts:** `docs/decisions.md` needs a new dated entry (this is the project's standing convention for exactly this kind of correction — see existing entries for Stories 1.2, 1.5, 1.9, 1.10). No CI/deployment/IaC impact.

### Technical Impact

Per Amelia's scoping (party-mode round 1) and the corrected understanding that `generateLink` never auto-sends anything (party-mode round 2 correction — the flow's only send path is the custom `sendInviteSms` call):

- `apps/super-admin/app/(admin)/gyms/actions.ts`: remove `generateLink({ type: "recovery" })` and the `ownerInviteLink` construction; generate a short, typeable temp password (fixed unambiguous alphabet) and pass it to a rewired `sendInviteSms` (or renamed equivalent) that now sends **plain text** through Story 2.1's `OtpDeliveryProvider`.
- `admin.auth.admin.createUser({ email, password: tempPassword, email_confirm: true, ... })` replaces the two-step generateLink flow. `email_confirm: true` is a real, flagged behavior change (previously the link itself proved ownership) — must be called out explicitly in the new story, not silently assumed.
- New column: `must_change_password` (boolean, default `true`) on the owner's profile/member row.
- New enforcement: a check in the AD-01/SA-01 login Server Action, immediately after successful auth, redirecting to a forced password-change screen when the flag is set — reuses Story 1.5's existing `/auth/update-password` logic (that piece is transport-agnostic and stays).
- The `/auth/confirm?token_hash=...&type=recovery` route becomes dead code for this flow specifically — confirm nothing else depends on it before removing (e.g., a future self-service "forgot password" flow for owners might still want it; if so, keep the route, just stop using it here).
- Tests: Story 1.5's `generateLink`/URL-construction assertions are replaced (not "fixed") with assertions on temp-password generation, `must_change_password` defaulting true, the login-flow gate, and the flip to `false` on password update.
- **Open item to confirm before implementation, not assumed:** are there any real pilot gym owners already invited under the old link flow? If none (expected — `sendInviteSms` has only ever been a stub, never sent a real message), this is a clean swap with no migration path. Confirm before coding.

---

## 3. Recommended Approach

**Selected path: Option 1 — Direct Adjustment**, via one new story added to Epic 1 (see Section 5), not a rollback and not an MVP/PRD scope change.

- **Option 2 (Rollback)** — not viable/needed. There's nothing to roll back to: `sendInviteSms` has never worked (it's a stub), so there's no working prior state being sacrificed. Story 1.5's reviewed code is superseded going forward, not reverted to an earlier state.
- **Option 3 (MVP/PRD Review)** — not needed. Section 2's artifact-conflict analysis found zero PRD/Epics/Architecture/UX text requiring change. This is a mechanism-level correction fully inside Story 1.5's original intent (arguably *more* aligned with PRD's UJ-5 wording than what shipped).
- **Option 1 (Direct Adjustment)** — viable and recommended. Effort: **Low–Medium** (Amelia's scoping: one function rewrite, one new column, one login-flow gate, test updates — no schema migration beyond one boolean column, no new external vendor to onboard since it reuses Story 2.1's already-built `OtpDeliveryProvider`). Risk: **Low** — isolated to the owner-activation path; no other shipped story depends on the `generateLink`/recovery-link mechanism.

**Rationale:** The party-mode discussion surfaced a real, substantive disagreement about *which* replacement mechanism to use (temp password vs. link-via-email), which the user resolved by choosing temp password over SMS. That decision is the one genuinely "significant" part of this change — everything downstream of it (Section 2's artifact check) turned out to be a contained, low-blast-radius implementation fix once traced against the actual PRD/Epics/Architecture/UX text, not the broader replan the trigger initially looked like it might require.

**Timeline impact:** Minimal. The new story is gated on Story 2.1 reaching a real, validated `OtpDeliveryProvider` send (already in progress) — no independent new spike is required, since it reuses Story 2.1's Twilio/sent.dm work directly.

---

## 4. Detailed Change Proposals

### 4.1 New Story — Epic 1, Story 1.11

```
Epic: 1 — Platform Foundation & Gym Onboarding
Story: 1.11 — Gym Owner Activation via Temp Password (SMS/WhatsApp)

As GymOS platform staff (Super Admin),
I want the new gym owner's account activated with a temporary password delivered as plain text over SMS/WhatsApp,
So that owner activation works on any OtpDeliveryProvider without depending on Meta's WhatsApp Business Platform template/URL-button approval process.

Supersedes: Story 1.5's `generateLink`({type:"recovery"})-based invite-link mechanism (never wired to a real
provider; corrected here before first real use, per Sprint Change Proposal 2026-07-14).

Depends on: Story 2.1 (OtpDeliveryProvider / TwilioSmsProvider / SentDmProvider) reaching a real, validated send.

Acceptance Criteria (draft — refine during story creation):
1. Given a new gym is created, when createGym runs, then a known temp password (fixed unambiguous alphabet,
   no 0/O/1/l/I) is generated and the owner's auth user is created with it directly (createUser, not
   generateLink) — email_confirm: true is set explicitly (flagged behavior change from the link flow).
2. And the temp password is sent via plain text through the OtpDeliveryProvider interface (no link, no URL,
   no button) — fits any provider/template, Meta-approval-free.
3. And the new owner's row is created with must_change_password = true.
4. Given an owner with must_change_password = true, when they successfully log in via AD-01/SA-01 email+password,
   then they are redirected to a forced password-change screen before reaching any other dashboard page.
5. Given the owner successfully sets a new password, when the update completes, then must_change_password
   flips to false and normal navigation resumes.
6. And this decision (temp-password-over-SMS, why link-via-email was rejected, the email_confirm:true behavior
   change) is recorded in docs/decisions.md.
```

*(This is a Sprint Change Proposal-level draft, not a full story spec — run `bmad-create-story` against Story 1.11 to produce the complete context-filled story file before development, per this project's standard story-creation step.)*

### 4.2 docs/decisions.md — new entry (drafted for the eventual story's Task, shown here for proposal completeness)

```
## 2026-07-14 — Gym Owner Activation: temp-password-over-SMS replaces recovery-link, recorded during Story 1.11

Decision 1 — Story 1.5's generateLink({type:"recovery"}) + SMS-delivered link is replaced by a known
temp password sent as plain text, before the flow's first real use. Trigger: sent.dm's WhatsApp Business
Platform template restrictions gate URL/button sends behind Meta's Utility-category approval process — real
friction for a V1 pilot, discovered while configuring Story 2.1's message templates. sendInviteSms had never
been wired to a real provider, so no real owner was ever affected by this change.

Decision 2 — Link-via-email (deliver the same recovery link, but over email instead of SMS) was evaluated and
rejected. It would have kept Story 1.5's mechanism untouched (smallest code diff), but rests on an unvalidated
assumption: ownerEmail exists only because Supabase's auth needs one (added beyond SA-04's own UX mockup,
flagged as Story 1.5's Open Question 2), not because anyone confirmed these gym owners check that address.
Email is also, for this population, at least as phishing-shaped a channel as SMS links — it does not clearly
improve the trust problem that motivated moving off links in the first place.

Decision 3 — email_confirm: true is now required on owner account creation (previously the recovery link
itself proved email ownership; a directly-created password-authenticated user has no equivalent proof without
this flag). Flagged explicitly, not a silent side effect.
```

---

## 5. Implementation Handoff

**Scope classification: Minor.**

- Zero PRD, Epics, Architecture, or UX Design text requires modification (Section 2).
- One new, small, fully-scoped story (1.11) within the existing Epic 1 structure — no epic added, removed, resequenced, or redefined.
- No rollback, no MVP/scope renegotiation.

**Routed to: Developer agent**, via the standard story cycle — `bmad-create-story` (Story 1.11) → `bmad-dev-story` → `bmad-code-review`. No PO backlog-reorg step and no PM/Architect replan needed beyond this proposal.

**Sequencing:** Story 1.11 cannot start development until Story 2.1 has a real, validated `OtpDeliveryProvider` send (Twilio or sent.dm) — currently blocked on the user obtaining real credentials and running the actual send test. Creating Story 1.11's story file now (context-gathering) does not need to wait; *implementing* it does.

**Success criteria:** A new gym owner receives a plain-text temp password over SMS/WhatsApp (no link), logs in via the existing AD-01/SA-01 form, is forced to set a real password before reaching any other page, and the whole flow is provider-agnostic (works identically whether `OTP_PROVIDER=twilio` or `sentdm`).
