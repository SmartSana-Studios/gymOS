# Adversarial Re-check, third pass: PRD V1.7 (third revision)

Scope: only the findings of review-adversarial-v17b.md (N-C1, N-C2, N-H1..N-H9 and the mediums on names, redirects, cookies, FR-189, UJ-14/FR-202, addendum drift), then new problems introduced by this revision. FR numbers are the current ones.

Verdict: Step 1 is ready for architecture **with conditions**. The redirect-payments critical is closed. Three conditions must be recorded before story creation: (1) a real design for Super Admin factor recovery and reset (FR-191), (2) a precise FR-180 proposal/hash contract, (3) a payment cutover rule (M-7). Steps 2 and 3 are unchanged in readiness.

Counts (23 items checked): closed 3, partially closed 14, still open 6.

---

## Part 1. Disposition

| ID | Disposition | FR cite | Remaining attack or gap |
|---|---|---|---|
| N-C1 first connection unconfirmed | Closed | FR-180 ("connecting or replacing ... always"), FR-179 (support only "prepares"), 10.2 item 4 | None for connect. Disconnect is not on the FR-179 allow-list so it is denied by default; say so in one sentence for the test author. |
| N-C2 Super Admin AAL2 bootstrap/recovery | Partial | FR-191, 10.2 pre-flight, addendum H AAL2 bullet | Drift fixed and ordering (enroll, verify, then flag) is now stated. Still open: the AAL1 enrollment window before cutover is "controlled" with no mechanism (stolen AAL1 session can enroll first); recovery codes are not a native Supabase TOTP feature so they are a custom AAL2 bypass; "out-of-band reset by the platform owner" has no controls; no rule resets a Super Admin's own factor (FR-190 covers support only). See NF-1. No test that every Super Admin RPC/tool refuses AAL1. |
| N-H1 Owner confirmation content | Partial | FR-180 | Closed: masked old/new identifiers, who/when, hash binding, 24 h expiry, one open proposal, immediate notice. Remaining: no fresh Owner re-auth at approval, no explicit reject action, and an attacker support person can still pair a proposal with a "please approve" message since the Owner cannot verify the merchant belongs to them (NF-2). Addendum hashes a "credential reference", FR hashes "the exact proposal": inconsistent. |
| N-H2 invite interception, pre-assignment | Partial | FR-175, FR-176, FR-177, FR-190 | Pre-assignment closed (pending until enrolled and Super Admin confirms; both channels required). Remaining: link consumption by GET/previewers not addressed; "must also pass the sign-in for it" does not say what second input binds the link holder to the person; the first factor is still one channel, so a captured channel plus a reset invite gives both factors (NF-3). |
| N-H3 identity hiding by column | Partial | FR-186, addendum H (7) | Opaque per-gym attribution ids adopted. Remaining: tests are "per surface", not a schema-wide check that fails on any new users.id-referencing column readable gym-side; FK/typing conflict with existing `created_by` columns (NF-6). |
| N-H4 FR-193 flag vs identity | Open | FR-193 | Check matches phone, email and "linked identity" only. The sole Super Admin creates a second account under another email/number and is a support person in every ON gym, reading PII with no escalation reason. No organizational guarantee, no compensating review, no mutual promotion block (NFR-020). |
| N-H5 pending/suspended race, re-check | Partial | FR-177, FR-182, FR-183 | Serialized lock and the "waiting for GymOS to confirm" state are in. Remaining: reactivation on toggle-on re-runs no account checks (disabled for inactivity FR-185, lock, missed recertification, reset in progress); transitions (suspended then unassign, then toggle on) are not a PRD table; glossary "Pending assignment" still defines only the switch-off case. |
| N-H6 owner visibility timing | Partial | FR-180, FR-181 | Payment changes now immediate. Staff creation/edit, public contact and about edits, refunds and waivers are daily summary only; plan price edits and member imports are in no notification. Staff creation is the backdoor path (M-9), so a day's lag matters. |
| N-H7 cookie tossing, `__Host-`, CSP, fallback | Partial | NFR-026, Section 12 F, addendum H public-site bullet | `__Host-` now required. Remaining: nothing says the Supabase SSR cookie name must be overridden to carry the prefix (default names do not), or where the dashboard keeps the session (localStorage makes cookie scoping moot); no named test that a sibling-set domain cookie cannot change the session; "no inline script" CSP vs Next.js hydration (nonces) unaddressed; fallback has no trigger or owner. |
| N-H8 addendum drift | Partial | addendum G line 149, H | Fixed: H AAL2 now includes Super Admin, default `false` for existing rows, FR range FR-175-FR-195, FR-182/FR-188 cites. Still stale: addendum G V1.7 subdomain notes say name rules are "in PRD Section 12 F"; they are FR-202/FR-203 and Section 12 F no longer holds them. |
| N-H9 velocity limit | Partial | FR-181, Section 12 G | Now per gym and per account, refund threshold dropped, waivers/staff/proposals/assignments counted. Remaining: window type unstated (fixed windows double at the boundary); lock is account-wide so a busy onboarding day freezes the person everywhere; price, contact and import edits uncounted; "assignments" are Super Admin actions, not support actions (confusing scope). |
| C5(d) `log_audit_event` callable by any authenticated session | Open | addendum I "open and unrelated" | Still parked outside the gate. Any gym staff or support session can write audit rows with misleading content, undermining FR-187 and the disclosure request. |
| M-1 4.5 "Supervisor can do" vs allow-list | Partial | FR-179, 4.5 line 222 | FR-179 now says "Beyond what a Supervisor can do" yet also "the allow-list is the specification" and "cannot reach any capability not on this list". Two inconsistent models: inherited baseline or enumerated list. Pick one. |
| M-2 gate coverage | Partial | 10.2 items 10-11 | Added: reset, bootstrap, FR-193, velocity, serialization. Still missing from Step 1: FR-185, FR-194, FR-195, Super Admin RPCs refuse AAL1. Step 2 omits FR-202 (hold/fold), FR-203 (rename/redirect/release), FR-204 intake, FR-205 (re-encode, strip, purge) tests. 10.2 item 3 says "three states", FR-182 now has four. |
| M-3 FR-189 feasibility | Partial | FR-189 | Session limits now application-enforced (closes plan-gating). "Verified within 5 minutes" still needs the `amr` timestamp read; "repeated wrong codes lock the account" is undefined threshold/lock mechanism; no spike in pre-flight. |
| M-4 name governance | Partial | FR-202, FR-203, addendum J | Added: 2 business day decision, Super Admin-maintained tables, seed lists, 12 month release for unpublished. Remaining: distance-1 rule not scaled by length; Super Admin is a single-person queue; no tie to the registered business name; generic words held only "when the name is" such a word (exact vs contained is unstated, see L-1); re-claim after release has no limit (NF-5). |
| M-5 redirect caching / image URLs | Closed | FR-203 (cache <= 5 min), FR-205 (opaque addresses) | Adequate. Add a uuid-pattern assertion to the projection test (FR-206). |
| M-6 public contact hijack | Partial | FR-181 | Public contact and about edits are in the daily summary; still no immediate notice or Owner confirmation for a support-initiated WhatsApp number change (lead theft). |
| M-7 in-flight payments at cutover | Open | FR-184 | Still "complete or roll back atomically"; no rule for a provider request already sent or a webhook arriving after an approved swap (NFR-019). |
| M-8 collision after assignment, weak self-dealing | Open | FR-178, FR-193 | Gym staff adding a member/staff with a support account's phone triggers FR-091 replace-binding; no block. Self-dealing check by own phone/email only (a relative's number evades). |
| M-9 support-created staff survive revocation | Open | FR-181 | Only tagged and flagged; a created Manager keeps recording payments after the support person is revoked until the Owner acts. |
| L-1 UJ-14 vs FR-202 | Closed | UJ-14, FR-202 | `getgymfit` now evades by being a clean name, and the about-text lures. Note: it contains generic words `gym`, `fit`; if "held" means containment it would have been held. Say "exact match" in FR-202 so the story is true. |
| L-3 appeal to same Super Admin, report form abuse | Open | FR-204 | Unchanged: appeal path goes to the same decider; unauthenticated report form has no rate limit or captcha. |

