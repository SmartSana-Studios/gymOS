---
baseline_commit: d2a3c6b3eeed59e02ce9c73cdc80e01896d75066
---

# Story 2.5: Member Invitation via Deep Link

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or Owner,
I want to send a new member a personalized invitation,
so that they can install the app and get started with their phone number already known to the system.

## Acceptance Criteria

**⚠️ These ACs are adapted from `epics.md`'s literal "deep link" wording per a recorded decision — see Scope Note #1 before implementing.**

1. **Given** a member record I created (Story 2.3/2.4), **when** I click "Send Invite," **then** an invite message is generated containing the member's name and gym name, with Copy and Share-via-WhatsApp actions — no link (deep, recovery, or otherwise) is included. [Source: docs/decisions.md#2026-07-15 entry, adapting epics.md#Story 2.5 AC #1]
2. **Given** the invite message, **when** I click "Copy message," **then** the full message text is copied to the clipboard and the button confirms the copy (matches the temp-password-copy precedent in `apps/super-admin/.../GymsPageClient.tsx`). [Source: EXPERIENCE.md#AD-06]
3. **Given** the invite message, **when** I click "Share via WhatsApp," **then** WhatsApp opens (web or app) with the message pre-filled via a `wa.me` link. [Source: EXPERIENCE.md#AD-06]
4. **Given** the member later opens the app and completes phone/OTP onboarding with the same phone number (Story 2.6, not built yet), **then** no additional linking action is required from this story — the member record and its phone number already exist from admin-side creation (Story 2.3), so Story 2.6's own phone-lookup is sufficient pre-association. This story adds no new persisted state to make that work. [Source: docs/decisions.md#2026-07-15 entry]

## Scope Note — Read Before the Tasks

**This story's actual mechanism is substantially different from `epics.md`'s literal text, by a recorded platform-wide decision. Read this before writing any code.**

1. **The deep link is dropped platform-wide — this is not this story's own call, it's already decided.** `docs/decisions.md`'s 2026-07-15 entry ("Onboarding/account-recovery channel policy") states: *"no link of any kind (deep link, recovery link, or email link) ships in any onboarding or account-recovery flow for now, for any user type... Story 2.5 keeps its existing link-agnostic framing... but its actual V1 mechanism drops the deep link: staff shares a plain-text [message] (not a URL) via SMS/WhatsApp."* Do not build `gymos://` scheme parsing, a dynamic-link service, or any App/Universal Links config — none of that infrastructure exists (`apps/mobile/app.json`'s `scheme: "gymos"` has no associated-domains/App-Links config, and no dynamic-link provider like Firebase Dynamic Links or Branch is wired anywhere in this repo). This is confirmed correct, not a gap to fill.
2. **Why this story still works with zero new persisted state.** The thing the deep link was originally meant to provide — "phone number pre-associated so OTP is the first screen shown" (FR-082) — is **already accomplished by Story 2.3's existing member-creation flow**, not by anything this story adds. `provisionMemberRow()` (`apps/dashboard/services/members.ts:322`, `findOrCreateUserByPhone`) creates a real `auth.users` row (`phone_confirm: false`) and a `members` row with that phone the moment a Manager/Owner creates the member — well before "Send Invite" is ever clicked. When the member later opens the app and enters that same phone number in Story 2.6's onboarding, Supabase's own phone/OTP flow and Story 2.6's "phone already has a platform account" branch (epics.md#Story 2.6 AC #5) resolve it — no invite-time database write is needed to make that work. **Do not create a new "pending invite" table, an `invited_at` column, or any tracking row for this story** — it is a pure UI/messaging feature.
3. **"Send Invite" is a client-side message-composition action, not a Server Action.** All the data needed (member name, phone, gym name) is already available without a new network round-trip: member name/phone come from `MemberListRow` (already loaded into `MembersPageClient`), gym name comes from `getDashboardShellContext()`'s `DashboardShellContext.gymName` (`apps/dashboard/services/session.ts`) — already fetched in `members/page.tsx` (`shell.gymName`) but currently **not** passed down to `MembersPageClient`; thread it through as a new prop. No new Server Action, no new `AppError` code, no audit-log entry (FR-080's audit-logged-action list — manual payments, verifications, refunds, deactivations, coach-assignment changes, Super Admin escalations, cron failures — does not include invite-sending).
4. **Invite message copy (no link):** `"{{name}}, you've been added to {{gymName}} on GymOS. Download the app and enter your phone number to get started."` This is the AD-06 mockup's message with its `[deep link]` line removed per Decision #1 above — author the exact EN string this way and the FR translation as its natural equivalent (not word-for-word), matching this project's established Voice-and-Tone discipline (EXPERIENCE.md's Voice and Tone table, "French translations must be exact equivalents in tone... not literal word-for-word").
5. **"Share via WhatsApp" uses a `wa.me` link, not the Web Share API.** `https://wa.me/?text={encodeURIComponent(message)}` opens WhatsApp (web or installed app) with the message pre-filled — universally available cross-platform with no native `navigator.share()` feature-detection needed. AD-06's mockup footnote ("`*` hidden if unavailable") describes `navigator.share()`-style conditional availability; a `wa.me` link has no comparable "unavailable" state, so render it unconditionally rather than building feature-detection for a condition that doesn't apply to this implementation. Open in a new tab (`window.open(url, "_blank")`), matching how external links are opened elsewhere in this app (no precedent to contradict — first usage of `wa.me` in this codebase).
6. **"Send Invite" button placement:** this app has no separate AD-04 member-detail route — Story 2.3 collapsed "View" into `MemberModal`'s `readOnly` mode (see that component's own doc comment). Mirror that precedent: add "Invite" as a third action button in the Members table's Actions column (`MembersPageClient.tsx`, alongside the existing "View"/"Deactivate" buttons), Manager+ only, not inside `MemberModal` itself — do not add a fourth mode to `MemberModal` or a new detail route for this story.
7. **Gate "Send Invite" visibility:** Manager+ (`canManage`, already computed in `MembersPageClient.tsx`) **and** `!member.deactivatedAt` (inviting a deactivated member to an app they can no longer access is nonsensical) **and** `member.phone` is non-null (defensive — `MemberListRow.phone` is typed nullable even though `createMemberSchema` always requires a phone at creation time; do not render the button for a row with no phone to compose a message around).

## Tasks / Subtasks

- [x] **Task 1: Thread `gymName` into `MembersPageClient`** (AC: #1)
  - [x] `apps/dashboard/app/(dashboard)/members/page.tsx`: pass `gymName={shell.gymName}` to `<MembersPageClient>` (the `shell` object is already fetched via `getDashboardShellContext()` in this file — no new query).
  - [x] `MembersPageClient.tsx`: accept `gymName: string` in its props type.

- [x] **Task 2: `InviteMemberModal` component** (AC: #1, #2, #3)
  - [x] New file `apps/dashboard/app/(dashboard)/members/components/InviteMemberModal.tsx`. Native `<dialog>`, max-width 480px (matches AD-06's "small modal" spec and `DeactivateMemberDialog.tsx`'s exact structural convention: `dialogRef`, `showModal()` on mount, `onCancel` no-op guard not needed here since there's no in-flight submission to protect).
  - [x] Props: `{ member: MemberListRow; gymName: string; onClose: () => void }` — no `onDone`/`onSaved` callback needed (this action writes nothing, so there is nothing for the parent to refresh).
  - [x] Compose the message client-side per Scope Note #4's exact template, using `useTranslation()`'s `t("members.invite.message", { name: member.name, gymName })`.
  - [x] Render: avatar-initial + member name + gym name header (matches AD-06 mockup), a read-only `<textarea>` (not `<Input>`, to allow the multi-line message to wrap and be visibly selectable) showing the composed message, a "Copy message" button, a "Share via WhatsApp" link/button, and a "Close" button.
  - [x] "Copy message": `navigator.clipboard.writeText(message)` wrapped in try/catch (Clipboard API can be denied — matches `GymsPageClient.tsx:111-121`'s exact precedent), on success set local `copied` state → button label swaps to `t("members.invite.copied")` (no timeout reset needed, matches the temp-password-copy precedent which also never resets — the modal closing is what resets it).
  - [x] "Share via WhatsApp": `<a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">` (Scope Note #5) — not a JS `onClick` handler with `window.open`, since a plain anchor is simpler and gets free keyboard/middle-click/accessibility behavior a JS handler would have to reimplement. **Review Round 1 found the URL omits `member.phone`, so it opens a generic compose screen rather than a chat targeted at the invited member — tracked as an open Review][Patch] item below, not yet fixed.**
  - [x] No form submission, no `useState` for submitting/loading (there is no async server call in this component at all).

- [x] **Task 3: Wire "Invite" button into `MembersPageClient.tsx`** (AC: #1, per Scope Note #6/#7)
  - [x] Add `invitingMember: MemberListRow | null` state, alongside the existing `modalState`/`deactivatingMember` state.
  - [x] In the Actions column (next to the existing "View"/"Deactivate" buttons), render an "Invite" button when `canManage && !member.deactivatedAt && member.phone` (Scope Note #7) — `onClick={(e) => { e.stopPropagation(); setInvitingMember(member); }}` matching the existing Deactivate button's `stopPropagation` pattern (row itself is clickable to open View). Verified in code: exact `canManage && !member.deactivatedAt && member.phone` condition present.
  - [x] Render `<InviteMemberModal member={invitingMember} gymName={gymName} onClose={() => setInvitingMember(null)} />` conditionally, matching the existing `deactivatingMember`/`modalState` conditional-render pattern in this file.

- [x] **Task 4: i18n (EN/FR parity)** (AC: #1-3)
  - [x] Add to `apps/dashboard/locales/{en,fr}.json`: `members.actions.invite` ("Invite"), and a `members.invite.*` namespace: `title`, `message`, `copyMessage`, `copied`, `shareWhatsapp` (reuses `common.close` for the Close button, per the story's own note — no duplicate key added).
  - [x] Run `node scripts/check-i18n-key-parity.mjs` before marking this story `review` (FR-016 CI gate) — re-run 2026-07-17 during this review's backfill: `apps/dashboard/locales`: 220 keys, en/fr in parity.

- [x] **Task 5: Validation and manual verification** (AC: #1-4)
  - [x] No new migration, no new RLS policy, no new pgTAP test file, no new Server Action, no new `AppError` code (Scope Note #2/#3) — confirmed via the diff: this story's changes touch only `page.tsx`, `MembersPageClient.tsx`, the new `InviteMemberModal.tsx`, and locale files. `supabase test db` was **not** re-run during this review's backfill (local Supabase/Docker was not running in this session and this story touches zero DB-facing code, so a re-run would be a no-op) — flagged honestly rather than claimed.
  - [x] Ran `pnpm --filter dashboard typecheck` and `pnpm --filter dashboard lint` during this review's backfill (2026-07-17): typecheck fails only on the already-tracked, pre-existing `apps/dashboard/app/layout.tsx`/`next-themes` `ThemeProviderProps` issue (`deferred-work.md`) — no new failures. Lint: clean, zero errors/warnings.
  - [x] No automated JS/TS unit-test runner exists in this project yet — this story's UI has no automated coverage. **Manual browser click-through was not performed in this review session** (no browser-automation tool / no seeded Manager test credentials available) — stated honestly rather than claimed. Code-level verification only: confirmed the Invite button's visibility condition (`canManage && !member.deactivatedAt && member.phone`), the composed-message template wiring, the `navigator.clipboard.writeText` try/catch, and the `wa.me` anchor are all present as specified — **except** the `wa.me` URL not actually targeting `member.phone` (see Review Findings).

### Review Findings

#### bmad-code-review (2026-07-17, cross-story diff review — Blind Hunter + Edge Case Hunter + Acceptance Auditor)

Note: this story's own Tasks/Subtasks checkboxes are unchecked and its Dev Agent Record is empty, yet the diff under review already contains a full implementation of this story (`InviteMemberModal.tsx`, the `MembersPageClient.tsx`/`page.tsx` wiring, EN/FR locale entries) — reviewed as-is against the story's AC/Scope Notes despite the bookkeeping gap (see the Decision item below).

- [x] [Review][Patch] "Share via WhatsApp" never includes the member's phone number in the `wa.me` URL (`https://wa.me/?text=${encodeURIComponent(message)}`) — it opens a generic WhatsApp compose screen instead of a chat targeted at the specific member being invited, defeating the point of a per-member "Invite" action. **Fixed 2026-07-17:** URL now builds as `https://wa.me/{digitsOnlyPhone}?text=...` using `member.phone` with the leading `+` stripped (falling back to the untargeted link only if `member.phone` is ever null, defensive per `MemberListRow`'s nullable typing). [apps/dashboard/app/(dashboard)/members/components/InviteMemberModal.tsx]
- [x] [Review][Patch] `docs/decisions.md`'s "2026-07-15 — Onboarding/account-recovery channel policy" entry states Story 2.5 "resolves the invitation by phone-number lookup against a pending-member record created at invite time" — this contradicts the story's own Scope Note #2/AC #4 ("adds no new persisted state") and the actual shipped code (no new table, no new Server Action). The code is correct; the decisions.md wording is stale and should be corrected to avoid misleading a future reader. **Fixed 2026-07-17:** corrected the entry to describe the actual mechanism (lookup against the `members`/`auth.users` row Story 2.3 already provisioned, no new record), with an inline correction note. [docs/decisions.md#2026-07-15]
- [x] [Review][Decision] This story's Tasks/Subtasks were entirely unchecked and its Dev Agent Record was empty despite the diff already containing a working implementation. **Resolved 2026-07-17 (user decision): backfilled.** Tasks checked off against the actual diff content, Dev Agent Record filled in below with what was actually verified during this review pass (including the two verification gaps stated honestly — no `supabase test db` re-run, no manual browser click-through), and Status moved from `ready-for-dev` to `review`. `sprint-status.yaml` synced accordingly.

## Dev Notes

- **This story adds no new persisted state and no new Server Action** — read Scope Note #2/#3 before writing any code that reaches for the database or a new `actions.ts` export. If implementation reveals what feels like a need for one, stop and re-read `docs/decisions.md`'s 2026-07-15 entry — it almost certainly means the DB write already happened in Story 2.3.
- **The single most consequential fact in this story:** the phone-number pre-association FR-082 asks for is already done by the time "Send Invite" is clicked (Scope Note #2). This story is strictly a messaging-UI convenience feature on top of already-complete data, not an onboarding-linking mechanism.
- **Do not build any `gymos://` deep-link handling, dynamic-link service, or App/Universal Links config.** That entire category of work is explicitly out of scope platform-wide per the 2026-07-15 decision, not just for this story.
- **`i18next/no-literal-string` ESLint gate + `check-i18n-key-parity.mjs`** — same CI-gate discipline as every prior Epic 1/2 story; run both before marking `review`.

### Project Structure Notes

New files:
```
apps/dashboard/app/(dashboard)/members/components/InviteMemberModal.tsx
```

Modified files:
```
apps/dashboard/app/(dashboard)/members/page.tsx                          (+ gymName prop passed to MembersPageClient)
apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx  (+ gymName prop, + "Invite" action button, + invitingMember state, + InviteMemberModal wiring)
apps/dashboard/locales/en.json / fr.json                                 (+ members.actions.invite, members.invite.* namespace)
```

No `supabase/migrations` changes. No `supabase/tests` changes. No `apps/mobile` changes (Story 2.6 is where the mobile-side phone-entry screen lives). No new `actions.ts` exports. No `packages/types` changes.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5] — original (superseded-in-part) acceptance criteria wording
- [Source: docs/decisions.md#2026-07-15 — "Onboarding/account-recovery channel policy"] — **authoritative**: drops the deep link platform-wide, redefines this story's actual V1 mechanism as a plain-text message with phone-number lookup, and explicitly says the next reader of this story needs this decision to understand why no link ships
- [Source: docs/decisions.md#2026-07-16 — Story 1.11 entries] — sibling precedent for why links don't work over WhatsApp Business Platform (Meta template approval requirement) and the "surface a manual fallback unconditionally" UI precedent (`GymsPageClient.tsx`'s temp-password toast, directly reused for this story's Copy-message pattern)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#AD-06] — Member Invite modal layout, Copy/Share actions (message content adapted per the decision above — the `[deep link]` line is removed)
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md#FR-082] — "Creating a member generates a personalized onboarding invitation (name, gym name, deep link)..." — the "deep link" clause is the part superseded by the 2026-07-15 decision
- [Source: _bmad-output/implementation-artifacts/2-4-csv-member-import.md] — "no new persisted state" precedent this story extends further (Story 2.4 at least reused existing INSERT paths; this story does not write to the database at all)
- [Source: apps/dashboard/services/members.ts:322] — `findOrCreateUserByPhone`/`provisionMemberRow` — confirms the phone-to-account association already exists by member-creation time (Story 2.3), which is *why* this story needs no new linking mechanism
- [Source: apps/dashboard/services/session.ts] — `getDashboardShellContext()` / `DashboardShellContext.gymName` — the gym-name source this story threads through, already fetched (not yet passed down) in `members/page.tsx`
- [Source: apps/dashboard/app/(dashboard)/members/components/DeactivateMemberDialog.tsx] — structural template for `InviteMemberModal`'s native `<dialog>` pattern
- [Source: apps/super-admin/app/(admin)/gyms/components/GymsPageClient.tsx:111-121] — `navigator.clipboard.writeText` + copied-state precedent, reused as-is for "Copy message"
- [Source: apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx] — existing row-actions/`canManage`/modal-state conventions this story extends (View/Deactivate button placement, `stopPropagation` pattern, conditional modal rendering)
- [Source: apps/mobile/app.json] — confirms no App/Universal Links or dynamic-link config exists (`scheme: "gymos"` only) — supporting evidence for Scope Note #1's "don't build link-handling infra" instruction
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — pre-existing `apps/dashboard/app/layout.tsx`/`next-themes` typecheck exception, unrelated to this story

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (Claude Code) — implementation agent/session unknown (Tasks/Subtasks and this record were unfilled when found by `bmad-code-review` on 2026-07-17); backfilled by claude-sonnet-5 (Claude Code) during that review's triage step, based on direct inspection of the actual diff and a fresh `typecheck`/`lint`/`check-i18n-key-parity.mjs` run — not a claim about who wrote the original code.

### Debug Log References

- `node scripts/check-i18n-key-parity.mjs` (2026-07-17): `apps/dashboard/locales`: 220 keys, en/fr in parity.
- `pnpm --filter dashboard typecheck` (2026-07-17): fails only on the pre-existing, unrelated `apps/dashboard/app/layout.tsx`/`next-themes` `ThemeProviderProps` error (`deferred-work.md`) — no failures in any file this story touches.
- `pnpm --filter dashboard lint` (2026-07-17): clean, zero errors/warnings.
- `supabase test db` was **not** re-run — local Supabase/Docker was not running in this session, and this story's diff touches zero migration/RLS/DB-facing files (confirmed via direct diff inspection: only `page.tsx`, `MembersPageClient.tsx`, the new `InviteMemberModal.tsx`, and locale files change), so this is stated as a known gap rather than a claimed pass.
- No browser-automation tool or seeded Manager/Owner test credentials were available in this review session — the click-through described in Task 5 (Invite button visibility, message composition, Copy/Share behavior) was **not** manually driven in a live browser. Verified instead by direct code inspection against every AC/Scope Note (see Completion Notes below).

### Completion Notes List

- Implementation was already present in the working tree when this story was picked up by `bmad-code-review` (2026-07-17) — this record documents what was found and verified, not a fresh implementation pass.
- AC #1/#2/#3 (no-link invite message, Copy, Share via WhatsApp) are implemented: `InviteMemberModal.tsx` composes `t("members.invite.message", { name, gymName })` with no link, a Copy button using `navigator.clipboard.writeText` in a try/catch (matches `GymsPageClient.tsx`'s precedent), and a `wa.me` anchor for WhatsApp share.
- AC #4 (no new persisted state) confirmed by diff inspection: no new migration, Server Action, or `AppError` code anywhere in this story's file set.
- Scope Note #6/#7 button-gating verified in code: the Invite button in `MembersPageClient.tsx` renders exactly under `canManage && !member.deactivatedAt && member.phone`.
- **One real defect found and NOT yet fixed at backfill time** (tracked separately under this story's Review Findings, above): the `wa.me` URL never includes `member.phone`, so "Share via WhatsApp" opens a generic compose screen instead of a chat targeted at the invited member. This is an implementation gap against Scope Note #5's intent, not a spec ambiguity.
- **A second documentation-only defect found and NOT yet fixed**: `docs/decisions.md`'s 2026-07-15 entry describes this story as resolving invitation via "a pending-member record created at invite time," which contradicts this story's own Scope Note #2 and the actual (correct) no-new-persisted-state implementation. The code is right; the decisions.md prose is stale.

### File List

- `apps/dashboard/app/(dashboard)/members/components/InviteMemberModal.tsx` (new)
- `apps/dashboard/app/(dashboard)/members/page.tsx` (modified — `gymName={shell.gymName}` passed to `MembersPageClient`)
- `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx` (modified — `gymName` prop, `invitingMember` state, "Invite" action button, `InviteMemberModal` wiring)
- `apps/dashboard/locales/en.json` / `fr.json` (modified — `members.actions.invite`, `members.invite.*` namespace)

## Change Log

- 2026-07-17 — `bmad-code-review` backfill: Tasks/Subtasks checked off and this Dev Agent Record filled in against the actual diff (implementation was already present but undocumented). Ran `pnpm typecheck`/`pnpm lint`/`check-i18n-key-parity.mjs` fresh — clean except the pre-existing, unrelated `layout.tsx`/`next-themes` typecheck failure. `supabase test db` re-run and a live browser click-through were **not** performed this session (no reachable Supabase/Docker instance, no browser-automation tool available) — stated honestly rather than claimed. Found and logged two new Review Findings during the same pass: the `wa.me` share URL doesn't target the invited member's phone, and `docs/decisions.md`'s 2026-07-15 entry contradicts this story's own "no new persisted state" design. Status moved `ready-for-dev` → `review`.
- 2026-07-17 — `bmad-code-review` patch pass: fixed both Review Findings from the same round. `InviteMemberModal.tsx`'s `wa.me` URL now targets `member.phone` (digits only, `+` stripped) instead of opening an untargeted compose screen. `docs/decisions.md`'s 2026-07-15 entry corrected to describe the actual no-new-persisted-state mechanism. Re-ran `pnpm typecheck`/`pnpm lint`/`check-i18n-key-parity.mjs` (222 keys, en/fr in parity) — clean except the same pre-existing `layout.tsx`/`next-themes` exception.
