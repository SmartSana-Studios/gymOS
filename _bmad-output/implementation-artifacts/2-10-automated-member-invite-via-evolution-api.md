---
baseline_commit: 1e6a0998063af9c53edf6234928209cb333d3a70
---

# Story 2.10: Automated Member Invite via Evolution API

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or Owner,
I want member invitations to send automatically via the Evolution API WhatsApp gateway instead of requiring a manual copy/share step,
so that onboarding a new member takes one click, with the original manual flow retained only as a fallback.

**Context — not derived from `epics.md`'s original text:** raised via `sprint-change-proposal-2026-08-08.md` Section 4.5 as a *revision* to Story 2.5's acceptance criteria, then split out and re-tracked as an independent story (`2-10`) per `sprint-change-proposal-2026-08-11.md`'s correct-course decision (`epics.md` line 36: "Stories 2.9/2.10 (`backlog`)"). `epics.md`'s own `### Story 2.10` header (backfilled 2026-08-13, verbatim from the approved proposal) is now the primary source for ACs below — this section adds only what the epics text omits. **Story 2.5 remains `done` and unmodified as a historical record of the original manual-only flow** — do not re-open or edit Story 2.5's own file; this story adds a new automated primary path in front of it.

**Hard dependency: Story 2.9 (`done`) must have shipped `EvolutionApiProvider`'s pattern and `messaging_provider_config` reads before this story can be implemented** — confirmed done (`_bmad-output/implementation-artifacts/2-9-evolution-api-sandbox-spike-otp-provider-fallback-chain.md`, `supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.ts`). This story is the **second, independent reader** of `messaging_provider_config.instance_id` anticipated by both Story 1.13's and Story 2.9's own Dev Notes — it does **not** touch `send-sms-hook`, the OTP fallback chain, or any Deno Edge Function code. This is a pure Node/Next.js (dashboard app) feature.

## Acceptance Criteria