---

## Part 2. New findings (introduced or exposed by this revision)

### HIGH

**NF-1. Super Admin recovery and reset is the new backdoor, and "recovery codes" is not a platform feature (FR-191, FR-190)**
- Scenario: FR-191 says recovery codes are issued at enrollment and the last resort is "a documented out-of-band reset by the platform owner, audited". (a) Supabase TOTP has no recovery codes; they must be a custom construct that satisfies AAL2, i.e. a purpose-built bypass of the very gate, stored by one person. (b) The platform owner and the sole Super Admin are the same human, and the reset is performed with service-role access that no AAL2 check covers; the audit record is written by the actor who performs it. Whoever obtains that access (stolen laptop, CLI token) resets the Super Admin factor and then creates and assigns support accounts. (c) FR-190 resets a *support* person's factor; nothing defines resetting a Super Admin's own factor or enrolling a second Super Admin. (d) "Controlled pre-flight step" has no mechanism: enrollment must be done by a one-time script or while all other Super Admin sessions are revoked, else a stolen AAL1 session can enroll first.
- Fix: Replace recovery codes with a sealed hardware-backed second TOTP factor (Supabase supports multiple factors) or an offline sealed secret held by a second named person; specify the break-glass as: service-role action requiring two people or a time-delayed (e.g. 24 h) action with immediate alert to an external contact; specify Super Admin factor reset and second Super Admin onboarding explicitly; cutover revokes all Super Admin sessions; add the "every Super Admin RPC and tool refuses AAL1" test.

