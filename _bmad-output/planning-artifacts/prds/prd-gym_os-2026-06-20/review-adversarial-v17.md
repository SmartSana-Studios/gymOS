# Adversarial Review: PRD V1.7 (support staff, landing pages, directory)

Scope: prd.md 4.5, 6.30 (FR-175..188), 6.31 (FR-189..198), 6.32 (FR-199..203), NFR-023..025, 10.2, Section 12, addendum H, checked against FR-072, FR-087..092, FR-126/127, FR-132, FR-171/172, NFR-001, NFR-021.

Method: assume a non-technical product owner, a small team building from the text with no questions, and a motivated attacker or careless insider. Every finding states where, what breaks, and the fix.

Verdict: NOT ready to build as written. The support-staff design concentrates cross-gym money-moving power in one MFA-protected account type, then hides the actor from the very party who bears the loss. Several "enforced" claims are not testable as phrased. The landing-page design puts gym-authored content on the same registrable domain as the staff login with no stated content-safety, cookie, or takedown model. Fix the Critical and High items before stories are cut.

Counts: Critical 5, High 13, Medium 13, Low 5 (36 total).

---

## CRITICAL

### C1. One support account can redirect every assigned gym's member payments, with no Owner-visible trace
- Where: FR-178 (connect or replace Tara Money; record payments, refunds), FR-180 (default ON), FR-182/FR-179 (actor hidden), FR-183 (excluded from notifications), FR-126 (Owner authorizes credentials).
- Scenario: An attacker, or a rogue or phished support person, passes TOTP once. In each of N assigned gyms they replace the Tara Money connection with a merchant account they control. Every subsequent in-app member payment goes to the attacker. They can also issue refunds and waive fees. The Owner's audit trail shows only "GymOS Support" and no notification fires (FR-183 explicitly suppresses support from notifications). Because the setting is ON by default, existing production gyms are exposed from the day of release without having consented.
- Fix:
  - (a) Credential replacement by support must be a two-step action. Support proposes, and the Owner (or Super Admin plus a second Super Admin) confirms. Alternatively, support can only trigger an Owner-completed connect flow and never handles the credentials.
  - (b) Every change to payment-connection state, refund over a threshold, bulk waiver, or staff creation must send a notification to the Owner and an alert to Super Admin, even though the actor is collapsed.
  - (c) Add a velocity limit per support account (changes per hour across gyms) with an automatic lock.
  - (d) Add an explicit amendment line to FR-126 ("Owner authorizes" is currently contradicted by FR-178 with no "Amendment to FR-126" per the document's own convention).

### C2. Support enrollment and MFA reset are the real attack path, and Super Admin has no stated second factor
- Where: FR-175, FR-184, FR-185; Section 12 G (temporary passwords over WhatsApp, password-reset OTP path "never run in production").
- Scenario: Super Admin creates a support account and delivers a temporary password over WhatsApp or SMS. Whoever gets it first signs in at AAL1 and enrolls THEIR authenticator ("forced enrollment at first sign-in"). The legitimate person is then locked out and a Super Admin "reset" (FR-185) is the recovery. An attacker with SIM-swap or WhatsApp access to the person's phone passes the password step, asks Super Admin for an MFA reset, and re-enrolls. FR-184 requires TOTP only for support. Super Admin, who can create support accounts, assign them anywhere and reset their MFA (FR-175, FR-176, FR-185), has no second-factor requirement in this PRD.
- Fix:
  - (a) Require Super Admin AAL2 for all of FR-175/176/181/185 and for the Super Admin session generally.
  - (b) Enrollment is by single-use invite link, expiring in 24h, sent to a channel verified out-of-band, never a temp password.
  - (c) Reset requires a second Super Admin approver or a recorded identity check, with a cooling-off delay and notification to the support person's other channel.
  - (d) State "one verified factor per account; adding or removing a factor requires AAL2", and test that an AAL1 session cannot enroll an additional factor.
  - (e) Provide recovery codes or a documented recovery path so reset is not the only route.

### C3. No dual control or independent oversight: a single Super Admin compromise equals every gym
- Where: FR-175/176/181, 4.5 Super Admin row, FR-187.
- Scenario: A compromised, coerced, or malicious Super Admin creates a support account, assigns it to all gyms, resets its MFA, and acts. Nothing in the PRD separates these duties or alerts anyone. The Owner cannot see the new assignment (FR-179 shows the same single row whether 1 or 20 people are assigned).
- Fix: Assignment of a support person to a gym with money-moving rights needs a second approver or a time-delay with Owner notification ("a GymOS support person was assigned; you can switch support off"). Audit events for create/assign/reset must be immutable and alert a named security contact. Cap gyms per support account or require re-approval above a threshold.

### C4. Gym-authored content on `*.gymosapps.com` shares a registrable domain with the staff login (XSS, cookie tossing, same-site CSRF)
- Where: FR-189, FR-190, FR-196, Section 12 F, addendum G.
- Scenario: Landing pages are hosted at `{name}.gymosapps.com`; staff sign in at `owner.gymosapps.com`. All are the same site. Any script injection in gym-entered content (about text, services, JSON-LD, map link, image name) executes on an origin that can read or set cookies scoped to `.gymosapps.com` if any auth cookie is domain-scoped, can fixate or overwrite session cookies (cookie tossing), and bypasses SameSite protections that only distinguish sites. Nothing in the PRD requires output encoding, CSP, cookie scoping, or sanitization. "Validated" content (FR-193) is not "escaped".
- Fix: Add an explicit security NFR: auth cookies host-only on `owner.`/`portal.` (never `Domain=.gymosapps.com`), enforce `__Host-` prefix; strict CSP with no inline script on landing; all gym text rendered as text only, never HTML or markdown with raw HTML; JSON-LD built via serializer that escapes `</script>` and `<`; security-header test in the Step 2 gate. Strongly consider hosting UGC on a separate registrable domain, or at minimum record the risk acceptance by the product owner.

### C5. The "hidden individual" is a UI claim, not an enforceable one: the real person is a real row in gym tables
- Where: FR-179, FR-182, FR-188, addendum H (model sketch: one `members` row per assignment with `is_support`; `display_actor` column).
- Scenario: Every assignment materializes a real members row carrying the person's real user id. Supervisors have SELECT on the gym's members and users data through the API; the front end hides the row but a staff member with a browser console reads it, with name and phone, and sees the same user id in a second gym they work for (cross-gym correlation). `recorded_by`, check-in, notes, refund approver, exports, CSV, realtime payloads, push text, and Sentry breadcrumbs all join to the individual. "Single flag drives every exclusion" is asserted for counts and the staff list, not for RLS, exports or joins. `display_actor` stored as a column written by the client or caller is spoofable. Section 12 notes `log_audit_event` is callable by any authenticated session: a support person (or any staff) can write misleading audit rows.
- Fix: Require, as testable acceptance criteria: (a) RLS and views hide support membership rows and the underlying user's name and phone from every non-Super-Admin; (b) a per-surface list (staff list, audit, payments recorded-by, refunds, notes, check-ins, exports, realtime, notifications, error logs) each with a pgTAP or E2E test; (c) `display_actor` is derived server-side in a view, never stored from client input; (d) `log_audit_event` is locked before support ships (promote it from "deferred" to gate).

---

## HIGH

### H1. Opt-out, unassignment and revocation vs in-flight work are undefined
- Where: FR-180, FR-186, NFR-023, OQ-30.
- Scenario: Support initiates a Tara Money charge or refund; a webhook, a retry, or a "pending" state is outstanding. The Owner switches support off or Super Admin unassigns. Who completes, cancels or reconciles it? The refund stays pending forever with an actor who no longer exists in the gym. A bulk import or a long RPC is half-way. Realtime subscriptions, signed storage URLs and an already-read Vault secret continue past "next request". Support already holds the credentials they typed in.
- Fix: Specify: in-flight operations are completed or rolled back atomically by the service at revocation; pending items created by a revoked person are re-owned to a system actor, flagged for Owner attention; realtime channels and signed URLs are closed or short-lived (state a max, e.g. 60 s) for support sessions; after any support-initiated credential change and after revocation, Owner is prompted to rotate the Tara Money credentials.

### H2. Assignment vs. opt-out race, and the "restores assignments" semantics (OQ-30) leave state undefined
- Where: FR-176, FR-180, addendum H.
- Scenario: Super Admin assigns a person while Owner has support off. Is a members row created and active, suspended, or deferred? Owner toggles ON, and a person assigned while off, possibly never reviewed, silently becomes active ("restores the gym's assignments"). A concurrent assign and toggle can leave a members row active with `allow_gymos_support=false`. Three sources of truth (assignment table, members row, setting) can drift; an orphan row with no assignment still grants access.
- Fix: Define the authoritative source (assignment table) and make the members row derived or enforced by a constraint and a single SECURITY DEFINER function. Specify that an assignment made while off is "pending" and never activates on toggle-on without a fresh Super Admin or Owner confirmation, or simply decide OQ-30 now. Add a test for the invariant "active support membership implies assignment AND allow=true".

### H3. Owner cannot distinguish "opted out", "zero support assigned", "one", or "twenty"
- Where: FR-179, 4.5 Owner row.
- Scenario: The row shows when at least one is assigned and allowed, and no row otherwise. An Owner who sees no row cannot tell if they switched support off, none was assigned, or the person was removed. An Owner who sees the row cannot tell how many people (or which of several time zones/ organizations) hold money-moving rights. A broken support request ("I asked for help") has nowhere to go.
- Fix: Show explicit state text: "Support: Off by you / On, no one currently assigned / On, N people assigned" (count is not identity), the last time support acted, and a stable pseudonymous label per person ("Support A", "Support B") that Super Admin can map. This keeps privacy of names while allowing the Owner to detect anomalies and to dispute.

### H4. Accountability gap: the party who bears the loss cannot attribute it
- Where: FR-182, FR-188, FR-181.
- Scenario: A refund, a fee waiver, or a plan price change by support is disputed by a member or a business partner. The Owner can say only "GymOS Support did it". The Owner has no way to reveal who, no SLA for Super Admin to answer, no dispute path, and FR-181 forbids the Owner from acting on individuals. Legal and contractual liability for support actions is not stated.
- Fix: Add a "request disclosure" workflow: Owner files a dispute on an audit row; Super Admin must reveal the individual's identity (or role and employer) within a stated period; record liability and terms ("GymOS is responsible for actions of its support staff") in the PRD or customer terms.

### H5. Default ON for existing production gyms is retroactive consent over member data
- Where: FR-180, Section 12 E, project state (real gyms live since 2026-09).
- Scenario: On release, every existing gym gets an additional, undisclosed set of people with full access to member PII and payments. The Owner and the members were never asked. In jurisdictions with personal-data laws (Cameroon's recent data protection law and equivalents; confirm with counsel) this is a processing change needing notice and a basis.
- Fix: Decide explicitly: either default OFF for gyms existing at release (opt-in notice sent first), or default ON with a mandatory announcement, an acknowledgement requirement, and a grace period before any assignment can occur. Add a notice to the member privacy policy.

### H6. Bypass of FR-072 (member-data access needs an escalation reason)
- Where: FR-072, FR-187, FR-175/176.
- Scenario: FR-187 says Super Admin escalation "stays unchanged", yet a support person reads all member and payment data in assigned gyms with no escalation action and no reason. A Super Admin can create a support account for themselves and assign it, defeating FR-072's per-access reason and audit by a different door.
- Fix: State that a Super Admin cannot hold a support account (separate identities, separate people), or require reason-coded sessions for support access to member PII. Add an explicit amendment to FR-072 explaining the intended relationship.

### H7. Person who is also a member, staff, or Owner elsewhere (identity collisions)
- Where: FR-001, FR-091, FR-177, FR-175, FR-003.
- Scenario: (a) The support person's phone already belongs to a member in gym X. FR-091 says "a new role replaces the prior binding", so assignment silently destroys the member's membership (subscriptions, payments, loyalty). (b) A support person's phone is already staff or an Owner in another gym; FR-001 allows one user per phone, so the "platform account" collision is undefined. (c) A gym staff member is assigned as support to their own gym, or an Owner to a competitor's gym. (d) Support records payments or waives fees for themselves or friends with no dual control. (e) The JWT carries a single `gym_id` (FR-003): which gym is active for a support person assigned to many, and how is switching authorized and revalidated?
- Fix: Require support accounts to use a dedicated GymOS-controlled email and number that cannot map to any existing user; reject on collision rather than replace; forbid assignment where the person holds any other membership in that gym; specify gym-context selection (explicit active-gym switch, revalidated live) and forbid self-dealing (a support person cannot act on a member record associated with their own phone/ID).

### H8. "Cannot change the gym's SaaS billing relationship / delete the gym" is untestable as written
- Where: FR-178.
- Scenario: Support has "gym profile and settings", "plans and prices", "staff", and Tara Money. Which tables and RPCs are "billing relationship"? Tier (FR-073), interval, billing anchor, the Owner contact for notices (FR-133), payment links, suspension state, and the Tara credential also used for Flow B? Support can deactivate every staff member including the Owner's Supervisors, change gym name, or change the Owner-contact phone so billing notices go elsewhere. "Delete the gym" has no corresponding FR (no delete exists).
- Fix: Replace negative prose with an allow-list of RPCs and columns, plus a negative test matrix. Enumerate the denied set (tier, interval, billing anchor, owner contact fields, subscription status, suspension, gym delete/deactivate, Owner membership). Add a pgTAP test per denied RPC and per column grant.

### H9. Support's staff-management power can create a persistent backdoor and lock out the Owner
- Where: FR-177, FR-178, FR-087, FR-089, Section 12 G (staff phone change policy missing).
- Scenario: Support creates a Manager or Receptionist with a phone it controls. That account is an ordinary staff account, visible but unflagged, and survives support revocation. Support can also deactivate the Owner's Supervisors (FR-089 ceiling does not cover equal rung, and the ceiling is not stated for same-rung edits), change a staff phone number, or trigger a password reset, which together can reach the Owner path.
- Fix: Support-created and support-modified staff are tagged and listed to the Owner as "created by GymOS Support", require Owner confirmation, and are removed or flagged on support revocation review. State that support cannot deactivate or edit Supervisors, cannot change any staff phone or reset any password for Owner or Supervisor, and cannot trigger credential resets.

### H10. MFA session handling: AAL2 once, then long-lived access; no step-up, lockout or session limits
- Where: FR-184, FR-186, addendum H.
- Scenario: AAL2 is a claim, valid for the token and persistent across refresh. A stolen laptop or an open browser session keeps money-moving power for as long as refresh succeeds. No TOTP brute-force lockout, replay window, idle timeout, concurrent session limit, or device binding is specified.
- Fix: Add: support session max age (e.g. 8 h) and idle timeout (e.g. 15 min); step-up AAL2 re-verification within 5 minutes for credential change, refund and staff creation; TOTP attempt lockout and rate limit; no "remember this device".

### H11. Edge functions and payment services bypass RLS, so "enforced in the database" does not cover them
- Where: FR-184 ("on every support read and write path"), NFR-023, NFR-017.
- Scenario: The payment service and edge functions use a service role key and read Vault. They authorize from the caller's claim or only from `gym_id`. A support session at AAL1, or after revocation, can trigger a payment via the edge function even if RLS is perfect.
- Fix: Add a requirement and a test that every edge function and service-role path performs the same live-authority check (assignment, opt-out, AAL2) via a shared helper before touching Vault or money. Include these in the Step 1 gate item 7 inventory, not just "policies and RPCs".

### H12. Name hijack via redirect expiry, and rename-limit bypass via unpublish/republish
- Where: FR-194, FR-195.
- Scenario: (a) After 12 months the old name is released and anyone (a competitor, a phisher) claims it. Printed flyers, QR codes and Google results sending people to the old name now reach the attacker's page. (b) "Claimed at publish time": a gym unpublishes, republishes under a new name, and thereby evades the twice-a-year limit and the 12-month reservation, and while unpublished the old name may be free to others (undefined). (c) Redirect chains: gym renames A to B to C; does A redirect to B (chain) or C? (d) Forced rename or takedown of an offensive name still redirects for 12 months (keeps the offensive address alive).
- Fix: Define name ownership as persistent for the gym (held while unpublished, suspended, or renamed), rename counted per gym regardless of publish state, redirect always to the current name in one hop, redirects dropped immediately on takedown or forced rename, old names retained as tombstones for 24 months or permanently reserved for the original gym. Test each.

### H13. Name rules allow IDN homograph labels, brand impersonation and phishing hostnames
- Where: FR-194, FR-195.
- Scenario: `a-z0-9-` with no leading or trailing hyphen allows `xn--` punycode labels (e.g. `xn--pple-43d`) that render as lookalike Unicode in browsers. Consecutive hyphens, all-digit names, and phishing strings (`owner-gymosapps`, `login-gymos`, `pay-tara`, `secure-owner`) pass. Only names starting with `gymos` are blocked; `gym-os` and `login`, `signin`, `account`, `billing`, `pay`, `payment`, `tara`, `taramoney`, `mtn`, `momo`, `orange`, `static`, `assets`, `img`, `test`, `demo`, `sandbox`, `preview`, `staff`, `member`, `members`, `super`, `superadmin`, `root`, `security`, `abuse`, `postmaster`, `legal`, `privacy`, `terms`, `blog`, `ftp`, `smtp`, `webmail`, `autodiscover`, `ns1`, `supabase`, `sentry`, `vercel`, `expo` are all claimable. No rule links the subdomain to the gym's registered business name, so any gym can take `mtn` or a well-known brand with a convincing page. "Near-match notification" has no definition of near, no recipient, no SLA, and the page is already live (no pre-moderation).
- Fix: Reject `xn--`, `--`, digits-only, and names containing a deny-list of brand and credential words; define near-match as normalized edit distance 1 plus homoglyph and hyphen/digit folding against all existing names, reserved names and a brand list; hold near-matches and names containing deny-listed terms for Super Admin approval before first publish (cheap, since gyms are created by GymOS staff); require name to contain a recognizable part of the gym's registered name or be approved.

---

## MEDIUM

### M1. Publish gate evaluated once; published page can fall below the gate or change after approval
- Where: FR-191, FR-192, FR-196.
- Scenario: A gym publishes with a valid page, then makes its only public plan private, removes the logo, or edits about text to 5 characters, or swaps in phishing text after the one-time check. The projection is either a live view (edits go public instantly, unvalidated) or a snapshot (undefined). No re-validation, no content change review.
- Fix: Decide snapshot-on-publish vs live; validate on every projection refresh; auto-unpublish (and notify) if the gate fails; log content diffs.

### M2. Published projection boundary is not specified as a field list
- Where: FR-196, NFR-024, Section 12 G.
- Scenario: "Nothing a visitor can request returns data not in the projection" is circular. Which fields exist? Does it expose internal uuids (gym_id, plan_id, enabling enumeration), `gym_token`, the Owner's personal phone as "contact", precise lat/long of a home address, plan IDs usable against payment endpoints, or archived plans and stale prices? The repo already has an anon-EXECUTE default-privilege trap: a SECURITY DEFINER view or function can leak beyond its intent.
- Fix: Enumerate projection columns in the PRD. Require security-invoker view or a dedicated schema with explicit grants, a test that anon has zero privilege on any other relation and function, and a snapshot test of the projection's column list that fails on change.

### M3. Image and gallery abuse
- Where: FR-190, FR-191, FR-193, Section 12 G (public storage cleanup gaps).
- Scenario: SVG with script, polyglot files, EXIF GPS data retained, oversized files, hotlinking and bandwidth abuse of a public bucket, illegal or sexual imagery (no moderation), photos of identifiable members without consent. "Remove logo" gaps mean deleted images stay reachable; CDN caching keeps them after unpublish.
- Fix: Allow only re-encoded JPEG/WebP/PNG, strip EXIF, set size and dimension and count limits, serve from a cookieless separate origin, purge on unpublish/delete, add a report-abuse path and a consent attestation at upload.

### M4. No takedown, complaint or appeal process
- Where: FR-195, 4.5.
- Scenario: Super Admin "can take down", but there is no public abuse-report channel, intake, SLA, owner notification, reason code, distinction between "takedown" and "unpublish", or whether the Owner can republish over a takedown. Third-party trademark owners and defrauded users have no route.
- Fix: Add a takedown state that blocks republish, requires a reason and notifies the Owner, define a public report form and a response SLA, and an appeal path.

### M5. Suspended gym and support interplay undefined
- Where: FR-132, FR-198, FR-178, FR-180.
- Scenario: FR-132 suspends every staff account. Does support (a staff membership) lose access? If yes, support cannot repair a Tara Money connection that may have caused the problem; if no, support holds a path that the Owner does not have, and could in theory lift or influence billing. The Owner is suspended and so cannot reach the "Allow GymOS Support" control either. Landing page: does the suspended gym's name stay reserved? Does the hidden page return 404 (which leaks nothing) or a distinguishable response that reveals suspension, which FR-132 says must never mention billing?
- Fix: State explicitly: support access during suspension is read-only (or denied), the control is reachable by the Owner in the suspended state or not, name stays reserved, and the public response is the same 404 as an unpublished page.

### M6. Publisher identity contradiction: who may claim a name
- Where: FR-190 vs FR-195, 4.5.
- Scenario: FR-190 and 4.5 let Owner, Supervisor and support publish; FR-195 says the name is claimed "by the gym's Owner at publish time". A Supervisor or support person cannot publish if the Owner has never claimed; if they can, FR-195 is violated, and a support person is choosing the public address of a gym.
- Fix: Name claim and rename are Owner-only (or Owner and Super Admin); content edit and publish by others use the existing name.

### M7. Country and city modeling is free text
- Where: FR-191, FR-199, FR-201.
- Scenario: "Country and city" with no canonical list: "Cameroon", "Cameroun", "CM", "douala", "Douala ", "Yaoundé"/"Yaounde" produce fragmented directory sections and break the threshold in FR-201. Inflating or gaming the threshold is trivial. No slug rules for accents in URLs.
- Fix: Country from ISO 3166 selection; city from a controlled list with alias normalization or Super Admin approval of new cities; define URL slug and the canonical language for place names.

### M8. Directory SEO details are internally inconsistent or unspecified
- Where: FR-197, FR-199..FR-202.
- Scenario: (a) Language alternates (hreflang) are declared for pages whose content is a single language "as entered", producing misleading alternates. (b) FR-199 lists any published gym in a country section; FR-201 de-indexes a thin country listing; the page's own indexing status is unspecified. (c) Category filter pages (FR-202) create near-duplicate URL combinations with no canonical or noindex rule. (d) A 100-character "about" (FR-191) is itself thin content. (e) Structured-data type for "Studio Yoga", "Autre" not mapped. (f) The "machine-readable site summary for AI crawlers" has no field list and may expose phone numbers wholesale.
- Fix: Specify canonical rules for facets, hreflang only where translated content exists, per-page index rules, schema type mapping, and the exact fields of the AI summary.

### M9. Privacy and legal exposure of address and phone
- Where: FR-189..191, FR-200, FR-203.
- Scenario: Publishing makes the contact phone, WhatsApp number and address indexable, scrapeable and archived by AI crawlers, including a home-based studio or an Owner's personal mobile. "Promptly" removal cannot recall cached copies. No publish-time consent screen or warning. No terms for gym-authored content and no content licence or acceptable-use policy.
- Fix: Add a publish confirmation that states what becomes public and for whom; allow a dedicated public contact distinct from the Owner's login phone; define a de-indexing procedure; require content terms acceptance; get counsel review for the applicable data law.

### M10. "Promptly" and freshness are unmeasurable
- Where: FR-198, FR-203, NFR-025.
- Scenario: Nothing defines the maximum time from unpublish/suspend/takedown to the address, directory, sitemap and CDN reflecting it. NFR-025 only covers speed. A takedown of a defamatory page can remain cached.
- Fix: Add an NFR with a number (e.g. unpublished content unreachable within 60 s at origin and CDN purged within 5 min; sitemap regenerated within 15 min) and a test.

### M11. Support-account lifecycle and governance gaps
- Where: FR-175, FR-181.
- Scenario: No offboarding SLA when an employee leaves, no periodic access recertification, no inactivity auto-expiry, no cap on number of gyms per person, no alerting on anomalous volume, no handling of a support person's phone or email change, no reason required for unassignment (FR-089 requires one for deactivation), and hard-delete of a person ("remove a person") orphans audit `actor_id`.
- Fix: Add: quarterly recertification, auto-disable after 30 days inactivity, mandatory reasons, soft-delete only with audit retention, and a documented contact-change flow.

### M12. Step 1 gate is too thin for the risk, and gate item 7 is not verifiable
- Where: 10.2 Step 1, Section 12 G.
- Scenario: Items 1..7 omit: opt-out vs in-flight, assignment races, MFA reset and enrollment abuse, audit identity-hiding tests (C5), denied-capability matrix (H8), cross-gym isolation in one session, the edge function path (H11), and suspended-gym behavior. "Retrofit complete" for "about 30 call sites" has no authoritative inventory, so completion cannot be verified, and bundling this retrofit in the same release as the support feature enlarges blast radius.
- Fix: Add a generated inventory and a failing CI check for any policy, RPC or function reading `app_role` or `gym_id` from the claim; add the missing test items to the gate; ship the retrofit as its own earlier release (addendum H already says it can ship alone).

### M13. Support-person gym assignment affects Owner-visible entitlements: staff counts and tier caps
- Where: FR-183, FR-086.
- Scenario: Excluding support from staff counts and role limits is a single flag. If the flag is wrong, set late, or a row is created before the flag is set (non-atomic), a support membership consumes a cap slot or gets counted in metrics and notifications. Conversely, a real staff member flagged by mistake disappears from counts and the Owner's list.
- Fix: Flag set in the same statement that creates the row (NOT NULL constraint, immutable by non-Super-Admin); test both directions.

---

## LOW

### L1. FR-171/FR-172 amendment wording
- Where: FR-172 vs FR-202. FR-172 says category "changes no behavior"; FR-202 introduces a filter and a public label. State it as "Amendment to FR-172" explicitly. Also category stuffing: Owner and Supervisor can edit it freely (FR-171) and now it affects public discovery; log and optionally restrict.

### L2. Missing "Amendment to" markers
- Where: FR-178 (to FR-126, FR-087/089), FR-186 (to FR-090, stated), FR-187 (FR-072, stated), FR-195 (FR-132 interplay). The document's own convention requires explicit amendment statements; several are implicit.

### L3. Language and acceptance ambiguity
- Where: FR-197 depends on OQ-28; FR-201 on OQ-29; FR-180 on OQ-30; FR-184 on OQ-27 ("TOTP enabled on production plan"). Four open questions block testability of the very FRs they sit under. Close or give defaults with explicit test values before stories.

### L4. Rename counter semantics
- Where: FR-195. "Twice a year" is not defined (calendar year vs rolling 12 months, and whether Super Admin forced renames count).

### L5. Generic and geographic names are first-come-first-served
- Where: FR-194/195. `gym`, `fitness`, `yoga`, `douala`, `cameroon`, `best-gym` can be claimed by one gym, with no fairness policy. Reserve a category and geography word list for Super Admin approval.

---

## Existing-FR conflicts (summary)
| New text | Conflicts with | Nature |
|---|---|---|
| FR-178 connect/replace Tara Money | FR-126 "Owner authorizes" | Unamended contradiction (C1) |
| FR-187 "FR-072 unchanged" + FR-178 | FR-072 reason-coded escalation | Bypass by assignment (H6) |
| FR-177 replace-binding behavior | FR-091 "new role replaces prior binding" | Support assignment can destroy a member binding (H7) |
| FR-175 own login | FR-001 one phone one user | Collision undefined (H7) |
| Support across many gyms | FR-003 single `gym_id` claim | Active-gym selection undefined (H7) |
| FR-198 hidden when suspended | FR-132 suspension never reveals billing | Response shape can leak state (M5) |
| FR-190 Supervisor/support publish | FR-195 Owner claims name | Contradiction (M6) |
| FR-181 removal without reason | FR-089 deactivation needs mandatory reason | Inconsistent (M11) |
| FR-202 category filter | FR-172 "descriptive only" | Needs explicit amendment (L1) |