1. **Given** a newly created member record, **when** I click "Send Invite," **then** the system automatically sends the personalized invitation (member's name, gym name — no deep link, see Dev Notes' "deep link" note below) via WhatsApp through the Evolution API gateway — no manual copy/share step required. [Source: epics.md#Story 2.10]
2. **Given** the automated send succeeds, **when** it completes, **then** the dashboard shows a confirmation ("Invite sent to [name] via WhatsApp"). [Source: epics.md#Story 2.10]
3. **Given** the automated send fails (Evolution API unreachable, instance disconnected, or not configured), **when** the failure occurs, **then** the dashboard shows an inline error and offers the existing manual copy/share-via-WhatsApp flow as a fallback — the same UI Story 2.5 shipped (`InviteMemberModal.tsx`), now demoted to a fallback path rather than the primary flow. [Source: epics.md#Story 2.10]
4. **Given** a member who was already sent an invite (successfully or not), **when** Manager/Owner clicks "Send Invite" again from the member's row, **then** a new automated send attempt is made via Evolution API (same success/failure/fallback behavior as the original send) — resending is not blocked or rate-limited beyond what Evolution API itself enforces. [Source: epics.md#Story 2.10]
5. **Given** the member taps the deep link (unchanged from original), **when** the app opens (or falls back to the Play Store/App Store), **then** the deep link's phone number is available to pre-associate at the OTP step. [Source: epics.md#Story 2.10] — **this AC is inherited epics.md text describing pre-existing, already-shipped behavior (Story 2.3's `provisionMemberRow`/`findOrCreateUserByPhone`, confirmed unaffected in Dev Notes below); this story adds no code toward it.**

## Dev Notes — Read Before Writing Any Code

**The "deep link" wording in AC #1/#5 is stale, inherited verbatim from the original proposal text — no actual deep link exists or is being added.** Story 2.5's Scope Note #1 already established, platform-wide, that no link of any kind ships in onboarding/recovery flows (`docs/decisions.md#2026-07-15`) — `apps/mobile/app.json` still has no App/Universal Links config. AC #5 is satisfied today by Story 2.3's `provisionMemberRow` (phone pre-associated at member-creation time, before any invite is ever sent) — this story does not touch that mechanism at all. **Compose the automated WhatsApp message using the exact same no-link template `InviteMemberModal.tsx`/`en.json`/`fr.json` already define** (`members.invite.message`) — do not invent new copy or attempt to add a link.

### What already exists (Story 2.5, `done` — reuse, do not rebuild)

- `InviteMemberModal.tsx` (`apps/dashboard/app/(dashboard)/members/components/InviteMemberModal.tsx`): the read-only textarea + "Copy message" + "Share via WhatsApp" (`wa.me` link, phone-targeted) UI. **Per the proposal's own Implementation Note ("kept, not deleted — it becomes the failure-path fallback"), this component ships as-is, unmodified in its own rendering logic.** Only its *invocation* changes (see Task 3 below — it now opens only on failure, not on every "Send Invite" click).
- The "Invite" row-action button in `MembersPageClient.tsx` (Manager+, `!member.deactivatedAt`, `member.phone` non-null — Scope Note #7 of Story 2.5) — button gating is unchanged by this story.
- `members.invite.*` / `members.actions.invite` i18n keys (`en.json`/`fr.json`) — reuse `message`/`title` as-is; this story adds new keys only for the new confirmation/error copy (Task 4).
- `gymName` already threaded into `MembersPageClient` (Story 2.5 Task 1) — no new prop-plumbing needed for that value.

### What this story adds (new)

1. **`EvolutionApiMessageProvider` — a Node port of the Deno `EvolutionApiProvider.ts` pattern**, per AD-12's explicit instruction ("following the established Deno→Node porting precedent, `sendTempPasswordMessage.ts`"). Two existing files are the templates to synthesize, not just one:
   - `supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.ts` — the **REST contract**: `POST {EVOLUTION_API_BASE_URL}/message/sendText/{instance}`, header `apikey: {EVOLUTION_API_KEY}`, body `{ "number": "<digits, no +>", "text": "<message>" }`, per-request (not hoisted) read of `messaging_provider_config.instance_id`, never-throw contract, `null`/missing instance → clean `{success:false}`.
   - `apps/super-admin/lib/messaging/sendTempPasswordMessage.ts` — the **Node-runtime shape**: no `Deno.env`, use `process.env`; no `httpHelpers.ts` (Deno-only, not importable into Next.js) — inline the same `AbortController`-bounded `fetch` with a 10s timeout, matching this file's exact pattern (`FETCH_TIMEOUT_MS`, timeout → `{success:false, status:503}`, non-ok → read body text defensively in its own try/catch).
   - **New file:** `apps/dashboard/lib/messaging/EvolutionApiMessageProvider.ts`. Export a function (not a class — this app has no `OtpDeliveryProvider`-style interface to implement; AD-12's `WhatsAppMessageProvider` port contract is `send(phone, message, locale) → DeliveryResult`, but since there is exactly one implementation and no chain/registry here, a plain async function matching that signature is sufficient — do not build an interface/class for a single caller with no polymorphism need). Reuse the `DeliveryResult`-equivalent shape: `{ success: true, channel: "whatsapp" } | { success: false, error: string }`.
   - **Reads `messaging_provider_config.instance_id` via `createAdminClient()`** (`apps/dashboard/lib/supabase/admin.ts`, already used by `services/members.ts`'s `findOrCreateUserByPhone`) — **not** the regular session client (`lib/supabase/server.ts`). The table's only RLS policy (`super_admin_read_messaging_config`, `supabase/migrations/0050_messaging_provider_config.sql`) grants SELECT to `is_super_admin()` only; a Manager/Owner dashboard session has zero read access. This exactly mirrors why `EvolutionApiProvider.ts` uses a service-role client in `send-sms-hook` — same table, same RLS shape, different runtime.
   - Env vars: reuse the **same** `EVOLUTION_API_BASE_URL`/`EVOLUTION_API_KEY` values already provisioned for `supabase/.env` (Story 2.9) — these are the same self-hosted Evolution API instance, just read from `apps/dashboard/.env.local`'s own copy (Next.js server env, `process.env`, not `NEXT_PUBLIC_`-prefixed — never exposed to the browser). Add both to `apps/dashboard/.env.example` with the same descriptive comment style already used there for `SUPABASE_SERVICE_ROLE_KEY`.
   - Message text: build from `getServerTranslation`'s `t("members.invite.message", { name, gymName })` — **do not duplicate the EN/FR strings inline**; this Server Action already has locale-resolution available (see `getRequestLocale()`/`getServerTranslation()`, used throughout `actions.ts`) — reuse it so the automated-send path and the manual-fallback modal never drift on message copy.

2. **New Server Action `sendMemberInvite(memberId: string)`** in `apps/dashboard/app/(dashboard)/members/actions.ts`, alongside the file's existing exports (`createMember`, `editMember`, etc. — same `"use server"` file, same `{ data, error }`-never-throws convention). Orchestration:
   - Re-fetch the member's `name`/`phone` server-side from the caller's own gym (do not trust a client-supplied name/phone — this file's established discipline, e.g. `createMember`'s re-validation). **No existing single-member lookup function exists in `services/members.ts`** (`listMembers` is a paginated list, not fetch-by-id) — add a small new one, e.g. `getMemberForInvite(memberId): Promise<{data: {name, phone} | null, error}>`, scoped by `gym_id` via the existing `getCallerGymId()` helper (copy the file's own established per-file-copy discipline, do not import from another service file — matches this file's own stated convention, see `getCallerGymId`'s doc comment). Return `not_found` (via `memberNotFoundError`) if the member doesn't belong to the caller's gym or has no phone.
   - Call `EvolutionApiMessageProvider`'s send function with the fetched phone/composed message/locale.
   - Return `{ data: { success: true } | { success: false }, error: null }` — **not** the `{data, error: AppError}` shape used for validation failures elsewhere in this file, because a send failure is an *expected* outcome the UI must render as AC #3's fallback state, not a generic error toast. Model it as `{ data: { sent: boolean }, error: AppError | null }` where `error` is only set for genuine failures (member not found, not authorized) and `sent: false` (with `error: null`) is the expected "gateway unreachable, show fallback" case — the client component branches on `sent` for AC #2 vs. AC #3, not on `error`.
   - **No audit-log entry** — matches Story 2.5's explicit precedent (FR-080's audit-logged-action list does not include invite-sending; Story 2.5 Scope Note #3 confirms "no audit-log entry"). This story does not change that list. If a future story needs one, that's a separate decision — do not add `logMemberChange`-style logging here speculatively.
   - **No new persisted state** (same as Story 2.5) — this Server Action reads and calls out, it does not write to any table. `messaging_provider_config` is read-only from this story's side (Story 1.13 owns all writes to it via `update_messaging_instance()`).

3. **`MembersPageClient.tsx` wiring change** — the "Send Invite" button's `onClick` no longer directly opens `InviteMemberModal`. Instead:
   - `onClick` calls `sendMemberInvite(member.id)` (loading state on that row's button while in flight — a small per-row "sending" boolean keyed by member id, or a single `sendingInviteId: string | null`, matching this file's existing single-flight-state conventions like `exporting`).
   - On `sent: true` → `showToast(t("members.invite.sentConfirmation", { name: member.name }))` (AC #2's exact wording — new i18n key, Task below). Reuses the existing `toast` state/`showToast()` helper already in this file (used by export/CSV-import) — no new toast mechanism.
   - On `sent: false` (or a genuine `error`) → open `InviteMemberModal` (`setInvitingMember(member)`), **and** show an inline error indicator per AC #3. Since `InviteMemberModal` itself has no error-banner slot today, the simplest AC-#3-compliant approach reusing existing patterns: `showToast(t("members.invite.sendFailedFallback"))` (a distinct new key, not the same as the success toast) immediately before opening the modal — this satisfies "shows an inline error and offers the...fallback flow" without inventing a new component. **Do not silently open the modal with no error signal** — AC #3 requires the failure to be visibly communicated, not just implicitly inferred from the modal appearing.
   - AC #4 (resend): the same button remains clickable after a send (success or failure) — no `disabled` state added for "already invited," no new column/badge tracking invite history. This is explicitly required by AC #4's "resending is not blocked" — do not add any local-state guard that would prevent a second click.

### Project Structure Notes

New files:
```
apps/dashboard/lib/messaging/EvolutionApiMessageProvider.ts
```

Modified files:
```
apps/dashboard/app/(dashboard)/members/actions.ts                          (+ sendMemberInvite)
apps/dashboard/services/members.ts                                         (+ getMemberForInvite)
apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx    (Send Invite button: calls sendMemberInvite first, opens InviteMemberModal only on failure)
apps/dashboard/locales/en.json / fr.json                                   (+ members.invite.sentConfirmation, members.invite.sendFailedFallback)
apps/dashboard/.env.example                                                (+ EVOLUTION_API_BASE_URL, EVOLUTION_API_KEY, documented)
apps/dashboard/.env.local                                                  (gitignored — real values, obtained from the user; same instance Story 2.9 already validated)
```

**Not modified:** `InviteMemberModal.tsx` itself (rendering logic unchanged, per the proposal's explicit "kept, not deleted" note), `send-sms-hook` (any file under `supabase/functions/`), `messaging_provider_config`'s schema/RLS/RPC (Story 1.13, `done`, read-only from this story), Story 2.5's own story file (leave as historical record, do not edit).

### Previous Story Intelligence

- **Story 2.9** (`2-9-evolution-api-sandbox-spike-otp-provider-fallback-chain.md`, immediately preceding in Epic 2 numbering, `done`): confirms `EvolutionApiProvider.ts`'s exact live-verified REST contract (`number` field confirmed correct against the real instance, not `jid` — do not second-guess this, it was spike-verified) and confirms the real instance details (`https://evo.ultradominon.com`, instance `souna2`, seeded into `messaging_provider_config.instance_id`) are already live and usable for this story's own manual verification. Also confirms the module-scope-throw pitfall (Finding 1 of its code review) — **this story's `EvolutionApiMessageProvider` has no equivalent risk** since it's the sole messaging call in its own Server Action (not one of several statically-imported providers in a shared module like `send-sms-hook`'s `PROVIDER_CHAIN`), but still follow the same "never throw, always return a result object" discipline for consistency with every other provider-like function in this codebase.
- **Story 2.5** (`2-5-member-invitation-via-deep-link.md`, `done`): the exact file set and no-new-persisted-state discipline this story extends. Its Review Findings history is worth knowing: the `wa.me` URL not targeting `member.phone` was a real shipped bug, fixed in review — confirms `InviteMemberModal.tsx`'s current `whatsappPhone`/`whatsappUrl` logic (lines 40-43) is already correct and should not be touched.
- **Story 1.13** (`1-13-super-admin-evolution-api-instance-configuration.md`, `done`): confirms `messaging_provider_config`'s exact schema/RLS and explicitly anticipated this story ("the Story 2.5 revision") as a second reader of `instance_id` via its own service-role client — this story is that anticipated reader, arriving as `2-10` instead of a 2.5 revision per the later correct-course split.

### Git Intelligence Summary

- HEAD at story-creation time is `1e6a099` (`feat(story-2.9): Deno test coverage + code-review fixes for OTP fallback chain`). Working tree has only unrelated untracked planning artifacts (`.claude/settings.json`, `_bmad-output/story-automator/`, a stray `.pdf:Zone.Identifier` file, an implementation-readiness report) — no in-progress work toward this story exists. `EvolutionApiMessageProvider`, `sendMemberInvite`, and any `apps/dashboard/lib/messaging/` directory do not yet exist (confirmed via `find`/`grep` during story creation) — this is a clean start.
- Recent commits (`3e6a560`, `1e6a099`, `c283694`) are entirely Story 2.9's own work plus an `epics.md` header backfill — no code patterns beyond what's already extracted into Dev Notes above (`EvolutionApiProvider.ts`'s REST contract is the one directly reused fact).

### Testing Standards

- This app has no automated JS/TS unit-test runner (confirmed by Story 2.5's own Testing Standards note — still true, no test runner was added since). Verification is: `pnpm --filter dashboard typecheck`, `pnpm --filter dashboard lint`, `node scripts/check-i18n-key-parity.mjs` (FR-016 CI gate — run before marking `review`, matches every prior Epic 1/2 story's discipline), plus a manual click-through against the real, already-validated Evolution API instance (Story 2.9 already confirmed `souna2`/`https://evo.ultradominon.com` works — reuse it rather than requesting new credentials) covering: successful automated send (AC #1/#2), a forced-failure path for AC #3 (e.g. temporarily point `messaging_provider_config.instance_id` at a bogus value via Story 1.13's `/messaging` Super Admin page, or disconnect the real instance as Story 2.9's own spike did) confirming the fallback modal opens with a visible error, and a resend (AC #4) confirming the button remains clickable and triggers a fresh attempt. No pgTAP applies — no schema/RLS/migration changes in this story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.10] — canonical AC text (backfilled 2026-08-13, verbatim from the approved proposal).
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-08.md#4.5] — original proposal text (as a Story 2.5 revision) plus the "Implementation note" (`InviteMemberModal.tsx` kept as fallback, new `sendMemberInvite` Server Action, `EvolutionApiMessageProvider`) that `epics.md`'s own text does not carry.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-11.md line 36] — the correct-course decision splitting this out of Story 2.5 into independent Story 2.10.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md#AD-10, #AD-12, "Named infra risk"] — `WhatsAppMessageProvider`'s ratified contract (`send(phone, message, locale) → DeliveryResult`), the Deno→Node porting instruction, and the explicit statement that an invite-send failure surfaces via the pre-existing `InviteMemberModal` fallback (not a silent drop) since this provider has no fallback chain of its own (unlike AD-11's OTP chain).
- [Source: supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.ts] — the REST contract template (live-spike-verified by Story 2.9): endpoint shape, header, body field names, never-throw discipline, per-request `instance_id` read.
- [Source: apps/super-admin/lib/messaging/sendTempPasswordMessage.ts] — the Node/Next.js runtime-shape template: `process.env`, inline `AbortController`-bounded `fetch`, no Deno-only imports.
- [Source: apps/dashboard/lib/supabase/admin.ts] — `createAdminClient()`, the service-role client this story's provider must use to read `messaging_provider_config` (mirrors `services/members.ts`'s existing `findOrCreateUserByPhone` usage).
- [Source: supabase/migrations/0050_messaging_provider_config.sql] — confirms the table's RLS is Super-Admin-SELECT-only, which is *why* a service-role client is structurally required here, not a convenience choice.
- [Source: apps/dashboard/app/(dashboard)/members/components/InviteMemberModal.tsx] — the existing fallback UI, unmodified by this story; its `wa.me`/phone-targeting logic (lines 40-43) is already correct (Story 2.5 review fix) and must not be re-touched.
- [Source: apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx] — existing `invitingMember`/`toast`/`showToast` state this story's button-wiring change extends, not replaces.
- [Source: apps/dashboard/app/(dashboard)/members/actions.ts] — the `"use server"` file `sendMemberInvite` is added to; existing `{data, error}` convention, `getServerTranslation`/`getRequestLocale` usage pattern (see `createMember`'s validation-error branch).
- [Source: apps/dashboard/services/members.ts] — `getCallerGymId`/`memberNotFoundError`'s per-file-copy convention (this story's new `getMemberForInvite` must follow the same discipline, not import from another service file); `MemberListRow` shape already includes `phone`.
- [Source: _bmad-output/implementation-artifacts/2-9-evolution-api-sandbox-spike-otp-provider-fallback-chain.md] — closest structural/precedent story; confirms the live Evolution API instance details usable for this story's own manual verification, and the "ship the port, no chain needed for a single-implementation interface" reasoning.
- [Source: _bmad-output/implementation-artifacts/2-5-member-invitation-via-deep-link.md] — the story this one revises-in-effect; its Scope Notes (#1 no-link policy, #2/#3 no-persisted-state/no-Server-Action-originally) explain why the *manual* flow looks the way it does, which this story's automated flow must stay consistent with (same message template, same no-audit-log posture).
- [Source: _bmad-output/implementation-artifacts/1-13-super-admin-evolution-api-instance-configuration.md] — confirms `messaging_provider_config`'s shape and this story's role as its second anticipated reader.
- [Source: apps/dashboard/.env.example] — existing env-var documentation style/comment convention to match for the two new Evolution API entries.

## Tasks / Subtasks

- [x] **Task 1: `EvolutionApiMessageProvider` — Node port** (AC: #1, #2, #3)
  - [x] Create `apps/dashboard/lib/messaging/EvolutionApiMessageProvider.ts` — async function `sendEvolutionApiMessage(phone: string, message: string): Promise<{success: true; channel: "whatsapp"} | {success: false; error: string}>`.
  - [x] Read `EVOLUTION_API_BASE_URL`/`EVOLUTION_API_KEY` from `process.env` — missing either → clean `{success:false}`, never throw.
  - [x] Query `messaging_provider_config.instance_id` via `createAdminClient()` (service-role), per-request (no module-scope caching) — missing/null instance → clean `{success:false}`.
  - [x] `POST {baseUrl}/message/sendText/{instance}`, header `apikey`, body `{ number: <digits, no +>, text: message }`, `AbortController`-bounded 10s timeout (mirror `sendTempPasswordMessage.ts`'s exact timeout/error-body-read pattern, including the nested try/catch around reading a non-ok response's body text).
  - [x] Non-2xx → `{success:false, error: "Evolution API {status}: {body}"}`. 2xx → `{success:true, channel:"whatsapp"}`.

- [x] **Task 2: `getMemberForInvite` + `sendMemberInvite` Server Action** (AC: #1, #2, #3, #4)
  - [x] `services/members.ts`: add `getMemberForInvite(memberId): Promise<{data: {name: string; phone: string} | null; error: AppError | null}>` — scoped by `getCallerGymId()`, returns `memberNotFoundError` if no matching row or `phone` is null.
  - [x] `actions.ts`: add `sendMemberInvite(memberId: string): Promise<{data: {sent: boolean} | null; error: AppError | null}>`. Validates `memberId` (reuse the existing `assignCoachSchema.shape.memberId` parser, matching `getCoachAssignments`'s own precedent for validating a bare id param), fetches the member via `getMemberForInvite`, composes the message via `t("members.invite.message", {name, gymName})`. **Resolve `gymName` server-side via `getDashboardShellContext()`** (`apps/dashboard/services/session.ts`, exported, already imported elsewhere via this file's sibling service modules — e.g. `services/members.ts` imports `mapAndLog` from the same file) — do **not** accept `gymName` as a Server Action parameter/trust a client-supplied value; this action already needs its own `getCallerGymId()`-scoped session context via `getMemberForInvite`, and `getDashboardShellContext()` is the established, already-shipped way every other server-side gym-name need in this app is resolved (`members/page.tsx` uses it for the exact same value, just client-threaded there because Story 2.5's UI was client-only — this action has no such constraint).
  - [x] Calls `sendEvolutionApiMessage`, returns `{data: {sent: result.success}, error: null}` on both outcomes (send failure is expected, not an `AppError`) — only member-not-found/validation issues populate `error`.

- [x] **Task 3: `MembersPageClient.tsx` wiring** (AC: #1, #2, #3, #4)
  - [x] Replace the "Send Invite" button's direct `setInvitingMember(member)` call with an async handler: call `sendMemberInvite(member.id)`, track a per-row sending state.
  - [x] `sent: true` → `showToast(t("members.invite.sentConfirmation", {name: member.name}))`.
  - [x] `sent: false` or `error` present → `showToast(t("members.invite.sendFailedFallback"))` then `setInvitingMember(member)` (opens the existing fallback modal, unmodified).
  - [x] No disabled/one-shot guard added — button stays clickable for resend (AC #4).

- [x] **Task 4: i18n (EN/FR parity)** (AC: #2, #3)
  - [x] Add `members.invite.sentConfirmation` ("Invite sent to {{name}} via WhatsApp" / French equivalent) and `members.invite.sendFailedFallback` (explains the automated send failed and the fallback options below are being shown / French equivalent) to `en.json`/`fr.json`. (Also added `members.invite.sending`, a per-row in-flight label matching this file's existing `exporting` text-swap convention referenced in Dev Notes.)
  - [x] Run `node scripts/check-i18n-key-parity.mjs` before marking `review`. — passed (466 keys, en/fr in parity).

- [x] **Task 5: Env wiring + manual verification** (AC: #1, #2, #3, #4)
  - [x] Add `EVOLUTION_API_BASE_URL`/`EVOLUTION_API_KEY` to `apps/dashboard/.env.example` (documented) and `.env.local` (gitignored, real values — same Story 2.9 already validated instance, copied from `supabase/.env`, no new credentials needed).
  - [x] `pnpm --filter dashboard typecheck` / `pnpm --filter dashboard lint` clean (typecheck: 0 errors; lint: same 4 pre-existing errors in `RecordRefundModal.tsx`/`RenewalModal.tsx`, confirmed present via `git stash` before this story's changes — no new failures introduced).
  - [x] Manual verification: with user consent, ran `sendEvolutionApiMessage` directly (the exact Task 1 code path) against local Supabase (`instance_id=souna2`) and the real, live `evo.ultradominon.com` gateway, targeting the same test number used in Story 2.9's spike (`+237680811041`, `docs/decisions.md` 2026-07-14 entry). All three scenarios confirmed: (1) successful send → `{success:true, channel:"whatsapp"}` (AC #1/#2), (2) forced failure via a bogus `instance_id` → clean `{success:false, error:"Evolution API 404: ..."}`, never throws (AC #3 — this is exactly the failure shape `sendMemberInvite`/`MembersPageClient.tsx` branch on to show the fallback), (3) resend after restoring the real `instance_id` → `{success:true}` again (AC #4, no blocking). `instance_id` was restored to `souna2` after the test. Full browser click-through of the Send Invite button/toast/fallback-modal UI was not additionally performed in this session (no interactive Manager/Owner browser session available) — the UI wiring (Task 3) was verified by typecheck (which validates the exact `sent`/`error` branching against `sendMemberInvite`'s real return type) and direct code review against the story's exact spec instead.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (Claude Code)

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **Task 1**: `EvolutionApiMessageProvider.ts` implemented as a plain async function (`sendEvolutionApiMessage`), Node-porting `EvolutionApiProvider.ts`'s REST contract (`POST {baseUrl}/message/sendText/{instance}`, `apikey` header, `{number, text}` body) with `sendTempPasswordMessage.ts`'s runtime shape (`process.env`, inline `AbortController`-bounded 10s-timeout `fetch`, nested try/catch on non-ok body read). Per-request (no module-scope caching) `instance_id` read via `createAdminClient()`. Never throws — every failure path (missing env, missing/null instance, timeout, non-2xx) returns a clean `{success:false, error}`.
- **Task 2**: `getMemberForInvite` added to `services/members.ts` following the file's per-function `getCallerGymId()`-scoping and `memberNotFoundError` conventions (no import from another service file). `sendMemberInvite` added to `actions.ts`: validates `memberId` via `assignCoachSchema.shape.memberId`, re-fetches name/phone server-side, resolves `gymName` via `getDashboardShellContext()` (never a client-supplied value), composes the message via the existing `members.invite.message` i18n key, and returns `{data: {sent}, error}` where a gateway failure is `sent:false, error:null` (expected outcome) and only member-not-found/validation issues populate `error`. No audit-log entry, no persisted state (matches Story 2.5 precedent).
- **Task 3**: `MembersPageClient.tsx`'s "Send Invite" button now calls `sendMemberInvite` first via a new `handleSendInvite` handler, tracking a per-row `sendingInviteId` state (matches the file's existing `exporting` single-flight convention, including a text-swap to `t("members.invite.sending")` while in flight). `sent:true` → success toast; `sent:false`/error → failure toast then opens the existing, unmodified `InviteMemberModal` as the fallback. No post-send disabled guard — button remains clickable for resend (AC #4).
- **Task 4**: Added `members.invite.sentConfirmation`, `members.invite.sendFailedFallback`, and `members.invite.sending` (the last supporting Task 3's loading-state text-swap, per Dev Notes' explicit instruction to match the `exporting` convention) to `en.json`/`fr.json`. `node scripts/check-i18n-key-parity.mjs` passed (466 keys, en/fr in parity).
- **Task 5**: Added `EVOLUTION_API_BASE_URL`/`EVOLUTION_API_KEY` to `.env.example` (documented) and `.env.local` (real values, copied from `supabase/.env` — same instance Story 2.9 validated, no new credentials requested). `pnpm --filter dashboard typecheck` passed with 0 errors. `pnpm --filter dashboard lint` surfaced the same 4 pre-existing errors in `RecordRefundModal.tsx`/`RenewalModal.tsx` present before this story's changes (confirmed via `git stash`) — no new lint failures. With explicit user consent, ran a script exercising the real `sendEvolutionApiMessage` code path against local Supabase (`instance_id=souna2`) and the live `evo.ultradominon.com` gateway, targeting the Story 2.9 spike's test number (`+237680811041`): successful send, forced failure via a bogus `instance_id` (clean `{success:false}`, never throws), and a successful resend after restoring the real `instance_id` — all three matched AC #1-#4's expected behavior exactly. `instance_id` was restored to `souna2` afterward; the scratch verification script was deleted, not committed.
- No deviations from the story's Dev Notes/Tasks were needed — implementation matches the specified files, functions, and signatures throughout.

### File List

**New:**
- `apps/dashboard/lib/messaging/EvolutionApiMessageProvider.ts`
- `apps/dashboard/lib/messaging/EvolutionApiMessageProvider.test.ts` (QA automation — 8 tests)
- `apps/dashboard/services/members.getMemberForInvite.test.ts` (QA automation — 5 tests)
- `apps/dashboard/app/(dashboard)/members/actions.sendMemberInvite.test.ts` (QA automation — 6 tests)
- `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.sendInvite.test.tsx` (QA automation — 4 tests, React Testing Library)
- `apps/dashboard/vitest.config.mts` (first test-runner config for `apps/dashboard`)
- `apps/dashboard/vitest.setup.ts`

**Modified:**
- `apps/dashboard/app/(dashboard)/members/actions.ts` (+ `sendMemberInvite`)
- `apps/dashboard/services/members.ts` (+ `getMemberForInvite`)
- `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx` (Send Invite button wiring)
- `apps/dashboard/locales/en.json` / `apps/dashboard/locales/fr.json` (+ `members.invite.sentConfirmation`, `members.invite.sendFailedFallback`, `members.invite.sending`)
- `apps/dashboard/.env.example` (+ `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY`, documented)
- `apps/dashboard/.env.local` (gitignored — real values, reused from `supabase/.env`)
- `apps/dashboard/package.json` (+ `test` script, `vitest`/`@testing-library/*`/`jsdom`/`@vitejs/plugin-react` devDependencies)
- `turbo.json` (+ `test` task)
- `.github/workflows/ci.yml` (+ "Unit/component tests" step, `typecheck` job — `npx turbo run test --filter=@gymos/dashboard`)
- `_bmad-output/implementation-artifacts/tests/test-summary.md` (+ Story 2.10 QA-automation section)

**Note (review fix — code review, 2026-08-13):** the original File List omitted the six test-infrastructure/CI entries above (test files, `vitest.config.mts`/`vitest.setup.ts`, `package.json`, `turbo.json`, `ci.yml`), even though they were real, substantial, git-confirmed changes (`apps/dashboard`'s first automated JS/TS test runner) already documented in `tests/test-summary.md`. This section's Testing Standards note ("no automated JS/TS unit-test runner ... still true") is now stale as of this story — left as-is above since it accurately describes the state *at story-creation time*, not post-implementation; `tests/test-summary.md`'s own "Framework" section is the up-to-date record.

## Change Log

- 2026-08-13: Story 2.10 implemented — automated WhatsApp member invite via Evolution API (Tasks 1-5 complete). New `EvolutionApiMessageProvider` (Node port of the Deno OTP provider pattern), new `sendMemberInvite` Server Action, `MembersPageClient.tsx` wired to attempt the automated send first with `InviteMemberModal` demoted to the failure-path fallback, new i18n keys, env vars wired. Verified against the real, live Evolution API instance (success, forced-failure, resend). No regressions; typecheck/lint clean relative to pre-existing baseline.
- 2026-08-13: QA automation — added `apps/dashboard`'s first JS/TS test runner (Vitest + React Testing Library + jsdom), 4 test files / 23 tests covering all of this story's new code paths (`EvolutionApiMessageProvider`, `getMemberForInvite`, `sendMemberInvite`, `MembersPageClient`'s Send Invite wiring), and wired `pnpm --filter dashboard test` into CI (`.github/workflows/ci.yml`). Full detail in `tests/test-summary.md`.
- 2026-08-13: Code review (AI) — 1 Medium finding (File List/Change Log omitted the test-infrastructure and CI changes above, despite being real and already documented in `tests/test-summary.md`) auto-fixed by backfilling this file's File List and Change Log. No High or Critical findings: all 5 Tasks and all 5 ACs verified implemented against actual code (re-ran `pnpm --filter dashboard test` — 23/23 pass; `typecheck` — 0 errors; `lint` — same 4 pre-existing baseline errors, no new failures; `check-i18n-key-parity.mjs` — pass, 466 keys). Status: review → done.

## Senior Developer Review (AI)

**Reviewer:** smartsana (via bmad-story-automator-review, autonomous adversarial pass) on 2026-08-13

### Scope

Cross-checked every AC and every `[x]` Task against actual code (not just the story's own narrative), diffed the story's File List against `git status`/`git diff --name-only`, ran the full verification suite myself rather than trusting the Dev Agent Record's claims.

### Verified independently

- `pnpm --filter dashboard test` → 4 files, 23/23 tests pass (matches claim).
- `pnpm --filter dashboard typecheck` → 0 errors (matches claim).
- `pnpm --filter dashboard lint` → same 4 pre-existing errors in `RecordRefundModal.tsx`/`RenewalModal.tsx` (`react-hooks/set-state-in-effect` x2, `i18next/no-literal-string` x2), no new failures (matches claim).
- `node scripts/check-i18n-key-parity.mjs` → pass, `apps/dashboard/locales`: 466 keys, en/fr in parity (matches claim).
- Read every changed/new source file (`EvolutionApiMessageProvider.ts`, `getMemberForInvite`, `sendMemberInvite`, `MembersPageClient.tsx` wiring, both locale files, `.env.example`) against the Deno (`EvolutionApiProvider.ts`) and Node (`sendTempPasswordMessage.ts`) reference templates the Dev Notes named — the REST contract, never-throw discipline, per-request `instance_id` read, and Node-runtime shape (`process.env`, inline `AbortController`, nested try/catch on body read) all match precisely.
- Confirmed `InviteMemberModal.tsx`, `send-sms-hook/`, and Story 2.5's own story file are genuinely untouched (`git diff --stat` empty), matching the story's explicit "Not modified" list.
- Confirmed `.env.local` exists, is gitignored (`apps/dashboard/.gitignore:45`), and is not tracked.
- Confirmed `members.phone` is validated E.164 with a leading `+` at every write path (`packages/types/src/schemas/member.ts`), so `sendEvolutionApiMessage`'s `.replace(/^\+/, "")` is correct, not a latent bug.
- Confirmed `sendMemberInvite`/`getMemberForInvite` not re-checking `deactivated_at` server-side matches the codebase-wide convention (`updateMember` has the same shape) — not a story-specific regression.

### Findings

1. **[Medium — fixed] File List / Change Log incomplete.** `git diff --name-only` / `git status --porcelain` showed real, substantial changes not reflected anywhere in the story file: `apps/dashboard/package.json`, `turbo.json`, `.github/workflows/ci.yml`, `apps/dashboard/vitest.config.mts`, `apps/dashboard/vitest.setup.ts`, and 3 new test files (23 tests total) — `apps/dashboard`'s first-ever JS/TS test runner and a new CI gate. The work itself was real and already documented in `_bmad-output/implementation-artifacts/tests/test-summary.md`, just not synced back into this story's own File List/Change Log. **Fix applied:** File List and Change Log backfilled above.

No Critical or High findings — all 5 Acceptance Criteria are genuinely implemented (verified against code, not just task checkmarks), all 5 Tasks' `[x]` markers reflect real, working code, and the test suite added on top of the story's own scope is high quality (real assertions against mocked collaborators, not placeholders — see `EvolutionApiMessageProvider.test.ts`'s 8 cases covering every branch including the non-ok-body-read failure path).

### Outcome

**Approved.** Status: review → done. Sprint status synced.