**NF-2. FR-180 proof is "what support shows the Owner": the Owner cannot verify the merchant is theirs, and the hash contract is unclear**
- Scenario: The confirmation displays masked identifiers and "GymOS Support". Grace is told by WhatsApp, as in UJ-12, to approve; the attacker uses a Tara Money account with a similar masked ending. The Owner has no independent check that the proposed merchant account is hers. Separately: FR-180 binds the approval to "a hash of that exact proposal" while addendum H hashes "the proposed credential reference": if the hash omits the current connection state or the gym/proposal id, an approval can apply after the connection changed in between; the pending secret's custody (Vault slot) and cleanup on expiry or reject are unspecified, so a rejected attacker credential remains stored; approval needs no fresh Owner authentication; no reject action exists, so a suspicious Owner has no way to signal.
- Fix: FR-180 states the hash input (gym id, proposal id, current connection version, proposed merchant id, credential reference, expiry); approval requires a fresh Owner OTP and applies only if current version is unchanged; reject exists and alerts Super Admin; pending secrets are deleted on expiry/reject/revocation of the preparer; the confirmation shows the provider-side merchant name from a provider lookup where available, and the Owner is told "GymOS will never ask you to approve this by message".

### MEDIUM

**NF-3. FR-190 cooling-off is short, notice-only, and rests on a single-channel first factor**
- Scenario: Reset invites go to "a channel Super Admin has verified" and the attacker who owns that channel (SIM swap or mailbox) also owns the first factor; the 30-minute window is shorter than a sleeping person's response time, and "recorded identity check" has no standard (who, what evidence). The person can cancel, but so can anyone holding either channel (denial of service on a legitimate reset). FR-185 lets Super Admin change a person's phone or email at AAL2 with no notice to the old channel and no cooling-off, which bypasses FR-190 entirely.
- Fix: cooling-off of at least 24 h for support accounts (shorter only with Super Admin identity check by a second person); a contact change triggers the same notice and delay as a reset; the reset invite is delivered to the *other* channel than the sign-in channel; define the identity check as a named checklist.

