# V1.8 UX additions: Admin Dashboard and Coach Portal (working draft)

> Working file, not part of the contract until spliced. Text only: no mock-ups, no wireframe files. Source of truth for what to splice into `EXPERIENCE.md` (and, if any, `DESIGN.md`). Nothing in `DESIGN.md` or `EXPERIENCE.md` has been edited.
>
> **Scope.** Admin Dashboard and Coach Portal only (Epics 27, 28, 29, and the settings story of Epic 31 for the gym challenge). Member App screens (ring, calendar, leaderboard, challenge card, "Pay for your session" copy) are drafted elsewhere. Epic 31 has no numbered stories in `epics.md` yet (stories pending, 2026-11-15), so "31.7 and 31.8" could not be read; the gym challenge settings section is drafted from FR-234 and Architecture Decision AD-61 and tagged Could.
>
> **Sources read.** DESIGN.md (all); EXPERIENCE.md Foundation, Surface Index, Admin IA, Sidebar, Voice and Tone, AD-04, AD-09, AD-11, AD-12, AD-13, AD-14, AD-15, AD-18, AD-19, AD-20, AD-21, AD-22, AD-23, AD-24 to AD-26, "V1.7 amendments", Cross-Cutting Components (alert panel, Record Session Payment Panel, Inline Renewal Panel, Support Identity Rule, SA-21), Form Validation, Empty States, V1.7 State Patterns, Interaction Primitives (Admin), Accessibility Floor (Admin), Responsive (Admin), Flows 10, 12 to 15; PRD 4.6, UJ-16, UJ-17, FR-234, FR-236 to FR-251, OQ-34 to OQ-36; the 2026-11-15 gym feedback; Epics 27 to 31 (epic level); Architecture Decisions AD-55 to AD-59, AD-61.
>
> **Conventions in this file.** `[ASSUMPTION]` marks an inference the sources do not state. `[NOTE FOR UX]` marks an open design question. `[CONFLICT]` marks a line of the existing contract that a V1.8 block changes. Every spliceable block sits between `<!-- BEGIN BLOCK n -->` and `<!-- END BLOCK n -->` and starts with one `INSERT AFTER:` or `APPEND TO SECTION:` line naming the existing heading (or paragraph) exactly. Strings carry an i18n key in a code span (`area.key`); the authoritative EN/FR pair for every key is the catalog in Block 4. Where a screen quotes EN inline, it is a copy of the catalog line; if they differ the catalog wins. Key names are `[ASSUMPTION]`: final names are set in each story, but EN and FR counts must match (existing rule).
>
> **Design stance (simplicity first).** One new modal for staff check-in, one for Correct plan, one read-only picker bar. Everything else reuses what exists: the Record Session Payment Panel, the Inline Renewal Panel, the status badges, the neutral "who did it" pill from AD-16, the muted-row treatment from AD-04 Sessions, the V1.6 per-section save pattern, the AD-24 role rendering rule (absent from the DOM, not disabled).

## Splice map

| Block | Content | Target |
|---|---|---|
| 1 | Surface Index rows, namespace note, Min Role edits | Surface Index, Admin Dashboard table |
| 2 | Admin IA additions | `### Admin Dashboard IA` |
| 3 | Sidebar and role-visibility tables | `### Admin Dashboard — Sidebar` |
| 4 | Voice and Tone: tone rows, vocabulary, full EN/FR string catalog | `## Voice and Tone` |
| 5 | New screens AD-30 (Check in a member), AD-31 (Correct plan), AD-32 (Coach picker) | after the V1.7 amendments section |
| 6 | Amendments to AD-04, AD-11, AD-12, AD-13, AD-14, AD-15, AD-18, AD-19, AD-20, AD-21, AD-22, AD-23 | each screen's own section |
| 7 | Form validation tables | `## Form Validation Rules` |
| 8 | Empty states and V1.8 state patterns | `## State Patterns` |
| 9 | Interaction, accessibility and responsive rows | `## Interaction Primitives`, `## Accessibility Floor`, `## Responsive & Platform Behaviour` |
| 10 | Key Flows 17 and 18 (UJ-16, UJ-17) | after Flow 15 |
| 11 | DESIGN.md additions | none needed (see block) |
| 12 | Open questions index | not spliced (hand-off list) |

---

<!-- BEGIN BLOCK 1 -->

## BLOCK 1 · Surface Index

**1a.** INSERT AFTER: the paragraph beginning `> **ID namespace note *(V1.7)*.**` (in `## Surface Index — All Screens`)

> **ID namespace note *(V1.8)*.** V1.8 adds Admin Dashboard screens **AD-30, AD-31 and AD-32**. Architecture Decisions AD-30 to AD-32 also exist (the architecture spine now runs AD-1 to AD-61), so the rule stands: "Architecture Decision AD-nn" is always spelled out, and a bare `AD-nn` is a screen. No Member App or Super Admin ids are added by this block. Existing ids are not renumbered.

**1b.** APPEND TO SECTION: `### Admin Dashboard` (the table at the top of the file under `## Surface Index — All Screens`, after the row beginning `| — | V1.7 amendments to AD-01`)

| ID | Page | Route | Min Role |
|---|---|---|---|
| AD-30 | Check in a member | Modal on AD-11 | Receptionist *(V1.8, FR-248–FR-250, Epic 27)*. Also GymOS Support, behind the second factor (FR-251) |
| AD-31 | Correct Plan | Modal on AD-04 | Manager: Owner, Supervisor, Manager. Also GymOS Support (FR-251) *(V1.8, FR-241–FR-243, Epic 27)* |
| AD-32 | Coach Portal — Coach Picker | `/coach?coach=<id>`, and the same query on `/coach/classes` and `/coach/:memberId` | Manager: Owner, Supervisor, Manager. Not Receptionist, Coach or GymOS Support *(V1.8, FR-247, Epic 29)* |
| — | V1.8 amendments to AD-04, AD-11, AD-12, AD-13, AD-14, AD-15, AD-18, AD-19, AD-20, AD-21, AD-22, AD-23 | see the V1.8 paragraph at the end of each screen | AD-04 Correct plan action and Sessions wording; AD-11 Check in a member, Entry column, Void; AD-12 labels; AD-13 Session validity and Gym challenge sections; AD-14/AD-15/AD-21 picker (read-only) and coach-owned classes; AD-18/AD-19 weekly times and Cancel class; AD-22 source value; AD-23 annual wording |

**1c.** Edits to existing Min Role cells `[ASSUMPTION — wording]`: AD-11 "Receptionist *(V1.6: session alert variant)*" gains "*(V1.8: Check in a member, Void)*"; AD-14, AD-15 and AD-21 "Coach" gain "; Owner, Supervisor, Manager read-only through the picker (AD-32)"; AD-21 additionally "*(V1.8: a Coach creates, edits and cancels own classes)*"; AD-19 "Manager" gains "; a Coach for own classes, from AD-21"; AD-18 "Receptionist" unchanged (Cancel class is Manager).

<!-- END BLOCK 1 -->

---

<!-- BEGIN BLOCK 2 -->

## BLOCK 2 · Information Architecture

APPEND TO SECTION: `### Admin Dashboard IA`

*(V1.8)* The IA tree above gains the following. Nothing is removed. Written as the changed branches only.

```
Admin Dashboard
├── Sidebar
│   ├── Members           → AD-03 → AD-04 (modal) → AD-31 Correct plan (modal)  [Owner/Supervisor/Manager]  [V1.8]
│   ├── Plans             → AD-23   (annual plan wording)                                                    [V1.8]
│   ├── Attendance        → AD-11 → AD-30 Check in a member (modal)                                         [V1.8]
│   │                              └── Void a staff check-in (modal on a row)  [Manager and above]          [V1.8]
│   ├── Classes           → AD-18 → AD-19 (modal: weekly times; result list "left unchanged")                [V1.8]
│   │                              └── Cancel class (dialog)  [Manager and above]                            [V1.8]
│   ├── Settings          → AD-13
│   │   ├── Session validity   (section, saves on its own)  [Owner/Supervisor]                              [V1.8]
│   │   └── Gym challenge      (section, saves on its own)  [Owner/Supervisor]  [Could]                     [V1.8]
│   └── Coach Portal                                                                                        [V1.8: now also for Owner, Supervisor, Manager]
│       ├── [Coach role]           Overview AD-20 · My Members AD-14 → AD-15 · My Classes AD-21 (+ Create / Edit / Cancel own classes via AD-19)
│       └── [Owner/Supervisor/Manager]  AD-32 coach picker → Classes (AD-21, read-only) · Members (AD-14 → AD-15, read-only)
│                                       (no Overview, no Progress tab: body and progress data never shown)
└── Floating / Overlay
    ├── Front-Desk Alert Panel  (V1.8: no alert is raised for a staff member's own check-in, accepted or rejected)
    ├── Inline Renewal Panel    (V1.8: also opens inside AD-30 on an expired result)
    └── Record Session Payment Panel (V1.8: also opens inside AD-30 on a "no paid session" result)
```

Reach rules `[ASSUMPTION]`: AD-30 is reached **only** from AD-11's page action (FR-248 says "from the Attendance page"). AD-31 is reached only from AD-04's header. AD-32 is the Coach Portal itself for the three admin roles, not a separate sidebar item. `[NOTE FOR UX]` A desk team may also want a one-tap "Check in" on an AD-03 row or the AD-04 header (the member is already found). Not drafted, to keep one entry point; add if the first gym asks.

<!-- END BLOCK 2 -->

---

<!-- BEGIN BLOCK 3 -->

## BLOCK 3 · Navigation Structure

APPEND TO SECTION: `### Admin Dashboard — Sidebar` (insert after the paragraph beginning `My Classes is **not** the admin Classes page`, before `**Logout:**`)

**V1.8 sidebar change: one row, one rule.**

`[CONFLICT]` with the line "Coach role: the sidebar renders only the 'Coach Portal' link" read as "Coach Portal is for the Coach role only", with the V1.7 matrix row `| Coach Portal | — | — | — | — | ✓ |`, and with the sentence "My Classes is **not** the admin Classes page — a Coach never reaches AD-18, cannot create or edit a class": from V1.8 (FR-246, FR-247) the Coach Portal is also opened by Owner, Supervisor and Manager through a coach picker, and a Coach creates, edits and cancels own classes inside My Classes. A Coach still never reaches AD-18, and the admin Classes page stays closed to the Coach role.

| Nav item | Receptionist | Manager | Supervisor | Owner | Coach |
|---|---|---|---|---|---|
| Coach Portal *(V1.8: picker for the three admin roles; own portal for Coach)* | — | ✓ | ✓ | ✓ | ✓ |

- **Label and position** `[ASSUMPTION]`: the item keeps the label "Coach Portal" / « Espace coach » and sits **after Classes** for Manager, Supervisor and Owner (the order is Overview, Members, Plans, Subscriptions, Payments, Attendance, Classes, Coach Portal, Audit Log, Settings). For the Coach role it stays the only item.
- **Receptionist** never sees it (absent from the DOM). **GymOS Support** never sees it: `[ASSUMPTION]` the V1.7 line "a support person sees the sidebar a Supervisor sees" gets this exception, because the picker functions are not support capabilities (Architecture Decision AD-58, FR-251). A support person who opens `/coach` gets the global "You don't have permission to do that."
- **What the three admin roles land on:** AD-32 (a coach is chosen first; nothing about any coach is shown before then). The Coach role lands on AD-20 Overview, as today.
- **Portal sub-navigation, admin view:** only **Classes** and **Members**. There is no Overview (it carries recent progress activity, which FR-247 excludes) and no per-member Progress tab. See AD-32.
- **Sidebar badge:** none.

**V1.8 role visibility, all new capabilities** (rows are actions; a dash means absent from the DOM; ✓ means available; "support" is the V1.7 role, shown to the gym as "GymOS Support"):

| Capability | Receptionist | Manager | Supervisor | Owner | Coach | Support |
|---|---|---|---|---|---|---|
| Check in a member (AD-30) | ✓ | ✓ | ✓ | ✓ | — | ✓ (second factor) |
| Void a staff check-in, same gym-local day | — | ✓ | ✓ | ✓ | — | ✓ |
| See the Entry column "By staff · name" | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Correct plan (AD-31) | — | ✓ | ✓ | ✓ | — | ✓ |
| Session validity setting (AD-13) | — | — | ✓ | ✓ | — | ✓ |
| Gym challenge: set and cancel (AD-13, Could) | — | — | ✓ | ✓ | — | ✓ |
| Annual plan wording (AD-23) | — | ✓ | ✓ | ✓ | — | ✓ |
| Weekly times and Cancel class on any class (AD-18, AD-19) | — | ✓ | ✓ | ✓ | — | ✓ |
| Create, edit, cancel **own** classes (AD-21 → AD-19) | — | — | — | — | ✓ | — |
| Coach picker, read-only (AD-32) | — | ✓ | ✓ | ✓ | — | — |

Notes: Owner and Supervisor share a column because V1.8 gives them identical capabilities (PRD 4.6). Supporting claims: support has no picker because FR-251's list does not include FR-247. A Manager does not reach Settings, so the two settings rows are absent for Manager, as for every V1.6 setting.

<!-- END BLOCK 3 -->

---

<!-- BEGIN BLOCK 4 -->

## BLOCK 4 · Voice and Tone

INSERT AFTER: the paragraph beginning `` `[NOTE FOR UX]` FR for the Allow switch reads `` (end of the V1.7 vocabulary notes, before `**French translations**`)

**V1.8 tone rows** (same two-column shape as the table above; add to it):

| Context | Write this | Not this |
|---|---|---|
| Staff check-in, accepted *(V1.8, FR-248)* | "Ange T. is checked in at 07:02." | "Manual check-in successful." |
| Staff check-in, expired *(V1.8, FR-249)* | "Not checked in. Jean B.'s membership expired 21 days ago." + [Renew now] | "Access denied." (the staff member is not the one being refused; say what happened and offer the next step) |
| Staff check-in, no paid session *(V1.8, FR-249)* | "Ange T. has no paid session. Record 2,000 XAF at the desk and Ange T. is checked in straight away." | "Error: no entitlement." |
| Void *(V1.8, FR-250)* | "Void this check-in? It stops counting for occupancy, streaks, rank and the gym challenge." | "Delete attendance record?" (nothing is deleted; the entry stays in the log, marked voided) |
| Correct plan refused *(V1.8, FR-242)* | "The payment of 250,000 XAF on 10 Nov (Cash) is still recorded. Refund it fully first, then correct the plan." | "Action not allowed." / "Subscription has payments." (always name the payment and say the next step) |
| Correct plan, what it is *(V1.8, FR-243)* | "It isn't a renewal: no payment is recorded, no notification is sent and no loyalty stamp is earned." | "This will modify the subscription." |
| Session validity *(V1.8, FR-236)* | "A paid session covers one visit." / "A paid session covers every check-in until the end of the day." | "Per-entry billing mode." / "Daily pass mode." |
| Gym challenge reward *(V1.8, FR-234)* | "The reward is your promise; GymOS doesn't give or pay it." | "Prize" / "Win" / anything that implies GymOS grants it |
| Weekly times *(V1.8, FR-244)* | "Add a time" / "Sessions with bookings were left unchanged" | "Slot" / "Occurrence override" (the word "slot" never appears in the UI) |
| Coach picker, read-only *(V1.8, FR-247)* | "You're viewing Emmanuel T.'s Coach Portal. Read-only." | "Impersonating coach" / "View as" (nobody is impersonated; no one acts as the coach) |
| Body data absent *(V1.8, FR-247)* | "Body measurements, photos and progress notes aren't shown in this view." | "Access denied." / a locked panel or blurred placeholder where the tab would be (absence is stated once, plainly, not dramatised) |

**V1.8 vocabulary** `[ASSUMPTION — FR terms to be reviewed with the FR copy pass]`. One term per concept, EN / FR:

| Concept | EN | FR | Never |
|---|---|---|---|
| A staff member entering a member's arrival | check in a member | enregistrer l'arrivée d'un membre | "manual check-in", "override", "force" |
| Taking a mistaken staff check-in back | void | annuler (l'arrivée) | "delete", "remove", "undo" (the entry stays visible, marked "Voided" / « Annulée ») |
| Fixing a wrongly chosen plan | correct plan | corriger la formule | "change plan", "swap", "downgrade" (a correction is not a renewal) |
| A paid session lasting one visit | Single use | Usage unique | "Per entry", "one-time" |
| A paid session lasting the day | Whole day | Toute la journée | "Daily pass", "unlimited" |
| A recurring class's weekly day-and-time entries | weekly times (one "time" = a day and an hour) | horaires de la semaine (un « horaire ») | "slot", "occurrence", "schedule row" |
| The Owner/Supervisor/Manager's coach view | coach picker (UI: "Choose a coach") | choisir un coach | "impersonate", "view as", "switch user" |
| The one-month gym-wide goal | Gym challenge | Défi de la salle | "contest", "competition", "prize" |
| What a visit is | visit (a check-in until check-out, or 3 hours) | visite | "entry" when it could mean a log row |
| "Paid once" for an annual plan | Paid once | Payé en une fois | "one-off payment", "lump sum", "yearly subscription fee" |

Session vs. class terminology (V1.6 rule) still applies: a paid or free day-visit is a "session" / « séance »; a class occurrence is a "session" in EN with the class name beside it, and a « cours » in FR (as on AD-18 and AD-21). `[ASSUMPTION]` The AD-19 "left unchanged" list and the Cancel class dialog follow the AD-21 precedent: "sessions" in EN, « cours » in FR.

### V1.8 string catalog (authoritative EN and FR for every new string)

Placeholders `[Name]`, `[time]`, `[date]`, `[N]` are filled at run time; dates and times follow the gym's locale and time zone (24-hour clock on class and attendance times, as AD-21). Amounts follow Monetary display. `[ASSUMPTION — all key names; all FR wording pending the FR copy pass]`.

**Group A. Check in a member (AD-30) and the attendance log (AD-11)**

| Key | EN | FR |
|---|---|---|
| `attendance.checkIn.action` | Check in a member | Enregistrer l'arrivée d'un membre |
| `attendance.checkIn.title` | Check in a member | Enregistrer l'arrivée d'un membre |
| `attendance.checkIn.intro` | For a member who can't use their phone at the entrance. | Pour un membre qui ne peut pas utiliser son téléphone à l'entrée. |
| `attendance.checkIn.search.label` | Find a member by name or phone | Trouver un membre par nom ou téléphone |
| `attendance.checkIn.search.hint` | Type at least 2 letters or 3 digits. | Saisissez au moins 2 lettres ou 3 chiffres. |
| `attendance.checkIn.search.none` | No member matches "[term]". Check the spelling, or search by phone. | Aucun membre ne correspond à « [terme] ». Vérifiez l'orthographe ou cherchez par téléphone. |
| `attendance.checkIn.search.more` | Showing the first 8. Type more to narrow the list. | Les 8 premiers sont affichés. Précisez votre recherche. |
| `attendance.checkIn.row.inside` | In the gym since [time] | Dans la salle depuis [heure] |
| `attendance.checkIn.entryTime` | Entry time: now ([time]). It can't be changed. | Heure d'arrivée : maintenant ([heure]). Elle ne peut pas être modifiée. |
| `attendance.checkIn.confirm` | Check in [Name] | Enregistrer l'arrivée de [Nom] |
| `attendance.checkIn.ok` | [Name] is checked in at [time]. | L'arrivée de [Nom] est enregistrée à [heure]. |
| `attendance.checkIn.okExpiring` | Checked in at [time]. [Name]'s membership expires on [date]. | Arrivée enregistrée à [heure]. L'adhésion de [Nom] expire le [date]. |
| `attendance.checkIn.okGrace` | Checked in at [time]. [Name]'s membership expired on [date]; the grace period ends on [date]. | Arrivée enregistrée à [heure]. L'adhésion de [Nom] a expiré le [date] ; la période de grâce se termine le [date]. |
| `attendance.checkIn.renewNow` | Renew now | Renouveler maintenant |
| `attendance.checkIn.rejectedExpired` | Not checked in. [Name]'s membership expired [N] days ago. | Arrivée non enregistrée. L'adhésion de [Nom] a expiré il y a [N] jours. |
| `attendance.checkIn.rejectedExpiredToday` | Not checked in. [Name]'s membership expired today. | Arrivée non enregistrée. L'adhésion de [Nom] a expiré aujourd'hui. |
| `attendance.checkIn.rejectedExpiredHelp` | Renew the membership to let them in. | Renouvelez l'adhésion pour l'autoriser à entrer. |
| `attendance.checkIn.renewedDone` | Membership renewed. [Name] is checked in at [time]. | Adhésion renouvelée. L'arrivée de [Nom] est enregistrée à [heure]. |
| `attendance.checkIn.sessionNeeded` | [Name] has no paid session. | [Nom] n'a pas de séance payée. |
| `attendance.checkIn.sessionNeededHelp` | Record [amount] XAF at the desk and [Name] is checked in straight away. | Enregistrez [montant] XAF à l'accueil et l'arrivée de [Nom] est enregistrée aussitôt. |
| `attendance.checkIn.recordAndCheckIn` | Record payment and check in | Enregistrer le paiement et l'arrivée |
| `attendance.checkIn.sessionDone` | Session recorded. [Name] is checked in at [time]. | Séance enregistrée. L'arrivée de [Nom] est enregistrée à [heure]. |
| `attendance.checkIn.alreadyIn` | [Name] is already checked in (since [time]). | [Nom] est déjà dans la salle (depuis [heure]). |
| `attendance.checkIn.refused.deactivated` | [Name] is deactivated. Reactivate them first. | [Nom] est désactivé. Réactivez ce membre d'abord. |
| `attendance.checkIn.refused.awaitingFee` | Settle [Name]'s registration fee first. | Réglez d'abord les frais d'inscription de [Nom]. |
| `attendance.checkIn.refused.noPlan` | [Name] has no plan yet. Assign a plan first. | [Nom] n'a pas encore de formule. Attribuez d'abord une formule. |
| `attendance.checkIn.refused.suspendedGym` | Check-ins can't be recorded while the gym is suspended. | Impossible d'enregistrer une arrivée tant que la salle est suspendue. |
| `attendance.checkIn.partialSession` | The session for [Name] was recorded, but the check-in didn't complete. Try again. Nothing is charged twice. | La séance de [Nom] a été enregistrée, mais l'arrivée n'a pas abouti. Réessayez. Rien n'est facturé deux fois. |
| `attendance.checkIn.partialRenewal` | [Name]'s renewal was recorded, but the check-in didn't complete. Try again. Nothing is charged twice. | Le renouvellement de [Nom] a été enregistré, mais l'arrivée n'a pas abouti. Réessayez. Rien n'est facturé deux fois. |
| `attendance.checkIn.network` | Couldn't check in [Name]. Check your connection and try again. | Impossible d'enregistrer l'arrivée de [Nom]. Vérifiez votre connexion et réessayez. |
| `attendance.checkIn.networkHint` | Not sure it went through? Search for [Name] again: a member who is in shows "In the gym since…". | Un doute ? Cherchez à nouveau [Nom] : un membre déjà présent affiche « Dans la salle depuis… ». |
| `attendance.checkIn.offline` | You're offline — you can't check anyone in right now. | Vous êtes hors ligne : impossible d'enregistrer une arrivée pour le moment. |
| `attendance.checkIn.another` | Check in another member | Enregistrer l'arrivée d'un autre membre |
| `attendance.checkIn.done` | Done | Terminé |
| `attendance.log.entry` (column) | Entry | Arrivée |
| `attendance.log.entryScan` | QR scan | Scan du QR |
| `attendance.log.byStaff` (pill) | By staff | Par le personnel |
| `attendance.log.byStaffName` | By staff · [Name] | Par le personnel · [Nom] |
| `attendance.log.voided` (pill) | Voided | Annulée |
| `attendance.log.voidedDetail` | Voided by [Name] on [date] at [time]. Reason: [reason] | Annulée par [Nom] le [date] à [heure]. Motif : [motif] |
| `attendance.void.action` | Void | Annuler |
| `attendance.void.actionAria` | Void the check-in of [Name] at [time] | Annuler l'arrivée de [Nom] à [heure] |

**Group B. Void a staff check-in (modal on an AD-11 row)**

| Key | EN | FR |
|---|---|---|
| `attendance.void.title` | Void this check-in? | Annuler cette arrivée ? |
| `attendance.void.body` | [Name]'s check-in at [time] was entered by staff. Voiding it removes the visit: it stops counting for occupancy, streaks, rank and the gym challenge. | L'arrivée de [Nom] à [heure] a été saisie par le personnel. L'annuler supprime la visite : elle ne compte plus pour la fréquentation, les séries, le classement et le défi de la salle. |
| `attendance.void.sessionBack` | The paid session this check-in used is given back to [Name]. | La séance payée utilisée par cette arrivée est restituée à [Nom]. |
| `attendance.void.paymentStays` | The payment stays on record. Refund it in Payments if you need to. | Le paiement reste enregistré. Remboursez-le dans Paiements si nécessaire. |
| `attendance.void.stampRemoved` | The loyalty stamp it earned is removed. | Le tampon de fidélité gagné est retiré. |
| `attendance.void.reason.label` | Reason for voiding | Motif de l'annulation |
| `attendance.void.reason.placeholder` | For example: wrong member selected | Par exemple : mauvais membre sélectionné |
| `attendance.void.reason.error` | Enter a reason (at least 5 characters). | Saisissez un motif (au moins 5 caractères). |
| `attendance.void.keep` | Keep check-in | Conserver l'arrivée |
| `attendance.void.confirm` | Void check-in | Annuler l'arrivée |
| `attendance.void.success` | Check-in voided. [Name] is no longer counted as in the gym. | Arrivée annulée. [Nom] n'est plus comptabilisé dans la salle. |
| `attendance.void.refused.laterVisit` | Can't void this check-in: [Name]'s later visit today relies on the same paid session. | Impossible d'annuler cette arrivée : la visite suivante de [Nom] aujourd'hui s'appuie sur la même séance payée. |
| `attendance.void.refused.laterVisitStaff` (second sentence, when the later visit was staff-entered) | Void the later check-in first. | Annulez d'abord l'arrivée suivante. |
| `attendance.void.refused.notToday` | A check-in can only be voided on the day it was entered. | Une arrivée ne peut être annulée que le jour de son enregistrement. |
| `attendance.void.refused.already` | This check-in was already voided. | Cette arrivée a déjà été annulée. |
| `attendance.void.refused.notStaff` | Only check-ins entered by staff can be voided. | Seules les arrivées saisies par le personnel peuvent être annulées. |
| `attendance.void.network` | Couldn't void the check-in. Check your connection and try again. | Impossible d'annuler l'arrivée. Vérifiez votre connexion et réessayez. |

**Group C. Correct plan (AD-31) and the AD-04 additions**

| Key | EN | FR |
|---|---|---|
| `members.correctPlan.action` | Correct plan | Corriger la formule |
| `members.correctPlan.title` | Correct plan | Corriger la formule |
| `members.correctPlan.intro` | Use this when the wrong plan was chosen. It isn't a renewal: no payment is recorded, no notification is sent and no loyalty stamp is earned. | À utiliser lorsque la mauvaise formule a été choisie. Ce n'est pas un renouvellement : aucun paiement n'est enregistré, aucune notification n'est envoyée et aucun tampon de fidélité n'est gagné. |
| `members.correctPlan.current` | Current plan | Formule actuelle |
| `members.correctPlan.currentDetail` | Started [date] · Expires [date] | Débutée le [date] · Expire le [date] |
| `members.correctPlan.checking` | Checking payments… | Vérification des paiements… |
| `members.correctPlan.newPlan.label` | New plan | Nouvelle formule |
| `members.correctPlan.newPlan.placeholder` | Choose a plan | Choisissez une formule |
| `members.correctPlan.noOtherPlan` | There is no other plan to choose. Add a plan in Plans first. | Il n'y a pas d'autre formule à choisir. Ajoutez d'abord une formule dans Formules. |
| `members.correctPlan.reason.label` | Reason | Motif |
| `members.correctPlan.reason.placeholder` | For example: wrong plan chosen at sign-up | Par exemple : mauvaise formule choisie à l'inscription |
| `members.correctPlan.reason.error` | Enter a reason (at least 5 characters). | Saisissez un motif (au moins 5 caractères). |
| `members.correctPlan.rule` | The new expiry is counted from the start date ([date]), not from today. | La nouvelle date d'expiration est calculée à partir de la date de début ([date]), pas d'aujourd'hui. |
| `members.correctPlan.preview` | New expiry: [date] · [status] | Nouvelle expiration : [date] · [statut] |
| `members.correctPlan.previewPps` | No expiry — billed per session | Sans expiration — facturée à la séance |
| `members.correctPlan.warnExpired` | With this plan, [Name]'s membership would already be expired (since [date]). You can still correct it. | Avec cette formule, l'adhésion de [Nom] serait déjà expirée (depuis le [date]). Vous pouvez tout de même la corriger. |
| `members.correctPlan.warnGrace` | With this plan, [Name]'s membership would be in its grace period (until [date]). You can still correct it. | Avec cette formule, l'adhésion de [Nom] serait en période de grâce (jusqu'au [date]). Vous pouvez tout de même la corriger. |
| `members.correctPlan.appNote` | [Name]'s app shows the new plan the next time it opens. | L'application de [Nom] affichera la nouvelle formule à sa prochaine ouverture. |
| `members.correctPlan.feeNote` | The registration fee is not affected. | Les frais d'inscription ne sont pas modifiés. |
| `members.correctPlan.confirm` | Correct plan | Corriger la formule |
| `members.correctPlan.success` | Plan corrected. [Name] is now on [Plan]; expires [date]. | Formule corrigée. [Nom] est maintenant sur [Formule] ; expire le [date]. |
| `members.correctPlan.successPps` | Plan corrected. [Name] is now on [Plan]. | Formule corrigée. [Nom] est maintenant sur [Formule]. |
| `members.correctPlan.blocked.lead` | Can't correct the plan yet. | Impossible de corriger la formule pour le moment. |
| `members.correctPlan.blocked.verified` | The payment of [amount] XAF on [date] ([method]) is still recorded. Refund it fully first, then correct the plan. | Le paiement de [montant] XAF du [date] ([mode]) est toujours enregistré. Remboursez-le intégralement d'abord, puis corrigez la formule. |
| `members.correctPlan.blocked.pending` | The payment of [amount] XAF on [date] ([method]) is awaiting verification. Refund it fully first, or wait until it settles, then correct the plan. | Le paiement de [montant] XAF du [date] ([mode]) attend sa vérification. Remboursez-le intégralement d'abord, ou attendez son règlement, puis corrigez la formule. |
| `members.correctPlan.blocked.inFlight` | The mobile money payment of [amount] XAF started on [date] is still in progress. Wait for it to settle. If it goes through, refund it fully, then correct the plan. | Le paiement mobile money de [montant] XAF commencé le [date] est en cours. Attendez son règlement. S'il aboutit, remboursez-le intégralement, puis corrigez la formule. |
| `members.correctPlan.blocked.partlyRefunded` | The payment of [amount] XAF on [date] ([method]) is only partly refunded ([refunded] XAF of [amount] XAF). Refund the rest first, then correct the plan. | Le paiement de [montant] XAF du [date] ([mode]) n'est remboursé qu'en partie ([remboursé] XAF sur [montant] XAF). Remboursez le reste d'abord, puis corrigez la formule. |
| `members.correctPlan.blocked.more` | + [N] more payments on this plan are still recorded. | + [N] autres paiements de cette formule sont encore enregistrés. |
| `members.correctPlan.blocked.open` | Open payments | Ouvrir les paiements |
| `members.correctPlan.refused.sessionHeld` | Can't move [Name] to or from Pay-per-session while an unused paid session is held. Refund it first, or wait until it is used or lapses ([date]). | Impossible de faire passer [Nom] vers ou depuis Paiement à la séance tant qu'une séance payée non utilisée est détenue. Remboursez-la d'abord, ou attendez qu'elle soit utilisée ou expire (le [date]). |
| `members.correctPlan.refused.samePlan` | [Name] is already on this plan. | [Nom] a déjà cette formule. |
| `members.correctPlan.refused.noSubscription` | [Name] has no current plan to correct. | [Nom] n'a pas de formule en cours à corriger. |
| `members.correctPlan.refused.planGone` | That plan is no longer available. Choose another. | Cette formule n'est plus disponible. Choisissez-en une autre. |
| `members.correctPlan.refused.changed` | This member's plan changed while you were working. Close this window and open the member again. | La formule de ce membre a changé pendant votre saisie. Fermez cette fenêtre et rouvrez le membre. |
| `members.correctPlan.network` | Couldn't correct the plan. Check your connection and try again. | Impossible de corriger la formule. Vérifiez votre connexion et réessayez. |
| `members.subscriptionStarted` (AD-04 field) | Subscription started | Abonnement débuté le |
| `members.sessions.coveredVisit` | Covered visit | Visite couverte |
| `members.sessions.coveredClass` | Covered class | Cours couvert |
| `members.sessions.usedVisit` | Used · visit on [date], [time] | Utilisée · visite du [date], [heure] |
| `members.sessions.usedClass` | Used · class [name], [date] | Utilisée · cours [nom], [date] |

**Group D. Settings: Session validity and Gym challenge (AD-13)**

| Key | EN | FR |
|---|---|---|
| `settings.sessionValidity.title` | Session validity | Validité de la séance |
| `settings.sessionValidity.wholeDay` | Whole day | Toute la journée |
| `settings.sessionValidity.wholeDayDesc` | A paid session covers every check-in until the end of the day. | Une séance payée couvre toutes les arrivées jusqu'à la fin de la journée. |
| `settings.sessionValidity.singleUse` | Single use | Usage unique |
| `settings.sessionValidity.singleUseDesc` | A paid session covers one visit. A visit ends at check-out, or [H] hours after check-in, whichever comes first. | Une séance payée couvre une seule visite. Une visite se termine au départ, ou [H] heures après l'arrivée, selon ce qui arrive en premier. |
| `settings.sessionValidity.classNote` | A class attended during an open visit uses that visit's session. Otherwise it uses its own session. | Un cours suivi pendant une visite ouverte utilise la séance de cette visite. Sinon, il utilise sa propre séance. |
| `settings.sessionValidity.chargingOff` | Takes effect when "Charge guests per session" is on. | Prend effet lorsque « Faire payer les invités à la séance » est activé. |
| `settings.sessionValidity.applies` | The change applies to check-ins from now on. A visit already open finishes under the old rule, and sessions already used keep their coverage. | Le changement s'applique aux arrivées à partir de maintenant. Une visite déjà ouverte se termine selon l'ancienne règle, et les séances déjà utilisées gardent leur couverture. |
| `settings.sessionValidity.loyaltyNote` | Single use earns loyalty stamps faster: one per paid session. Check your loyalty setting. | L'usage unique fait gagner les tampons de fidélité plus vite : un par séance payée. Vérifiez votre programme de fidélité. |
| `settings.sessionValidity.save` | Save session validity | Enregistrer la validité de la séance |
| `settings.sessionValidity.saved` | Session validity saved. | Validité de la séance enregistrée. |
| `settings.sessionValidity.error` | Couldn't save session validity. Try again. | Impossible d'enregistrer la validité de la séance. Réessayez. |
| `settings.chargeGuests.helperSingleUse` | Pay-per-session members need a paid session to check in or attend a class. One session covers one visit. | Les membres en Paiement à la séance doivent avoir une séance payée pour s'enregistrer ou assister à un cours. Une séance couvre une visite. |
| `settings.saveHint.v18` (clause added to the hint) | …, Session validity and Gym challenge, | …, Validité de la séance et Défi de la salle, |
| `settings.challenge.title` | Gym challenge | Défi de la salle |
| `settings.challenge.intro` | A monthly goal for all your members together: visit days in the month. The reward is your promise; GymOS doesn't give or pay it. | Un objectif mensuel pour tous vos membres ensemble : le nombre de jours de visite dans le mois. La récompense est votre promesse ; GymOS ne la donne ni ne la paie. |
| `settings.challenge.none` | No challenge for [Month]. | Aucun défi pour [mois]. |
| `settings.challenge.month` | Month | Mois |
| `settings.challenge.target.label` | Target (visit days, all members together) | Objectif (jours de visite, tous les membres) |
| `settings.challenge.target.error` | Enter a whole number of visit days, 1 or more. | Saisissez un nombre entier de jours de visite, 1 ou plus. |
| `settings.challenge.reward.label` | Reward | Récompense |
| `settings.challenge.reward.help` | Write what you promise, for example "a free smoothie for everyone". | Écrivez votre promesse, par exemple « un smoothie offert à tous ». |
| `settings.challenge.reward.error` | Write the reward (up to 120 characters). | Écrivez la récompense (120 caractères maximum). |
| `settings.challenge.fixedNote` | Set it before the month starts. Once set, the target and reward can't change. | À définir avant le début du mois. Une fois défini, l'objectif et la récompense ne peuvent plus changer. |
| `settings.challenge.set` | Set challenge for [Month] | Définir le défi de [mois] |
| `settings.challenge.setDialog.title` | Set the [Month] challenge? | Définir le défi de [mois] ? |
| `settings.challenge.setDialog.body` | Target: [N] visit days. Reward: [text]. These can't be changed afterwards. You can cancel the challenge, but then no other challenge can be set for [Month]. | Objectif : [N] jours de visite. Récompense : [texte]. Ces éléments ne pourront plus être modifiés. Vous pouvez annuler le défi, mais aucun autre défi ne pourra alors être défini pour [mois]. |
| `settings.challenge.setDialog.back` | Back | Retour |
| `settings.challenge.setDialog.confirm` | Set challenge | Définir le défi |
| `settings.challenge.scheduled` | The [Month] challenge is set: [N] visit days. Reward: [text]. It starts on [date]. | Le défi de [mois] est défini : [N] jours de visite. Récompense : [texte]. Il commence le [date]. |
| `settings.challenge.running` | [Month] challenge: [done] / [N] visit days. Reward: [text]. | Défi de [mois] : [done] / [N] jours de visite. Récompense : [texte]. |
| `settings.challenge.reached` | Target reached. | Objectif atteint. |
| `settings.challenge.cancelled` | The [Month] challenge was cancelled. It can't be set again for [Month]. | Le défi de [mois] a été annulé. Il ne peut pas être redéfini pour [mois]. |
| `settings.challenge.cancel` | Cancel challenge | Annuler le défi |
| `settings.challenge.cancelDialog.title` | Cancel the [Month] challenge? | Annuler le défi de [mois] ? |
| `settings.challenge.cancelDialog.body` | Members stop seeing it straight away. A cancelled challenge can't be set again for [Month]. | Les membres ne le voient plus immédiatement. Un défi annulé ne peut pas être redéfini pour [mois]. |
| `settings.challenge.cancelDialog.keep` | Keep challenge | Conserver le défi |
| `settings.challenge.setToast` | Challenge set for [Month]. | Défi défini pour [mois]. |
| `settings.challenge.cancelToast` | Challenge cancelled. | Défi annulé. |
| `settings.challenge.error.save` | Couldn't save the challenge. Try again. | Impossible d'enregistrer le défi. Réessayez. |
| `settings.challenge.error.started` | [Month] has already started, so a challenge can't be set for it. | [Mois] a déjà commencé : un défi ne peut plus être défini pour ce mois. |
| `settings.challenge.error.exists` | A challenge already exists for [Month]. | Un défi existe déjà pour [mois]. |

**Group E. Plans (AD-23)**

| Key | EN | FR |
|---|---|---|
| `plans.annual.paidOnce` | Paid once | Payé en une fois |
| `plans.annual.summary` | [price] XAF · [D] days · Paid once | [prix] XAF · [D] jours · Payé en une fois |
| `plans.annual.discount` | Includes [x]% annual discount | Dont [x] % de remise annuelle |
| `plans.annual.modalHelp` | Members pay the full price once. The plan then runs for [D] days. Renewing is a new payment. | Les membres paient le prix complet en une fois. La formule dure ensuite [D] jours. Le renouvellement est un nouveau paiement. |
| `plans.annual.noInstalments` | To let members pay monthly, create a separate monthly plan. Paying an annual plan in instalments isn't available. | Pour un paiement mensuel, créez une formule mensuelle distincte. Le paiement d'une formule annuelle en plusieurs fois n'est pas disponible. |

**Group F. Classes: weekly times, cancel, coach-created (AD-18, AD-19, AD-21)**

| Key | EN | FR |
|---|---|---|
| `classes.times.label` | Weekly times | Horaires de la semaine |
| `classes.times.counter` | [n] of 14 | [n] sur 14 |
| `classes.times.day` | Day | Jour |
| `classes.times.time` | Time | Heure |
| `classes.times.add` | + Add a time | + Ajouter un horaire |
| `classes.times.remove` | Remove | Supprimer |
| `classes.times.removeAria` | Remove [day] [time] | Supprimer [jour] [heure] |
| `classes.times.limit` | A class can have up to 14 weekly times. | Un cours peut avoir jusqu'à 14 horaires par semaine. |
| `classes.times.timezone` | Times are in the gym's time zone ([zone]). | Les heures sont dans le fuseau horaire de la salle ([fuseau]). |
| `classes.times.error.none` | Add at least one day and time. | Ajoutez au moins un jour et une heure. |
| `classes.times.error.day` | Choose a day. | Choisissez un jour. |
| `classes.times.error.time` | Enter a time, for example 18:30. | Saisissez une heure, par exemple 18:30. |
| `classes.times.error.duplicate` | This day and time is already in the list. | Ce jour et cette heure figurent déjà dans la liste. |
| `classes.times.editNotice` | Changes apply to upcoming sessions that nobody has booked. Sessions with bookings stay as they are, and you'll see them after you save. | Les changements s'appliquent aux prochains cours sans réservation. Les cours réservés restent inchangés, et vous les verrez après l'enregistrement. |
| `classes.times.saved.title` | Class saved | Cours enregistré |
| `classes.times.saved.summary` | Weekly times: [summary] | Horaires : [résumé] |
| `classes.times.left.title` | [N] sessions with bookings were left unchanged | [N] cours réservés n'ont pas été modifiés |
| `classes.times.left.title1` | 1 session with bookings was left unchanged | 1 cours réservé n'a pas été modifié |
| `classes.times.left.help` | They keep their old time and their bookings. | Ils gardent leur ancien horaire et leurs réservations. |
| `classes.times.left.row` | [day] [date] · [time] · [n] / [capacity] booked | [jour] [date] · [heure] · [n] / [capacité] réservations |
| `classes.times.left.none` | Nothing was left unchanged. Upcoming sessions follow the new times. | Rien n'a été laissé tel quel. Les prochains cours suivent les nouveaux horaires. |
| `classes.times.oldTimeTag` | Old time | Ancien horaire |
| `classes.cancel.action` | Cancel class | Annuler le cours |
| `classes.cancel.title` | Cancel [Class]? | Annuler [Cours] ? |
| `classes.cancel.body` | All upcoming sessions are cancelled, and [N] bookings are cancelled. Past sessions and attendance stay on record. | Tous les prochains cours sont annulés, ainsi que [N] réservations. Les cours passés et les présences restent enregistrés. |
| `classes.cancel.bodyNoBookings` | All upcoming sessions are cancelled. Nobody has booked yet. | Tous les prochains cours sont annulés. Personne n'a encore réservé. |
| `classes.cancel.keep` | Keep class | Conserver le cours |
| `classes.cancel.toast` | [Class] cancelled. | [Cours] annulé. |
| `classes.cancel.badge` | Cancelled | Annulé |
| `classes.cancel.error` | Couldn't cancel the class. Try again. | Impossible d'annuler le cours. Réessayez. |
| `classes.cancel.already` | This class was already cancelled. | Ce cours a déjà été annulé. |
| `classes.coach.fixed` | Coach | Coach |
| `classes.coach.fixedHelp` | Classes you create are taught by you. | Les cours que vous créez sont animés par vous. |
| `classes.coach.ownOnly` | You can only change your own classes. | Vous ne pouvez modifier que vos propres cours. |
| `classes.coach.create` | + Create class | + Créer un cours |
| `classes.coach.empty` | You don't have any classes yet. Create one, or ask your manager to assign you to a class. | Vous n'avez pas encore de cours. Créez-en un, ou demandez à votre responsable de vous en attribuer un. |

**Group G. Coach picker (AD-32)**

| Key | EN | FR |
|---|---|---|
| `coach.picker.label` | Choose a coach | Choisir un coach |
| `coach.picker.banner` | You're viewing [Name]'s Coach Portal. Read-only. | Vous consultez l'espace coach de [Nom]. Lecture seule. |
| `coach.picker.choose` | Choose a coach to see their classes and members. | Choisissez un coach pour voir ses cours et ses membres. |
| `coach.picker.noCoaches` | Your gym has no coaches yet. Add a coach in Staff. | Votre salle n'a pas encore de coach. Ajoutez-en un dans Personnel. |
| `coach.picker.noCoachesManager` | Your gym has no coaches yet. Ask an Owner or Supervisor to add one. | Votre salle n'a pas encore de coach. Demandez à un propriétaire ou à un superviseur d'en ajouter un. |
| `coach.picker.unavailable` | That coach isn't available. Choose another. | Ce coach n'est pas disponible. Choisissez-en un autre. |
| `coach.picker.inactive` | [Name] is no longer a coach at this gym. | [Nom] n'est plus coach dans cette salle. |
| `coach.picker.tab.classes` | Classes | Cours |
| `coach.picker.tab.members` | Members | Membres |
| `coach.picker.noClasses` | [Name] has no classes yet. | [Nom] n'a pas encore de cours. |
| `coach.picker.noMembers` | No members are assigned to [Name]. | Aucun membre n'est attribué à [Nom]. |
| `coach.picker.noBodyData` | Body measurements, photos and progress notes aren't shown in this view. | Les mesures corporelles, les photos et les notes de progression ne sont pas affichées dans cette vue. |
| `coach.picker.partUnavailable` | This part isn't available in this view. Body measurements, photos, progress notes and progress activity are never shown here. | Cette partie n'est pas disponible dans cette vue. Les mesures corporelles, les photos, les notes de progression et l'activité de progression n'y sont jamais affichées. |
| `coach.picker.notAssigned` | [Member] isn't assigned to [Coach]. | [Membre] n'est pas attribué à [Coach]. |
| `coach.picker.expiredBar` | This member's membership has expired. | L'adhésion de ce membre a expiré. |
| `coach.picker.planAuthor` | Workout plan written by [Name] | Programme d'entraînement rédigé par [Nom] |
| `coach.picker.openInClasses` | Open in Classes | Ouvrir dans Cours |
| `coach.portal.nav` (sidebar label, all roles) | Coach Portal | Espace coach |

**Group H. Audit Log labels (AD-12)** (same short past-tense style as V1.6 and V1.7)

| Key | EN | FR |
|---|---|---|
| `audit.actionTypes.staffCheckIn` | Member checked in by staff | Arrivée d'un membre enregistrée par le personnel |
| `audit.actionTypes.staffCheckInRejected` | Staff check-in not accepted | Arrivée par le personnel refusée |
| `audit.actionTypes.staffCheckInVoided` | Staff check-in voided | Arrivée par le personnel annulée |
| `audit.actionTypes.planCorrected` | Plan corrected | Formule corrigée |
| `audit.actionTypes.sessionValidityChanged` | Session validity changed | Validité de la séance modifiée |
| `audit.actionTypes.challengeSet` | Gym challenge set | Défi de la salle défini |
| `audit.actionTypes.challengeCancelled` | Gym challenge cancelled | Défi de la salle annulé |
| `audit.actionTypes.classTimesChanged` | Class weekly times changed | Horaires du cours modifiés |
| `audit.actionTypes.classCancelled` | Class cancelled | Cours annulé |
| `audit.actionTypes.classCreatedByCoach` | Class created | Cours créé |

**Group I. Remaining strings** (labels, announcements, small errors; shared actions such as [Retry], [Refresh], [Cancel], [Close] reuse the existing global keys)

| Key | EN | FR |
|---|---|---|
| `attendance.checkIn.search.error` | Couldn't search members. Try again. | Impossible de rechercher les membres. Réessayez. |
| `attendance.checkIn.search.clear` | Clear search | Effacer la recherche |
| `attendance.checkIn.search.count` (polite announcement) | [N] members found | [N] membres trouvés |
| `attendance.checkIn.openMember` | Open [Name] | Ouvrir [Nom] |
| `attendance.log.entryAria` | Checked in by staff, [Name] | Arrivée enregistrée par le personnel, [Nom] |
| `members.correctPlan.newPlan.error` | Choose a plan | Choisissez une formule |
| `members.correctPlan.loadError` | Couldn't check this member's payments. Try again. | Impossible de vérifier les paiements de ce membre. Réessayez. |
| `plans.annual.modalHelpNoDuration` | Members pay the full price once. The plan then runs for the duration below. Renewing is a new payment. | Les membres paient le prix complet en une fois. La formule dure ensuite la durée indiquée ci-dessous. Le renouvellement est un nouveau paiement. |
| `classes.times.sorted` (polite announcement) | Weekly times sorted | Horaires triés |
| `classes.times.summary.more` | +[N] more | +[N] autres |
| `guestSessions.source.desk` (AD-22 Source value) | Desk check-in | Arrivée à l'accueil |
| `coach.picker.backToMembers` | Back to members | Retour aux membres |
| `coach.picker.openStaff` | Open Staff | Ouvrir Personnel |

<!-- END BLOCK 4 -->

---

<!-- BEGIN BLOCK 5 -->

## BLOCK 5 · New screens AD-30, AD-31, AD-32

INSERT AFTER: the last paragraph of `### V1.7 — Amendments to existing Admin screens` (the AD-16 bullet list ending "…the Role-ceiling rules are unchanged."), before the `---` that precedes `## Screen Reference — Super Admin Dashboard`

---

### AD-30 · Check in a member *(V1.8, FR-248–FR-250, Epic 27, modal on AD-11)*

**Purpose:** The desk checks a member in when they cannot use their phone at the entrance: no smartphone, a dead battery, an app problem. Every member still has a required phone number (FR-020); this is not a way around it and not a new member path. It creates the same attendance record as a scan, marked as entered by staff. Receptionist and above (Receptionist, Manager, Supervisor, Owner), and GymOS Support behind the second factor (FR-251). Absent from the DOM for Coach.

**Entry:** the page action [Check in a member] / [Enregistrer l'arrivée d'un membre] on AD-11, in the page header on the right. It is the only entry point.

**Layout, step 1 (find and choose):**
```
Check in a member                                               [✕]
For a member who can't use their phone at the entrance.

Find a member by name or phone
[🔍 Ange                                          ]
Type at least 2 letters or 3 digits.

┌─────────────────────────────────────────────────────────────────┐
│ ( ) [Av] Ange T.   +237 6 70 11 22 33   Drop-in    [Active]      │
│ (•) [Av] Ange M.   +237 6 55 44 33 22   Monthly    [Expiring soon]│
│                                         In the gym since 06:40   │
└─────────────────────────────────────────────────────────────────┘
Entry time: now (07:02). It can't be changed.

                                       [Cancel]  [Check in Ange M.]
```

**Components (step 1):**
- **Search field:** auto-focused on open; matches name (contains, accent-insensitive) and phone (digits, any country-code form) within this gym only; 300 ms debounce, as AD-03. Needs 2 letters or 3 digits before it queries (helper under the field). `[ASSUMPTION — thresholds]`
- **Results:** at most 8 rows, sorted by name; if more match, the line "Showing the first 8. Type more to narrow the list." Each row is one radio option (a `radiogroup`) with avatar (initials fallback), name, full phone number (as AD-03 shows it to the same roles, so two members with the same name can be told apart), plan name and the **member status badge** (Active, Expiring Soon, Grace Period, Expired, Deactivated; same colours as AD-03). A member already inside shows the muted tag "In the gym since [time]" under the row. The row stays selectable; the server decides (state "Already checked in"). `[ASSUMPTION — a Pay-per-session member's row shows the plan name only, never a session count; the session is checked on confirm]`
- **Entry time line:** plain text, "Entry time: now ([time]). It can't be changed." There is **no time field and no date field**: the time is the time of entry; it cannot be set to the past or the future (FR-248). The displayed time updates each minute and is for information only; the server stamps the actual time.
- **[Check in [Name]]:** the primary button, disabled until a row is chosen, labelled with the action and the chosen name (Accessibility Floor: confirm buttons are named by action). One tap checks in; there is no second confirmation dialog because the button already names the person and a wrong entry can be voided the same day (Manager and above) `[ASSUMPTION — no extra confirm step; the name on the button and the phone on the row are the guard]`.
- **[Cancel] / [✕]:** closes the modal; nothing is recorded.

**Result states (step 2).** The modal body is replaced by one result panel, with the member's avatar and name above it. Every result is the server's answer; the client does not predict it. A result panel has an icon, a label, a colour token and a text, never colour alone. The staff member is the only audience, so copy says what happened and the next step.

| # | Result | Colour, icon, live region | EN text (key) | Actions | Recorded |
|---|---|---|---|---|---|
| R1 | Checked in, Active | `success`, check circle, `role="status"` | "[Name] is checked in at [time]." (`attendance.checkIn.ok`) | [Check in another member] [Done] | Attendance row, source staff, entered by this user; audit "Member checked in by staff" |
| R2 | Checked in, Expiring Soon | `warning`, check circle with warning line, `role="status"` | "Checked in at [time]. [Name]'s membership expires on [date]." (`…okExpiring`) | [Renew now] (opens the Inline Renewal Panel inside the modal) [Check in another member] [Done] | As R1 |
| R3 | Checked in, Grace Period | `warning`, same | "Checked in at [time]. [Name]'s membership expired on [date]; the grace period ends on [date]." (`…okGrace`) | As R2 | As R1 |
| R4 | Not checked in, Expired | `danger`, block icon, `role="alert"` | "Not checked in. [Name]'s membership expired [N] days ago." (`…rejectedExpired`; "today" variant) + "Renew the membership to let them in." | [Renew now] [Check in another member] [Done] | **No attendance.** Audit "Staff check-in not accepted" with the outcome. No front-desk alert |
| R5 | No paid session | `info`, ticket icon, `role="alert"` | "[Name] has no paid session." + "Record [amount] XAF at the desk and [Name] is checked in straight away." (`…sessionNeeded`, `…sessionNeededHelp`) | [Record payment and check in] [Check in another member] [Done] | No attendance until the payment is recorded; a blocked-attempt row (`source` staff) and an audit row |
| R6 | Completed after renewal or payment | `success`, as R1, `role="status"` | "Membership renewed. [Name] is checked in at [time]." or "Session recorded. [Name] is checked in at [time]." | [Check in another member] [Done] | Payment (via the shared panel) then attendance, as R1 |
| R7 | Already checked in | `warning`, clock icon, `role="status"` | "[Name] is already checked in (since [time])." (`…alreadyIn`) | [Check in another member] [Done] | Nothing; no cost; no audit row `[ASSUMPTION — a no-op is not audited]` |
| R8 | Refused: Deactivated / Awaiting registration fee / No plan | `neutral`, info icon, `role="alert"` | "[Name] is deactivated. Reactivate them first." / "Settle [Name]'s registration fee first." / "[Name] has no plan yet. Assign a plan first." | [Check in another member] [Done]; a text link "Open [Name]" to AD-04 where the staff role can act | No attendance; audit as R4 `[ASSUMPTION — the same refusals a scan would give; neutral, not red, because red means expired]` |
| R9 | Refused: gym suspended | `danger`, `role="alert"` | "Check-ins can't be recorded while the gym is suspended." | [Done] | None (existing suspended pattern governs the rest of the app) |
| R10 | Partly done | `warning`, `role="alert"` | "The session for [Name] was recorded, but the check-in didn't complete. Try again. Nothing is charged twice." (or the renewal variant) | [Check in [Name]] (retries only the check-in) [Done] | The payment stands; no attendance yet |
| R11 | Network failure | `danger`, `role="alert"`, inline above the buttons, modal stays on step 1 | "Couldn't check in [Name]. Check your connection and try again." + "Not sure it went through? Search for [Name] again: a member who is in shows "In the gym since…"." | [Check in [Name]] stays enabled | Unknown on the client; the server's one-open-check-in rule makes a retry safe |
| R12 | Offline | neutral text under the field, `role="status"` | "You're offline — you can't check anyone in right now." | The confirm button is disabled and the reason is visible beside it | None |

**Rules behind the results** (they are the same as a scan, FR-249):
- **Expired is rejected; expiring and grace are accepted with a warning.** A staff check-in uses the same status calculation as a scan; the dashboard never computes it.
- **Pay-per-session at a gym with "Charge guests per session" on** needs a usable session under the gym's Session validity (AD-13). When there is none (R5), the staff member records the desk payment in place and the check-in then completes (R6). At a gym with charging off, or a Pay-per-session plan priced 0, a Pay-per-session member is checked in with no payment step (R1).
- **In place, not elsewhere:** [Record payment and check in] opens the **Record Session Payment Panel** inline under the result panel as an expanding section inside the modal at every width (the way it sits inside the AD-04 modal, not as the tablet drawer, because a drawer would stack on a modal), with the same fixed amount and the same refusals ("A mobile money payment for [Name] is already in progress…" and the rest of its table). On success the modal does not close and does not show the payment toast; it shows R6 straight away, because the check-in follows the payment automatically. [Renew now] does the same with the **Inline Renewal Panel**; on success the check-in completes automatically and R6 shows. `[ASSUMPTION — a renewal completes the check-in without a further tap, for the same reason a desk payment does. FR-249 says so only for the payment.]` `[NOTE FOR UX]` If the product owner prefers a deliberate second tap after a renewal ("Renewed. Check in [Name] now?"), swap R6's renewal variant for that; the payment path stays automatic as FR-249 states.
- **No separate front-desk alert.** A staff check-in, accepted or rejected, never raises a Front-Desk Alert Panel entry (FR-249): the staff member sees the outcome here. The existing alerts for member scans are unchanged.
- **Occupancy and the member's app.** An accepted staff check-in counts toward occupancy, appears in the member's History, and counts for streaks, calendar and leaderboard like any visit (FR-248). Nothing is shown about that in this modal.
- **Check-out** is unchanged and stays on AD-11 ([Check Out] per row).
- **One at a time, many in a row.** After R1 to R3, R6 or R7 the modal stays open on [Check in another member], which returns to step 1 with an empty search and focus in the field, so a morning queue of three is three searches in one open modal. [Done] closes it.

**Audit:** every staff check-in and every rejected staff attempt is one AD-12 row: Actor = the staff member (or "GymOS Support"), Action "Member checked in by staff" or "Staff check-in not accepted", Target = the member, Details = time and outcome (and the reason code for a rejection).

**Support Identity Rule:** a support person's staff check-in shows the staff name as **"GymOS Support"**, role "Support", in the Entry column, the void text and the audit row. Never a name, initials or count.

**Loading:** the search shows 3 skeleton rows after the debounce; the confirm shows a spinner in the button and disables it (a second tap cannot create a second request).

**Error:** field-level search failure: "Couldn't search members. Try again." with [Retry] (reuse the AD-03 pattern). Check-in failures are R11.

`[NOTE FOR UX]` Whether a result can offer [Check out] when the member is already inside (R7) for the case "they are leaving and the scan was never done". AD-11's Currently Checked-In table already has [Check Out], so R7 points there in words only ("See the list under the modal"); not drafted as a button to keep the modal single-purpose.

---

### AD-31 · Correct Plan *(V1.8, FR-241–FR-243, Epic 27, modal on AD-04)*

**Purpose:** Fix a plan chosen by mistake on a member's **current subscription**. It is a correction, not a renewal and not an upgrade. Owner, Supervisor and Manager (the roles that assign plans), and GymOS Support as a Supervisor (FR-251). Absent from the DOM for Receptionist and Coach.

**Entry:** [Correct plan] / [Corriger la formule] in the AD-04 View-mode header, between [Edit] and [Deactivate] (Manager and above). It is shown when the member has a current subscription, and absent from the DOM otherwise (the initial-assignment action stays the way to give a member a first plan). `[ASSUMPTION — shown for any member with a current subscription, including a deactivated one]`

**Layout, form state:**
```
Correct plan                                                     [✕]
Ange T.

Use this when the wrong plan was chosen. It isn't a renewal: no payment
is recorded, no notification is sent and no loyalty stamp is earned.

Current plan   Annual · 250,000 XAF · 365 days · Paid once
               Started 02 Nov 2026 · Expires 02 Nov 2027

New plan *     [Choose a plan                                     ▾]
Reason *       [For example: wrong plan chosen at sign-up          ]
                                                              0 / 300

The new expiry is counted from the start date (02 Nov 2026), not from today.
New expiry: 02 Dec 2026 · Active                   ← after a plan is chosen
ⓘ Ange T.'s app shows the new plan the next time it opens.
  The registration fee is not affected.

                                         [Cancel]  [Correct plan]
```

**Components:**
- **Opening check.** On open the modal asks the server whether any payment on the current subscription still stands, and shows a skeleton plus "Checking payments…" meanwhile. If something stands, the **refusal state** (below) replaces the form straight away, so nobody types a reason for an action that cannot happen. `[ASSUMPTION — the server exposes a read-only eligibility check. Without it, the refusal appears only on submit and the layout below is otherwise unchanged. The server check on submit is authoritative in both cases (Architecture Decision AD-59).]`
- **Current plan block:** read-only: plan name, price, duration, "Paid once" on an annual plan (the Plans summary line, AD-23), the subscription's **start date** and expiry.
- **New plan:** a select of this gym's active plans **except the current one**, each as the plan summary line ("Monthly · 25,000 XAF · 30 days", "Annual · 250,000 XAF · 365 days · Paid once", "Drop-in · 2,000 XAF per session"). If there is no other plan: "There is no other plan to choose. Add a plan in Plans first." with a link to AD-23, and no form fields.
- **Reason:** required; a multi-line field, 5 to 300 characters; counter. Blank blocks the button.
- **Rule line:** "The new expiry is counted from the start date ([date]), not from today." always visible, so a start date in the past is not a surprise.
- **Preview line** (appears once a plan is chosen): "New expiry: [date] · [status]" with the status as the member status badge text, or "No expiry — billed per session" for a Pay-per-session target. `[ASSUMPTION — the server returns a dry-run of the expiry and status (including any loyalty days already added to the subscription, Architecture Decision AD-59); the client never computes it.]` `[NOTE FOR UX]` If no dry-run is built, drop this line and the two warnings below, and show the real new expiry only in the success toast.
- **Warning when the result is already past:** if the preview status is Expired, a `warning` box: "With this plan, [Name]'s membership would already be expired (since [date]). You can still correct it." For Grace Period: "…would be in its grace period (until [date]). You can still correct it." The button stays enabled: the correction is allowed, the staff member is simply told. `[ASSUMPTION — warn, do not block]`
- **Notes:** "[Name]'s app shows the new plan the next time it opens." and "The registration fee is not affected." (FR-243, FR-242 assumption).
- **[Correct plan]:** primary, disabled until a plan and a valid reason are present; labelled with the action. Not a destructive confirmation, so no second dialog and Escape closes the modal (an unsaved reason is lost; no draft is kept).

**Refusal states** (the modal's body is replaced by a `neutral`-bordered message with an info icon, no red, because the staff member did nothing wrong; `role="alert"`; the only actions are the named link and [Close]). Each names what blocks it and says what to do (FR-242):

| # | Refusal | EN text (key) | Actions |
|---|---|---|---|
| F1 | A verified payment stands | "Can't correct the plan yet. The payment of 250,000 XAF on 10 Nov (Cash) is still recorded. Refund it fully first, then correct the plan." (`blocked.lead` + `blocked.verified`) | [Open payments] (AD-09 filtered to this member), [Close] |
| F2 | A payment awaits verification | "…The payment of 250,000 XAF on 10 Nov (Cash) is awaiting verification. Refund it fully first, or wait until it settles, then correct the plan." (`blocked.pending`) | As F1 |
| F3 | A Tara Money payment is in flight | "…The mobile money payment of 250,000 XAF started on 10 Nov is still in progress. Wait for it to settle. If it goes through, refund it fully, then correct the plan." (`blocked.inFlight`) | As F1 |
| F4 | A payment is only partly refunded | "…The payment of 250,000 XAF on 10 Nov (Cash) is only partly refunded (100,000 XAF of 250,000 XAF). Refund the rest first, then correct the plan." (`blocked.partlyRefunded`) | As F1 |
| F5 | More than one payment stands | The message names the **most recent** standing payment, then one extra line "+ [N] more payments on this plan are still recorded." (`blocked.more`) `[ASSUMPTION — name the most recent, count the rest]` | As F1 |
| F6 | Unused paid session, to or from Pay-per-session | "Can't move [Name] to or from Pay-per-session while an unused paid session is held. Refund it first, or wait until it is used or lapses ([date])." (`refused.sessionHeld`; date = the soonest lapse) | [Open payments], [Close] |
| F7 | Already on that plan (stale) | "[Name] is already on this plan." | Back to the form with the field marked |
| F8 | No current subscription (stale) | "[Name] has no current plan to correct." | [Close] |
| F9 | Chosen plan deleted meanwhile | "That plan is no longer available. Choose another." | Back to the form, the select refreshed |
| F10 | The subscription changed meanwhile (a renewal or another correction) | "This member's plan changed while you were working. Close this window and open the member again." | [Close] |
| F11 | Network | "Couldn't correct the plan. Check your connection and try again." inline above the buttons; the modal stays on the form | [Correct plan] stays enabled |
| F12 | Permission lost (role changed, support access ended) | The global "You don't have permission to do that." | [Close] |

F1 to F6 are the refusals the sources require. F7 to F10 are the stale-state refusals every write needs; copy is `[ASSUMPTION]`. A subscription with **no payment record** (an imported member, a payment-less renewal override) goes straight to the form; its "Started" date is the recorded start date. A voided or fully refunded payment does not block, and is not mentioned.

**Success state:** the modal closes; AD-04 refreshes in place (Plan, Expiry, status badge, Subscription started unchanged); toast `members.correctPlan.success`: "Plan corrected. Ange T. is now on Monthly; expires 02 Dec 2026." (Pay-per-session target: "Plan corrected. Ange T. is now on Drop-in."); focus returns to the [Correct plan] button. The member's current subscription keeps its start date; attendance, sessions, stamps, streaks and badges are untouched (FR-243).

**Audit line** (AD-12): Actor = the staff member (or "GymOS Support"), Action "Plan corrected" / « Formule corrigée », Target = the member, Details = "Annual → Monthly · 250,000 → 25,000 XAF · expires 02 Nov 2027 → 02 Dec 2026 · Reason: Wrong plan chosen at sign-up". Both plans, both prices, both expiries and the reason are in the one row (FR-241).

**Support:** a support person has the action as a Supervisor does, behind the second factor. `[NOTE FOR UX]` FR-189 names three step-up actions (payment-account connection, refund, staff creation). Architecture Decision AD-56 puts staff check-in "behind the step-up gate" for support; whether Correct plan, the void and the two settings also raise the step-up prompt (SA-21) is not stated. Decide the list; if yes, the prompt's bound-action line reads "You're about to: Correct plan for [Name]" and the confirm label is [Correct plan].

**Loading:** skeleton block plus "Checking payments…". **Error (load):** "Couldn't check this member's payments. Try again." with [Retry] (reuse the AD-03 pattern); the form is not shown.

---

### AD-32 · Coach Portal — Coach Picker *(V1.8, FR-247, Epic 29, read-only)*

**Purpose:** The Owner, Supervisor or Manager opens the Coach Portal, chooses one coach of their gym, and sees what that coach sees: the coach's classes and class lists, and the coach's assigned members with profile, session notes and authored workout plans. **Read-only. Body and progress data are never shown through this view** (FR-247, FR-095, NFR-011, NFR-016; OQ-34). Receptionist, Coach and GymOS Support have no picker. The picker is limited to the staff member's own gym.

**Layout:**
```
Coach Portal
Coach  [Emmanuel T.            ▾]        ⓘ You're viewing Emmanuel T.'s Coach Portal. Read-only.
[ Classes ] [ Members ]

(Classes tab: AD-21 layout, read-only)
┌────────────────────────────────────────────────────────────────┐
│ HIIT Circuit   Mon 18:00 · Wed 18:00 · Fri 18:00  Capacity 15   │
│  ▾ Fri 12 Sep · 18:00                             11/15 booked  │
│      Amara K.          ✓ attended                               │
│      Jean B.           —                                        │
│                                         [Open in Classes →]     │
├────────────────────────────────────────────────────────────────┤
│ Stretching     Tue 12:30                          Capacity 10   │
└────────────────────────────────────────────────────────────────┘

(Members tab: AD-14 layout, read-only; a row opens AD-15 in picker mode)
```

**Components:**
- **Coach select:** a single control, label "Coach" / "Choose a coach", listing **this gym's active Coach-role staff** by name (the same source as the AD-19 coach dropdown). `[ASSUMPTION — active coaches only; becomes a type-ahead combobox from 10 coaches]`. The choice is carried in the URL (`?coach=<id>`) so back, refresh and a shared link keep it. `[ASSUMPTION — query parameter]` Changing the coach reloads the current tab for the new coach and keeps the tab. With exactly one coach in the gym the select is pre-set to them `[ASSUMPTION]`.
- **Read-only banner:** always visible under the select while a coach is chosen: "You're viewing [Name]'s Coach Portal. Read-only." A `neutral` border with an eye icon, not `info` (nothing is waiting for the viewer to act, and `info` means a recoverable action). It is not dismissible.
- **Portal sub-navigation in picker mode:** **Classes** and **Members** only, in that order. Default tab: Classes `[ASSUMPTION]`. There is no Overview (it contains recent progress activity, which FR-247 excludes) and no Progress tab on a member. See "No body data" below.
- **Classes tab = AD-21 in read-only mode:** the chosen coach's classes, their sessions from 00:00 today onward, booked counts, and per session the roster (name and attendance status only), served by the same server-side functions as the coach's own view but with the coach as a parameter (Architecture Decision AD-58). **No** [+ Create class], [Edit] or [Cancel class] (absent from the DOM; this view never writes). Each class row has a text link [Open in Classes →] to AD-18 for Manager, Supervisor and Owner, where editing already lives. A Manager is not blocked from editing in AD-18; this view simply does not.
- **Members tab = AD-14 in read-only mode:** the coach's currently assigned members, same columns (Name, Plan, Status badge, Expiry, Last note snippet), search and sort. A row opens AD-15 in picker mode (same route with `?coach=`).
- **AD-15 in picker mode:**
  - Header: avatar, name, status badge, plan, expiry, goal, experience, phone (the profile the coach sees today). `[ASSUMPTION — goal and experience level are profile, not body data]`
  - The amber "This membership has expired. Contact your receptionist." bar is re-worded for this viewer: "This member's membership has expired." (it is not addressed to a coach).
  - Tabs: **Session Notes** and **Workout Plan** only.
  - **Session Notes (read-only):** the chosen coach's notes about this member, newest first, each with author and time. No [+ Add note], no Edit, no hover affordance. `[ASSUMPTION — "what that coach sees": this coach's own notes. The Owner and Manager can already read every coach's notes in AD-04, so nothing is withheld from them.]` `[NOTE FOR UX]` FR-247 says notes "as authored are shown, as they already are to Owner and Manager (FR-055)". If the product owner wants every coach's notes for the member shown here, keep the same list and label each with its author (AD-15 already prints the author).
  - **Workout Plan (read-only):** the ordered exercise list with sets, reps and notes, and the line "Workout plan written by [Name]" when the plan's author is not the chosen coach. No [Edit], no [+ New plan], no drag handle or Move up/down, no [Take ownership] banner, and **no completion or progress marks** of any kind (plan completion data is excluded, FR-247).
  - Under the tabs, one persistent line (`neutral` icon): "Body measurements, photos and progress notes aren't shown in this view."
- **No body data: the explicit states.**
  1. The persistent line above on every member page in picker mode.
  2. A direct address of an excluded part (a bookmarked `/coach/overview?coach=…`, or a member's Progress tab address): the page shows one message in place of the content, `role="status"`: "This part isn't available in this view. Body measurements, photos, progress notes and progress activity are never shown here." with links [Classes] and [Members].
  3. The picker never shows a count, a chart, a thumbnail, a "last logged" date or a "no data yet" placeholder for any body or progress item, so a viewer cannot infer whether a member logs data.
- **Not assigned (any more):** a member address whose member is not currently assigned to the chosen coach shows "[Member] isn't assigned to [Coach]." with [Back to members]; it never shows the profile. A coach who is not in this gym, or is not a coach, shows "That coach isn't available. Choose another." and clears the select. A coach who was deactivated: "[Name] is no longer a coach at this gym." (reached only by a stale link). All are the server returning nothing; the UI never reveals more.
- **No coaches:** "Your gym has no coaches yet. Add a coach in Staff." with a link to AD-16 for Owner and Supervisor; for Manager, who cannot reach Staff: "Your gym has no coaches yet. Ask an Owner or Supervisor to add one."
- **Nothing chosen:** "Choose a coach to see their classes and members." with the select focused. No coach's data loads before a choice.

**Empty states:** Classes tab "[Name] has no classes yet." Members tab "No members are assigned to [Name]." Search with no match: the AD-14 copy.

**Role visibility:** Owner, Supervisor, Manager see the picker. Receptionist and GymOS Support: the route returns the global "You don't have permission to do that." and the sidebar item is absent. Coach: sees their own portal with no picker, no banner and no `?coach=` (a typed parameter is ignored; their own id is resolved server-side).

**Audit:** none. Viewing is not a write and the same people can already read this data in AD-04 and AD-18. `[NOTE FOR UX]` Whether opening another person's coach view should be logged (read access to session notes). Not required by FR-247; flagged because notes are personal.

**Loading:** the select renders first; below it 3 skeleton class rows or 6 skeleton member rows. Each tab fails on its own with a page-level error and [Refresh], as AD-03.

---

<!-- END BLOCK 5 -->

<!-- BEGIN BLOCK 6 -->

## BLOCK 6 · Amendments to existing Admin screens

Each sub-block ends one existing screen's section. Nothing existing is deleted; where an existing line is overtaken, a `[CONFLICT]` names it.

---

### 6.1 AD-04 · Member — Detail

APPEND TO SECTION: `### AD-04 · Member — Detail` (after the V1.6 bullet "**Coach:** sees nothing new (Story 19.9). Neither section renders in AD-15.")

**V1.8 — Correct plan, subscription start, Sessions wording *(FR-241–FR-243, FR-236, FR-237; Epics 27, 28)*:**

```
[Ange T.]  [Expiring soon]     [Record session payment]  [Edit] [Correct plan] [Deactivate] [Send Invite]
Phone … Plan: Annual (250,000 XAF · 365 days · Paid once)
Subscription started 02 Nov 2026 · Expires 02 Nov 2027
```

- **[Correct plan]** *(Manager and above; absent for Receptionist and Coach).* Opens AD-31. Shown when the member has a current subscription. It is a plain secondary button in the header row, left of [Deactivate], so the three destructive or corrective actions sit together. `[ASSUMPTION — a visible button, not an overflow menu, because the desk uses it the same day a wrong plan is spotted]`
- **Subscription started** *(new read-only field, all roles that open the modal)*: "Subscription started" / « Abonnement débuté le », next to Expiry Date. `[ASSUMPTION]` It is the date Correct plan counts the new expiry from (FR-243), so staff can see it before they open the action. For a Pay-per-session member it is omitted.
- **Annual plan wording** in the Plan field uses the plan summary line (AD-23): "Annual (250,000 XAF · 365 days · Paid once)".
- **After a correction** the modal shows the new plan with no extra marker; the reason and both plans are in AD-12. `[ASSUMPTION — no "corrected" tag on the member, to keep the modal quiet]`
- **Sessions section, Single-use gyms** *(FR-237, Architecture Decision AD-55)*: a used session shows what it covered. Whole-day sessions keep today's "Covered day" wording. A session used under Single use reads "Used · visit on Thu 09 Oct, 09:02" / « Utilisée · visite du jeu. 09 oct., 09:02 », and one used for a class reads "Used · class HIIT, Thu 09 Oct" / « Utilisée · cours HIIT, jeu. 09 oct. ». Labels `members.sessions.coveredVisit` ("Covered visit") and `members.sessions.coveredClass` ("Covered class") sit beside the existing "Covered day". Rows already recorded keep the label they were recorded under; flipping the setting rewrites no row (FR-239).
- A session given back by a void (AD-11) returns to **Unused** with its original lapse date and no marker `[ASSUMPTION]`.
- **Coach:** sees none of this (AD-15 is unchanged for the Coach role).

---

### 6.2 AD-11 · Attendance

APPEND TO SECTION: `### AD-11 · Attendance` (after the V1.6 paragraph ending "Blocked attempts are listed only on AD-22.")

**V1.8 — Check in a member, entry marker, void *(FR-248–FR-250, Epic 27; user decision 2026-11-15)*.**

**Layout (changes only):**
```
Attendance                                          [Check in a member]      ← Receptionist and above

[Front-Desk Alert Panel — unchanged; no alert for a staff member's own entry]

Currently Checked In   (N members)                                 [Refresh]
┌────────────────────────────────────────────────────────────────────────────┐
│ Name       Check-in time   Entry                    Status   Actions        │
│ Ange T.    07:02           By staff · Brice N.      Active   [Check Out][Void]│
│ Jean B.    06:40           QR scan                  Active   [Check Out]     │
└────────────────────────────────────────────────────────────────────────────┘

Daily Log
┌────────────────────────────────────────────────────────────────────────────┐
│ Member     Check-in   Check-out   Duration   Entry                           │
│ Ange T.    07:02      —           Open       By staff · Brice N.   [Void]    │
│ Paul E.    06:50      06:51       1m         By staff · Aicha M.   Voided    │   ← muted row
│ Amara K.   08:14      10:02       1h 48m     QR scan                          │
└────────────────────────────────────────────────────────────────────────────┘
```

**Components (V1.8):**
- **[Check in a member]**: primary page action, right-aligned in the page header, Receptionist and above (every role that sees AD-11), and GymOS Support. Opens AD-30. Absent from the DOM for Coach (who has no AD-11).
- **Entry column** (new, in both tables): plain text, never colour-coded. A scan reads "QR scan" / « Scan du QR ». A staff entry shows the neutral pill **"By staff"** / « Par le personnel » followed by "· [Name]" of the staff member who entered it, e.g. "By staff · Brice N." The pill is the same neutral treatment as the AD-16 "Created by GymOS Support" pill: icon plus text, no colour signal. A support entry reads "By staff · GymOS Support" (Support Identity Rule: never a name, initials or count). Members whose visit predates V1.8 show "QR scan" (all earlier check-ins were scans). `[ASSUMPTION — historic rows read "QR scan"]`
- **Narrow widths:** the staff name part of the cell follows the existing "Actor" column rule and is hidden under 1024 px; the **"By staff" pill always stays**, so a staff entry is never mistaken for a scan.
- **[Void]** (row action, Manager and above; GymOS Support): shown on a row only when **all** hold: the entry is a staff entry, it was made on the current gym-local day, and it is not already voided. Otherwise it is absent from the DOM (a Receptionist never sees it; nobody sees it on a scan or on yesterday's row). It sits next to [Check Out] in Currently Checked In, and alone in the Daily Log row of a closed visit. Its accessible name includes the member and time ("Void the check-in of Ange T. at 07:02").
- **Voided rows** *(Daily Log)*: stay in the log, **muted** (the AD-04 "voided" muted-row treatment), with the neutral pill "Voided" / « Annulée » in the Check-out cell and a tooltip and row detail "Voided by [Name] on [date] at [time]. Reason: [reason]". They are **excluded** from Currently Checked In and from the "N members" count, and from every count the product makes (occupancy, streaks, rank, the challenge). They are shown by default, with no toggle, so the log stays honest; a voided row is never deletable. `[ASSUMPTION]`
- **Front-desk alerts:** unchanged. A staff entry or void raises none.

**Void modal** *(Manager and above; Escape disabled, as other consequential confirmations; focus opens on [Keep check-in])*:
```
Void this check-in?                                              [✕]

Ange T.'s check-in at 07:02 was entered by staff. Voiding it removes the
visit: it stops counting for occupancy, streaks, rank and the gym challenge.

The paid session this check-in used is given back to Ange T.      ← only if a session was used
The payment stays on record. Refund it in Payments if you need to. ← only with the line above
The loyalty stamp it earned is removed.                            ← only if a stamp was earned

Reason for voiding *
[For example: wrong member selected                          ]
                                                          0 / 300

                                  [Keep check-in]  [Void check-in]
```
- **Reason:** required; 5 to 300 characters; blank blocks [Void check-in]. `[ASSUMPTION — same limits as Correct plan]`
- **Conditional lines** are shown only when they apply (the server reports whether the entry consumed a session and earned a stamp). `[ASSUMPTION]` They state the effect so a Manager is not surprised that a void gives a session back but does not refund money (FR-250's void; Architecture Decision AD-56).
- **Success:** the modal closes; the row is muted and marked "Voided"; if the visit was open it leaves Currently Checked In; toast "Check-in voided. [Name] is no longer counted as in the gym."
- **Refusals** (inline above the buttons, `role="alert"`, modal stays open; EN copy in the catalog, Group B):
  | Refusal | Message | Action |
  |---|---|---|
  | A later same-day visit relies on this entry's paid session | "Can't void this check-in: [Name]'s later visit today relies on the same paid session." + "Void the later check-in first." only when the later visit was a staff entry | [Close] |
  | Not the same gym-local day (stale tab left open past midnight) | "A check-in can only be voided on the day it was entered." | [Close] |
  | Already voided (two people at once) | "This check-in was already voided." | [Close], list refreshes |
  | Not a staff entry (stale) | "Only check-ins entered by staff can be voided." | [Close] |
  | Network | "Couldn't void the check-in. Check your connection and try again." | [Void check-in] stays |
  A **scan** can never be voided (FR-250: a correction of a staff mistake, not anti-cheat). `[NOTE FOR UX]` When the later visit is a scan and the earlier one is a staff entry, the void can never happen the same day; the message above is the end of the road. If the first gym meets this, the answer is a Manager checking the member out and leaving both visits.
- **The member is not told.** A void shows no notification in the app; the visit disappears from the member's History. `[NOTE FOR UX]` Confirm that silence is right for a member who saw the check-in confirmation.

**Support attribution:** the Entry cell, the void text and the audit rows show "GymOS Support" for support actions (Support Identity Rule; add AD-11's Entry cell and the void dialog to the per-surface test list).

**Empty states** (unchanged copy): Currently Checked In "No one is checked in right now."; Daily Log "No check-ins recorded for this period." A day whose only entries are voided shows the voided rows muted (the log is not empty), and Currently Checked In reads "No one is checked in right now."

**Error state:** if the Entry column cannot be resolved (a staff member's name fails to load), the cell reads "By staff" with no name and the row stays usable; it never blocks the page. The page-level load error and [Refresh] are unchanged (AD-03 pattern).

**Responsive:** see Block 9. **Realtime:** a check-in or void entered on another desk appears in Currently Checked In through the existing realtime channel; a void removes the row without a reload.

---

### 6.3 AD-12 · Audit Log

APPEND TO SECTION: `### AD-12 · Audit Log` (after the V1.6 action-labels table)

**V1.8 — New action labels *(FR-080 amended by FR-234, FR-236, FR-241, FR-244, FR-246, FR-250)*.** Same short past-tense style. Keys and FR are in the catalog (Group H).

| Event | EN | FR | Details cell |
|---|---|---|---|
| Staff check-in | "Member checked in by staff" | « Arrivée d'un membre enregistrée par le personnel » | Time; outcome; "Checked in with a warning" for Expiring Soon and Grace Period |
| Staff check-in not accepted | "Staff check-in not accepted" | « Arrivée par le personnel refusée » | Reason code in plain words (expired, no paid session, deactivated, …) |
| Staff check-in voided | "Staff check-in voided" | « Arrivée par le personnel annulée » | Original entry time, reason |
| Plan corrected | "Plan corrected" | « Formule corrigée » | "Annual → Monthly · 250,000 → 25,000 XAF · expires 02 Nov 2027 → 02 Dec 2026 · Reason: …" |
| Session validity changed | "Session validity changed" | « Validité de la séance modifiée » | "Whole day → Single use" |
| Gym challenge set / cancelled | "Gym challenge set" / "Gym challenge cancelled" | « Défi de la salle défini » / « Défi de la salle annulé » | "[Month] · target [N] · reward [text]" / "[Month]" |
| Class weekly times changed | "Class weekly times changed" | « Horaires du cours modifiés » `[ASSUMPTION — audited, FR-080's spirit]` | Class name; old → new summary; "[N] sessions with bookings left unchanged" |
| Class cancelled / created by a coach | "Class cancelled" / "Class created" | « Cours annulé » / « Cours créé » `[ASSUMPTION]` | Class name; "[N] bookings cancelled" |

Actor for all of the above: the staff member's display name and role, or "GymOS Support" with role "Support" (Support Identity Rule). A rejected staff attempt by a Receptionist is visible in the log to Manager and above (the page's existing access).

---

### 6.4 AD-13 · Settings

APPEND TO SECTION: `### AD-13 · Settings` (after the V1.6 "Category" paragraph)

**V1.8 — Session validity and Gym challenge *(FR-236, FR-239, FR-234; Epics 28, 31)*.** Both sections follow the V1.6 and V1.7 pattern: Owner and Supervisor only (GymOS Support as a Supervisor); absent from the DOM for everyone else; each saves on its own and is **excluded from [Save Settings]** (Architecture Decision AD-32, AD-61).

`[CONFLICT]` with the V1.6/V1.7 hint line "Save applies changes across every section below… except Registration fee, Charge guests per session, Loyalty program, Category, Allow GymOS Support and Landing page, which save on their own." V1.8 adds two more. The hint gains: "…, Session validity and Gym challenge" / « …, Validité de la séance et Défi de la salle ».

**Placement:** Session validity sits **directly under "Charge guests per session"** (the two read as one subject) and above "Loyalty program". Gym challenge sits **after "Loyalty program"**, as the last member-facing section. `[ASSUMPTION — order]`

**Layout:**
```
── Charge guests per session ──────────────────────────────────────── V1.6
Charge guests per session   [ On ● ]
Pay-per-session members need a paid session to check in or attend a class.
One session covers one visit.                          ← reads the setting below

── Session validity ───────────────────────────────────────────────── V1.8
( ) Whole day    A paid session covers every check-in until the end of the day.
(•) Single use   A paid session covers one visit. A visit ends at check-out,
                 or 3 hours after check-in, whichever comes first.
                 A class attended during an open visit uses that visit's
                 session. Otherwise it uses its own session.
ⓘ Single use earns loyalty stamps faster: one per paid session. Check your
  loyalty setting.                                     ← only if loyalty is on
ⓘ Takes effect when "Charge guests per session" is on. ← only while charging is off
The change applies to check-ins from now on. A visit already open finishes
under the old rule, and sessions already used keep their coverage.
                                              [Save session validity]

── Gym challenge ───────────────────────────────────────────── V1.8 · Could
A monthly goal for all your members together: visit days in the month.
The reward is your promise; GymOS doesn't give or pay it.

December 2026  (next month)
  Target (visit days, all members together) *   [ 1,000 ]
  Reward *   [ A free smoothie for everyone                    ]   0 / 120
  Set it before the month starts. Once set, the target and reward can't change.
                                           [Set challenge for December]
```

**Session validity (AD-13, new section):**
- A radio group "Session validity" / « Validité de la séance » with two options and their descriptions (catalog Group D). The default and the value for every existing gym is **Whole day**, so nothing changes until an Owner or Supervisor chooses (FR-236).
- The "3 hours" in the Single-use description is read from the platform value (Architecture Decision AD-55: `single_use_visit_limit_minutes`, 180), never typed into the string. `[ASSUMPTION — the text is built from the platform value]`
- **Always editable.** While "Charge guests per session" is off, the section still saves, and an info line states "Takes effect when "Charge guests per session" is on." `[ASSUMPTION — editable so an Owner can prepare; the V1.6 Loyalty section disables inputs when off, but there the inputs would be meaningless, and here the choice is one switch]`
- **No confirmation dialog** (the Loyalty precedent: inline notes instead). The consequences are written on the screen: "The change applies to check-ins from now on. A visit already open finishes under the old rule, and sessions already used keep their coverage." `[NOTE FOR UX]` The V1.6 charging switch has a both-ways dialog because it is a kill switch with a member-visible effect. Switching to Single use also changes what members pay. If the product owner prefers a dialog, copy the AD-13 charge-guests dialog pattern with the Group D body text.
- **Loyalty note** shown only when the loyalty program is on and the chosen option is Single use (FR-239).
- **[Save session validity]**: enabled only when the choice differs from the saved value. Toast "Session validity saved." Audit row "Session validity changed" with "Whole day → Single use".
- **Errors:** inline, "Couldn't save session validity. Try again." The radio stays where the user left it.
- **Dependent wording, V1.8:** the **Charge guests per session** helper changes with the setting: Whole day keeps "One session covers the whole day."; Single use reads "One session covers one visit." The turn-on dialog's scope line is unchanged. AD-22's Used column and AD-04's Sessions use the matching wording (see 6.9, 6.1).
- **Old member apps:** `[NOTE FOR UX]` V1.6 warned the Owner that old app builds show a refused guest the "expired" screen. Whether a similar warning is needed for Single use (an old build may not understand the visit rule) depends on mobile; not drafted.

**Gym challenge (AD-13, new section, Could: ships only if ready, its absence never holds the release):**
- **What the section shows** depends on the state of the two months it concerns. At most two lines exist at once, "This month" and "Next month":
  | State | Shown | Actions |
  |---|---|---|
  | No challenge for next month | The form: Month (read-only, the next gym-local month), Target, Reward, the fixed-note, [Set challenge for [Month]] | Set |
  | Challenge set for next month | "The [Month] challenge is set: [N] visit days. Reward: [text]. It starts on [date]." (read-only) | [Cancel challenge] |
  | Challenge running this month | "[Month] challenge: [done] / [N] visit days. Reward: [text]." The progress is a count only, never a list of members | [Cancel challenge] |
  | Target reached this month | The running line plus "Target reached." | [Cancel challenge] stays |
  | Cancelled (this or next month) | "The [Month] challenge was cancelled. It can't be set again for [Month]." (muted) | none; the form for the **following** month, if any, is not offered until that month is next |
  | Challenge ended (past month) | Not shown; no history list `[ASSUMPTION]` | — |
- **Only the next month can be set** `[ASSUMPTION]`: FR-234 says a challenge is created for a month that has not yet started. Offering only the next month keeps one clear rule and one field set: "Month" is text, not a picker. A gym that wants this month's challenge cannot have one (the helper says why).
- **Target:** whole number of visit days, 1 or more (upper bound `[ASSUMPTION]` 100,000), counted across all the gym's members in the month. **Reward:** free text, 1 to 120 characters; helper "Write what you promise…". The reward line says what it is: the gym's promise. No field, wording or default implies money, a session, a Shield or a loyalty stamp (FR-234).
- **[Set challenge for [Month]]** opens a confirmation (Escape disabled): "Set the December challenge?" with the exact target and reward and the two consequences, [Back] and [Set challenge]. Because the target and reward cannot be edited afterwards, the dialog is the last chance to correct a typo.
- **[Cancel challenge]** opens "Cancel the December challenge?" with [Keep challenge] and [Cancel challenge]. Members stop seeing it straight away; the month cannot be given another challenge.
- **Errors:** "Couldn't save the challenge. Try again."; a stale "…has already started, so a challenge can't be set for it."; "A challenge already exists for [Month]." (two people at once).
- **Audit:** "Gym challenge set" with month, target and reward; "Gym challenge cancelled" with the month.
- `[NOTE FOR UX]` Whether the Owner wants a history of past challenges. Not in FR-234; left out for simplicity.

---

### 6.5 AD-14 · Coach Portal — Member List and AD-15 · Coach Portal — Member Detail

APPEND TO SECTION: `### AD-14 · Coach Portal — Member List`, and APPEND TO SECTION: `### AD-15 · Coach Portal — Member Detail`

**V1.8 — picker mode *(FR-247)*.** Both screens render for Owner, Supervisor and Manager when a coach is chosen in AD-32, with the same columns and layout but **read-only** and **without body or progress data**. AD-32 is the specification of that mode; this paragraph only records the differences so a developer reading AD-14 or AD-15 finds them:

- **AD-14:** the list is the chosen coach's currently assigned members; the empty state is "No members are assigned to [Name]." In picker mode the existing empty-state copy ("Ask your Manager, Owner, or Supervisor to assign members.") is not used.
- **AD-15:** tabs are **Session Notes** and **Workout Plan** only. The **Progress tab is absent** (not locked, not blurred, not empty). No [+ Add note], Edit, [+ New plan], reorder controls or [Take ownership] banner. The expired bar reads "This member's membership has expired." The line "Body measurements, photos and progress notes aren't shown in this view." sits under the tabs.
- `[CONFLICT]` with AD-15's Progress tab ("Same weight trend chart + measurements as MA-15") and with AD-04's "Coach Notes tab: Manager/Owner see all coaches' notes": the picker shows no progress data at all, and shows the chosen coach's own notes (see the `[NOTE FOR UX]` in AD-32).
- For the **Coach role** nothing changes: their own AD-14 and AD-15, including the Progress tab for their assigned members, stay exactly as specified.

---

### 6.6 AD-18 · Classes — List & Attendance

APPEND TO SECTION: `### AD-18 · Classes — List & Attendance *(V1.5)*` (after the V1.6 paragraph ending "…'Aucune séance à venir' → 'Aucun cours à venir'.")

**V1.8 — weekly times in the list, Cancel class, left-unchanged tag *(FR-244, FR-245, FR-246; Epic 29)*.**

- **Schedule column:** a recurring class's times are summarised as the days with the same hour grouped, in week order starting Monday: "Mon 07:00 · Wed 18:30 · Sat 09:00", or "Tue, Thu 18:00 · Sat 09:00". Four or more groups truncate to three plus "+N more" with a tooltip carrying the full list. A one-off class keeps its date. The Schedule column reads the same for a class migrated from the old model ("Tue, Thu 18:00"): the migration is invisible (FR-245). Times are 24-hour, in the gym's time zone. `[ASSUMPTION — Monday-first order and grouping rule]`
- **Row actions (Manager and above):** [Edit] (existing) and **[Cancel class]** / [Annuler le cours]. [Cancel class] opens the dialog below. Both are absent from the DOM for Receptionist. A cancelled class shows the neutral badge **"Cancelled"** / « Annulé », sorts below the live classes, and offers neither action. `[ASSUMPTION — cancelled classes stay listed so past attendance remains reachable; no filter]`
- **Cancel class dialog** *(Manager and above; also used by a Coach for own classes from AD-21; Escape disabled)*:
  ```
  Cancel Pilates?                                                   [✕]
  All upcoming sessions are cancelled, and 8 bookings are cancelled.
  Past sessions and attendance stay on record.
                                         [Keep class]  [Cancel class]
  ```
  Zero bookings: "All upcoming sessions are cancelled. Nobody has booked yet." The buttons are named by action ([Keep class], [Cancel class]); the generic [Cancel] is not used, so it cannot be read as "cancel this dialog". The booking count comes from the server. Success toast "[Class] cancelled." Refusals: "This class was already cancelled."; "You can only change your own classes." (a Coach, stale); "Couldn't cancel the class. Try again."
  `[NOTE FOR UX]` FR-246 grants "cancel classes", and Architecture Decision AD-57 adds one `cancel_class` function. The sources do not say whether booked members are told. The dialog says only what is known (bookings are cancelled). Decide whether booked members get a notification, and if a single session can be cancelled without cancelling the class (not drafted).
- **Session rows kept on the old time:** after a weekly-times edit (AD-19), a future session that has bookings and no longer matches the new times shows the muted tag **"Old time"** / « Ancien horaire » in the expanded row, so the list the editor saw once can be found again. `[ASSUMPTION — the server can tell, by comparing a session to the class's times]`
- Receptionist: no change except that they see the new Schedule column wording.

---

### 6.7 AD-19 · Classes — Create / Edit

APPEND TO SECTION: `### AD-19 · Classes — Create / Edit *(V1.5, modal on AD-18)*`

**V1.8 — the weekly-times editor *(FR-244, FR-245; Epic 29)*.** `[CONFLICT]` with AD-19's Schedule block ("Days [Tue] [Thu], Time [6:00 PM]") and its rule "recurring requires ≥1 day-of-week + a time + a start date": a recurring class now holds a list of **weekly times** (a day and an hour each), so one class can run at a different hour on each day.

**Layout (recurring, replaces the Days/Time lines):**
```
Create Class                                                    [x]

Name *              [ Pilates                          ]
Description         [                                  ]
Coach *             [Select coach ▾]          ← Manager and above; Coach-role: fixed text, see below
Capacity *          [  15  ] members

Schedule *
  ○ One-off    ● Recurring
  Starting      [ 17 Nov 2026 ]

  Weekly times *                                              3 of 14
  ┌────────────────────────────────────────────────────────────────┐
  │ Day [Monday     ▾]  Time [ 07:00 ]                    [Remove] │
  │ Day [Wednesday  ▾]  Time [ 18:30 ]                    [Remove] │
  │ Day [Saturday   ▾]  Time [ 09:00 ]                    [Remove] │
  └────────────────────────────────────────────────────────────────┘
  [+ Add a time]
  Times are in the gym's time zone (Africa/Douala).

                                          [Cancel]  [Create class]
```

**Behaviours:**
- **One row per time.** Each row has a Day select (Monday to Sunday, in that order; storage convention is not shown) and a Time field (24-hour, to the minute), and a [Remove] button. The same weekday may appear more than once at different times. Rows are shown in week order, Monday first; the order re-sorts when a row loses focus or on save. `[ASSUMPTION — display order]`
- **[+ Add a time]** appends a row **pre-filled with the next weekday after the last row and the same time as the last row**, and moves focus to its Day select, so "Tue and Thu at 18:00" is one row plus one tap and a weekday change. `[ASSUMPTION — pre-fill]`
- **Limit:** up to 14 times per class `[ASSUMPTION — FR-244]`. The counter "[n] of 14" is always visible. At 14, [+ Add a time] stays visible and is `aria-disabled`, with the line "A class can have up to 14 weekly times." This is a rule shown, not a role-hidden control, so it is disabled rather than absent.
- **Last row:** [Remove] on the only remaining row is allowed; the form then shows the "Add at least one day and time." error on save. A recurring class cannot be saved with no time.
- **Length** *(FR-244 "and the class's length where the class has one")*: the shipped class has no length field, so none is shown. `[NOTE FOR UX]` If a class length is added later, it becomes a third field on each row.
- **Switching One-off ↔ Recurring** keeps what was entered for the other mode until save, so toggling by accident loses nothing.
- **One-off** is unchanged: one date and time.
- **Migration is invisible** (FR-245): opening an existing recurring class shows its old days as one row per day, all at its old hour. No banner, no "migrated" label, no change to its sessions or bookings.

**Validation** (inline per row, `aria-describedby`, error summary on submit; full table in Block 7): at least one row; every row needs a day and a valid time; the same weekday and time twice is refused on the later row.

**Editing a class that has upcoming sessions** *(FR-245)*:
- A notice sits above "Weekly times": "Changes apply to upcoming sessions that nobody has booked. Sessions with bookings stay as they are, and you'll see them after you save." (`info` icon, not a warning: it is a rule, not a problem).
- On **Save**, the modal does not just close. It shows a **result view** in the same modal:
  ```
  Class saved                                                     [x]
  Weekly times: Mon 07:00 · Wed 18:30 · Sat 09:00

  2 sessions with bookings were left unchanged
  They keep their old time and their bookings.
    Wed 18 Nov · 18:00 · 8 / 15 booked
    Fri 20 Nov · 18:00 · 12 / 15 booked

                                                            [Done]
  ```
  - The list is **the future sessions that have bookings and were therefore left as they were**, with date, hour and "[n] / [capacity] booked". It is read-only here; the editor decides outside the modal (talk to the coach and the members; the sessions are still on AD-18 with the "Old time" tag).
  - When nothing was left unchanged, the result view is skipped for a create, and for an edit shows one line "Nothing was left unchanged. Upcoming sessions follow the new times." with [Done]. `[ASSUMPTION]` A **create** never has bookings, so it closes on save as today and the new class appears in AD-18's list.
  - Focus moves to the result heading; [Done] closes the modal and returns focus to the class's [Edit] button.
  `[NOTE FOR UX]` The sources say the sessions "are listed to the editor, who decides what to do with it" but no action exists to move or cancel one session (FR-245, Architecture Decision AD-57 returns them). The list is informational. Decide whether a per-session [Cancel this session] or [Move] is wanted; both would touch bookings.
- **Concurrency:** if a booking lands on a session while the editor is saving, the server leaves that session as it is and lists it. The editor never sees an error for it.

**Coach mode (opened from AD-21, a Coach on their own class):** identical fields, with **Coach** shown as plain text of the signed-in coach (`classes.coach.fixed` with the helper "Classes you create are taught by you."), not a select. A Coach cannot choose another coach and cannot open a class that is not theirs (the server refuses with "You can only change your own classes."). Title "Create Class" / "Edit Class" as for the other roles. A Manager, Supervisor or Owner editing the same class sees the full Coach select.

---

### 6.8 AD-20 · Coach Portal — Overview and AD-21 · Coach Portal — My Classes

APPEND TO SECTION: `### AD-20 · Coach Portal — Overview`

**V1.8:** unchanged for the Coach role. In picker mode (AD-32) there is **no Overview**: it contains "Recent Progress Activity", which FR-247 excludes, and "Needs Follow-Up", which is a coaching instrument rather than a roster. A direct address shows the "This part isn't available in this view…" message (AD-32).

APPEND TO SECTION: `### AD-21 · Coach Portal — My Classes`

**V1.8 — a Coach creates, edits and cancels own classes *(FR-246; Epic 29)*.** `[CONFLICT]` with AD-21's Purpose "Read-only", its Components line "**No write controls anywhere on this screen** — no create, edit, reschedule…", and the sidebar sentence "a Coach… cannot create or edit a class". Those lines now apply only to **class attendance** and to every class that is not the Coach's own. A Coach still cannot mark attendance, cannot assign another coach, and cannot reach AD-18 (the admin Classes page stays closed to the Coach role).

**Layout (changes only):**
```
Coach Portal
[ Overview ] [ My Members ] [ My Classes ]                       [+ Create class]
┌────────────────────────────────────────────────────────────────────────────┐
│ HIIT Circuit   Mon 18:00 · Wed 18:00 · Fri 18:00   Capacity 15   [Edit] [Cancel class] │
│  ▾ Fri 12 Sep · 18:00                                         11/15 booked │
│      Amara K.          ✓ attended   (read-only)                            │
```

- **[+ Create class]** (page action, Coach role only): opens AD-19 in Coach mode. On save the class appears in this list, and (as for any class) in AD-18 for Receptionist and above, and in the member app's class list.
- **[Edit] and [Cancel class]** per class row: shown only for classes whose coach is the signed-in Coach (every row on this page, since the list is the Coach's own). The **roster and attendance stay read-only**: no mark-attendance control, no checkbox, no booking add or remove.
- **Edit** opens AD-19 in Coach mode with the weekly-times editor and the left-unchanged result view; **Cancel class** opens the Cancel class dialog (AD-18 6.6).
- **Empty state** *(replaces the Components empty line)*: "You don't have any classes yet. Create one, or ask your manager to assign you to a class." with [+ Create class] (`classes.coach.empty`). `[CONFLICT]` with "You are not assigned to any classes yet. Your manager schedules classes and assigns a coach."
- **Picker mode:** the same list for another coach, **read-only**: no [+ Create class], [Edit] or [Cancel class] (AD-32).
- **Loading and errors:** unchanged. A failed create or edit shows the AD-19 inline errors; a Coach whose own-class check fails server-side (a stale tab after reassignment) sees "You can only change your own classes."

---

### 6.9 AD-22 · Guest Sessions

APPEND TO SECTION: `### AD-22 · Guest Sessions (drill-down) *(V1.6, FR-163, Story 19.10)*`

**V1.8 *(FR-237, FR-239, FR-249; Epics 27, 28)*:**
- **Blocked attempts → Source** gains the value **"Desk check-in"** / « Arrivée à l'accueil » (a rejected staff check-in for a Pay-per-session member with no usable session, AD-30 R5), beside "Check-in" and "Class: [name]". `[ASSUMPTION — label]`
- **Paid → Used column:** reads "covered day" (Whole day), "visit [date], [time]" (Single use) or "class [name], [date]" (class), by how the session was used. Counts stay "consumed sessions" under either setting (FR-239).
- No other change.

---

### 6.10 AD-23 · Plans

APPEND TO SECTION: `### AD-23 · Plans *(shipped; documented V1.6 with the FR-173 plan-type lock)*`

**V1.8 — annual plan wording *(FR-240; Epic 27)*.** The first gym found the annual flow unclear. An annual plan is a plan with an **annual billing interval**: the member pays the whole price **once**, and the subscription runs for the plan's duration. A monthly plan and an annual plan are two separate plans. **Paying an annual plan in instalments is not supported in V1.8.** The dashboard now says so in plain words wherever an annual plan is described.

- **List row, annual interval:** "XAF 250,000 · 365 days · Paid once" / « 250 000 XAF · 365 jours · Payé en une fois », in place of the shipped "/ monthly" suffix, with the duration shown as the second figure. When the plan carries an annual discount, a muted second line "Includes 15% annual discount" / « Dont 15 % de remise annuelle ». The monthly row keeps "XAF 25,000 / monthly · 30 days" as shipped; the Pay-per-session row keeps "XAF 2,000 / session".
- **The summary line** "[price] XAF · [duration] days · Paid once" is **one reusable line** used in: the AD-23 list, the PlanModal helper, every plan select in the dashboard (AD-05, the Inline Renewal Panel, and the AD-31 Correct plan select) and the plan name area of the AD-04 modal. A developer builds it once.
- **PlanModal, when Billing Interval is Annual:** under the Billing Interval field, helper text "Members pay the full price once. The plan then runs for [D] days. Renewing is a new payment." (with [D] from the Duration field; before it is filled, "…for the duration below."), then "To let members pay monthly, create a separate monthly plan. Paying an annual plan in instalments isn't available."
- **Annual discount field** (existing): its helper stays; the discount is part of the price shown on the card ("Includes [x]% annual discount").
- `[ASSUMPTION]` A plan's duration is not changed when the interval is switched. `[NOTE FOR UX]` Whether choosing Annual should pre-fill Duration with 365; a pre-fill could overwrite a deliberate number, so it is not drafted.
- `[NOTE FOR UX]` The same wording ("Paid once") may belong in PS-01's plan details and the MA-13 member plan screen. FR-240 says "on the dashboard"; the public page and the app are not changed by this block.

<!-- END BLOCK 6 -->

---

<!-- BEGIN BLOCK 7 -->

## BLOCK 7 · Form Validation Rules

APPEND TO SECTION: `### Admin Dashboard` (the one under `## Form Validation Rules`, after the last AD table)

**AD-30 Check in a member (V1.8)**
| Field | Rule | Error |
|---|---|---|
| Search | Needs 2 letters or 3 digits before it queries; this gym only; at most 8 results | Hint: "Type at least 2 letters or 3 digits." No match: "No member matches "[term]". Check the spelling, or search by phone." |
| Member (radio) | Exactly one chosen; [Check in [Name]] disabled until then | None (the button state is the signal) |
| Time of entry | Not an input. Always the server's current time | — |

**Void a staff check-in (V1.8)**
| Field | Rule | Error |
|---|---|---|
| Reason | Required; trimmed 5 to 300 characters | "Enter a reason (at least 5 characters)." |
| (Server) | Staff entry; same gym-local day; not already voided; no later same-day visit relying on its session | See AD-11 refusals |

**AD-31 Correct plan (V1.8)**
| Field | Rule | Error |
|---|---|---|
| New plan | Required; an active plan of this gym; not the current plan | "Choose a plan" (field error key `members.correctPlan.newPlan.error`) |
| Reason | Required; trimmed 5 to 300 characters | "Enter a reason (at least 5 characters)." |
| (Server) | No payment on the current subscription stands (verified, pending, in flight, partly refunded all stand); no unused paid session when moving to or from Pay-per-session; subscription unchanged since the modal opened | See AD-31 refusals F1 to F10 |

**AD-13 Session validity (V1.8)**
| Field | Rule | Error |
|---|---|---|
| Session validity | One of Whole day, Single use; [Save session validity] enabled only on a change | "Couldn't save session validity. Try again." |

**AD-13 Gym challenge (V1.8, Could)**
| Field | Rule | Error |
|---|---|---|
| Month | Not editable: the next gym-local month | Stale: "[Month] has already started, so a challenge can't be set for it." |
| Target | Required; whole number, 1 to 100,000 `[ASSUMPTION — upper bound]` | "Enter a whole number of visit days, 1 or more." |
| Reward | Required; trimmed 1 to 120 characters; plain text | "Write the reward (up to 120 characters)." |
| (Server) | One challenge per gym per month, cancelled ones included | "A challenge already exists for [Month]." |

**AD-19 Weekly times (V1.8)**
| Field | Rule | Error |
|---|---|---|
| Weekly times (list) | Recurring: at least 1 row, at most 14 `[ASSUMPTION — FR-244]` | "Add at least one day and time." |
| Day (per row) | Required; Monday to Sunday | "Choose a day." |
| Time (per row) | Required; 24-hour `HH:MM` | "Enter a time, for example 18:30." |
| Day + Time pair | Unique within the class (the same weekday twice at different times is allowed) | "This day and time is already in the list." (on the later row) |
| Starting | As V1.5: required for recurring; not before today for a new class | As shipped |
| Coach (Coach mode) | Not an input; the signed-in Coach | Stale: "You can only change your own classes." |

**AD-23 Plan, annual interval (V1.8)**: no new rules. The helper text only (see AD-23).

<!-- END BLOCK 7 -->

---

<!-- BEGIN BLOCK 8 -->

## BLOCK 8 · Empty states and V1.8 state patterns

**8a.** APPEND TO SECTION: `### Empty States` (table; add after the V1.7 rows)

| Surface / Context | Copy | Primary action |
|---|---|---|
| AD-30 before typing *(V1.8)* | "Type at least 2 letters or 3 digits." / « Saisissez au moins 2 lettres ou 3 chiffres. » | None |
| AD-30 no match *(V1.8)* | "No member matches "[term]". Check the spelling, or search by phone." / « Aucun membre ne correspond à « [terme] ». Vérifiez l'orthographe ou cherchez par téléphone. » | [Clear search] |
| AD-11 Currently Checked-In / Daily Log *(V1.8)* | Existing copy. A day with only voided entries is not empty: the Daily Log shows them muted | — |
| AD-13 Gym challenge, none for next month *(V1.8)* | "No challenge for [Month]." with the form | [Set challenge for [Month]] |
| AD-19 result, nothing left unchanged *(V1.8)* | "Nothing was left unchanged. Upcoming sessions follow the new times." / « Rien n'a été laissé tel quel. Les prochains cours suivent les nouveaux horaires. » | [Done] |
| AD-21 My Classes, Coach with none *(V1.8)* | "You don't have any classes yet. Create one, or ask your manager to assign you to a class." / « Vous n'avez pas encore de cours. Créez-en un, ou demandez à votre responsable de vous en attribuer un. » | [+ Create class] |
| AD-32 nothing chosen *(V1.8)* | "Choose a coach to see their classes and members." / « Choisissez un coach pour voir ses cours et ses membres. » | The coach select |
| AD-32 gym has no coaches *(V1.8)* | "Your gym has no coaches yet. Add a coach in Staff." (Owner, Supervisor) / "…Ask an Owner or Supervisor to add one." (Manager) | [Open Staff →] (Owner, Supervisor) |
| AD-32 Classes tab, no classes *(V1.8)* | "[Name] has no classes yet." / « [Nom] n'a pas encore de cours. » | None |
| AD-32 Members tab, none assigned *(V1.8)* | "No members are assigned to [Name]." / « Aucun membre n'est attribué à [Nom]. » | None |
| AD-32 excluded part, direct address *(V1.8)* | "This part isn't available in this view. Body measurements, photos, progress notes and progress activity are never shown here." | [Classes] [Members] |

**8b.** INSERT AFTER: the section `### V1.7 — New State Patterns` (before `## Interaction Primitives`)

### V1.8 — New State Patterns

V1.8 adds one small decision table for staff check-in, one for plan correction, and one classification for weekly-times edits. Defaults are conservative: existing gyms stay on Whole day, have no challenge, and keep their classes' times exactly as they were.

**Staff check-in outcome *(FR-249; the same decision as a scan, plus a place to act)*:**
| Member / gym state | Result | Attendance written | Alert panel | What the staff member can do in place |
|---|---|---|---|---|
| Active | R1 checked in | Yes (source staff) | No | Another member, Done |
| Expiring Soon | R2 checked in with warning | Yes | No | Renew now |
| Grace Period | R3 checked in with warning | Yes | No | Renew now |
| Expired | R4 not checked in | No | No | Renew now, then the check-in completes |
| Pay-per-session, charging on, no usable session | R5 no paid session | No (until paid) | No | Record the desk payment, then the check-in completes |
| Pay-per-session, charging on, a usable session | R1 | Yes; consumes a session under the gym's Session validity | No | — |
| Pay-per-session, charging off or price 0 | R1 | Yes | No | — |
| Already checked in (open visit) | R7 | No | No | Another member, Done |
| Deactivated / awaiting registration fee / no plan | R8 | No | No | Open the member |
| Gym suspended | R9 | No | No | Done |
- Every row writes one AD-12 entry (accepted, or "not accepted"), except R7 `[ASSUMPTION]`.
- **Single use:** an open visit older than the visit limit (3 hours) is closed by the server and a new visit starts, which can turn R7 into R1 or R5. The UI shows only the server's result.

**Void a staff check-in *(FR-250)*:**
| State | [Void] shown | Effect of voiding |
|---|---|---|
| Staff entry, today, not voided, nothing relies on its session | Yes (Manager and above) | Visit closed if open; stops counting for occupancy, streaks, rank and the challenge; its session is given back; its stamp removed; milestones and badges already earned are not taken back |
| Staff entry, today, a later same-day visit relies on its session | Yes, but refused on confirm | Nothing changes; refusal message |
| Staff entry, an earlier gym-local day | No | — |
| Scan entry | No | — |
| Already voided | No | — |

**Plan correction eligibility *(FR-242; classification of a payment on the current subscription)*:**
| Payment state | Counts as standing | Message |
|---|---|---|
| Verified (not refunded) | Yes | F1 |
| Awaiting verification | Yes | F2 |
| Mobile money in flight | Yes | F3 |
| Partly refunded | Yes | F4 |
| Fully refunded | No | none |
| Voided | No | none |
| No payment record at all (import, override) | No | none; correction allowed |
| Registration fee | Not a subscription payment | none |
- Unused paid session while moving to or from Pay-per-session: refused (F6). A free session does not block `[ASSUMPTION — FR-242 says "paid"]`.

**Weekly-times edit *(FR-245; what happens to each upcoming session)*:**
| Session | Result |
|---|---|
| Future, no bookings | Regenerated to the new times |
| Future, has bookings | Left as it is; listed in the result view; tagged "Old time" in AD-18 when it no longer matches |
| Today or past | Untouched |
| Created while the editor was saving | Treated by whether it has bookings at that moment; the server decides |
- The class's bookings, capacity, cancellation cutoff and reminders are unchanged and work per session.

**Gym challenge by month *(FR-234)*:** none, set (next month), running (this month), reached, cancelled. A cancelled month stays "cancelled" and cannot be set again. The challenge does not carry into the next month. The progress is a count of visit days; voided staff check-ins are not counted.

<!-- END BLOCK 8 -->

---

<!-- BEGIN BLOCK 9 -->

## BLOCK 9 · Interaction, Accessibility and Responsive

**9a.** APPEND TO SECTION: `### Admin Dashboard (Desktop Web)` (under `## Interaction Primitives`, after the AD-15 reordering bullet)

- **AD-30 Check in a member** *(V1.8)*: opening the modal puts focus in the search field. Tab order: Search → result list (one tab stop; arrow keys move the choice, Space or Enter chooses) → [Check in [Name]] → [Cancel]. Enter in the search field with exactly one result chooses it; Enter on [Check in [Name]] confirms. After a result, focus moves to the result heading (R1 to R3, R6, R7 `role="status"`; R4, R5, R8 to R11 `role="alert"`). [Check in another member] returns focus to the search field. Closing returns focus to [Check in a member] on AD-11.
- **Void modal** *(V1.8)*: Escape disabled (consequential, as other confirmations); opens with focus on [Keep check-in], so Enter does not void by accident. Tab order: Reason → [Void check-in] → [Keep check-in]. Closing returns focus to the row's [Void] (or to the row if it has disappeared).
- **AD-31 Correct plan** *(V1.8)*: opens with focus on New plan (form state) or on the refusal heading (refusal state). Tab order: New plan → Reason → [Correct plan] → [Cancel]. Escape closes (not a destructive confirmation). Closing returns focus to [Correct plan] on AD-04.
- **AD-13 V1.8 sections** *(V1.8)*: each section's save button is directly after its last field, as the V1.6 sections. The challenge set and cancel dialogs open with focus on [Back] and [Keep challenge], Escape disabled.
- **AD-19 weekly times** *(V1.8)*: [+ Add a time] moves focus to the new row's Day select; [Remove] moves focus to the previous row's Day select, or to [+ Add a time] when none is left. Each row is a labelled group "Time [n] of [total]". Arrow keys do not reorder; the list re-sorts itself on blur, announced politely ("Weekly times sorted").
- **AD-32 coach picker** *(V1.8)*: the select is the first tab stop after the sub-navigation; changing it moves focus to the first tab content heading and announces the banner. Read-only: there are no hidden editable controls to tab through.

**9b.** APPEND TO SECTION: `### Admin Dashboard` (under `## Accessibility Floor`, as extra rows of its table, before the "**Color contrast:**" line)

| Requirement | Implementation |
|---|---|
| Check-in result panels *(V1.8, AD-30)* | R1 to R3, R6, R7 are `role="status"` (polite). R4, R5, R8 to R11 are `role="alert"`. The icon is `aria-hidden`; the label text carries the meaning, and the colour is supplementary (success, warning, danger, info, neutral). A result is never colour alone |
| Member search results *(V1.8, AD-30)* | A `radiogroup` of options; each option's accessible name reads name, plan, status and "In the gym since [time]" when present. The status badge text is the label. The result count is announced politely ("3 members found") after typing pauses (300 ms) |
| Staff entry marker *(V1.8, AD-11)* | The "By staff" pill is text with an `aria-hidden` icon; the row reads "Checked in by staff, [Name]". The "Voided" pill and the muted row style are paired with text, so a voided row is never conveyed by opacity alone; the reason is in the row's accessible description |
| Void action *(V1.8, AD-11)* | The button's accessible name includes member and time ("Void the check-in of Ange T. at 07:02"); the dialog is named "Void this check-in?"; its confirm is labelled by action ("Void check-in"); the conditional effect lines are in `aria-describedby` |
| Correct plan *(V1.8, AD-31)* | The confirm button is labelled "Correct plan"; the rule line, the preview and the warnings are in `aria-describedby`; the preview is `aria-live="polite"` and updates after the choice. A refusal is `role="alert"` and its link [Open payments] is a real link. The "Checking payments…" state is `aria-busy="true"` |
| Session validity radios *(V1.8, AD-13)* | A real `radiogroup` with a visible label; each option's description is its `aria-describedby`; the info lines (charging off, loyalty) are in the group's description |
| Gym challenge *(V1.8, AD-13)* | The fixed-note is in the Target and Reward fields' `aria-describedby`; the running line's progress is text ("412 / 1,000 visit days"), not only a bar; both dialogs focus-trap and are labelled by action |
| Weekly times *(V1.8, AD-19)* | Each row is a `group` named "Time [n] of [total]"; Day and Time have visible labels; [Remove] is named "Remove Wednesday 18:30"; the counter "[n] of 14" and a re-sort are announced politely; the duplicate error is on the later row and linked by `aria-describedby`; the left-unchanged list is a list with `aria-labelledby` its heading, and focus moves to the result heading on save |
| Cancel class dialog *(V1.8, AD-18, AD-21)* | Labelled by action ([Keep class], [Cancel class]); the booking count is in `aria-describedby`; Escape disabled |
| Coach picker *(V1.8, AD-32)* | A labelled select ("Choose a coach"); the read-only banner is `role="status"` once when a coach is chosen and then static text; the sub-navigation is `aria-current` on the active tab; the persistent "no body data" line is plain text in reading order, not an icon-only cue |
| Read-only portal *(V1.8, AD-32)* | Read-only views contain no disabled or hidden-but-focusable controls; absent controls are absent from the DOM, as for every role-gated control |
| Support actor *(V1.8)* | "GymOS Support" in the Entry cell, the void text and the audit row is plain text with the same accessible name as a staff name would have |

**9c.** APPEND TO SECTION: `### Admin Dashboard — Responsive Breakpoints`

*(V1.8)*
- **AD-11 Entry column:** the staff name part is hidden under 1024 px with the other "Actor" values; the **"By staff" pill and the "Voided" pill always stay**. Under 768 px the table scrolls horizontally as today, with Name, Check-in time, Entry pill and Actions pinned. [Check in a member] stays in the header; under 768 px it is full-width under the page title `[ASSUMPTION]`.
- **AD-30:** under 768 px full-screen; from 768 px a centered card (max 640 px), as every modal. Results rows stack avatar and name over phone and plan. The Record Session Payment Panel and the Inline Renewal Panel open as an **inline expanding section inside the modal** at every width, as inside the AD-04 modal (not a drawer, because a drawer would sit on top of a modal).
- **AD-31:** same modal rule; the plan select is full width; the refusal message wraps, and [Open payments] sits under it on narrow screens.
- **AD-13 sections:** radios stack with their descriptions; Target and Reward fields stack under 768 px; the set and cancel dialogs are full-screen under 768 px.
- **AD-19 weekly times:** from 768 px a row is one line (Day, Time, [Remove]); under 768 px a row wraps to Day over Time with [Remove] under them, each row a card with a 1 px border. The list scrolls inside the modal; [+ Add a time] stays directly under the list. The result view's session list scrolls in the modal body.
- **AD-18 Schedule column:** under 1024 px it truncates to the first group plus "+N more"; the full list stays in the tooltip and in the AD-19 editor.
- **AD-32:** the select is full width under 768 px; the banner wraps under it; the Classes and Members tabs scroll horizontally if needed; AD-14 and AD-21 keep their existing narrow-viewport rules.
- **Sidebar:** the Coach Portal item appears in the 64 px icon rail on tablet with the usual hover tooltip.

<!-- END BLOCK 9 -->

---

<!-- BEGIN BLOCK 10 -->

## BLOCK 10 · Key Flows

INSERT AFTER: the whole section `### Flow 15 · Chidi Takes Down an Impersonating Page *(V1.7, UJ-14)*` (it ends the file; the last line is its "Climax beat" paragraph)

`[ASSUMPTION — numbering]` Flow 16 is reserved for UJ-15 (Mireille keeps her week, the Member App engagement flow drafted separately). If that flow takes a different number, renumber these two.

---

### Flow 17 · Brice Checks In a Member at the Door *(V1.8, UJ-16)*

**Protagonist:** Brice, Receptionist at Martin's gym, 7 a.m. at the desk. Supporting cast: Ange (the Pay-per-session guest of Flow 12) with a dead phone, and Nadia (Manager, Flow 4 and Flow 10) later in the day. `[ASSUMPTION — narrative drafted, per PRD UJ-16]`

**Entry:** Martin's gym has "Charge guests per session" on and Session validity set to **Single use** (AD-13). Ange arrives at 07:00 and cannot scan: her phone is dead. Her phone number is on her record as for every member; this is a desk problem, not a missing account.

1. **AD-11.** Brice opens Attendance and taps [Check in a member].
2. **AD-30, step 1.** He types "Ange". One match: Ange T., Drop-in, Active. The line "Entry time: now (07:02). It can't be changed." is the only time on screen. He chooses her; the button reads "Check in Ange T."
3. **AD-30, R5.** The result is blue, not red: "Ange T. has no paid session. Record 2,000 XAF at the desk and Ange T. is checked in straight away." The rule is the same as for a scan: Single use means a paid session covers one visit.
4. **Record Session Payment Panel, inside the modal.** Amount 2,000 XAF (fixed), method Cash (default). Brice collects the cash and taps [Record session payment →].
5. **AD-30, R6.** The modal turns green: "Session recorded. Ange T. is checked in at 07:02." No front-desk alert was raised for any of this; Brice saw the outcome where he acted. He taps [Done].
6. **AD-11.** Currently Checked In shows Ange T., 07:02, "By staff · Brice N." The same entry sits in the Daily Log with the same marker.
7. **09:10.** Ange finishes her workout. At the desk, Brice taps [Check Out] on her row (existing action). Her visit has ended.
8. **18:00, same day.** Ange returns. Brice repeats steps 1 to 5; at the "no paid session" result he records another 2,000 XAF. Her morning visit ended at check-out (had she forgotten, it would have ended at the 3-hour limit), so the evening visit needs its own session. At a **Whole day** gym the same evening return would have gone straight to a green result with nothing to pay.
9. **Variation: the wrong Ange.** A different morning Brice picks the wrong "Ange" from two. He has no [Void] button (it is absent for a Receptionist). Nadia opens AD-11, taps [Void] on that row, types "wrong member selected" and confirms. The row is muted and marked Voided; the visit stops counting everywhere, and the session it used goes back to that member. Brice checks in the right Ange.
10. **Later, AD-12 (Nadia).** The log shows "Member checked in by staff" with Brice's name, and "Staff check-in voided" with Nadia's name and her reason. Had GymOS Support entered it, the actor would read "GymOS Support".

**Climax beat:** Ange's dead phone is a two-minute desk problem, not a lost sale and not a free pass. The screen asks for exactly what a scan would have asked for, takes the payment in the same window, and leaves a log that says who entered the visit.

---

### Flow 18 · Nadia Fixes a Plan and a Timetable *(V1.8, UJ-17)*

**Protagonist:** Nadia, Manager (Flows 4 and 10). Supporting cast: Emmanuel (Coach, Flow 9), Grace (Owner, Flows 7 and 12). `[ASSUMPTION — narrative drafted, per PRD UJ-17]`

**Entry:** a Tuesday morning. Last week a new member, Paul E., was signed up on the **Annual** plan; he meant **Monthly**. No payment has been recorded for the subscription yet.

1. **AD-04.** Nadia opens Paul E. The header shows "Plan: Annual (250,000 XAF · 365 days · Paid once)" and "Subscription started 12 Nov 2026". She taps [Correct plan].
2. **AD-31.** For a moment the modal says "Checking payments…". Nothing stands, so the form appears. She chooses Monthly, and types "Wrong plan chosen at sign-up". The rule line says the new expiry counts from 12 Nov, and the preview reads "New expiry: 12 Dec 2026 · Active". She taps [Correct plan].
3. **Toast and AD-04.** "Plan corrected. Paul E. is now on Monthly; expires 12 Dec 2026." AD-12 holds one line with both plans, both prices, both expiries and her reason. Paul's app shows the new plan next time it opens; no notification was sent and no loyalty stamp was earned.
4. **Variation: money already moved.** For a different member, Jean B., the same wrong plan had been paid in cash and verified. Nadia taps [Correct plan]; the modal does not open a form. It says "Can't correct the plan yet. The payment of 250,000 XAF on 10 Nov (Cash) is still recorded. Refund it fully first, then correct the plan." She taps [Open payments], records the full refund in AD-09 (the existing flow), and returns. The form now opens.
5. **AD-18 → AD-19.** The same morning she edits the Pilates class. The weekly times list holds Mon, Wed and Fri, all at 18:00 (the class's old schedule, migrated invisibly). She changes Monday to 07:00, Wednesday to 18:30, and Friday to Saturday 09:00; no row needed adding. She saves.
6. **AD-19, result view.** "Class saved. Weekly times: Mon 07:00 · Wed 18:30 · Sat 09:00. 2 sessions with bookings were left unchanged: Wed 18 Nov · 18:00 · 8 / 15 booked; Fri 20 Nov · 18:00 · 12 / 15 booked. They keep their old time and their bookings." She taps [Done], and calls Emmanuel about those two. Back on AD-18 the two sessions carry an "Old time" tag.
7. **Emmanuel, AD-21.** In his Coach Portal's My Classes he taps [+ Create class], names it Stretching, sets capacity 10 and one weekly time, Tue 12:30. His own name is shown as the coach and cannot be changed. He saves; the class is in his list and in Nadia's AD-18.
8. **Grace, AD-32.** The Owner opens the Coach Portal. A picker asks her to choose a coach; she picks Emmanuel. A banner reads "You're viewing Emmanuel T.'s Coach Portal. Read-only." She sees his classes with the booked names, and, under Members, his assigned clients with their notes and workout plans. Under every member the line says body measurements, photos and progress notes aren't shown in this view. There is no Progress tab and no Overview.

**Climax beat:** A wrong plan is corrected before any money moves, with both versions and the reason written to the audit log; when money had moved, the screen named the exact payment to refund first, so nothing is rewritten silently. In the same hour a timetable is fixed without breaking a single booking, a coach adds his own class without asking, and the Owner sees what Emmanuel sees: his classes and his clients' notes, never their bodies.

<!-- END BLOCK 10 -->

---

<!-- BEGIN BLOCK 11 -->

## BLOCK 11 · DESIGN.md additions

**No new tokens.** Colours, type, radii and spacing are reused unchanged; nothing is added to the `colors`, `typography`, `rounded`, `spacing` or `components` front matter.

Reuse map, so nothing is invented in the build:

| Element | Reuses |
|---|---|
| Check-in result panels (AD-30 R1 to R11) | The status colours as the alert panel and check-in overlays use them: `success` (accepted), `warning` (accepted with a warning, already checked in), `danger` (expired, gym suspended, network), `info` (no paid session, the same meaning as the V1.6 session-required alert), `neutral` (refused for a non-expiry reason). Each pairs an icon and a label (Do's table). System-ui, dashboard type |
| "By staff" and "Voided" pills (AD-11) | The neutral pill of AD-16 ("Created by GymOS Support"): pill, 1 px border, icon plus text, no colour signal |
| Voided row | The muted row treatment already used for lapsed or voided sessions in the AD-04 Sessions section |
| Read-only banner (AD-32) | A `flat` bordered strip with the `neutral` token and an eye icon (not `info`, which means "a recoverable step is waiting") |
| Modals, dialogs, inline panels (AD-30, AD-31, void, cancel class, challenge dialogs) | The existing modal sizes (full-screen under 768, centered card max 640), the Record Session Payment Panel and the Inline Renewal Panel as inline sections |
| Weekly times rows (AD-19) | The existing form-row, select and time input; each row on narrow screens is a bordered `flat` card |
| Plan summary line, annual "Paid once" | Plain text in the existing plan row; no chip, no colour (the Category label rule: descriptive data must not look like a status) |

Optional documentation lines (no values change), `[ASSUMPTION]`: add a row to the Do's and Don'ts table: **Do** "Show who entered a visit as plain text with a neutral pill, and mark a voided visit with text as well as a muted row" / **Don't** "Colour a staff entry, or signal a void by opacity or strike-through alone." And one sentence under the V1.6 `info` token: "also the AD-30 'no paid session' result". Neither is needed to build the screens.

<!-- END BLOCK 11 -->

---

## BLOCK 12 · Open questions index (hand-off list, not spliced)

Every `[NOTE FOR UX]` above, in order, so the product owner can answer them in one pass. Items 1 to 6 touch the desk flows that ship first (Epic 27).

| # | Where | Question |
|---|---|---|
| 1 | Block 2 | Add a one-tap "Check in" on AD-03 rows or the AD-04 header, or keep AD-11 as the only entry point (FR-248 says "from the Attendance page")? |
| 2 | AD-30 | After a desk renewal on an expired result, does the check-in complete on its own (drafted, same as the desk payment) or after a second deliberate tap? |
| 3 | AD-30 | Should an "already checked in" result offer [Check out], or only point to the list? |
| 4 | AD-31 | Is a read-only dry-run of the new expiry and status built? It drives the preview line and the "already expired" warning; without it both go and the date shows only after saving |
| 5 | AD-31 | Do GymOS Support's Correct plan, void and the two settings raise the step-up prompt (SA-21)? FR-189 lists three actions; Architecture Decision AD-56 mentions the step-up gate for staff check-in |
| 6 | AD-11 | A staff entry whose session a later **scan** visit relies on can never be voided the same day. Accept the dead end, or add a rule? Also: should a voided member be told (drafted: silence)? |
| 7 | AD-32 | The picker shows the chosen coach's own session notes (drafted); FR-247 also says notes "as authored" are shown. Show every coach's notes with author labels instead? |
| 8 | AD-32 | Should opening another person's coach view be audit-logged? |
| 9 | AD-13 | Session validity saves with an inline note only (drafted); add a confirmation dialog like the charging switch? Is an old-app-build warning needed for Single use? |
| 10 | AD-13 | Keep a history of past gym challenges, or only this month and next (drafted)? |
| 11 | AD-18 | Are booked members notified when a class is cancelled, and can one session be cancelled without the class? (FR-246 and Architecture Decision AD-57 only say `cancel_class`) |
| 12 | AD-19 | The "left unchanged" list is informational. Is a per-session cancel or move wanted? |
| 13 | AD-19 | If a class length is added later it becomes a third field on each weekly-time row |
| 14 | AD-23 | Should choosing the Annual interval pre-fill Duration with 365? |
| 15 | AD-23 | Does "Paid once" also belong on the public page plan details (PS-01) and the member plan screen (MA-13)? FR-240 says the dashboard only |

Also open outside this file's remit (recorded for the Member App draft): the member-visible wording for a staff-entered visit (History shows it as an ordinary visit in this draft), and the "Pay for your session" result in a Single-use gym.

## Coverage check

| Request item | Where |
|---|---|
| 1 AD-11 amendment and check-in flow, every result state, void and modal, staff marker, empty and error states, support attribution | Block 6.2, Block 5 AD-30 |
| 2 AD-04 amendment and Correct Plan modal, fields, roles, every refusal with EN/FR, success, audit line | Block 6.1, Block 5 AD-31, catalog Group C |
| 3 AD-13 Session validity and Gym challenge; AD-23 annual wording | Block 6.4, Block 6.10 |
| 4 AD-18/AD-19 slot editor, AD-21 My Classes, Coach Picker with roles, behaviour, read-only and "no body data" states, sidebar changes | Block 6.6 to 6.8, Block 5 AD-32, Block 3 |
| 5 IA, navigation, Voice and Tone keys EN/FR, accessibility, responsive, role tables | Blocks 2, 3, 4, 9, 3 |
| 6 UJ-16 and UJ-17 as flows with a climax beat | Block 10 |
| 7 DESIGN.md | Block 11 (no new tokens) |
