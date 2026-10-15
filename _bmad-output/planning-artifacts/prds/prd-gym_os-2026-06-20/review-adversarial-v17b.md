# Adversarial Re-review, second pass: PRD V1.7 (revised)

Scope: prd.md 1.3, 3.2, 4.5, UJ-12..14, 6.30 (FR-175..FR-195), 6.31 (FR-196..FR-208), 6.32 (FR-209..FR-214), NFR-023..026, Section 8, 10.2, Section 12; addendum.md G, H, I. Predecessor: review-adversarial-v17.md (written against the first draft; FR numbers there are the OLD numbers).

Verdict: Step 1 (support staff) is NOT ready for architecture. The first review's critical attack (support redirecting payments) is narrowed but not closed: first-time connection is unconfirmed, the Owner confirmation is unspecified, and the Super Admin AAL2 rollout has no enrollment or recovery path and is contradicted by addendum H. Steps 2 and 3 (landing, directory) are close: fix the cookie claim, the name-governance bottleneck and the cache/takedown mismatch, then they can proceed.

Counts: of 36 prior findings, 17 closed, 19 partially closed, 0 open (one open sub-item inside C5). New findings: 2 critical, 9 high, 9 medium, 5 low.

---

## Part 1. Disposition of prior findings

Old FR numbers are mapped to the revised ones. "Partial" lists the remaining attack.

