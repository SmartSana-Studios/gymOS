# GymOS Terms of Service (DRAFT)

**Status: draft for legal review — not yet published or linked from any app,
store listing, or dashboard sign-up flow.**

This draft is grounded in what the GymOS codebase actually does — see
`docs/privacy-policy.md` (also draft) for the companion data-handling
document and `docs/play-store-data-safety.md` for the underlying data
inventory. Before publishing: have it reviewed by counsel familiar with
applicable consumer-contract and payments law in the jurisdictions you
operate in, fill in the bracketed placeholders, and host it at a stable
public URL linked from both the dashboard sign-up flow and the mobile app's
onboarding.

---

_Last updated: [DATE]_

These Terms of Service ("Terms") govern use of GymOS (the "App," the
"Service"), a gym management platform. By creating an account, enrolling as
a member of a gym that uses GymOS, or using the GymOS dashboard as gym
staff, you agree to these Terms.

## 1. Who this applies to

GymOS is used by two distinct kinds of accounts:

- **Gym staff** (Owner, Manager, Supervisor, Coach) — use the GymOS
  dashboard to run their gym: manage members, staff, classes, payments,
  and workout plans.
- **Members** — use the GymOS mobile app. A member does not sign up for
  GymOS independently; they are enrolled by a gym that has already
  subscribed to the Service. Your relationship for billing, membership
  terms, and cancellation is with **your gym**, not with GymOS directly,
  except where this document says otherwise (e.g. Section 4's SaaS billing
  relationship between a gym and GymOS).

## 2. Accounts

- Accounts are created via phone-number verification (one-time SMS/WhatsApp
  code). You're responsible for keeping access to that phone number secure.
- One gym-level Owner per gym is supported today; the Owner is responsible
  for the actions of the staff they invite (Managers, Supervisors, Coaches).
- Staff role changes (promotion, demotion, deactivation) take effect
  immediately, including forced logout of an affected account — this is a
  security control, not a punitive measure, and is disclosed here so it
  isn't a surprise.

## 3. Member subscriptions and payments (gym → member)

- A member's subscription (plan, price, billing cadence) is set by their
  gym, not by GymOS.
- Payments are processed through GymOS's payment partner, **Tara Money**.
  GymOS does not store your card or mobile-money credentials — Tara Money
  handles that data directly, and GymOS only records the resulting
  transaction (amount, currency, method, status).
- [NEEDS A DECISION: state your actual refund policy — does a gym set its
  own, or does GymOS impose a platform-wide floor? Confirm against how
  refunds are actually implemented (`refunds` table, staff-initiated) before
  publishing.]
- Failed or overdue payments may result in account suspension per your
  gym's configured grace period; GymOS surfaces payment-due reminders and a
  pay-now flow but does not independently decide suspension terms beyond
  what your gym's subscription configuration specifies.

## 4. Gym subscriptions to GymOS (GymOS → gym)

- A gym's own subscription to the GymOS platform (tier, billing cycle) is a
  separate commercial relationship between the gym's Owner and GymOS.
- Tier changes take effect at the next billing cycle; GymOS does not
  prorate mid-cycle changes.
- [NEEDS A DECISION: state cancellation terms, what happens to member data
  and access on a gym's own subscription lapsing/suspension, and any
  minimum commitment period.]

## 5. Acceptable use

You agree not to:

- Use the Service to harass, discriminate against, or endanger any person.
- Attempt to access data, gyms, or accounts you're not authorized to access.
- Circumvent or interfere with the Service's security controls, rate
  limits, or authentication mechanisms.
- Use the Service for any purpose that violates applicable law.

GymOS may suspend or terminate accounts that violate this section.

## 6. Coach-authored content and session notes

Workout plans, exercise assignments, and session notes created by a coach
are shared with the member they're written for (and with that gym's
authorized staff) as part of the Service's core functionality. See
`docs/privacy-policy.md` for how this data is handled and who can see it.

## 7. Disclaimers

- GymOS is a management and communication platform. It does not provide
  medical, fitness, or nutritional advice, and workout plans or progress
  data logged through the Service are not a substitute for professional
  guidance.
- The Service is provided "as is." [NEEDS A DECISION: standard liability
  limitation / warranty disclaimer language, reviewed by counsel —
  intentionally left unwritten here rather than guessed at.]

## 8. Termination

- A gym's Owner may close their gym's account at any time; member access
  ends per the gym's own notice to its members.
- GymOS may suspend or terminate access for Terms violations, non-payment
  of a gym's own platform subscription, or as required by law.

## 9. Changes to these Terms

We may update these Terms from time to time. We'll update the "Last
updated" date above when we do, and — [NEEDS A DECISION: confirm the actual
notice mechanism, e.g. in-app banner, email, before publishing].

## 10. Governing law

[NEEDS A DECISION: jurisdiction and governing law — should match the legal
entity's actual jurisdiction, filled in alongside `docs/privacy-policy.md`'s
matching placeholder.]

## 11. Contact us

**[COMPANY NAME / LEGAL ENTITY]**
**[ADDRESS]**
**[SUPPORT EMAIL]**
