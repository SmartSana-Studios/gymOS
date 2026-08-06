# GymOS Privacy Policy (DRAFT)

**Status: draft for legal review — not yet published or linked from any store listing.**

This draft is grounded in what the GymOS codebase actually does (see
`docs/play-store-data-safety.md` for the underlying data inventory). Before
publishing: have it reviewed by counsel familiar with applicable data
protection law in the jurisdictions you operate in, fill in the bracketed
placeholders, and host it at a stable public URL.

---

_Last updated: [DATE]_

GymOS ("we", "us", "the App") is a gym management platform used by gym
staff and members. This policy explains what information GymOS collects,
why, and how it's handled.

## 1. Who this applies to

This policy covers the GymOS mobile app (member-facing) and the GymOS
dashboard (staff-facing web app). If you're a gym member, your gym is the
one that enrolled you — GymOS is the software platform your gym uses, not
a service you sign up for independently.

## 2. Information we collect

| Category | What | Why |
|---|---|---|
| Identity | Name, phone number, optional email, optional date of birth | Account creation, login (SMS one-time-code), identifying you at check-in |
| Profile | Profile photo | Displayed to gym staff for identification |
| Safety | Emergency contact (optional) | Provided to gym staff only in case of emergency |
| Fitness onboarding | Goal and experience level you select during onboarding | Personalizing your plan-confirmation experience |
| Attendance | Check-in and check-out timestamps at your gym | Gym occupancy tracking, your own attendance history |
| Payments | Payment amount, currency, method, and status | Billing and subscription management. **We do not store your card number or other raw payment credentials** — payments are processed by our payment partner, Notch Pay, who handles that data directly |
| Coach notes | Session notes written by your assigned coach (if your gym uses this feature) | Shared between you, your coach, and gym staff who need it for your training |
| Device | A push-notification token tied to your device | Delivering app notifications (subscription reminders, payment confirmations, etc.) via Expo's push notification service |

We do **not** collect: your location/GPS, your contacts, your browsing or
search history, or any audio/microphone data.

## 3. Who we share information with

- **Notch Pay** — our payment processor, to complete transactions you initiate
- **Expo** — our push notification infrastructure provider, to deliver notifications to your device
- **[SMS provider — Twilio]** — to send one-time login codes to your phone number
- **Your gym** — gym staff (owners, managers, coaches per their role) can see the information relevant to running your membership and training

We do not sell your information to third parties, and we do not share it
for advertising purposes.

## 4. How long we keep information

[NEEDS A DECISION: state your actual retention period — e.g., "for as long
as your membership is active, plus N years for financial/audit record
requirements," or reference your jurisdiction's record-keeping
requirements for gym/fitness businesses.]

## 5. Your choices

- You can update your language preference and some profile details yourself in the app.
- To request a correction or deletion of your information, contact your gym directly, or contact us at **[SUPPORT EMAIL]**. [NEEDS A DECISION: confirm the actual process — see the open question in `docs/play-store-data-safety.md` about whether deletion is a real automated flow or a manual request process.]

## 6. Children's privacy

GymOS is not directed at children under [AGE — confirm your gym's actual
minimum membership age] and we do not knowingly collect information from
children below that age.

## 7. Security

Information is transmitted using industry-standard encryption (HTTPS/TLS).
Access within the app is restricted by role — gym staff only see
information relevant to their role at their own gym.

## 8. Changes to this policy

We may update this policy from time to time. We'll update the "Last
updated" date above when we do.

## 9. Contact us

**[COMPANY NAME / LEGAL ENTITY]**
**[ADDRESS]**
**[SUPPORT EMAIL]**