| ID | Disposition | Addressed by | Remaining attack or gap |
|---|---|---|---|
| C1 payment redirect | Partial | FR-180 (replace needs Owner), FR-181 (notify, velocity), FR-183 (existing gyms off) | First connection where none exists needs no confirmation (N-C1). What the Owner confirms is unspecified (N-H1). FR-181 sends a daily summary, FR-180 says "notifies": inconsistent timing (N-H6). |
| C2 enrollment / reset | Partial | FR-176 (invite, one factor, AAL2 to add), FR-190 (reset), FR-191 (Super Admin AAL2) | Reset has no identity check, second approver or cooling-off; the "other channel" may not exist; invite interception and pre-assignment (N-H2). Super Admin rollout, first-factor enrollment and recovery undefined (N-C2). |
| C3 no dual control | Partial | FR-191 defers it to Section 8; blast radius cut by FR-180, FR-183 | Create/assign/reset still has no second approver and no alert to anyone; sole Super Admin compromise still gives a live support identity in every ON gym (new gyms are ON). Acceptable only if recorded as accepted risk and paired with an immutable alert to a named external contact. |
| C4 gym content on shared domain | Partial | FR-205, NFR-026, Section 12 F | "Host-only" does not stop cookie tossing; `__Host-` is not required; Supabase SSR default names do not use it; CSP vs framework inline hydration; fallback has no trigger (N-H8). |
| C5 hidden identity unenforceable | Partial | FR-186, FR-188, addendum H "review additions" | Closed surface list vs per-gym uuid columns (N-H3). C5(d): `log_audit_event` still listed "open and unrelated" in addendum I; not promoted to the gate. This sub-item is OPEN. |
| H1 in-flight vs revocation | Partial | FR-184, FR-192 | "Roll back atomically" is impossible for a provider call already sent; in-flight Tara payments across an account swap undefined (M-7). Rotate-credentials prompt softened to "review". |
| H2 assignment/opt-out race | Partial | FR-177, FR-183, addendum H states, OQ-30 | No lock between assign and toggle; reactivation skips re-checks; pending invisible to Owner (N-H5). OQ-30 still open. |
| H3 Owner can't tell states | Closed | FR-182 three states + last-acted time | Count deliberately hidden (accepted). Pending is not a stated state (see N-H5). |
| H4 accountability | Closed | FR-187 (disclosure request, 3 days, liability) | SLA is an assumption; liability terms in OQ-31. |
| H5 default ON retroactive | Closed | FR-183, 1.3, 10.2 pre-flight | Addendum H still says `default true` (N-H9). Members' notice sits in OQ-31. |
| H6 FR-072 bypass | Partial | FR-193 | "Cannot hold" is a flag, not an identity guarantee (N-H4). |
| H7 identity collisions | Partial | FR-175, FR-178, FR-193, FR-194 | Collision arising after assignment, evadable self-dealing check (M-8). No "Amendment to FR-091" marker. |
| H8 denied-capability prose | Closed | FR-179 allow-list + per-denial test | 4.5 still says "do what a Supervisor can do" (M-1). |
| H9 backdoor staff | Partial | FR-179, FR-181 (tag, flag on revocation) | Created staff survive revocation, only "flagged"; no Owner confirmation; tag is only on the Owner's list (M-9). |
| H10 session handling | Closed | FR-189 | Feasibility on Supabase unverified (M-3). |
| H11 service-role paths | Closed | FR-189, NFR-023, 10.2 item 8 | Gate item 2 lists support only; Super Admin AAL1 refusal not tested (M-2). |
| H12 name hijack/rename | Closed | FR-203 | New issues: permanent reservation, 301 caching (M-4, M-5). |
| H13 homograph/brand | Partial | FR-202 | Brand/credential word list has no owner or content; edit distance 1 on 3-char names holds nearly everything; no link to registered business name (M-4). |
| M1 gate evaluated once | Partial | FR-199 (re-evaluated each change) | Live vs snapshot not stated; post-publish edits go live unreviewed (accepted by FR-204 "no pre-moderation"), but public contact edits are unmonitored (M-6). |
| M2 projection list | Partial | FR-206, NFR-024 | Image URLs carry storage paths (gym id) against "no internal identifiers" (M-5b). |
| M3 image abuse | Closed | FR-205 | |
| M4 takedown | Closed | FR-204, UJ-14 | Appeal goes to the same Super Admin (L-3). |
| M5 suspension | Closed | FR-192, FR-207 | |
| M6 publisher identity | Closed | FR-198 | |
| M7 country/city | Closed | FR-209 | |
| M8 SEO | Partial | FR-208, FR-211, FR-212 | "Canonical addresses defined for filtered views" has no rule; category facets and schema type mapping for "Autre" unspecified; AI summary fields listed (good). |
| M9 phone/address privacy | Partial | FR-197 public contact + confirm screen, FR-207 | Cached/archived copies, legal basis in OQ-31 (open). |
| M10 "promptly" | Closed | FR-207 | Browser caching of 301 defeats it (M-5). |
| M11 support lifecycle | Partial | FR-185, FR-177 reasons | No cap on gyms per account; hard-delete vs audit actor_id not stated. |
| M12 gate too thin | Partial | 10.2 items 1-9 | Missing: FR-181 velocity lock, FR-190 reset, FR-193, FR-194, FR-185; Step 2 omits FR-202 and FR-205 tests (M-2). Retrofit now ships inside the support release rather than alone. |
| M13 flag atomicity | Closed | FR-178, FR-188 | |
| L1 FR-172 amendment | Closed | FR-213 | |
| L2 amendment markers | Partial | FR-180, FR-192, FR-193 have them | FR-178 changes FR-091 and invokes FR-087 with no marker; FR-203 touches FR-132 behavior with no marker. |
| L3 open questions block FRs | Partial | OQ-27 closed | OQ-28..OQ-31 still open; ~14 `[ASSUMPTION]` tags in Step 1/2 FRs. |
| L4 rename counter | Closed | FR-203 rolling 12 months | |
| L5 generic names | Closed | FR-202 | Creates the approval queue (M-4). |

Existing-FR conflicts:

| Conflict | Disposition |
|---|---|
| FR-178(old) vs FR-126 | Closed (FR-180 amends FR-126/127) |
| FR-072 bypass | Partial (FR-193; see N-H4) |
| FR-091 replace-binding | Partial (refused at assignment; no marker; later collision, M-8) |
| FR-001 one phone one user | Closed (FR-175) |
| FR-003 single gym_id | Closed (FR-194) |
| FR-132 vs hidden page | Closed (FR-207 same 404) |
| Publisher vs name claim | Closed (FR-198) |
| FR-089 mandatory reason | Closed (FR-177, FR-185) |
| FR-172 descriptive | Closed (FR-213) |