**NF-4. Super Admin sessions have no timeout, step-up or velocity limit, yet Super Admin is the most powerful actor**
- Scenario: FR-189 gives support 8 h/15 min idle and 5-minute step-up; FR-191 gives Super Admin only AAL2. A stolen AAL2 Super Admin session (one factor verified days ago, still refreshing) creates, assigns and resets support accounts at will. FR-181's velocity limit does not count Super Admin actions despite listing "assignments".
- Fix: apply the FR-189 timeouts and step-up to create/assign/reset/takedown; count Super Admin create/assign/reset in an alert threshold with an external notification.

**NF-5. FR-203 name release rule is squattable and snipeable**
- Scenario: (a) Creating a gym is cheap; claiming a name needs no publish; a squatter holds N desirable names across N gyms for 12 months, then re-claims on release with no cooldown. (b) After a rename the old name redirects for 12 months, then is released: any other gym can then claim it and inherit inbound links, QR codes and search equity from the original gym, including lookalikes of a real business. (c) Renaming into a name held for approval has no stated behavior (page dark? old name kept?). (d) Takedown names are "never released" with no appeal-linked unlock.
- Fix: name claim requires a complete publish gate or a verified Owner phone and a per-Owner cap; released names are quarantined (e.g. 12 further months, Super Admin approval) before reuse; a held rename keeps the current name live until decided; lift of takedown releases the reservation rule.

**NF-6. Per-gym opaque attribution (FR-186) conflicts with existing columns**
- Scenario: Existing `created_by`, `recorded_by` and similar columns are `uuid references users(id)`. Storing an opaque id there breaks the foreign key and every join; leaving the user id breaks FR-186. The architect will pick one silently. Addendum H (3) hides membership rows by views, but `members.user_id` for the support membership remains the platform user id in the same table.
- Fix: state the design choice in the PRD: either a per-gym shadow `users` row per assignment (opaque auth-less identity) with a Super Admin-only mapping, or a `display_actor` view for all attribution columns plus a schema-wide test; require the test to cover any column referencing users.id.

**NF-7. Remaining internal contradictions between FR text, gate, Section 12 and addendum**
- 10.2 item 3 says "the three states", FR-182 defines four (off, on none, on assigned, on waiting).
- Glossary "Pending assignment" says only "made while switch is off"; FR-177 also makes not-yet-enrolled assignments pending.
- Section 12 G velocity assumption mentions "assignments" among support actions while FR-177 makes them Super Admin actions.
- FR-179 inherits Supervisor baseline but also says the allow-list is exhaustive (M-1).
- Addendum G still says name rules are in Section 12 F.
- Fix: one-pass edit of the four places.

### LOW

**NF-8. FR-185 auto-disable interacts badly with FR-183 suspension.** A support person assigned only to gyms that are switched off is inactive 30 days, is disabled account-wide, and reactivation of a gym later finds no usable account; recertification is quarterly with no owner. Fix: inactivity counts only gyms with an active assignment, and reactivation checks account state (N-H5).

---

## Top remaining issues

1. NF-1 / N-C2: Super Admin recovery and reset design (recovery codes are not native; break-glass is an unaudited-by-others bypass).
2. NF-2 / N-H1: FR-180 contract: hash inputs, fresh Owner auth, reject, secret cleanup, Owner-verifiable merchant identity.
3. M-7: payment cutover rule for in-flight requests and late webhooks.
4. N-H4 / M-9 / M-8: self-dealing and persistence paths (second Super Admin-held support account; support-created staff survive revocation; member-add collision with a support phone).
5. N-H7 / C5(d): cookie-name override and tossing test; `log_audit_event` lock-down still outside the gate.
