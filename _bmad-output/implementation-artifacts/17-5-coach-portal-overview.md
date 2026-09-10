---
baseline_commit: 147e10d
---

# Story 17.5: Coach Portal — Overview

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Coach,
I want a portal home that summarises my own caseload,
so that I can see what I am teaching, who needs me, and who has been active, without opening every client one at a time.

*Depends on Stories 17.3 and 17.4, both merged (PR #11, PR #13 → `147e10d`). **No migration. Zero RLS policies modified. No new `SECURITY DEFINER` function.** Depth, not release-blocking (`epics.md` Epic 17 dependency order).*

*`/coach/overview` already exists: Story 17.3 ships it with one widget, My Members At A Glance, and a whole-page empty state. This story adds AD-20's other three widgets (My Next Sessions, Needs Follow-Up, Recent Progress Activity), per-widget failure isolation, AD-20's 4-card skeleton, the `#class-<id>` landing on My Classes, and a `?tab=progress` deep link into AD-15.*

*Two decisions were made with the product owner (smartsana) during story creation, 2026-09-10, and are already written into `epics.md` Story 17.5 and `EXPERIENCE.md` AD-20 (uncommitted on `master`; Task 0 carries them):*
1. ***A Coach with no assigned members but upcoming sessions sees My Next Sessions plus the AD-14 guidance,*** *not the whole-page message alone. The whole-page message remains for no members **and** no upcoming sessions (AC #3).*
2. ***Needs Follow-Up flags after 14 gym-local days without a note from this Coach; Recent Progress shows entries from the last 7 gym-local days*** *(AC #9).*

*Do not re-litigate either decision.*

## Acceptance Criteria

1. **Read plan.** `app/(dashboard)/coach/overview/page.tsx` keeps its shape: a sync default export returning `<Suspense fallback={<CoachOverviewLoading />}><CoachOverviewData /></Suspense>`.
   - `CoachOverviewData` awaits `getRequestLocale()` and `getServerTranslation(locale)`, then **one** `Promise.all` of exactly four reads:
     - `listAssignedMembers({})` (unchanged, `services/coaches.ts:227`);
     - `listMyClasses()` (unchanged, `services/classes.ts:337`, Story 17.4);
     - `listAssignedMemberNoteRecency()` (new, AC #6);
     - `listAssignedMemberProgressRecency()` (new, AC #7).
   - Then `const now = new Date()`, **once**, after those awaits, passed to every selector. Under `cacheComponents: true` the current time may only be read after a request-time read; `coach/classes/page.tsx` does exactly this and builds as Partial Prerender (◐). No `"use cache"`, no `unstable_cache`: an ended assignment must vanish on the next load (FR-146).
   - All four services return `{ data, error }` and never throw (AD-9), so there is no `try`/`catch` and the `Promise.all` cannot reject on one of them.
   - **One Suspense boundary, not four.** AC #3 picks the layout from the member count, so the page needs that result before it renders anything. Failure isolation comes from branching on each result independently, the discipline `(dashboard)/page.tsx:56-61` documents for Story 17.1.

2. **Per-widget failure isolation.** Each widget's view is built from its own read only. When that read has `error` (or `data: null`), that widget alone renders its title plus the inline `common.loadError`; every other widget, My Members At A Glance included, renders normally. No read failure blanks the page and none renders `notFound()`.

3. **Layout.** `M` = the `listAssignedMembers({})` result, `S` = My Next Sessions' upcoming sessions (AC #4).

   | `M` | `S` | Renders |
   |---|---|---|
   | ≥ 1 row | any | the 4-widget grid |
   | error | any | the 4-widget grid; At A Glance shows its error |
   | 0 rows | 0 upcoming (read succeeded) | **only** AD-14's whole-page empty state, exactly 17.3's markup (`overview/page.tsx:47-53`, `coachPortal.emptyNoAssignments`) — no widget |
   | 0 rows | ≥ 1 upcoming, or its read failed | `<div className="grid gap-4 md:grid-cols-2">` with exactly two children: the My Next Sessions widget, then 17.3's dashed empty-state `<div>` unchanged |

   - Grid: `grid gap-4 md:grid-cols-2`, in AD-20's order — My Next Sessions, My Members At A Glance, Needs Follow-Up, Recent Progress Activity.
   - When `M = 0`, the two member-recency reads still run in the `Promise.all` and their results are ignored, whatever they return.
   - Why the last row (decided with smartsana, 2026-09-10): a Coach who only teaches classes lands here on every sign-in, and hiding their next sessions behind "No members have been assigned to you yet" would empty the one widget that is not about assignments. AD-20's "AD-14 copy rather than four empty widgets" still holds: no empty member widget ever renders.

4. **My Next Sessions** reuses `listMyClasses()` — no second class query, no `class_sessions`/`class_bookings` read (a Coach reads zero bookings under RLS, `0068:37-42`).
   - `selectNextSessions(classes, now): NextSession[]`, where `NextSession = { classId; className; classSessionId; scheduledAt; bookedCount; capacity; gymTimezone }`.
     - It flattens every class's sessions and keeps `Date.parse(scheduledAt) > now.getTime()` **strictly**. 17.4's window starts at gym-local 00:00, so earlier-today sessions arrive and must be dropped; compare numbers, never strings.
     - It sorts ascending by `scheduledAt` (ties: class name, then class id) and keeps the first `NEXT_SESSIONS_LIMIT` (3, AD-20's mockup).
   - Each row links to `` `/coach/classes#class-${classId}` `` (17.4's section id, `CoachClassesPageClient.tsx:100`).
     - primary: the session time, from AC #9's formatter, built **once per timezone** (not per row) in the row's `gymTimezone`;
     - secondary: the class name;
     - meta: `t("coachPortal.classes.bookedCount", { booked, capacity })` (17.4's key; both numbers `toLocaleString(locale)`).
   - Header link "All →" to `/coach/classes` (`coachPortal.overview.nextSessions.viewAll`). No "+N more" line.
   - Zero upcoming sessions → `coachPortal.overview.nextSessions.empty`.

5. **Landing on a class.** `coach/classes/components/CoachClassesPageClient.tsx` expands the class named by the URL hash.
   - Seed a ref at mount with `const classIdsRef = useRef(classes.map((c) => c.classId))`. Keep it current with `useEffect(() => { classIdsRef.current = classes.map((c) => c.classId); }, [classes])`, declared **above** the hash effect. **Never assign `ref.current` during render:** `react-hooks/refs` is a lint **error** in this repo (eslint-plugin-react-hooks 7.1.1 via eslint-config-next).
   - The hash effect has `[]` deps and needs no eslint-disable. It defines `apply()`, calls it once, and adds a `hashchange` listener on `window`, removed on unmount.
   - `apply()`: if `window.location.hash` equals `` `#class-${id}` `` for an id in `classIdsRef.current`, add that id to `openClassIds` and call `document.getElementById(`class-${id}`)?.scrollIntoView({ block: "start" })`. Any other hash is a no-op.
   - It does not re-run when `classes` changes, so a `router.refresh()` does not re-open a class the Coach collapsed.
     - Next 16 with `cacheComponents` keeps visited routes in `<Activity>` and re-runs their effects on return (`next/dist/docs/01-app/02-guides/preserving-ui-state.md`). So pressing Back to `/coach/classes#class-x` re-opens that class.
     - That is expected: do not add a "ran once" guard.
   - `window` is read only inside effects, so SSR output is unchanged and there is no hydration mismatch.
   - It opens the class only: no session expands and no roster is fetched.
   - Every existing 17.4 test in `CoachClassesPageClient.test.tsx` passes unmodified.

6. **Needs Follow-Up.**
   - **Service** `listAssignedMemberNoteRecency()` in `services/coaches.ts`, after `listSessionNotes()`:
     ```ts
     supabase
       .from("members")
       .select("id, name, gyms(timezone), session_notes!session_notes_member_id_fkey(created_at)")
       .eq("gym_id", gymId)
       .eq("role", "member")
       .is("deactivated_at", null)
       .order("name", { ascending: true })
       .order("created_at", { referencedTable: "session_notes", ascending: false })
       .limit(1, { referencedTable: "session_notes" });
     ```
     - `gymId` from this file's `getCallerGymId()`, like every other function in it.
     - Returns `{ data: CoachMemberRecencyRow[] | null; error: AppError | null }`, with `export interface CoachMemberRecencyRow { memberId: string; memberName: string; gymTimezone: string; lastAt: string | null }`.
     - **Cast the result; do not trust the inferred type.** The chain typechecks, but the builder infers `gyms` as `{ timezone: any }[]`, an array, while PostgREST returns an **object** (measured). `row.gyms.timezone` fails typecheck, and `row.gyms[0].timezone` compiles, then throws at runtime.
       - Cast as this file does everywhere: `(data ?? []) as unknown as MemberNoteRecencyFromDb[]`, with `interface MemberNoteRecencyFromDb { id: string; name: string; gyms: { timezone: string } | { timezone: string }[] | null; session_notes: { created_at: string }[] | null }`.
       - Map `const gym = Array.isArray(row.gyms) ? row.gyms[0] : row.gyms` and `gymTimezone: gym?.timezone || "UTC"`. Never fall back to `""`: `Intl.DateTimeFormat` throws `RangeError: Invalid time zone specified` on it, and a throwing service breaks AC #2.
       - `lastAt: row.session_notes?.[0]?.created_at ?? null`.
     - **Why `members` with an embedded latest note, not a `session_notes` fetch.** `max_rows = 1000` (`supabase/config.toml:18`) truncates silently, and notes grow without bound (30 members × 2 notes a week passes 1000 in about four months). A truncated fetch would report the wrong "last note". The embed returns one row per assigned member with at most one note each. `members.ts:219-220` is the in-repo precedent for `limit(1, { referencedTable })`.
     - **`.eq("role", "member")` is load-bearing.** `self_read_own_membership` (`0013:23`, `user_id = auth.uid()`) hands a Coach their own row on any `members` select. Measured: without the filter the Coach appears in their own caseload.
     - **The FK hint is mandatory:** `session_notes` has two FKs to `members` (`member_id`, `coach_id`).
     - **Scoping is RLS, nothing else.** `coach_read_assigned_members` (`0040:81`) limits rows to currently assigned members; `coach_read_own_session_notes` (`0041:61`) limits notes to ones this Coach authored on a currently assigned member, so a previous coach's notes never count (FR-055). An ended assignment removes the member from the next load. Add no app-side coach filter; a Coach cannot read `coach_assignments` (`0039`).
   - **Selection** `selectFollowUp(rows, now): { rows: CoachMemberRecencyRow[]; moreCount: number }` in `coach/overview/caseload.ts`:
     - flagged iff `lastAt === null` or `gymLocalDaysAgo(lastAt, now, gymTimezone) >= FOLLOW_UP_AFTER_DAYS`;
     - order: never-noted members first (by name), then oldest note first (ties by name);
     - `rows` holds the first `WIDGET_MAX_ROWS`, and `moreCount` counts the rest.
   - **Rows** link to `` `/coach/${memberId}` `` (AD-15 opens on Session Notes by default). primary: the name. secondary: `coachPortal.overview.followUp.noNoteYet`, or `coachPortal.overview.followUp.lastNote` with `{ when }` from AC #9's relative formatter.
   - Header description: `coachPortal.overview.followUp.description` with `{ days: FOLLOW_UP_AFTER_DAYS }`. `moreCount > 0` → `coachPortal.overview.moreCount` with `{ count }`. None flagged → `coachPortal.overview.followUp.empty`.
   - **Check-in recency is not a signal.** No `attendance_events` read, and `gym_staff_read_own_attendance_events` (`0025:24`) stays untouched. A Coach has no attendance read, and widening it needs a product decision (epic AC; `sprint-change-proposal-2026-09-09.md` "Deliberate deferral").

7. **Recent Progress Activity.**
   - **Service** `listAssignedMemberProgressRecency()` in `services/coaches.ts`, after `getMemberProgressData()`, same return type:
     ```ts
     supabase
       .from("members")
       .select("id, name, gyms(timezone), progress_entries(logged_at)")
       .eq("gym_id", gymId)
       .eq("role", "member")
       .is("deactivated_at", null)
       .is("progress_entries.deactivated_at", null)
       .order("name", { ascending: true })
       .order("logged_at", { referencedTable: "progress_entries", ascending: false })
       .limit(1, { referencedTable: "progress_entries" });
     ```
     - Same cast and mapping as AC #6, with `progress_entries: { logged_at: string }[] | null` in the `FromDb` interface.
     - The embedded `deactivated_at` filter is required: RLS does not hide soft-deleted entries (`0067:131-139`).
     - Selects `logged_at` **only**. No measurement value reaches this screen.
     - Scoping: `coach_read_assigned_progress_entries` (`0067:140`, live role via `private.current_member_role()`).
     - **No `progress_photos` read, no storage call, no signed URL.** Photos carry their own consent (`coach_read_shared_progress_photos`, `0067:92`), and logging an entry is not consent to appear on a summary screen.
   - **Selection** `selectRecentProgress(rows, now): { rows; moreCount }`: kept iff `lastAt !== null` and `gymLocalDaysAgo(lastAt, now, gymTimezone) < RECENT_PROGRESS_WITHIN_DAYS`; most recent first (ties by name); first `WIDGET_MAX_ROWS`, with the rest counted in `moreCount`.
   - **Rows** link to `` `/coach/${memberId}?tab=progress` `` (AC #12). primary: the name. secondary: `coachPortal.overview.recentProgress.logged` with `{ when }`.
   - Description `coachPortal.overview.recentProgress.description` `{ days: RECENT_PROGRESS_WITHIN_DAYS }`; empty `coachPortal.overview.recentProgress.empty` `{ days }`; more as in AC #6.

8. **My Members At A Glance is unchanged in behaviour:** the same `listAssignedMembers({})` result, locale-formatted total, one `Badge` per non-zero status in `STATUS_ORDER` using `STATUS_BADGE_CONFIG`'s labels and icons, and "All →" to `/coach`. It only moves into AC #10's widget frame.

9. **Gym time helpers**, in a new plain module `app/(dashboard)/coach/gymTime.ts` (`subscriptions/subscriptionLabels.ts` is the route-folder precedent):
   - **`gymDateFormatter(locale, timeZone)`**, **moved** verbatim from `coach/classes/page.tsx:96-120`, together with its doc comment. `coach/classes/page.tsx` imports it and loses its local copy.
     - It is moved rather than exported from the page: `next build` rejects a non-Page export ("is not a valid Page export field").
     - It creates three `Intl.DateTimeFormat`s per call, so call it once per timezone per render.
     - 17.4's page test (18:00 in Africa/Douala vs 17:00 in UTC) must still pass unmodified.
   - **`gymLocalDaysAgo(iso: string, now: Date, timeZone: string): number`** returns the difference between the two instants' gym-local **calendar dates**, clamped at 0.
     - Get each date's `year`, `month` and `day` from `formatToParts` of `new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })`. Do not parse a formatted string; locale output formats have changed between ICU releases. Cache one formatter per timezone in a module-level `Map`.
     - Then compute `(Date.UTC(y1, m1 − 1, d1) − Date.UTC(y2, m2 − 1, d2)) / 86_400_000`.
     - **Calendar days, not elapsed 24-hour periods:** a note written at 23:30 yesterday reads "yesterday" at 08:00 today.
     - **The gym's zone, not UTC or the runtime's:** measured, `2026-09-09T23:30:00Z` is `2026-09-10` in Africa/Douala.
     - **Clamped at 0:** `progress_entries.logged_at` is client-supplied for offline entries (`0066`), so a fast device clock can put it in the future.
   - **`relativeDaysFormatter(locale)`** builds `const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })` once and returns `(days) => rtf.format(-days, "day")`.
     - Measured output — en: "today", "yesterday", "2 days ago", "21 days ago"; fr: "aujourd’hui", "hier", "avant-hier", "il y a 21 jours".
     - French uses U+2019 (’), so tests must not hardcode an ASCII apostrophe.
     - No plural keys are needed. `getServerTranslation` sets `escapeValue: false` (`get-server-translation.ts:57`), so the phrase interpolates as-is.

   **`app/(dashboard)/coach/overview/caseload.ts`** holds the constants and the pure selectors:
   - `NEXT_SESSIONS_LIMIT = 3`
   - `FOLLOW_UP_AFTER_DAYS = 14`
   - `RECENT_PROGRESS_WITHIN_DAYS = 7`
   - `WIDGET_MAX_ROWS = 5`
   - `selectNextSessions`, `selectFollowUp`, `selectRecentProgress`

   Each constant carries its rationale in a comment; the two day values were chosen with smartsana (2026-09-10).
   - `FOLLOW_UP_AFTER_DAYS`: two weeks tolerates one missed weekly check-in before flagging.
   - `RECENT_PROGRESS_WITHIN_DAYS`: "this week", a weekly weigh-in cadence.

   Selectors take `now` as a parameter and never call `Date`. The two day constants drive the selectors **and** are interpolated into the copy (AC #6, #7). Non-test source and locale files contain no other literal `14` or `7` for these thresholds; tests and the seed SQL may use literals. This satisfies the epic AC: "a single named constant … not a magic number scattered across the query and the UI copy".

10. **Widgets are presentational server components** in `app/(dashboard)/coach/overview/components/`. There is no `"use client"`, no hook and no `async`; they receive **translated strings only** and never a `t` prop.
    - **`OverviewWidget`** is the frame. It is 17.3's markup (`overview/page.tsx:64-70`): `<section className="space-y-3 rounded-md border p-4">`, a header row with `<h2 className="text-sm font-medium">`, an optional description `<p className="text-xs text-muted-foreground">`, and an optional header `Link` (`text-sm text-muted-foreground hover:text-foreground`).
    - **`CaseloadList`** is the body for the three list widgets. Its props are `{ state: "error" | "ready"; errorLabel: string; emptyLabel: string; rows: { key: string; href: string; primary: string; secondary: string; meta?: string }[]; moreLabel: string | null }`.
      - `error` → `<p className="text-sm text-red-600">`;
      - no rows → a muted `<p>`;
      - otherwise a `<ul>` of `<li><Link>` rows: primary, then secondary muted, then `meta` right-aligned and muted when present;
      - `moreLabel` renders as a muted `<p>` after the list, only when non-null.
    - **`MembersAtAGlance`** renders the existing total, label and badges from props (`total`, `assignedLabel`, `items: { status, label, count }[]`), and its error state.
    - The page renders **no client component of its own** (`next/link` aside). No polling or realtime: AD-20 specifies neither.

11. **Loading.** `coach/overview/loading.tsx` renders AD-20's **4** skeleton widget cards: each is `h-40 w-full animate-pulse rounded-md bg-muted`, inside `grid gap-4 md:grid-cols-2` with `aria-busy="true"`. It is text-free. Replace its header comment, which still says 17.5 will do this. The page's fallback keeps importing it.

12. **AD-15 tab deep link.**
    - `coach/[memberId]/page.tsx` takes `searchParams: Promise<{ tab?: string }>` next to `params`. It passes both into `CoachMemberDetailData`, which resolves them with `Promise.all`.
    - Resolve `initialTab`: `"progress"` or `"workout-plan"` when `tab` equals exactly that string, otherwise `"session-notes"`.
    - `CoachMemberDetailPageClient` gains `initialTab: CoachMemberDetailTab` (export `type CoachMemberDetailTab = "session-notes" | "progress" | "workout-plan"` from that file) and uses it as `<Tabs defaultValue={initialTab}>` (`CoachMemberDetailPageClient.tsx:179`).
    - The Tabs stay uncontrolled: switching tabs does not rewrite the URL, and `router.refresh()` after a note save keeps the open tab. Nothing else in either file changes.
    - `e2e/progress-data-privacy.spec.ts:106` (no param, then clicks Progress) is unaffected.

13. **Scope held.**
    - No migration, no RLS change, no new function.
    - Unchanged: `listAssignedMembers`, `listMyClasses`, `list_my_classes()`, `coach/layout.tsx`, `CoachPortalNav`, `coach/page.tsx`, `Sidebar.tsx`, and every other export of `services/coaches.ts` and `services/classes.ts`.
    - No attendance read and no `progress_photos` read.
    - **No route guard** on `/coach/*` (17.3 AC #14; smartsana, 2026-09-10). A non-coach opening `/coach/overview` by URL gets whatever their own RLS returns, gym-wide. Recorded in `deferred-work.md`, not fixed.

14. **i18n.** Add these keys to `apps/dashboard/locales/en.json` and `fr.json` under `coachPortal.overview`. Keep `membersAtAGlance.*`. `node scripts/check-i18n-key-parity.mjs` passes.

    | Key | EN | FR |
    |---|---|---|
    | `nextSessions.title` | My Next Sessions | Mes prochaines séances |
    | `nextSessions.viewAll` | All → | Toutes → |
    | `nextSessions.empty` | No upcoming sessions. | Aucune séance à venir. |
    | `followUp.title` | Needs Follow-Up | À relancer |
    | `followUp.description` | No note from you in {{days}} days or more | Aucune note de votre part depuis {{days}} jours ou plus |
    | `followUp.noNoteYet` | No note yet | Aucune note pour l'instant |
    | `followUp.lastNote` | Last note {{when}} | Dernière note {{when}} |
    | `followUp.empty` | Every member has a recent note from you. | Chacun de vos membres a une note récente de votre part. |
    | `recentProgress.title` | Recent Progress Activity | Activité de progression récente |
    | `recentProgress.description` | Logged in the last {{days}} days | Progression enregistrée ces {{days}} derniers jours |
    | `recentProgress.logged` | Logged {{when}} | Enregistrée {{when}} |
    | `recentProgress.empty` | None of your members logged progress in the last {{days}} days. | Aucun de vos membres n'a enregistré de progression ces {{days}} derniers jours. |
    | `moreCount` | +{{count}} more | +{{count}} de plus |

    - `nextSessions.viewAll` is its own key, not `membersAtAGlance.viewAll`: French agrees "Tous" with *membres* and "Toutes" with *séances*.
    - `moreCount` deliberately avoids i18next plural suffixes. French has a `many` category, and "autres" would be wrong at a count of 1.
    - Reuse `coachPortal.classes.bookedCount`, `coachPortal.emptyNoAssignments` and `common.loadError` (the last lives in `packages/types/src/locales`).
    - No hardcoded user-facing string anywhere. Lint does **not** catch hardcoded attribute strings: `i18next/no-literal-string` runs in `jsx-text-only` mode and its `jsx-attributes` list is dead config (`eslint.config.mjs:22-38`). Check `aria-*` and `title` by hand.

15. **Vitest** (`globals` off: import `describe`/`it`/`expect`/`vi` from `vitest`).
    - **`coach/gymTime.test.ts`:**
      - `gymLocalDaysAgo("2026-09-09T23:30:00Z", 2026-09-10T08:00Z, "Africa/Douala") === 0`, and `=== 1` in `"UTC"`;
      - `2026-08-21T10:00Z` → `20` at that `now` in Douala;
      - a future instant → `0`;
      - `2025-12-31T23:30:00Z` is day 0 at `2026-01-01T09:00Z` in Douala;
      - `relativeDaysFormatter("en")(1) === "yesterday"`, and fr `(21)` contains `21`.
    - **`coach/overview/caseload.test.ts`:**
      - next sessions: a session exactly at `now` is excluded, an earlier-today session is excluded, sessions are merged across classes in ascending order, the list is capped at 3, and each row carries its `classId`;
      - follow-up: 13 days is not flagged and 14 days is flagged, never-noted members come first, the list is ordered and capped at 5, and `moreCount` is correct;
      - recent progress: 6 days is kept and 7 days is dropped, `null` is dropped, the list is most-recent-first and capped.
    - **`services/coaches.listAssignedMemberNoteRecency.test.ts`** and **`…ProgressRecency.test.ts`:**
      - use the recording query-builder stub and mocks from `classes.countClassSessionsBetween.test.ts:15-56` (including its i18n mocks, which `coachNotFoundError` needs), adding `order` and `limit`;
      - assert the exact `from("members")`, select string, `eq`/`is` calls, and both `referencedTable` calls; progress also asserts `is("progress_entries.deactivated_at", null)`;
      - mapping covers `gyms` as an object, a one-element array and `null` (→ `"UTC"`), and an empty embed → `lastAt: null`;
      - no `gym_id` claim → error with no `from` call; a query error → `{ data: null, error: mapped }`, with no throw;
      - progress: `from` is never called with `"progress_photos"`.
    - **`coach/overview/page.test.tsx`**, rewritten. Await the async child through the boundary (`renderOverview()` helper, `:37-41`) and assert on the widget elements' **props**.
      - Mocks: all four services; `getServerTranslation` with the options-visible `t` from `coach/classes/page.test.tsx` (`` (key, opts) => opts ? `${key}|${JSON.stringify(opts)}` : key ``); `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime`, as `coach/classes/page.test.tsx:106-109` does.
      - Assert:
        - the fallback is `CoachOverviewLoading`;
        - each service is called once, `listAssignedMembers` with `{}`;
        - grid order;
        - 17.3's behaviours still hold: total, badge breakdown in status order, "All →" to `/coach`, the empty state, and the error branch now scoped to its widget;
        - each of the four services failing **alone** → only that widget is in its error state;
        - every row of AC #3's table, including the two-child grid in the last row;
        - hrefs `/coach/classes#class-<id>`, `/coach/<id>` and `/coach/<id>?tab=progress`;
        - descriptions carry `{"days":14}` and `{"days":7}`.
    - **`coach/overview/loading.test.tsx`:** four text-free skeleton cards and `aria-busy="true"`, mirroring `coach/classes/page.test.tsx:121-127`.
    - **`coach/overview/components/*.test.tsx`** (RTL): `h2` titles; error, empty and list states; link `href`s; `meta` rendered when present; the more label shown only when non-null.
    - **`CoachClassesPageClient.test.tsx`**, cases added, existing ones untouched.
      - **Do not set `window.location.hash` directly.** jsdom fires `hashchange` for a fragment navigation asynchronously (`setTimeout 0`). That would re-run the handler outside `act`, double the `scrollIntoView` calls, and leak an event into the next test.
      - Set the hash with `window.history.replaceState(null, "", "#class-class-workshop")` (no event) before `render`. For the hashchange case, inside `act`, call `replaceState` and then `window.dispatchEvent(new HashChangeEvent("hashchange"))`.
      - Spy with `vi.spyOn(Element.prototype, "scrollIntoView")` (stubbed at `vitest.setup.ts:20-22`). In `afterEach`, run `window.history.replaceState(null, "", "/")` and `vi.restoreAllMocks()`.
      - Assert:
        - a hash set before render → that class is `aria-expanded="true"`, the other is `false`, and `scrollIntoView` was called once;
        - an unknown hash → nothing opens;
        - a dispatched `hashchange` after mount → opens;
        - `getMySessionRosterAction` is not called by any of these;
        - a class opened from the hash can still be collapsed.
    - **`coach/[memberId]/page.test.tsx`** (new):
      - **Mocks:**
        - `@/services/coaches` (`getMemberDetail`, `listSessionNotes`, `getMemberProgressData`);
        - `@/services/workoutPlans` (`getWorkoutPlan` resolving `{ data, canCreatePlan, error }`);
        - `@/services/exercises` (`listExerciseLibrary`);
        - `@/lib/i18n/get-request-locale` and `@/lib/i18n/get-server-translation`;
        - `./components/CoachMemberDetailPageClient`, as `coach/classes/page.test.tsx:38-42` mocks its client component. This keeps `"use server"` actions, Radix and lucide out of jsdom.
      - **Call:** `CoachMemberDetailPage({ params: Promise.resolve({ memberId }), searchParams: Promise.resolve({ tab }) })`, await the boundary's child, and read `initialTab` off the mocked element's props.
      - **Assert:** `progress` → `"progress"`; `workout-plan` → `"workout-plan"`; a missing tab, `garbage` and `PROGRESS` all → `"session-notes"`.

16. **Verify.**
    - `pnpm --filter @gymos/dashboard typecheck`, `lint` (0 errors, no new warnings in touched files), `test` and `build`. `/coach/overview`, `/coach/classes` and `/coach/[memberId]` stay Partial Prerender (◐).
    - `node scripts/check-i18n-key-parity.mjs`.
    - **No pgTAP file.** No SQL changes, and the RLS behaviour these widgets rely on is already pinned by `coach_portal_member_detail_session_notes.test.sql` (the FR-055 reassignment case, section (e), `:235`), `progress_entries.test.sql` and `progress_photos.test.sql`. CI's `rls-tests` still runs them.

17. **Record-keeping, in the same change.**
    - **`docs/decisions.md`:** a new top entry (newest-first), "recorded during Story 17.5". It covers:
      - the two thresholds and the calendar-day rule;
      - why the reads go through `members` with an embedded latest row (`max_rows`), and why the `role` filter;
      - AC #3's layout table;
      - the hash landing and the `?tab=` link.

      Cite other entries by dated heading, never by line number.
    - **`deferred-work.md`:** a "Deferred from: dev-story of story-17-5-coach-portal-overview" section carrying Dev Notes → *Found, not fixed*.
    - `epics.md` Story 17.5 and `EXPERIENCE.md` AD-20 are **already amended** for both decisions (uncommitted; Task 0 carries them). Do not amend them again.

## Tasks / Subtasks

- [x] **Task 0: branch (before any code)**
  - [x] PR #13 (17.4) is merged into `master` as `147e10d` (2026-09-10). Branch `feat/17-5-coach-overview` from `master` and record `baseline_commit` in a frontmatter block at the top of this file.
  - [x] Four files sit uncommitted on `master`'s working tree: this story file, `sprint-status.yaml`, `_bmad-output/planning-artifacts/epics.md` (Story 17.5 amendment note) and `EXPERIENCE.md` (AD-20 thresholds and empty state). Carry all four onto the branch and commit them with this story.

- [x] **Task 1: gym time helpers (AC: #9)**
  - [x] Create `coach/gymTime.ts`: move `gymDateFormatter` from `coach/classes/page.tsx` and import it there; add `gymLocalDaysAgo` and `relativeDaysFormatter`
  - [x] `coach/gymTime.test.ts`; re-run `coach/classes/page.test.tsx` unmodified

- [x] **Task 2: services (AC: #6, #7)**
  - [x] `listAssignedMemberNoteRecency()`, `listAssignedMemberProgressRecency()` and `CoachMemberRecencyRow` in `services/coaches.ts`, with the casts and the `"UTC"` fallback
  - [x] Both service test files, red first

- [x] **Task 3: selectors (AC: #4, #6, #7, #9)**
  - [x] `coach/overview/caseload.ts` holds the four constants (each with its rationale comment), the three selectors and the `NextSession` type
  - [x] `caseload.test.ts`, including every boundary in AC #15

- [x] **Task 4: page, widgets and loading (AC: #1, #2, #3, #8, #10, #11)**
  - [x] `OverviewWidget`, `CaseloadList`, `MembersAtAGlance`, and their RTL tests
  - [x] Rewrite `coach/overview/page.tsx`: new header comment, one `Promise.all`, `now` once, AC #3's table, view models built with `t` in the page
  - [x] `loading.tsx` → 4 cards, plus `loading.test.tsx`
  - [x] Rewrite `page.test.tsx`

- [x] **Task 5: hash landing on My Classes (AC: #5)**: the ref and hash effect in `CoachClassesPageClient.tsx`, plus its new test cases

- [x] **Task 6: AD-15 `?tab=` (AC: #12)**: `[memberId]/page.tsx`, `CoachMemberDetailPageClient.tsx`, and a new `[memberId]/page.test.tsx`

- [x] **Task 7: i18n (AC: #14)**: 13 keys in EN and FR; parity script

- [x] **Task 8: record-keeping (AC: #17)**

- [x] **Task 9: verify and hand over (AC: #16)**
  - [x] typecheck, lint, test, build, parity
  - [x] **Seed local QA data** as postgres over host psql, committed, in the "Overview QA Gym" (`00000000-0000-4000-9171-000000000001`, Africa/Douala).
    - **Starting state (checked 2026-09-10):**
      - **0** `session_notes` and **0** `progress_entries`.
      - Cyril (`coach@overviewqa.test`, member `…0701`) is assigned Aicha `…0201`, Blaise `…0202`, Marc `…0213`, Nadia `…0214`, Olivier `…0215`, Quentin `…0217` and Rose `…0218`, all starting 2026-08-21.
      - Paule `…0216`'s assignment ended on 2026-09-07.
      - Every note needs its `coach_assignment_id`.
    - **Fixture dates are deliberately unrealistic; don't adjust them.** Some notes predate their assignment or sit under an ended one. `session_notes` has no trigger (only CHECK constraints), and RLS never compares these dates, so the expected results below hold.
    - **Cyril's notes:**
      - Aicha: 3 days and 30 days ago;
      - Blaise: 20 days ago;
      - Olivier: exactly 14 gym-local calendar days ago, at local noon (`(date_trunc('day', now() at time zone 'Africa/Douala') - interval '14 days' + interval '12 hours') at time zone 'Africa/Douala'`);
      - Paule: 1 day ago, under her ended assignment.
    - **Celine (`…0702`) on Nadia:** insert an **ended** `coach_assignments` row (started 60 days ago, ended 40 days ago), then a note 2 days ago under it. Proven insertable in the rolled-back proof.
    - **Progress entries:**
      - Aicha: 2 days ago;
      - Blaise: 5 days ago, plus a soft-deleted entry 1 day ago;
      - Olivier: 40 days ago;
      - Quentin: exactly 7 gym-local days ago;
      - Paule: today.
    - **Expected for Cyril:**
      - Needs Follow-Up shows Marc, Nadia, Quentin and Rose ("No note yet"), then Blaise (20 days), then "+1 more" (Olivier, 14 days);
      - Recent Progress shows Aicha (2 days ago), then Blaise (5 days ago);
      - My Next Sessions shows the next three future sessions of 17.4's seeded classes.
    - **Expected for Celine:** she has no assignees and teaches QA Morning Yoga (8 future sessions), so AC #3's last row applies: My Next Sessions plus the guidance box.
    - Read both widgets' queries back under each coach's claims in a rolled-back transaction, and record the ids and results in the Debug Log.
  - [x] **Completion Notes checklist for smartsana's browser pass** (they do browser QA themselves):
    - as Cyril: the four widgets and the expected rows above; Paule and Nadia's old note do not appear; each Follow-Up row opens AD-15 on Session Notes, each Progress row opens it on Progress, and each session row lands on My Classes with that class expanded and scrolled into view;
    - as Celine: Next Sessions plus the guidance box;
    - the 4-card skeleton while navigating from My Members;
    - EN/FR;
    - as the owner by URL: gym-wide figures, which is the accepted precedent.

### Review Findings

- [x] [Review][Patch] Key AD-15's `<Tabs>` on `router.bfcacheId` so a Recent Progress row always opens Progress (decision delegated to the reviewer by smartsana, 2026-09-10, "decide": option 1; amends AC #12's "nothing else in either file changes"; `bfcacheId: string` is typed in Next 16.3.4 and no client unit test mocks `useRouter`). Finding: with `cacheComponents`, Next keeps up to 3 visited routes in `<Activity>` and preserves their client state across fresh `<Link>` navigations; `router.bfcacheId` exists to opt out (`use-router.md`). So: Overview → Aicha (`/coach/<id>?tab=progress`, opens on Progress) → switch to Session Notes → Overview → click Aicha again (same URL, route still preserved) → the uncontrolled `<Tabs defaultValue={initialTab}>` keeps Session Notes, and the deep link does nothing. A different `?tab=` value is a different page segment (`__PAGE__?{"tab":…}`), so a first visit always opens correctly. Options: (1) key the Tabs on `useRouter().bfcacheId`, which resets the tab on a Link click but keeps it on Back/Forward and `router.refresh()`; it amends AC #12's "nothing else in either file changes", and Next calls `bfcacheId` a last resort. (2) Accept Next's preserved-state behaviour, as AC #5 accepts it for the `#class-<id>` landing, and record it in `deferred-work.md`. [apps/dashboard/app/(dashboard)/coach/[memberId]/components/CoachMemberDetailPageClient.tsx:184]
- [x] [Review][Patch] Two hash-landing cases (unknown hash; collapse and re-render) never assert that `getMySessionRosterAction` was not called, which AC #15 asks of every one of them [apps/dashboard/app/(dashboard)/coach/classes/components/CoachClassesPageClient.hashLanding.test.tsx:79]
- [x] [Review][Patch] No test proves the two member-recency reads still run when the Coach has no assigned members (AC #3); the "four reads, each once" case runs only with members present [apps/dashboard/app/(dashboard)/coach/overview/page.test.tsx:361]
- [x] [Review][Patch] The `docs/decisions.md` entry records only AC #3's two no-member rows. It omits the failure rows: a failed member read still renders the 4-widget grid, and a failed class read with no members shows My Next Sessions' error beside the guidance (AC #17) [docs/decisions.md:9]
- [x] [Review][Patch] The unmount test accepts any function passed to `removeEventListener("hashchange", …)`, so it would pass if cleanup removed a different handler from the one added [apps/dashboard/app/(dashboard)/coach/classes/components/CoachClassesPageClient.hashLanding.test.tsx:122]

## Dev Notes

- **Read `apps/dashboard/AGENTS.md` first.** Next.js here is **16.3.4**.
  - `cacheComponents: true` (`next.config.ts:9`) means every cookie-backed read needs an explicit `<Suspense>`.
  - `(dashboard)/layout.tsx:17`'s ancestor `fallback={null}` means `next build` does **not** catch a missing page boundary; the dashboard chrome blanks instead. Keep AC #1's boundary.
  - Reading the current time: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/io.md` requires it to follow a request-time read or `await io()`. AC #1's order satisfies that: cookies are read first. `new Date()` in an async Server Component passes `react-hooks/purity`.
  - `middleware.ts` is `proxy.ts`.

- **Measured (local Supabase, 2026-09-10).** Rolled-back transaction, Cyril's coach claims, with fixtures matching Task 9's seed minus the boundary cases:

  | Read | Result |
  |---|---|
  | bare `select … from members` | the 7 assigned members **plus Cyril's own coach row** (`self_read_own_membership`) → AC #6's `role` filter |
  | latest visible note per `role = 'member'` row | Aicha → the 3-day note (not the 30-day); Blaise → 20 days; **Nadia → none** (Celine's 2-day note under an ended assignment is invisible); **Paule absent** (ended assignment; her 1-day note unreachable); Marc, Olivier, Quentin, Rose → none |
  | latest `deactivated_at is null` progress entry | Aicha 2d; **Blaise 5d** (the soft-deleted 1d entry excluded); Olivier 40d; Paule absent |
  | `gyms` own row | visible, `Africa/Douala` (`read own gym`, `0009`) |
  | the same reads as the **owner** | 18 members, 5 notes (every coach's, via `manager_or_owner_read_own_session_notes`, which includes supervisor), 0 progress entries |

  A read-only PostgREST check through `@supabase/supabase-js` against the local stack accepted both AC #6 and AC #7 builder chains verbatim, including the FK hint, both `referencedTable` options and the embedded `is` filter. Both chains also typecheck (AC #6's cast note covers the wrong inferred `gyms` type). Runtime shapes: `session_notes: []` / `progress_entries: []` are arrays, and `gyms: { timezone }` is an object.

- **Why direct RLS reads, not a new RPC.** The epic says "no migration", and both grants already exist exactly as needed: `coach_read_own_session_notes` for authored notes on currently assigned members, and `coach_read_assigned_progress_entries`. The 17.4 roster needed `SECURITY DEFINER` only because a Coach cannot read unassigned members or bookings. Nothing here reaches beyond the Coach's own caseload.

- **Why the thresholds live in the app.** "Latest note older than N days" needs a per-member aggregate. PostgREST aggregates are not enabled here, and a view or RPC would be a migration. The embed gives one latest row per member, and the selectors do the rest over at most one row per assigned member.

- **`now` and the gym's calendar.** All day arithmetic is gym-local calendar dates computed with `Intl`, which is safe across DST. The gym timezone enum today is `Africa/Douala`, `Africa/Lagos`, `Africa/Bangui`, `Africa/Kinshasa` and `UTC` (`packages/types/src/schemas/gym.ts:155`), none of which has DST; `0097`'s header explains why the code must be DST-safe anyway. The timezone arrives with each row: `gyms(timezone)` on the member reads and `gymTimezone` on `listMyClasses()` rows. No extra `gyms` read and no `getGymSettings()` (it selects `gym_token`).

- **Coach claims vs live role.** `coach_read_assigned_members` and `coach_read_own_session_notes` gate on the `app_role` claim (`0040`, `0041`); `coach_read_assigned_progress_entries` gates on the live role (`0067`). A coach demoted mid-session keeps At A Glance and Needs Follow-Up for up to the JWT's hour but loses Recent Progress at once. This is the pre-existing AD-3 gap: record it in *Found, not fixed*, don't retrofit.

- **Found, not fixed** (for `deferred-work.md`, AC #17):
  1. **Needs Follow-Up cannot tell a new assignment from a neglected one.** A Coach has no read on `coach_assignments.started_at` (`0039`), so a member assigned today shows "No note yet" immediately.
  2. **The member widgets and At A Glance count different sets.** AC #6/#7 read `members`, while `listAssignedMembers()` reads `subscriptions_current`, which drops assignees with no subscription row. So such a member can be in Needs Follow-Up but not in the At-A-Glance total. It has the same root as the 17.3 review item, and AC #3's gate inherits it.
  3. **A non-coach opening `/coach/overview` by URL sees gym-wide figures.** Needs Follow-Up is built from every coach's notes, and Recent Progress is empty. On a gym of more than 1000 members the `members` read truncates. No route guard, by decision.
  4. **A client-supplied `logged_at` in the future** is clamped to "today", so a device with a fast clock can keep an entry looking fresh.
  5. **The JWT-claim vs live-role split** described above.

- **Testing stack.** Vitest 4.1.10, `@testing-library/react` 16.3.2 and `@testing-library/user-event` 14.6.4; jsdom; co-located `*.test.ts(x)`. `vitest.setup.ts` registers `cleanup` and stubs `scrollIntoView`. Async Server Components are tested by awaiting the child through its boundary (`coach/overview/page.test.tsx:37-41`, `coach/classes/page.test.tsx`).

- **Out of scope:**
  - any write path;
  - check-in-based follow-up;
  - progress photos;
  - a route guard;
  - a configurable threshold (a gym setting would be new UI plus a migration);
  - an AD-15 breadcrumb (17.3 deferred it);
  - the "Espace/Portail Coach" copy question;
  - realtime or polling;
  - a production deploy.

### Project Structure Notes

- **New:**
  - `apps/dashboard/app/(dashboard)/coach/gymTime.ts` + `.test.ts`
  - `coach/overview/caseload.ts` + `.test.ts`
  - `coach/overview/loading.test.tsx`
  - `coach/overview/components/OverviewWidget.tsx`, `CaseloadList.tsx`, `MembersAtAGlance.tsx` + tests
  - `coach/[memberId]/page.test.tsx`
  - `apps/dashboard/services/coaches.listAssignedMemberNoteRecency.test.ts`, `coaches.listAssignedMemberProgressRecency.test.ts`
- **Modified:**
  - `coach/overview/page.tsx` (rewritten), `page.test.tsx` (rewritten), `loading.tsx`
  - `coach/classes/page.tsx` (imports the moved formatter only)
  - `coach/classes/components/CoachClassesPageClient.tsx` (ref and hash effect) + its test (cases added)
  - `coach/[memberId]/page.tsx`, `components/CoachMemberDetailPageClient.tsx`
  - `apps/dashboard/services/coaches.ts` (additions only)
  - `apps/dashboard/locales/en.json`, `fr.json`
  - `docs/decisions.md`
  - `_bmad-output/implementation-artifacts/deferred-work.md`, `sprint-status.yaml`
  - `_bmad-output/planning-artifacts/epics.md` and `ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md` (already amended during story creation; commit only)
  - this file
- **Unmodified:** every migration and RLS policy, `packages/types/src/database.ts` (no new RPC), `coach/layout.tsx`, `coach/components/**`, `coach/page.tsx`, `Sidebar.tsx`, and the admin `classes/**`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 17.5: Coach Portal — Overview — including both 2026-09-10 amendment notes]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 17.4 — My Next Sessions reuses list_my_classes(); `id="class-<classId>"`]
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md:559 FR-146; :441 FR-055; :557 FR-145]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md:1755-1790 AD-20 (as amended 2026-09-10); AD-14 empty-state copy; AD-15 tabs]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-09-09.md — "Deliberate deferral — check-in-based coach follow-up"; §4.4 row 17.5]
- [Source: _bmad-output/implementation-artifacts/17-3-coach-portal-sub-navigation-landing.md — AC #10, #14; Review Findings (loading, gym switch)]
- [Source: _bmad-output/implementation-artifacts/17-4-coach-portal-my-classes-session-roster.md — AC #7, #10, #11 (section anchor, hash expansion left to 17.5); Dev Notes → Out of scope]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — 17.3 review (subscriptions_current inner join), 17.1 review (timestamps without timeZone)]
- [Source: docs/decisions.md#2026-09-10 — Coach My Classes (Story 17.4); #2026-09-10 — Gym-health cards (Story 17.2)]
- [Source: supabase/migrations/0013_dashboard_shell_self_read.sql:23; 0039 (coach_assignments, manager/owner read only); 0040_coach_portal_member_list_rls.sql:33-95; 0041_coach_portal_member_detail_session_notes.sql:7-75; 0066_body_profile_progress_entry_logging.sql:43-71; 0067_progress_data_photo_privacy.sql:92, 131-146; 0025 (attendance read excludes coach); 0097_gym_local_period_bounds.sql header (DST rule)]
- [Source: supabase/config.toml:18 (max_rows); supabase/tests/coach_portal_member_detail_session_notes.test.sql:235; progress_entries.test.sql; progress_photos.test.sql]
- [Source: apps/dashboard/app/(dashboard)/coach/overview/page.tsx, page.test.tsx, loading.tsx; coach/classes/page.tsx:96-131; coach/classes/page.test.tsx:38-42, 106-109, 121-127; coach/classes/components/CoachClassesPageClient.tsx:48-155; coach/[memberId]/page.tsx:22-86; coach/[memberId]/components/CoachMemberDetailPageClient.tsx:60-75, 179-241; (dashboard)/page.tsx:56-61, 115-151]
- [Source: apps/dashboard/services/coaches.ts:21-36, 227-261, 371-431, 537-606; services/classes.ts:298-380; services/members.ts:217-220]
- [Source: apps/dashboard/services/classes.countClassSessionsBetween.test.ts:15-56 (recording builder stub + mocks); apps/dashboard/vitest.setup.ts:20-22]
- [Source: apps/dashboard/lib/i18n/get-server-translation.ts:57; apps/dashboard/eslint.config.mjs:22-38; scripts/check-i18n-key-parity.mjs]
- [Source: apps/dashboard/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/io.md; 02-components/link.md "Scrolling to an id"; 01-app/02-guides/preserving-ui-state.md (Activity re-runs effects)]
- [Source: packages/types/src/schemas/gym.ts:155 (timezone enum)]

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (`claude-opus-5[1m]`) via Claude Code, `bmad-create-story` then `bmad-dev-story` workflows.

### Debug Log References

- **Task 0:** branch `feat/17-5-coach-overview` from `master` at `147e10d` (PR #13's merge commit); `baseline_commit` written to this file's frontmatter. The four uncommitted docs (this file, `sprint-status.yaml`, `epics.md`, `EXPERIENCE.md`) came along on the branch, still uncommitted.
- **Red → green:**
  - **Task 1:** `gymTime.test.ts` was red on the missing module, then green. Together with `coach/classes/page.test.tsx`, unmodified after the formatter moved: 23/23.
  - **Task 2:** both service test files were red, 11 tests failing with "… is not a function", then green.
  - **Task 3:** `caseload.test.ts`, 15 tests, was written before `caseload.ts`. With the service tests: 26/26.
  - **Task 4:** the page, widget and loading tests were written alongside the page, **not red first**. The overview folder came to 42/42: page 18, widgets 8, loading 1, caseload 15.
  - **Task 5:** the hash-landing file's 5 tests were written alongside the effect, not red first. Together with the untouched 17.4 client file's 14: 19/19.
  - **Task 6:** `[memberId]/page.test.tsx`, 7/7.
  - **Lint** caught two `<p>body</p>` JSX literals in `OverviewWidgets.test.tsx` (`i18next/no-literal-string`), rewritten as `{"body"}`. The ref and both effects in `CoachClassesPageClient.tsx` pass `react-hooks/refs` and the other react-hooks rules with no disable comment.
  - **Refactor after green:** `CaseloadSelection` became generic, so `selectRecentProgress()` returns rows whose `lastAt` is typed non-null. That removed a `?? now` fallback in the page.
- **Final verification, on the final code:**
  - `pnpm --filter @gymos/dashboard typecheck`: exit 0.
  - `lint`: 0 errors and the same 15 warnings as the 17.4 baseline. `eslint` over every touched file: exit 0, no findings.
  - `test`: **67 files / 536 tests** green, up from 59 / 469 (+8 files, +67 tests).
  - `node scripts/check-i18n-key-parity.mjs`: clean, dashboard 784 keys (771 + 13).
  - Grep of non-test overview source: `14` and `7` appear only as the two constants.
  - `pnpm --filter @gymos/dashboard build`: exit 0, with `/coach`, `/coach/overview`, `/coach/classes` and `/coach/[memberId]` all Partial Prerender (◐).
  - No pgTAP run: no SQL changed.
- **Task 9, QA seed**, committed to the local DB in the "Overview QA Gym" (`00000000-0000-4000-9171-000000000001`). A guard aborts a re-run if the gym already has notes or entries.
  - **`session_notes` (6):**
    - Cyril → Aicha (3 days and 30 days ago), Blaise (20 days), Olivier (local noon on 2026-08-27, exactly 14 gym-local days before 2026-09-10), Paule (1 day, under her ended assignment);
    - Celine → Nadia, 2 days ago, under a new **ended** `coach_assignments` row (started 60 days ago, ended 40 days ago).
  - **`progress_entries` (6):** Aicha 2 days; Blaise 5 days, plus a soft-deleted entry 1 day ago; Olivier 40 days; Quentin local noon on 2026-09-03 (exactly 7 gym-local days); Paule now.
  - **Read back** in a rolled-back transaction:
    - **Cyril, latest visible note (local date):** Aicha 2026-09-07, Blaise 2026-08-21, Olivier 2026-08-27, and none for Marc, Nadia (Celine's note hidden), Quentin and Rose. Paule is absent.
    - **Cyril, latest active entry:** Aicha 09-08, Blaise 09-05 (the soft-deleted 09-09 entry excluded), Olivier 08-01, Quentin 09-03.
    - **Cyril, upcoming sessions:** QA HIIT Circuit on 09-11 18:00 (3 booked), 09-14 18:00 and 09-16 18:00. Today's 12:00 QA Lunch Express has already started and is excluded.
    - **Celine:** 0 visible members and 8 upcoming sessions.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created. Story created 2026-09-10, with two product decisions taken with smartsana (empty-state layout for a class-only coach; 14-day / 7-day thresholds) and written into `epics.md` and `EXPERIENCE.md`. The widget reads were proven under a real coach session on the local DB in a rolled-back transaction. The story was then checked against the create-story checklist by a fresh-context validator, and its findings were applied.
- **AC #1–#3, page:**
  - one Suspense boundary and one `Promise.all` over `listAssignedMembers({})`, `listMyClasses()` and the two new recency reads;
  - `now` read once, after the request-time reads;
  - each widget built from its own `{ data, error }`;
  - the layout table is implemented as specified: no members and no upcoming session → guidance alone; no members but sessions, or a failed class read → My Next Sessions beside the guidance; otherwise the 4-widget grid in AD-20's order, including when the member read failed.
- **AC #4, My Next Sessions:** `selectNextSessions()` keeps sessions strictly after `now`, sorts them across classes and keeps 3. Rows link to `/coach/classes#class-<id>`, with the time from `gymDateFormatter` (one per timezone), the class name, and the booked count as `meta`.
- **AC #5, hash landing:** a ref seeded at mount and synced in an effect, plus a `[]`-deps effect that opens and scrolls to the named class on mount and on `hashchange`, with the listener removed on unmount. **Deviation in test placement only:** the new cases live in `CoachClassesPageClient.hashLanding.test.tsx` rather than being appended to `CoachClassesPageClient.test.tsx`. That keeps the 17.4 file byte-for-byte untouched, which is the intent of AC #15's "existing ones untouched". The new file also proves a re-render with new props does not re-open a collapsed class.
- **AC #6–#7, services:** both read `members` with one embedded latest row, the `role = 'member'` filter, the FK hint, and the embedded `deactivated_at` filter for progress.
  - A shared `toMemberRecencyRow()` casts the result, accepts `gyms` as an object, a one-element array or null, and falls back to `"UTC"`.
  - Neither touches `progress_photos` or storage.
- **AC #8–#11, the rest of the page:**
  - My Members At A Glance behaves as in 17.3 (same total, same badges and order, "All →" to `/coach`), now inside the shared `OverviewWidget` frame.
  - `gymTime.ts` holds the formatter, moved verbatim, plus `gymLocalDaysAgo()` (from `formatToParts`, with one cached formatter per timezone) and `relativeDaysFormatter()`.
  - `caseload.ts` holds the four constants with their rationale.
  - The widgets are hookless server components taking strings only. The AC #15 component tests share one file, `OverviewWidgets.test.tsx`.
  - `loading.tsx` renders 4 text-free cards with `aria-busy`.
  - `moreCount` is interpolated with the numeric `count`.
- **AC #12, AD-15 `?tab=`:** `resolveInitialTab()` accepts only the exact strings `progress` and `workout-plan`. A missing, unknown, differently-cased or repeated (`string[]`) value lands on Session Notes. The client gains `initialTab` and the exported `CoachMemberDetailTab` type, used as `<Tabs defaultValue>`; nothing else in either file changed.
- **AC #13, scope held:** no migration, RLS, `database.ts`, layout, nav, Sidebar or admin classes change. `listAssignedMembers()` and `listMyClasses()` are untouched.
- **AC #14:** 13 keys in EN and FR, parity clean.
- **AC #17, record-keeping:**
  - a `docs/decisions.md` top entry (the two decisions, calendar days, embedded latest rows and the `role` filter, per-widget isolation, hash landing and `?tab=`), citing the 17.2 entry by its dated heading;
  - a `deferred-work.md` section carrying the five found-not-fixed items.
- **Nothing committed.** The work sits on `feat/17-5-coach-overview`.
- **For smartsana's browser pass.** Log in at the local dashboard; the data above is seeded, and the Overview QA Gym passwords are the ones from the 17.3/17.4 passes.
  - **As `coach@overviewqa.test` (Cyril), on `/coach/overview`:**
    - four cards: My Next Sessions, My Members At A Glance, Needs Follow-Up, Recent Progress Activity;
    - **My Next Sessions:** three QA HIIT Circuit sessions (Fri 11 Sep 18:00 at 3/15, then Mon 14 and Wed 16 Sep). Clicking one lands on My Classes with QA HIIT Circuit already expanded and scrolled into view;
    - **Needs Follow-Up:** Marc, Nadia, Quentin and Rose ("No note yet"), then Blaise ("Last note 20 days ago"), then "+1 more". Neither Paule nor Celine's note on Nadia appears. A row opens the member on Session Notes;
    - **Recent Progress Activity:** Aicha ("Logged 2 days ago"), then Blaise ("Logged 5 days ago"). A row opens the member on the Progress tab.
  - **As `coach2@overviewqa.test` (Celine):** My Next Sessions (QA Morning Yoga) beside the "No members have been assigned to you yet" guidance, and no other card.
  - **Loading and language:** the 4-card skeleton while navigating from My Members to Overview; EN/FR (for example "À relancer", "il y a 20 jours").
  - **As the owner, opening `/coach/overview` by URL:** gym-wide figures. This is the accepted no-route-guard precedent.

### File List

New:
- `apps/dashboard/app/(dashboard)/coach/gymTime.ts`
- `apps/dashboard/app/(dashboard)/coach/gymTime.test.ts`
- `apps/dashboard/app/(dashboard)/coach/overview/caseload.ts`
- `apps/dashboard/app/(dashboard)/coach/overview/caseload.test.ts`
- `apps/dashboard/app/(dashboard)/coach/overview/loading.test.tsx`
- `apps/dashboard/app/(dashboard)/coach/overview/components/OverviewWidget.tsx`
- `apps/dashboard/app/(dashboard)/coach/overview/components/CaseloadList.tsx`
- `apps/dashboard/app/(dashboard)/coach/overview/components/MembersAtAGlance.tsx`
- `apps/dashboard/app/(dashboard)/coach/overview/components/OverviewWidgets.test.tsx`
- `apps/dashboard/app/(dashboard)/coach/classes/components/CoachClassesPageClient.hashLanding.test.tsx`
- `apps/dashboard/app/(dashboard)/coach/[memberId]/page.test.tsx`
- `apps/dashboard/services/coaches.listAssignedMemberNoteRecency.test.ts`
- `apps/dashboard/services/coaches.listAssignedMemberProgressRecency.test.ts`
- `_bmad-output/implementation-artifacts/17-5-coach-portal-overview.md`

Modified:
- `apps/dashboard/app/(dashboard)/coach/overview/page.tsx` (rewritten)
- `apps/dashboard/app/(dashboard)/coach/overview/page.test.tsx` (rewritten)
- `apps/dashboard/app/(dashboard)/coach/overview/loading.tsx`
- `apps/dashboard/app/(dashboard)/coach/classes/page.tsx` (imports the moved formatter)
- `apps/dashboard/app/(dashboard)/coach/classes/components/CoachClassesPageClient.tsx`
- `apps/dashboard/app/(dashboard)/coach/[memberId]/page.tsx`
- `apps/dashboard/app/(dashboard)/coach/[memberId]/components/CoachMemberDetailPageClient.tsx`
- `apps/dashboard/services/coaches.ts` (additions only)
- `apps/dashboard/locales/en.json`
- `apps/dashboard/locales/fr.json`
- `docs/decisions.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/epics.md` (amended during story creation)
- `_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md` (amended during story creation)

## Change Log

- 2026-09-10 — create-story: Story 17.5 created with two product decisions (a class-only coach's layout; the 14-day / 7-day thresholds), which are also written into `epics.md` and `EXPERIENCE.md` AD-20. Widget reads were proven on the local DB, and the create-story checklist validation was applied. Status → ready-for-dev.
- 2026-09-10 — dev-story: Story 17.5 implemented (Tasks 0–9).
  - **Overview:** `/coach/overview` gains My Next Sessions (reusing `listMyClasses()`), Needs Follow-Up and Recent Progress Activity next to 17.3's At A Glance.
    - one `Promise.all` with per-widget failure isolation;
    - AD-20's 4-card skeleton;
    - the no-members layout rule.
  - **Services:** two new services read `members` with one embedded latest note or active progress entry.
  - **Time helpers:** gym-local calendar-day helpers and the moved formatter now live in `coach/gymTime.ts`.
  - **My Classes:** opens the class a `#class-<id>` hash names.
  - **AD-15:** takes `?tab=progress` / `?tab=workout-plan`.
  - **i18n:** 13 EN/FR keys.
  - **Tests:** 8 new test files and a rewritten overview page test; the suite is now 67 files / 536 tests.
  - **Record-keeping:** a `decisions.md` entry and a `deferred-work.md` section.
  - **Local QA:** notes and progress entries seeded.
  - **Verification:** typecheck, lint, test, i18n parity and build all green.
  - Status → review.
- 2026-09-10 — code-review: three parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor), none failed; the Acceptance Auditor found no AC violation. 28 raw findings became 24 after merging; 19 were dismissed as verified not real, spec-pinned, repo convention, or already in `deferred-work.md`.
  - **Decision (delegated to the reviewer by smartsana, resolved as a patch):** AD-15's `<Tabs>` are keyed on `router.bfcacheId`, so a second click on the same Recent Progress row opens Progress again. This amends AC #12's "nothing else in either file changes".
  - **Patches:** the two hash-landing cases that lacked it now assert no roster fetch; the unmount test proves the removed handler is the one added; an overview page test proves both recency reads still run with no assigned members; `docs/decisions.md` records AC #3's two failure rows and the `bfcacheId` key.
  - **Verification:** dashboard Vitest 67 files / 537 tests; typecheck 0; lint 0 errors, 15 warnings unchanged; `next build` exit 0 with `/coach`, `/coach/overview`, `/coach/classes` and `/coach/[memberId]` Partial Prerender (◐). No locale or SQL change.
  - Status → done.