---

## Part 2. New findings

## CRITICAL

### N-C1. The "none connected" state bypasses the Owner confirmation, and it is exactly the state support is invited into
- Where: FR-180 ("connect ... where none is connected"; replacing needs Owner), FR-183 (ON for new gyms), UJ-12 (Idris connects Grace's account "himself" because none exists).
- Scenario: Every new gym is created ON with no connection. A rogue or phished support person connects an account they control as the gym's first Tara Money connection. No Owner approval, and notification is a daily summary (FR-181). Members then pay the attacker until the Owner notices. Same hole for any gym whose connection returns to "none" (Owner disconnect, expired or rejected credentials, a support-prepared "replace" that is implemented as disconnect then connect). FR-179 does not say whether support can disconnect; if it can, "replace" is two unconfirmed steps.
- Fix: Owner confirms every change of connection state including the first (the Owner sees the merchant identifier, FR below). Disconnect is Owner-only. Better, the Owner types or authorizes the credentials in their own session; support can only trigger the flow (the predecessor's C1a option, not adopted). If UJ-12's convenience must stay, require Owner confirmation on first connect too and say so in 4.5, UJ-12 and 10.2 item 4.

### N-C2. Super Admin AAL2: no enrollment path, a rollout lockout, no recovery, and addendum H says the opposite
- Where: FR-176 (adding a factor needs AAL2), FR-190 (reset needs Super Admin AAL2), FR-191, Section 8 (one Super Admin today), addendum H "AAL2" bullet.
- Scenario: (a) On deploy, every existing Super Admin session and password login is AAL1; FR-191 says no session works below AAL2, but no flow enrolls the Super Admin's first factor. The only Super Admin is locked out of the platform, including the tools needed to fix it. (b) If the first enrollment is permitted at AAL1 (Supabase allows it), anyone holding a stolen or lingering Super Admin AAL1 session enrolls their authenticator and owns the platform: the window is the time between deploy and the real Super Admin enrolling. (c) Authenticator lost: FR-190 requires a Super Admin at AAL2 to reset; with one Super Admin there is nobody. (d) Addendum H line 159 states the gate "treats a missing or aal1 value as no access for support memberships only (other roles are unchanged)", the direct opposite of FR-191, and an architect following the addendum ships a gate that never covers Super Admin. Also every Super Admin RPC, script and service-role tool needs the same check; 10.2 item 2 tests support only.
- Fix: Specify (1) an enrollment ceremony for Super Admin before the gate is switched on (enroll, verify, then enable, behind a flag), with a time-boxed window and existing sessions revoked at cutover; (2) a documented break-glass (out-of-band, two named people or a sealed recovery factor, audited) for loss of the sole Super Admin factor; (3) a test that every Super Admin RPC and tool refuses AAL1; (4) correct addendum H.

## HIGH

### N-H1. The Owner confirmation is a label, not a control: content, binding, expiry and approver are unspecified
- Where: FR-180, addendum H review additions (5), 4.5.
- Scenario: "Approves it in the dashboard" says nothing about what is shown. (a) If the Owner sees only "Approve payment account change", the attacker support person prepares a malicious replacement and simultaneously WhatsApps the Owner "please approve to fix payments": the Owner cannot tell it from a legitimate request, since every actor is "GymOS Support". (b) Time-of-check/time-of-use: support edits the prepared proposal after the Owner opens it, or prepares several and the Owner approves a stale one. (c) Proposal expiry exists only in the addendum ("a row with an expiry"), not in the PRD. (d) Pre-staging: support prepares proposals in advance; no limit on pending proposals. (e) If the Owner account is itself phished, the confirmation is worthless, but then the attacker holds the Owner role and needs no support.
- Fix: State in FR-180: the confirmation screen shows the masked current and new merchant identifiers, the time requested and expiry (e.g. 24 h), and the effect on member payments; approval binds to a hash of the exact proposal and any edit voids it; at most one open proposal per gym; approval requires a fresh Owner OTP; the Owner can reject, and rejection notifies Super Admin. Only the Owner role approves (not Supervisor).

### N-H2. Invite enrollment: the link is a bearer secret with no identity binding, and assignment can precede enrollment
- Where: FR-175, FR-176, FR-177, FR-190.
- Scenario: "A channel Super Admin has verified" has no meaning beyond Super Admin's say-so. Whoever opens the single-use link first enrolls their authenticator and is that person (mailbox compromise, SIM swap, forwarded message). Super Admin may assign gyms before the person enrolls (nothing forbids it), so the interceptor lands in live gyms with no further check. Link previewers (WhatsApp, email scanners) can consume a single-use link on a GET. FR-190's "notifies the person on their other channel": FR-175 requires only one phone or email, so there may be no other channel, and the reset invite goes to the very channel an attacker holds. No identity check, cooling-off or second approver is required for reset (C2c not adopted).
- Fix: Link consumption is a POST behind a confirm page; the link plus a one-time code sent over a second, separately registered channel; assignment refused until enrollment is complete and a Super Admin has confirmed the first sign-in; reset requires a recorded identity check and a delay (e.g. 24 h) with notification to a pre-registered second channel; require two channels at account creation.

### N-H3. Identity hiding fails on columns, not surfaces: the same user uuid appears in every `created_by`
- Where: FR-186 (closed list), addendum H (3).
- Scenario: The surface list names seven read paths. The real risk is any column or payload carrying the support user's uuid: `created_by`, `updated_by`, `recorded_by`, import batch owner, storage `owner`, `members` row id/user_id for the support membership, JWT `sub` echoed in realtime or exports, audit `actor_id`. Staff of any gym with SELECT on such a column (or a multi-gym Owner, or two colluding Owners) correlates the same uuid across gyms, defeating "a person's identity is not visible across the gyms". A new table added later has no test. C5(d) (`log_audit_event` callable by any authenticated session, so a support person or any staff can write misleading audit rows) is still parked as "not V1.7 scope" in addendum I.
- Fix: Require a per-gym opaque actor id (hash of user id and gym id, server-side) wherever a support action is attributed gym-side, and null or map `created_by`-style columns through a view; add a schema-wide test that fails when a new column referencing users.id is readable gym-side; move `log_audit_event` lockdown into the Step 1 gate.

### N-H4. FR-193 "Super Admin cannot hold a support account" is a flag check, not an identity rule
- Where: FR-193, FR-175, FR-141/NFR-020 (Super Admin promotion).
- Scenario: Enforcement can only be a constraint that one users row is not both flags. The sole Super Admin creates a second account with a different email ("one real person" is unverifiable by the system), assigns it, and reads member and payment data in any gym with no escalation reason: the bypass FR-193 exists to stop. Promotion paths (support to Super Admin, Super Admin to support) are not named.
- Fix: Either state the guarantee as organizational (a named other person creates any support account, impossible with one Super Admin) or compensate: support PII reads raise the same reason-coded audit as FR-072 and are reviewed monthly; make the exclusion mutual at promotion (NFR-020 extension) with a test; record the residual risk in Section 8.

### N-H5. Pending/suspended assignment states: unlocked race, invisible pending, reactivation without re-check
- Where: FR-177, FR-182, FR-183, OQ-30, addendum H (4).
- Scenario: (a) Race: Super Admin's assign reads `allow=true`; Owner switches off; assign commits as active. Result: an active membership in an off gym (the invariant in addendum H holds only if the setting row is locked in the same transaction, which is not stated). (b) FR-182's "on with no one assigned" is ambiguous when pending assignments exist; the Owner switches ON believing nobody is assigned, then Super Admin confirms several pending people: the Owner's single toggle becomes consent to unknown people, and "Super Admin confirms" is not Owner consent. (c) Suspended assignments reactivate on toggle-on months later without checking account state: person disabled for 30-day inactivity, MFA reset pending, recertification missed, or account locked. (d) Unassign during the suspended state, then toggle on: must not reactivate; no transition table exists in the PRD (only in the addendum).
- Fix: Put the state machine (pending, active, suspended, ended) and allowed transitions in FR-177 with the gym-row lock; reactivation re-runs every account check; FR-182 shows "N pending confirmation" as a state without identities, or the Owner is told at toggle-on that Super Admin can add people; test the concurrent assign/toggle.

### N-H6. Owner visibility is late and narrow: FR-180 vs FR-181 timing, and unmonitored high-value changes
- Where: FR-180, FR-181, FR-179.
- Scenario: FR-180 says every payment-connection change "notifies the Owner"; FR-181 says "a summary at least daily on days support acted". An implementer picks the daily summary; the Owner learns of a redirected payment up to a day late. Not covered by any notification: plan price changes, public contact change, staff creation beyond the tag, import of members, category change, support-initiated unpublish.
- Fix: Payment-connection changes and staff creation notify immediately (push and in-app); refunds and waivers batch daily; list the notified event set as an enumerated table with owner-facing text; add public contact and price changes to it.

### N-H7. Host-only cookies do not answer cookie tossing, and Supabase SSR does not give you `__Host-` for free
- Where: NFR-026, FR-205, addendum H (public-site security bullet), Section 12 F.
- Scenario: A sibling subdomain (any gym page, or a compromise of the wildcard `apps/landing` project that also serves `www.`) sets a cookie with `Domain=.gymosapps.com` carrying the Supabase auth cookie name; the browser sends it to `owner.` alongside or instead of the host-only one: session fixation or forced logout. Host-only protects reads, not writes. `__Host-` rejects domain-scoped cookies, but `@supabase/ssr` cookie names are derived from the project ref (`sb-<ref>-auth-token`, chunked `.0`, `.1`) and need `cookieOptions.name`/`storageKey` overridden plus `Secure`, `Path=/`, no `Domain`; the PRD only says "strictest prefix supported". If the dashboard keeps the session in localStorage (browser client), cookie scoping is moot and the claim is untestable. A strict CSP "with no inline script" conflicts with default Next.js hydration scripts (needs nonces), unchecked. "Separate domain fallback" has no trigger or owner.
- Fix: Make `__Host-` names a requirement with a named test (assert Set-Cookie attributes on owner and portal sign-in, and that a cookie set from a sibling subdomain does not change the session); state which client storage the dashboard uses; specify nonce-based CSP; define the fallback trigger (any failed header test blocks the Step 2 gate) and consider putting the wildcard on a separate registrable domain from the start, as UGC next to the staff login remains the single largest standing risk of Step 2.

### N-H8. Addendum H and G contradict the PRD or point to deleted text
- Where: addendum.md lines 149, 155, 157, 159.
- Scenario: (a) Line 159: AAL2 gate for support only (see N-C2). (b) Line 157: `allow_gymos_support boolean not null default true`: `ADD COLUMN ... DEFAULT true` backfills every existing production gym to ON, defeating FR-183 and the V1.6 precedent addendum G itself spells out (line 143: false for existing rows). (c) Line 155 "FR-175–FR-188" (support is FR-175–FR-195); line 157 cites "(FR-183, FR-179)" for the exclusion flag and staff-list row, which are now FR-188 and FR-182. (d) Line 149 says name rules are "in PRD Section 12 F"; they are now FR-202/FR-203 and Section 12 F no longer holds them.
- Fix: Correct each; make (b) an explicit migration instruction ("add with default false, then set default true for new rows") and a gate test on a pre-release database snapshot.

### N-H9. Velocity limit counts too little, per account only, and locks account-wide
- Where: FR-181, FR-179.
- Scenario: The limit covers "payment-connection or refund-over-threshold" actions; the threshold is undefined, so refunds just below it are unlimited. Waivers, price edits, public-contact edits, member imports and staff creation are not counted. The limit is per support account across gyms, not per gym: five accounts (or one Super Admin creating five) each do 3 per hour against one gym. A fixed hour window can be doubled across the boundary. A lock is account-wide, so one busy onboarding day (import corrections, refund batches) freezes the person in every gym. Note: refunds are ledger records until provider refunds ship (Section 8, V2.0), so the money risk is mainly connection change; the limits are mostly integrity controls.
- Fix: Count all FR-179 write categories with per-category limits, add a per-gym ceiling across all support accounts, use a sliding window, define the refund threshold in the PRD, and make the lock step down to read-only for the gym in question first.

## MEDIUM

### M-1. 4.5 "Do what a Supervisor can do" contradicts FR-179 "the allow-list is the specification"
Support row in 4.5 inherits all Supervisor powers (including FR-089 edit/deactivate of Managers and Receptionists, which FR-179 does not list). A story author reads 4.5; a test author reads FR-179. Fix: state that Supervisor baseline powers are included only where FR-179 names them, or list "plus everything a Supervisor can do except the denied set" and enumerate the denied set only; do not keep both.

### M-2. Step 1 and Step 2 gates omit several FRs
10.2 Step 1 has no item for FR-181's velocity lock, FR-185 (auto-disable, recertification), FR-190 (reset invalidates sessions), FR-193, FR-194 (active-gym context, no cross-gym request), FR-195, nor a Super Admin AAL1 refusal across all Super Admin RPCs. Step 2 lists "FR-196–FR-208" but its done criteria omit FR-202 (near-match hold, homoglyph), FR-205 (text-only, re-encode, metadata strip, cookieless origin, purge) and FR-204 (report intake). Fix: one gate item per FR family with a named test.

### M-3. FR-189 specifics may not be implementable as written on Supabase
"MFA verified within the last 5 minutes" requires reading the `amr` timestamp from the JWT and re-verifying through a new AAL2 session; "8 hours and 15 minutes idle" depends on Supabase session timebox and inactivity settings (plan-gated); "repeated wrong codes lock the account" is not a built-in account lock. Fix: add a feasibility spike to the pre-flight (next to the TOTP enablement check), or define the fallback (application-level session table and a lockout counter in the database).

### M-4. Name governance creates a bottleneck and permanent loss of good names
FR-202/203: names reserved to a gym forever; no release for a churned or deleted gym; each gym can accrue two reserved names a year permanently. Held names (near-match, generic words, brand words) wait on a Super Admin queue with no SLA, and with one Super Admin that is a single person. Edit distance 1 on a 3-character name holds almost any other 3-4 character name; folding (hyphen/digit) holds `fit-zone` vs `fitzone` legitimately. The brand/credential word list has no owner and no content. Name is not tied to the registered business name, so a gym can claim a well-known local brand that is not on the platform. A competitor can claim and hold (reserved forever) a likely target's name. Fix: release names after N months of gym churn or on Super Admin release; approval SLA (e.g. 2 business days) with automatic rejection message; distance rule scaled by length; named list owner and file location; require the name to contain a recognizable part of the registered gym name or go to approval.

### M-5. Redirect and takedown vs browser caching, and image URLs against "no internal identifiers"
(a) FR-203 uses a 301; browsers and crawlers cache it indefinitely, so FR-207's 60 s/5 min times and "redirects dropped immediately on takedown" do not hold for returning visitors. Use 302/307 or 301 with short max-age and state the cache headers. (b) FR-206 forbids internal identifiers, but gallery and logo URLs on the separate origin typically contain the storage path `gym_id/...`. Fix: content-hash object names; test the projection output for uuid patterns.

### M-6. Public contact and address hijack by anyone who can edit content
FR-179 and FR-198 let support, Supervisor and Owner edit the public contact and plan prices; changing the WhatsApp number redirects every inbound prospect to a different phone (lead theft, phishing). Not in FR-181's notified set and not Owner-confirm. Fix: public contact change notifies the Owner immediately and is shown in the audit as a distinct event; optional Owner confirmation for support-initiated change.

### M-7. FR-184 "roll back atomically" and payment cutover are undefined
A Tara request already sent cannot roll back. Payments initiated against the old account whose webhook arrives after an approved swap break NFR-019 (settlement account verifiable against connected credentials). Fix: define a cutover rule: new payments use the new account from approval time; webhooks for payments created earlier reconcile against the connection that was active at creation; pending items left as "needs review".

### M-8. Identity collision after assignment, and weak self-dealing check
FR-178 refuses assignment when the person is already in the gym. Later, gym staff adding a member with the support account's phone number (it is a GymOS number, so unlikely but possible by guess or leak) triggers FR-091 "a new role replaces the prior binding", silently ending support or turning the person into a member. FR-193's "own phone or email" test is evaded by a spouse's number. Fix: block member and staff creation for any phone belonging to a support account (generic error); state FR-193 as best effort and rely on audit review.

### M-9. Support-created staff persist after revocation
FR-181 only flags them; a Manager created with an attacker's phone keeps recording payments (Manager scope) after support is revoked. The Owner sees a tag and a prompt. Fix: on revocation, support-created staff are suspended pending Owner confirmation; creation of staff by support requires Owner confirmation for roles that can record payments.

## LOW

### L-1. UJ-14 contradicts FR-202
The page `gymos-pay` cannot exist (reserved prefix `gymos`), yet UJ-14 says it was reported and a different spelling "the rule did not catch". Rewrite with a name that actually evades folding (`gyrnos-pay`, rn for m is distance 2).

### L-2. Account-wide lock as a denial of service
One support account locked by a noisy day cannot help any gym; there is no on-call alternate rule. Covered partly in N-H9.

### L-3. Appeal goes to the same Super Admin who took the page down; report form has no abuse controls
FR-204: add a second reviewer when available and rate limit and captcha the unauthenticated report form (addendum I already lists unauthenticated cost-bearing endpoints as an open class).

### L-4. Stale references outside the PRD
`review-rubric-v17.md` and `.memlog.md` still use the old FR numbers; a reader may mistake them for current. Mark them historical or renumber. `docs/decisions.md` already records the renumbering.

### L-5. Self-unpublish can be triggered by anyone with edit rights
FR-199: flipping the last public plan to private (or archiving it) unpublishes and delists a gym; a Supervisor or support person can do this by accident or in anger. Add Owner notification (already present) and a one-step restore; consider requiring a confirm when the action would unpublish.

---

## Internal consistency check (1.3, 4.5, 6.30, 10.2, Section 12)

- 1.3, 4.5, 10.2 and Section 12 agree on: order of delivery, AAL2 for support and Super Admin, existing gyms OFF and new gyms ON, Owner confirmation for replacement. All four share the N-C1 gap (replacement only).
- 1.3 says FR-189-FR-191 is the second-factor gate; FR-190 is a reset FR and FR-191 the Super Admin rule: fine, but 10.2 item 2 tests only support.
- 4.5 Super Admin row cites FR-190, FR-202-FR-204 correctly; 4.5 Owner row omits the disclosure request (FR-187) and "pending" visibility.
- Section 12 G assumption table omits FR-181's refund threshold (undefined) and FR-185 inactivity is listed; 3.2 safety metric (line 143) says "outside an active assignment" but pending/suspended are not defined normatively.
- Section 8 records dual control as "later" (FR-191) while FR-190/FR-191 assume a reviewer exists for reset; with one Super Admin FR-190 has no independent check.
- Renumbering: no stale ranges inside the PRD body found; stale ranges are in addendum H and G (N-H8) and in the review/memlog files (L-4).
