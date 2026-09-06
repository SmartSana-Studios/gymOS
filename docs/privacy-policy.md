# GymOS Privacy Policy — where it lives

**The policy text is no longer maintained in this file.** It moved into the
dashboard app on 2026-09-06 so that it could be served at a real public URL,
which is what App Store Connect and Play Console require.

| | |
|---|---|
| **Canonical text (EN + FR)** | `apps/dashboard/lib/legal/privacy-policy.ts` |
| **Operator-supplied values** | `apps/dashboard/lib/legal/details.ts` |
| **Page** | `apps/dashboard/app/privacy/page.tsx` |
| **Public URL** | `https://<dashboard-domain>/privacy` |

This file is now a pointer only. Editing it changes nothing that a member or
a store reviewer sees — edit `privacy-policy.ts` instead.

## Why it moved

A markdown draft in `docs/` cannot be submitted to a store: both stores want
a URL they can fetch, unauthenticated, at review time and periodically
afterwards. Keeping a second prose copy here as well would guarantee drift
between what counsel reviewed and what is actually served, so the draft was
replaced by this pointer rather than kept in parallel.

## What changed in the text when it moved

The draft in this file predated three shipped epics and understated what
GymOS collects. The hosted version adds:

- **Body measurements** (`progress_entries`, Story 10.1) — weight, waist,
  chest, hips, arms, thighs, and the member's own note.
- **Progress photos** (`progress_photos`, Story 10.2) — including that they
  are private by default and shared with a coach only per-photo, revocably.
- **Class bookings and workout-plan completions** (Epics 12, 13).
- **Notification history and preferences** (Story 6.7).
- **Analytics and error reporting** — a new section covering PostHog
  (Story 9.5) and Sentry (Story 14.1), both of which the draft omitted
  entirely, including the specific guarantee that no measurement value,
  photo, note text, or contact detail is sent to PostHog.
- **Phone-number sharing with the messaging providers** (Evolution API,
  Twilio, sent.dm) — the draft named only a bracketed "[SMS provider]".

It also resolves the draft's open data-deletion question: see below.

## Resolved: data deletion (2026-09-06)

GymOS declares **Yes** to Play's "users can request data deletion", satisfied
by a **documented manual process** rather than an in-app delete button —
which Play explicitly permits provided the instructions are published and the
contact route works. The policy's §6 states the process: the member contacts
their gym or writes to the support address, GymOS confirms identity via the
gym, deletes what it is not legally required to keep, and confirms completion.

An in-app account-deletion flow was considered and deliberately not built for
V1: erasure would have to cross ~40 tables and conflicts directly with
`audit_log`'s append-only design (Story 1.4) and with financial-record
retention. That remains available as a future story if the manual process
proves insufficient in practice.

## Operator details (supplied 2026-09-06)

| Field | Value |
|---|---|
| `legalEntity` | GetSocial Inc |
| `address` | Yaoundé, Melen |
| `supportEmail` | info@smartsana.com |
| `retentionPeriod` | EN: "for as long as your membership is active, and for one year after it ends" · FR: "tant que votre adhésion est active, puis pendant un an après sa fin" |
| `minimumAge` | 18 |

All five are filled, so `/privacy` no longer renders the unpublished-draft
banner. `retentionPeriod` is the one field held per-locale rather than as a
single shared string — it is prose, not a language-neutral fact, and a shared
string would have put an untranslated English clause into the French policy.

## Resolved: minimum age is 18 (2026-09-06)

Set to **18**, i.e. GymOS declares itself an adults-only product. This is the
simpler answer for both stores: Play's "Target audience and content" section
takes the 18+ bracket only, avoiding the 13–17 branch's additional
child-safety, ads and content-rating requirements, and Apple's age-rating
questions follow the same shape.

One consequence worth knowing: nothing in the app enforces this. There is no
age gate, `members.dob` is optional, and a gym can enrol whoever it likes. If
a gym in practice signs up a 16-year-old, the published policy will say the
app is not directed at them. That is a policy/ops mismatch rather than a
store-review blocker, but it is the kind of thing worth settling before the
first real gym onboards minors.

## Open items — deferred by the operator (2026-09-06)

Deferred deliberately, not overlooked. None of them blocks deploying the page;
items 1 and 2 should be closed before the URL is submitted to a store console.

1. **Entity name vs. product branding — deferred.** The policy names
   *GetSocial Inc*, while the support domain is `smartsana.com`, the Expo
   owner account is `smartsana-studios`, and the bundle ID is
   `com.smartsana.gymos`. Store reviewers do check that the developer
   account, the app, and the privacy policy point at the same organisation —
   if the Play/App Store developer account is not registered to GetSocial
   Inc, either the policy or the account needs to change, or the relationship
   between the two names should be stated in the policy.
2. **Address completeness — deferred.** "Yaoundé, Melen" is a locality, not a
   full registered postal address (no street/PO box, no country line). The
   spelling was normalised to "Yaoundé" with the accent, since the same
   string is served on the French page.
3. **Counsel review of both language versions** of `privacy-policy.ts`. The
   French was authored alongside the English rather than translated from a
   reviewed source, so it needs the same review, not a lighter one.
4. **Retention vs. what the code actually does — still open.** The policy
   promises deletion one year after a membership ends. Nothing in the
   codebase enforces that: there is no retention job, and `deactivated_at` is
   a soft-delete. The promise is currently kept by the manual process, not by
   the system; a scheduled purge would be a future story.

## Keeping it honest

`docs/play-store-data-safety.md` and `privacy-policy.ts` are derived from the
same underlying facts (the migrations, the wired SDKs, `apps/mobile/app.json`).
A divergence between the two is what a store review flags — when the schema,
a third-party SDK, or a permission changes, update both in the same pass.
