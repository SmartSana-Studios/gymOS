# Story 17.4: Coach Portal — My Classes & Session Roster

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Coach,
I want to see the classes I am assigned to teach and who is booked into each session,
so that I know what I am teaching and who to expect, without asking the front desk.

*Depends on Story 17.3 (fills its `/coach/classes` route shell). **Migration 0096.** Zero RLS policies modified. **Release-blocking:** it ships in the same release as 17.3 (product owner, 2026-09-10), so the Portal's My Classes item never points at the placeholder in front of a customer.*

*Two decisions were made with the product owner (smartsana) during story creation, 2026-09-10, and are already written into `epics.md` Story 17.4 and `EXPERIENCE.md` AD-21:*
1. ***0096 adds two functions, not one.*** *A Coach has no RLS read on `class_bookings`: `gym_staff_read_own_class_bookings` is owner/manager/receptionist/supervisor only (`0068:37-42`). So the epic's "booked count" cannot be computed from plain reads, and the epic's "exactly one new function" could not satisfy it. `list_my_classes()` returns the Coach's classes and sessions with counts only, no member identity. `list_my_class_session_roster()` stays as specified. Story 17.5's My Next Sessions reuses `list_my_classes()`.*
2. ***Sessions are listed from 00:00 today in the gym's timezone onward, not strictly `scheduled_at > now()`.*** *`attended_at` is only ever set once a session has started (`0068:121`), so a strictly-upcoming list would hide the class a Coach is teaching right now, together with its attendance.*

*Do not re-litigate either decision; the reasoning is in Dev Notes.*

## Acceptance Criteria

1. **Migration `supabase/migrations/0096_coach_portal_my_classes.sql`** adds exactly two functions, their grants and a verify block, using **this SQL exactly**. It was compiled and exercised in a rolled-back transaction against this repo's local Supabase during story creation; see Dev Notes → *Measured*.

   ```sql
   create function list_my_classes()
   returns table (
     class_id uuid,
     class_name text,
     capacity integer,
     schedule_type text,
     one_off_session_at timestamptz,
     recurrence_days smallint[],
     recurrence_time time,
     gym_timezone text,
     class_session_id uuid,
     scheduled_at timestamptz,
     booked_count bigint
   )
   language plpgsql
   stable
   security definer
   set search_path = public, pg_temp
   as $$
   declare
     v_gym_id uuid;
     v_coach_id uuid;
     v_timezone text;
     v_day_start timestamptz;
   begin
     v_gym_id := private.gym_id();
     if v_gym_id is null then
       return;
     end if;

     select m.id into v_coach_id
     from members m
     where m.user_id = auth.uid()
       and m.gym_id = v_gym_id
       and m.role = 'coach'
       and m.deactivated_at is null;

     if v_coach_id is null then
       return;
     end if;

     if private.current_gym_status() is distinct from 'active' then
       raise exception 'list_my_classes: gym % is not active', v_gym_id;
     end if;

     select g.timezone, date_trunc('day', now() at time zone g.timezone) at time zone g.timezone
     into v_timezone, v_day_start
     from gyms g
     where g.id = v_gym_id;

     return query
     select c.id, c.name, c.capacity, c.schedule_type, c.one_off_session_at,
            c.recurrence_days, c.recurrence_time, v_timezone,
            cs.id, cs.scheduled_at,
            (select count(*) from class_bookings cb where cb.class_session_id = cs.id)
     from classes c
     left join class_sessions cs
       on cs.class_id = c.id
      and cs.scheduled_at >= v_day_start
     where c.gym_id = v_gym_id
       and c.coach_id = v_coach_id
     order by c.name, c.id, cs.scheduled_at nulls last;
   end;
   $$;

   revoke execute on function list_my_classes() from public;
   grant execute on function list_my_classes() to authenticated;

   create function list_my_class_session_roster(p_class_session_id uuid)
   returns table (member_id uuid, member_name text, attended_at timestamptz)
   language plpgsql
   stable
   security definer
   set search_path = public, pg_temp
   as $$
   declare
     v_gym_id uuid;
     v_coach_id uuid;
   begin
     v_gym_id := private.gym_id();
     if v_gym_id is null then
       return;
     end if;

     select m.id into v_coach_id
     from members m
     where m.user_id = auth.uid()
       and m.gym_id = v_gym_id
       and m.role = 'coach'
       and m.deactivated_at is null;

     if v_coach_id is null then
       return;
     end if;

     if private.current_gym_status() is distinct from 'active' then
       raise exception 'list_my_class_session_roster: gym % is not active', v_gym_id;
     end if;

     return query
     select b.id, b.name, cb.attended_at
     from class_sessions cs
     join classes c on c.id = cs.class_id
     join class_bookings cb on cb.class_session_id = cs.id
     join members b on b.id = cb.member_id
     where cs.id = p_class_session_id
       and cs.gym_id = v_gym_id
       and c.coach_id = v_coach_id
     order by b.name, b.id;
   end;
   $$;

   revoke execute on function list_my_class_session_roster(uuid) from public;
   grant execute on function list_my_class_session_roster(uuid) to authenticated;
   ```

   - **Shape:** `create function`, not `create or replace`, and no `begin;`/`commit;` wrapper. The applier supplies the transaction, as for 0095/0097.
   - **No comments inside either `$$ … $$` body.** `supabase/tests/suspension_rpc_coverage.test.sql` scans `prosrc`, which includes body comments. A comment containing `insert into`, `update <table>`, `delete from`, or `execute` followed by a quote, `format(`, `$`, `v_` or `_sql`, would make the meta-test misread a read-only function as a writer (`:81-83`, `:299-326`) or as dynamic SQL (`:194`). Put all rationale in the file header.
   - **Header comment**, house style as in `0095:1-82`. Cover:
     - what this closes: the Coach has no RLS read on `class_bookings` (`0068:37-42`), and no read on the names of members they are not assigned to (`0040:81-87`);
     - why `SECURITY DEFINER`, and why that is not an RLS widening: column-precise, and no phone number or other `members` column leaves;
     - why the caller is resolved from a **live** `members` row (`role = 'coach'`, `deactivated_at is null`) rather than `auth.jwt() ->> 'app_role'` (AD-3 forbids new `app_role` call sites; FR-089 needs immediate revocation);
     - why unauthorized callers get an **empty set**, not an exception;
     - why the suspension guard is present in a read-only function, and why it sits **below** caller resolution (0090's error-precedence refinement, `0090:76-80`);
     - why the start of today is computed inline rather than by calling 0097's `private.gym_local_day_bounds()` (0096 applies before 0097 in filename order, so it must not depend on it). The expression is identical to that helper's `day_start` and carries no `+ interval`, which is the part 0095/0097 warn about;
     - why the roster RPC is not time-bounded;
     - why deactivated **booked** members still appear;
     - that both functions are read-only, so they are neither guarded writers nor exclusion-list entries in the suspension meta-test.
   - **Trailing verify block**, messages prefixed `'0096: '`, asserting:
     - (a) both functions exist with the right arg counts;
     - (b) neither grants EXECUTE to PUBLIC, counting a NULL `proacl` as granted (copy `0095:145-156`);
     - (c) both are `prosecdef`. This is the **inverse** of 0095's check: here DEFINER rights are the point;
     - (d) both `prosrc` match the fail-closed guard regex `current_gym_status\(\)\s+is\s+distinct\s+from\s+'active'`.

     The block below was run during story creation and passes; use it verbatim:

     ```sql
     do $verify$
     begin
       if not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'list_my_classes' and p.pronargs = 0
       ) then
         raise exception '0096: list_my_classes() was not created';
       end if;

       if not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'list_my_class_session_roster' and p.pronargs = 1
       ) then
         raise exception '0096: list_my_class_session_roster(uuid) was not created';
       end if;

       if exists (
         select 1 from pg_proc p
         where p.oid in ('public.list_my_classes()'::regprocedure,
                         'public.list_my_class_session_roster(uuid)'::regprocedure)
           and (
             p.proacl is null
             or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
           )
       ) then
         raise exception '0096: EXECUTE on list_my_classes() and list_my_class_session_roster() must not be granted to PUBLIC';
       end if;

       if exists (
         select 1 from pg_proc p
         where p.oid in ('public.list_my_classes()'::regprocedure,
                         'public.list_my_class_session_roster(uuid)'::regprocedure)
           and not p.prosecdef
       ) then
         raise exception '0096: both functions must be SECURITY DEFINER -- a Coach has no RLS read on class_bookings, nor on the names of members they are not assigned to';
       end if;

       if exists (
         select 1 from pg_proc p
         where p.oid in ('public.list_my_classes()'::regprocedure,
                         'public.list_my_class_session_roster(uuid)'::regprocedure)
           and p.prosrc !~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
       ) then
         raise exception '0096: both functions must carry the fail-closed suspension guard (is distinct from ''active'', 0090)';
       end if;
     end;
     $verify$;
     ```

2. **Caller semantics, both functions.** They return rows only when the caller has a `gym_id` claim, has a **live** `members` row in that gym with `role = 'coach'` and `deactivated_at is null`, and that gym is `active`.
   - **Empty set, never an exception**, in all of these cases:
     - no `gym_id` claim, or `anon`, which has no EXECUTE at all;
     - a member, receptionist, manager, supervisor or owner, including one whose JWT still says `app_role = coach` after a demotion;
     - a deactivated coach;
     - another coach's class or session;
     - another gym's session;
     - a nonexistent session id.
   - **Suspended or deactivated gym:** a caller who **is** a coach there gets `raise exception '<fn>: gym <uuid> is not active'`. The phrase `is not active` is load-bearing (`packages/types/src/errors.ts:14-28`, `0090:55-60`); do not reword it.
   - Never branch on `auth.jwt() ->> 'app_role'` anywhere in 0096 (ARCHITECTURE-SPINE AD-3).

3. **`list_my_classes()` semantics.**
   - **Every class** whose `coach_id` is the caller's own `members.id`. A class with **no** session in the window still returns exactly **one** row, with `class_session_id`, `scheduled_at` = `null` and `booked_count` = `0`. A Coach who teaches only a finished one-off class or a far-future recurring class is therefore never shown AD-21's "not assigned" empty state.
   - **Sessions** are those with `scheduled_at >= 00:00 today in gyms.timezone`, with no upper bound. The materializer keeps recurring classes 4 weeks ahead (`0057:224-248`); one-off classes have one session.
   - **`booked_count`** counts **every** booking on that session: bookings of members the Coach is not assigned to, and of deactivated members. Cancellation is a row DELETE (`0058:22-31`), so `count(*)` is the true booked total, the same definition as `book_class_session()`'s capacity check (`0058:193`) and the member app (`0078:68`).
   - **`gym_timezone`** is repeated on every row, so the page formats times in the gym's zone with no extra read.
   - **Order:** class name, class id, then `scheduled_at` ascending with nulls last.

4. **`list_my_class_session_roster(p_class_session_id)` semantics.**
   - It returns exactly `(member_id, member_name, attended_at)`, one row per booking on that session, ordered by name then id. No other `members` column, especially `phone` (FR-145, `EXPERIENCE.md` AD-21).
   - **Not time-bounded:** a Coach may read the roster of any session of their own class, past or future. A time bound would protect nothing, since the Coach already teaches those sessions, and would break the page for a session that crosses midnight.
   - **Deactivated booked members are included.** Deactivation does not cancel a booking, and the admin roster (`services/classes.ts:261-294`) shows them too.

5. **Zero RLS change, and the guardrails stay green unchanged.**
   - 0096 creates, alters or drops **no** policy. Untouched: `gym_staff_read_own_class_bookings` (`0068:37`), `member_read_own_class_bookings` (`0058:64`), `gym_staff_read_own_classes` (`0057:101`), `gym_staff_read_own_class_sessions` (`0057:172`), every `manager_or_owner_*` policy, and every `members` policy.
   - `mark_class_attendance`'s role check (`0068:70`) is unchanged, and so are `ClassesPageClient.tsx:58`'s `canManage` and `:65`'s `canMarkAttendance = role !== "coach"`.
   - `supabase/tests/suspension_rpc_coverage.test.sql` passes **without edits**. Neither function goes on its exclusion list: they write nothing, and an exclusion entry for a read-only function would be permanently inert and would mislead the next reader, as `docs/decisions.md` records under 2026-09-09 (Story 11.9).

6. **Types.** `packages/types/src/database.ts` gains two entries, in this order between `list_my_class_bookings` (`:2088-2096`) and `list_own_active_gym_memberships` (`:2097`). ASCII puts `_` before `e`, so `list_my_class_session_roster` sorts before `list_my_classes`.

   ```ts
   list_my_class_session_roster: {
     Args: { p_class_session_id: string }
     Returns: {
       attended_at: string | null
       member_id: string
       member_name: string
     }[]
   }
   list_my_classes: {
     Args: never
     Returns: {
       booked_count: number
       capacity: number
       class_id: string
       class_name: string
       class_session_id: string | null
       gym_timezone: string
       one_off_session_at: string | null
       recurrence_days: number[] | null
       recurrence_time: string | null
       schedule_type: string
       scheduled_at: string | null
     }[]
   }
   ```

   Hand-add them. `supabase gen types typescript --local` exits 0 and writes 0 bytes in this devcontainer (17.1 Debug Log). The nullable columns are typed `| null` on purpose: the generator types table-returning columns as non-null, which is false for a `left join` and for `attended_at`. Do not commit CLI churn to other entries.

7. **Services in `apps/dashboard/services/classes.ts`**, beside the admin reads (AD-7). Both call the RPC with no `getCallerGymId()` step, because `private.gym_id()` resolves the gym server-side, as `getGymLocalPeriodBounds()` does (`services/gym-settings.ts:126`). Both return `{ data, error }` and never throw (AD-9); on error `{ data: null, error: await mapAndLog(error) }`.
   - **`listMyClasses(): Promise<{ data: CoachClassRow[] | null; error }>`**
     - `supabase.rpc("list_my_classes")`, no args.
     - Groups rows by `class_id`, **preserving the SQL order**.
     - A row with `class_session_id === null` contributes the class with `sessions: []`.
     - `bookedCount: Number(row.booked_count)`.
     - `data: null` or `[]` from the RPC → `{ data: [], error: null }`: zero classes is a result, not an error.
     - Types:
       ```ts
       export interface CoachClassSessionRow { classSessionId: string; scheduledAt: string; bookedCount: number }
       export interface CoachClassRow {
         classId: string; className: string; capacity: number;
         scheduleType: "one_off" | "recurring"; oneOffSessionAt: string | null;
         recurrenceDays: number[] | null; recurrenceTime: string | null;
         gymTimezone: string; sessions: CoachClassSessionRow[];
       }
       ```
   - **`listMyClassSessionRoster(classSessionId: string): Promise<{ data: CoachRosterRow[] | null; error }>`**
     - `supabase.rpc("list_my_class_session_roster", { p_class_session_id: classSessionId })`, mapped to `{ memberId, memberName, attendedAt }`.
     - `data: null` → `[]`.
   - **Do not reuse** `listClasses()` or `listSessionBookings()`. Under a Coach session their `class_bookings` reads return **zero rows silently**, not an error (`0068:37-42`), so counts would render `0/15` and every roster "No members booked".

8. **Server Action `app/(dashboard)/coach/classes/actions.ts`** (`"use server"`): `getMySessionRosterAction(classSessionId: string)` is a thin wrapper returning `listMyClassSessionRoster(classSessionId)`, the same shape as `classes/actions.ts:128-132`'s `getSessionBookingsAction`.
   - A Server Action is a public POST endpoint callable with any id. The RPC is the authorization boundary, and returns empty for anything not the caller's own class.
   - Add no other action: there is no write path on this page.

9. **`app/(dashboard)/coach/classes/page.tsx` is rewritten** from 17.3's route shell. Keep the file and its role, and replace the header comment.
   - **Shape:** the sync default export returns `<Suspense fallback={<CoachClassesLoading />}><CoachClassesData /></Suspense>`, the structure of `coach/overview/page.tsx:29-35`.
   - **`CoachClassesData`** (async):
     - `locale = await getRequestLocale()`, `{ t } = await getServerTranslation(locale)`, `listMyClasses()`.
     - Error → the inline `<div className="text-sm text-red-600">{t("common.loadError")}</div>` (`coach/overview/page.tsx:42-44`). Never `notFound()`.
     - Zero classes → AD-21's empty state in AD-14's dashed box (`coach/overview/page.tsx:49-51` classes) with `t("coachPortal.classes.emptyNoClasses")`, and **no** client component.
     - Otherwise render `<CoachClassesPageClient classes={views} />`, where every date, number and label is **formatted on the server** (AC #10).
   - **No `<h1>`**: `coach/layout.tsx:42` renders the Portal heading.
   - **No route-level role guard**: the precedent is `coach/page.tsx:14-24`. A manager or owner opening `/coach/classes` by URL gets the empty state, because the RPC returns nothing for a non-coach. That is correct, not a bug.
   - **No write controls**: no `canManage` or `canMarkAttendance` flag is read or passed.

10. **Server-side formatting in the gym's timezone.** No `Date`→string conversion happens in the client component.
    - **One formatter** per page render, used for every session label and for a one-off class's schedule:
      ```ts
      new Intl.DateTimeFormat(locale, {
        timeZone: gymTimezone, weekday: "short", day: "numeric", month: "short",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      })
      ```
      - 24-hour, per the AD-21 mockup.
      - `gymTimezone` comes from the first row. It is the same on every row; do not add a separate `gyms` read, and do **not** call `getGymSettings()`, which also selects `gym_token`.
    - **Recurring schedule:** `t("classes.recurringSummary", { days, time })`, where `days` is `recurrenceDays.map((d) => t(DAY_KEY[d])).join(", ")` and `time` is `recurrenceTime.slice(0, 5)`.
      - `recurrence_time` is already gym-local wall-clock time (`0057:245`), so it gets no timezone conversion.
      - Copy `DAY_KEY` from `ClassesPageClient.tsx:16` (this app's per-file-copy convention). Do not import from a client component.
    - **Capacity:** `t("coachPortal.classes.capacity", { capacity: capacity.toLocaleString(locale) })`.
    - **Per session:** `t("coachPortal.classes.bookedCount", { booked: bookedCount.toLocaleString(locale), capacity: capacity.toLocaleString(locale) })`.
    - **Never** a bare `toLocaleString()` or a formatter without `timeZone`.
      - `CheckedInTable.tsx:31`, `ClassesPageClient.tsx:134,151` and `CoachMemberDetailPageClient.tsx`'s `noteTimestamp()` all format in the runtime zone, which is UTC on Vercel's server and the browser's zone in the client. That gives an SSR/client hydration mismatch and, on the server, the wrong hour. Both are already recorded in `deferred-work.md` (17.1 and 5.3 reviews).
      - Server-side formatting with an explicit gym `timeZone` avoids both.
    - **Client props:**
      ```ts
      type CoachClassView = {
        classId: string; className: string; scheduleLabel: string; capacityLabel: string;
        sessions: { classSessionId: string; label: string; bookedLabel: string }[];
      };
      ```

11. **`app/(dashboard)/coach/classes/components/CoachClassesPageClient.tsx`** (`"use client"`): read-only and accessible.
    - **Class section:** each class is a `<section id={`class-${classId}`} className="rounded-md border">`.
      - The `id` is the anchor Story 17.5's My Next Sessions links to (`/coach/classes#class-<uuid>`). Do not build hash-driven auto-expansion; that is 17.5's call.
      - Its header is a `<button type="button" aria-expanded aria-controls>` showing class name, `scheduleLabel` and `capacityLabel`. It toggles that class's session list.
      - Classes start **collapsed** and expand independently (a `Set` of open class ids).
    - **Session row:** each session is also a `<button type="button" aria-expanded aria-controls>` showing `label` and `bookedLabel`.
      - **One session is expanded at a time** across the page, the same single-expand model as `ClassesPageClient.tsx:37`.
      - Expanding calls `getMySessionRosterAction(classSessionId)` **every time**, with no client cache, so attendance marked at the desk shows on the next expand.
      - Guard stale responses with a request ref exactly like `ClassesPageClient.tsx:67-101`: a result for a session that is no longer the expanded one is discarded.
    - **Roster panel** (inside the expanded session):
      - loading: `classes.attendance.loadingBookings`;
      - error: inline `common.loadError`, not a toast;
      - zero rows: `classes.attendance.noBookings`;
      - otherwise a `<ul>` of rows, each showing the member name and a read-only status:
        - attended: `<Badge variant="outline" className="border-green-200 bg-green-100 text-green-800"><CheckCircle2 className="mr-1 size-3" />{t("classes.attendance.attended")}</Badge>` (the badge at `ClassesPageClient.tsx`'s expanded panel);
        - not attended: `<span aria-hidden="true">—</span><span className="sr-only">{t("coachPortal.classes.notAttended")}</span>`.
    - **A class with `sessions.length === 0`** shows `classes.noUpcomingSession` when expanded.
    - **Read-only, absent from the DOM:** no button, link or form other than the disclosure buttons. No "Mark attended", no create, edit or reschedule control, no member-detail link (a booked member may not be assigned to this Coach, and `/coach/[memberId]` would show "not found"). No `role` prop is accepted.
    - **Hardcoded strings:** none, including `aria-*` attributes. The `i18next/no-literal-string` gate runs in `jsx-text-only` mode and misses attributes (`eslint.config.mjs:22-38`).

12. **Loading.** `coach/classes/loading.tsx` is replaced: it currently returns `null` and names 17.4 as its owner (`:1-7`).
    - It renders AD-21's **3 skeleton class rows**, each `h-14 w-full animate-pulse rounded-md bg-muted`, inside a `space-y-3` wrapper with `aria-busy="true"`.
    - The skeleton is text-free.
    - The page's own `<Suspense>` fallback imports and renders the same component, as `coach/overview/page.tsx:9,31` does.

13. **i18n.** `apps/dashboard/locales/en.json` and `fr.json`, under `coachPortal.classes` (`:646-648`):
    - **Delete** `coachPortal.classes.pendingNote`: the thing it says is "not available yet" now exists. Afterwards, `git grep pendingNote apps/dashboard` must find nothing.
    - **Add:**

      | Key | EN | FR |
      |---|---|---|
      | `coachPortal.classes.emptyNoClasses` | You are not assigned to any classes yet. Your manager schedules classes and assigns a coach. | Aucun cours ne vous est encore assigné. Votre gérant programme les cours et y assigne un coach. |
      | `coachPortal.classes.capacity` | Capacity {{capacity}} | Capacité {{capacity}} |
      | `coachPortal.classes.bookedCount` | {{booked}}/{{capacity}} booked | {{booked}}/{{capacity}} inscrits |
      | `coachPortal.classes.notAttended` | Not attended | Absent |
    - **Reuse, do not duplicate:** `classes.days.*`, `classes.recurringSummary`, `classes.noUpcomingSession`, `classes.attendance.{attended,noBookings,loadingBookings}` (`en.json:362-372, 405-410`) and `common.loadError`, which lives in `packages/types/src/locales`, not the app file.
    - `node scripts/check-i18n-key-parity.mjs` passes.
    - The EN empty-state copy is the epic's verbatim AD-21 text. See Dev Notes for the flagged "manager"-only wording.

14. **pgTAP: `supabase/tests/coach_portal_my_classes.test.sql`**, in `member_app_classes_surfaces.test.sql`'s style: `begin;` / `select plan(N);` / `finish()` / `rollback;`, fixtures inserted as postgres before any `set local role`, a story-scoped UUID block `00000000-0000-0000-0174-…`, and `set local timezone = 'UTC';`. It must prove:
    - **Shape and privileges, both functions:** `has_function`, `is_definer`, `volatility_is(..., 'stable')`, and the `search_path` config (`proconfig` contains `search_path=public, pg_temp`). Also `anon` has no EXECUTE and `authenticated` has EXECUTE (`has_function_privilege`).
    - **Why DEFINER is needed:** as the coach, a plain `select count(*) from class_bookings` returns **0** while the same fixtures return rows for the receptionist, and a plain `members` select for a booked, unassigned member returns 0.
    - **`list_my_classes()` for coach A1**, matching Dev Notes → *Measured*:
      - 3 rows: `Archived Workshop` with a null session and 0, then `HIIT Circuit` at local 00:00 today with 1, then `HIIT Circuit` +2 days with 3;
      - `booked_count = 3` includes a booking by a **deactivated** member and bookings by members the coach is **not assigned** to;
      - `gym_timezone = 'Africa/Douala'`;
      - the session at exactly `day_start` is included and the one at `day_start − 1 minute` is excluded, with `day_start` taken from `private.gym_local_day_bounds(tz, now())` (0097);
      - another coach's class is absent.
    - **Gym-local, not UTC, day start:** a `Pacific/Kiritimati` (UTC+14) gym's coach sees the session at its local 00:00 and not the one a minute before, under a UTC session timezone. Also assert `pg_get_functiondef('public.list_my_classes()'::regprocedure)` contains `date_trunc('day', now() at time zone g.timezone) at time zone g.timezone` and does **not** contain `interval`.
    - **Roster for coach A1:**
      - own today session → Alice, attended;
      - own session yesterday → 1 row (not time-bounded);
      - own future session → 3 rows ordered by name, including the deactivated member;
      - exactly 3 output columns (`member_id`, `member_name`, `attended_at`).
    - **Empty for:**
      - another coach's session;
      - another gym's session;
      - a random uuid;
      - a deactivated coach (both functions);
      - a receptionist (both);
      - a manager (both);
      - a member booked on the session (both);
      - a member whose JWT claims `app_role = coach` (both);
      - coach A1 with no `gym_id` claim;
      - coach A1 carrying Gym B's `gym_id`;
      - a coach demoted to `manager` whose JWT still says coach. Do this last, as postgres, inside the test, with `update members set role = 'manager'`.
    - **Suspended gym:** `throws_like(..., '%is not active%')` for both functions as that gym's coach. Seed the gym with `status = 'suspended'` **in its INSERT**, never by UPDATE (`0014`'s trigger silently reverts it).
    - **Policies unchanged:** `policies_are('public', <table>, ARRAY[...])` for `classes`, `class_sessions`, `class_bookings` and `members`, using the exact lists in Dev Notes → *Measured*.
    - **Session times** are seeded relative to `private.gym_local_day_bounds(tz, now())`; `now()` is fixed for the transaction, so fixtures cannot straddle midnight.
    - **Every fixture member** gets an explicit `name`; the tier's `member_cap` must be large enough for the fixtures (`enforce_member_cap`).
    - **Run** over host psql with `set search_path = public, extensions;` prepended, since `supabase test db` is not runnable here. Then run the **full** suite, including `suspension_rpc_coverage.test.sql`, unmodified.

15. **Vitest.** `globals` is **not** enabled, so import `describe`/`it`/`expect`/`vi` from `vitest`.
    - **`services/classes.listMyClasses.test.ts`**, mocking `@/lib/supabase/server` as `payments.getRevenueMtd.test.ts:12-33` does. Assert:
      - `rpc` is called once with exactly `["list_my_classes"]`;
      - grouping of 2 classes × sessions preserves order;
      - a null-session row gives `sessions: []`;
      - a string or number `booked_count` becomes a number;
      - `null` and `[]` → `{ data: [], error: null }`;
      - an error → the mapped error with `data: null`, and no throw.
    - **`services/classes.listMyClassSessionRoster.test.ts`:** exact args `{ p_class_session_id }`, camelCase mapping including `attendedAt: null`, `null` → `[]`, and the mapped error.
    - **`coach/classes/page.test.tsx`**, rewritten from 17.3's. Await the async child through the boundary, as `coach/overview/page.test.tsx:37-41` does, with services mocked. Assert:
      - the boundary's fallback is `CoachClassesLoading`;
      - error → text is exactly `["common.loadError"]`;
      - zero classes → exactly `["coachPortal.classes.emptyNoClasses"]` and no `CoachClassesPageClient` element;
      - with rows → one `CoachClassesPageClient` whose `classes` prop has the preformatted labels. `"2026-09-11T17:00:00Z"` in `Africa/Douala` must produce a label containing `18:00`. The same instant for a `UTC` gym must contain `17:00`, which proves the gym zone is used rather than the runtime's;
      - a recurring class's `scheduleLabel` uses `classes.recurringSummary` with the translated days and `HH:mm`;
      - `listMyClasses` is called once;
      - no text `pendingNote` anywhere.
    - **`coach/classes/components/CoachClassesPageClient.test.tsx`**, with `@testing-library/react` + `@testing-library/user-event` (both in `apps/dashboard/package.json`), `react-i18next` mocked to return keys, and `../actions` mocked. Assert:
      - classes start collapsed (`aria-expanded="false"`);
      - expanding a class reveals its session buttons;
      - expanding a session calls `getMySessionRosterAction` once with that id and renders names and the attended badge versus the sr-only `notAttended`;
      - collapsing and re-expanding **calls it again**;
      - expanding session B while A's call is pending renders **only** B's roster (resolve A after B);
      - an action error → `common.loadError` inside that panel;
      - `noBookings` for `[]`;
      - `classes.noUpcomingSession` for a class with no sessions;
      - **the only `button` elements in the DOM carry `aria-expanded`**, and there are no `a`, `form` or `input` elements;
      - each section has `id="class-<classId>"`.

16. **Regressions held.**
    - `coach/layout.tsx`, `CoachPortalNav.tsx` and its test, `coach/overview/**`, `coach/page.tsx`, `coach/[memberId]/**` and `Sidebar.tsx` are unmodified.
    - The admin `classes/**` page, `services/classes.ts`'s existing exports (`listClasses`, `listSessionBookings`, `markAttendance`, `insertClass`, `updateClass`, `countClassSessionsBetween`), 0057/0058/0068/0078/0090/0095/0097 and `suspension_rpc_coverage.test.sql` are unmodified.
    - `pnpm --filter @gymos/dashboard build` exits 0, with `/coach/classes` still Partial Prerender.

17. **Record-keeping, in the same change.**
    - **`docs/decisions.md`:** a new entry at the **top** (newest-first), dated the day it is written, "recorded during Story 17.4". It covers:
      - the two product-owner decisions (second function; window from gym-local start of today);
      - why a read-only DEFINER function carries the suspension guard, a deliberate departure from `list_bookable_class_sessions()` (0078) and `get_workout_plan_viewer_context()`, which carry none;
      - the live-role caller check.

      Cite existing entries by dated heading, never by line number.
    - **`deferred-work.md`:** a "Deferred from: dev-story of story-17-4-coach-portal-my-classes-session-roster" section carrying the items in Dev Notes → *Found, not fixed*.
    - `epics.md` and `EXPERIENCE.md` are **already amended**; do not amend them again.

## Tasks / Subtasks

- [ ] **Task 0: branch hygiene (before any code)**
  - [ ] Story 17.2 is `done` but **uncommitted** on `feat/17-2-gym-health-cards`. This story's file and its `epics.md`/`EXPERIENCE.md`/`sprint-status.yaml` amendments were written into that same working tree. Confirm 17.2 (with these docs) is committed, PR'd and merged to `master`. Then branch `feat/17-4-coach-my-classes` from that `master` and record the commit as `baseline_commit` in this file's frontmatter. Do not stack 17.4 on an uncommitted tree.

- [ ] **Task 1: migration 0096 (AC: #1, #2, #3, #4, #5)**
  - [ ] Create `supabase/migrations/0096_coach_portal_my_classes.sql` with AC #1's exact SQL, the header comment and the verify block, and no comments inside function bodies
  - [ ] Apply locally: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0096_coach_portal_my_classes.sql`. Insert no ledger row, as for 0092–0097 locally (local ledger head is 0091), and say so in the Debug Log. Applying 0096 after 0097 locally is fine, because 0096 does not depend on 0097
  - [ ] `pg_proc`: both `prosecdef = t`, `provolatile = s`, `proacl = {postgres=X/postgres,authenticated=X/postgres}`, `proconfig = {"search_path=public, pg_temp"}`; `has_function_privilege('anon', …) = f`

- [ ] **Task 2: types (AC: #6)**: hand-add both entries; record that they were hand-added

- [ ] **Task 3: services + action (AC: #7, #8)**
  - [ ] `listMyClasses()`, `listMyClassSessionRoster()` and the three exported types in `services/classes.ts`
  - [ ] `app/(dashboard)/coach/classes/actions.ts` with `getMySessionRosterAction`

- [ ] **Task 4: page + client component + loading (AC: #9, #10, #11, #12)**
  - [ ] Rewrite `coach/classes/page.tsx`: new header comment, server formatting helpers, empty and error states
  - [ ] Create `coach/classes/components/CoachClassesPageClient.tsx`
  - [ ] Replace `coach/classes/loading.tsx` with the 3-row skeleton

- [ ] **Task 5: i18n (AC: #13)**: delete `pendingNote`, add the four keys in EN and FR, run the parity script, `git grep pendingNote apps/dashboard` → nothing

- [ ] **Task 6: tests (AC: #14, #15)**
  - [ ] `supabase/tests/coach_portal_my_classes.test.sql`, then the full pgTAP suite over host psql
  - [ ] The four Vitest files, red before green where practical

- [ ] **Task 7: record-keeping (AC: #17)**: `docs/decisions.md` top entry; `deferred-work.md` section

- [ ] **Task 8: verify (AC: #16)**
  - [ ] `pnpm --filter @gymos/dashboard typecheck`, `lint` (0 errors, no new warnings in touched files), `test`, `build`
  - [ ] `node scripts/check-i18n-key-parity.mjs`
  - [ ] Seed local QA data for smartsana's browser pass. **No local coach has any class today** (checked 2026-09-10). As postgres over host psql, in the "Overview QA Gym" (`coach@overviewqa.test` = Cyril QA Coach, `coach2@overviewqa.test` = Celine New Coach):
    - for Cyril, one recurring class (e.g. Mon/Wed/Fri 18:00 from today) plus one one-off class in the past;
    - materialize with `select private.materialize_sessions_for_class('<id>')`;
    - on today's and a future session, a few `class_bookings` rows for existing QA members, one with `attended_at = now()`;
    - for Celine, one class of her own.
    - Record the ids in the Debug Log.
  - [ ] List in Completion Notes for smartsana's manual browser pass (they do browser QA themselves):
    - as Cyril: `/coach/classes` shows only his classes, with times in gym-local 24h; the counts match the seeded bookings; expanding a session shows names plus Attended / "—"; no write control anywhere; the past one-off class shows "No upcoming session";
    - as Celine: only her class;
    - as the owner: `/coach/classes` by URL shows the empty state, and `/classes` is unchanged;
    - EN/FR;
    - the skeleton shows while navigating from My Members to My Classes.

## Dev Notes

- **Read `apps/dashboard/AGENTS.md` first.** Next.js here is **16.3.4**, with breaking changes against training data. Relevant facts established by 17.1–17.3:
  - `cacheComponents: true` (`next.config.ts:9`) requires every cookie-backed read inside an explicit `<Suspense>`;
  - `(dashboard)/layout.tsx:17`'s ancestor `fallback={null}` means `next build` does **not** catch a missing page boundary; it blanks the dashboard chrome instead. Keep AC #9's boundary;
  - `middleware.ts` is `proxy.ts`.

- **Why a second function (decided).** Measured under a coach session on the local DB:
  - `select count(*) from class_bookings` returns **0**, where a receptionist sees 7;
  - `members` rows for booked, unassigned members return **0**;
  - `classes` and `class_sessions` are fully readable, since their policies have no role check (`0057:101,172`).

  The epic's "booked count" was therefore unreachable with plain reads, and its "exactly one new function" AC could not coexist with it. The alternative, a booked count taken as the roster's length after expanding each session, was rejected for three reasons: AD-21's collapsed "8/15 booked" lines could not render, it costs one RPC per session, and 17.5 would need the same N calls. `list_my_classes()` returns **aggregates only**, no member identity, so the single privilege FR-145 protects, the roster, still goes through exactly one function. Still zero RLS policies changed.

- **Why "from start of today" (decided).** `mark_class_attendance()` sets `attended_at = now()` when the desk marks a booked member present (`0068:121`), which happens at or after the session starts. A strictly upcoming list would drop a session the moment it began, so AD-21's "✓ attended" would essentially never render. The admin page solves the same problem with a 3-hour grace (`services/classes.ts:7-12`); the product owner chose gym-local today instead.

- **Why the day start is inlined, not 0097's helper.** Migrations apply in filename order, and `supabase db reset` in CI does too. So 0096 runs **before** 0097 creates `private.gym_local_day_bounds()`. A `language sql` body referencing it would fail at creation, and a plpgsql body would be a hidden forward dependency. The inlined expression is character-for-character that helper's `day_start` (`0097`, AC #9 of 17.2). The DST trap 0095/0097 warn about is `+ interval` placed after the `at time zone` round trip, and there is **no** interval here. AC #14's `pg_get_functiondef` assertion pins that.

- **Why a suspension guard in a read-only function.** AD-3 binds "every `SECURITY DEFINER` function that gates on role or gym status", and these gate on role. `tenant_active_gate` does nothing inside DEFINER functions (`0090:9-19`). The two existing read-only DEFINER functions, `list_bookable_class_sessions()` and `list_my_class_bookings()` (0078) and `get_workout_plan_viewer_context()`, carry no guard: the first two predate 0090, and the third was deliberately left alone by 11.9 and its review deferred. This is new code, so it follows AD-3.
  - **Placement:** the guard sits **below** caller resolution, so a non-coach at a suspended gym learns nothing about the gym's status (`0090:76-80`).
  - **Why it is unreachable in practice:** `(dashboard)/layout.tsx:58-104` renders the suspended screen before any child route. The guard protects direct PostgREST callers, and the service maps the raise to `gym_suspended` via `mapSupabaseError`.

- **Why an empty set, not `raise 'permission denied'`, for non-coaches.** The epic specifies empty for another coach, another gym and a deactivated coach. Using one uniform outcome for every non-authorized caller leaks nothing, not even whether a session id exists. The page then needs no error branch for a manager who opens `/coach/classes` by URL.

- **Why the live role, not the JWT.**
  - A demoted coach keeps `app_role = coach` for up to an hour (`jwt_expiry`). Measured: with the live `members.role` check, a coach demoted to manager whose JWT still says coach gets **0** roster rows.
  - A user who is a plain member cannot become a coach by any claim.
  - `classes_validate_coach` (`0057:140-165`) only fires when `classes.coach_id` changes, so a demoted coach's classes still point at their member row. Only the live check closes that.

- **Why a live DB check here while 17.3 did not.** 17.3 deliberately kept `shell.role` (a JWT claim) for the landing redirect, because a wrong landing page is cosmetic. Here the check guards a privilege: the roster.

- **Measured (local Supabase, rolled-back transaction, 2026-09-10, AC #1's SQL verbatim).**
  - **Functions:** both `prosecdef=t provolatile=s proacl={postgres=X/postgres,authenticated=X/postgres} proconfig={"search_path=public, pg_temp"}`, and `anon` has no EXECUTE. The verify block passes.
  - **Fixtures:**
    - **Gym A (Africa/Douala; day_start `2026-09-09 23:00+00` at now = 2026-09-10):**
      - coach A1 teaches `HIIT Circuit` (recurring {1,3,5} 18:00, capacity 15) and `Archived Workshop` (one-off, 10 days ago, one past session);
      - coach A2 teaches `Other Coach Class`;
      - a deactivated coach A3 teaches a class;
      - a receptionist;
      - members Alice, Bob, Carol (deactivated) and Dan.
    - **HIIT sessions:**
      - at `day_start`: Alice attended;
      - at `day_start − 1 min`: Dan;
      - at now + 2 days: Bob, Alice, Carol.
    - **Other gyms:**
      - Gym B (active): a coach and a session;
      - Gym C (suspended at insert): a coach and a session;
      - Gym D (`Pacific/Kiritimati`): a coach, with sessions at its local `day_start` and one minute before.
  - **Results:**

    | Caller | `list_my_classes()` | roster |
    |---|---|---|
    | coach A1 | 3 rows: Archived Workshop / null session / 0; HIIT / `2026-09-09 23:00+00` / 1; HIIT / +2d / 3; tz Africa/Douala | today → Alice ✓; yesterday → 1; +2d → 3 (Alice, Bob, Carol); A2's session → 0; Gym B session → 0; random uuid → 0 |
    | coach A2 | 1 row (Other Coach Class) | own → 1; A1's → 0 |
    | deactivated coach A3 | 0 | 0 |
    | receptionist / manager | 0 | 0 (receptionist's plain `class_bookings` read: 7) |
    | member Alice (booked) | 0 | 0 |
    | member with forged `app_role=coach` | 0 | 0 |
    | coach A1, no `gym_id` claim / Gym B claim | 0 | 0 |
    | coach A2 demoted to manager, stale coach JWT | — | 0 |
    | coach D (UTC+14) | 1 row at `2026-09-10 10:00+00` (its local 00:00); the minute-before session excluded | — |
    | coach C (suspended gym) | raises `list_my_classes: gym … is not active` | raises `list_my_class_session_roster: gym … is not active` |
    | anon | — | `permission denied for function` |

  - **Meta-test checks against the drafts:** no guarded function lacks the `is not active` phrase; the dynamic-SQL set is still only `private.process_notification_deliveries`; zero write markers in either body.
  - **Live policies** (pin these in `policies_are`):
    - `class_bookings`: gym_staff_read_own_class_bookings, member_read_own_class_bookings, tenant_active_gate
    - `class_sessions`: gym_staff_read_own_class_sessions, tenant_active_gate
    - `classes`: gym_staff_read_own_classes, manager_or_owner_insert_own_classes, manager_or_owner_update_own_classes, tenant_active_gate
    - `members`: coach_read_assigned_members, gym_staff_read_own_members, manager_or_owner_insert_own_members, manager_or_owner_update_own_members, member_read_gym_staff_members, self_read_own_membership, self_update_own_member_onboarding_fields, super_admin_escalated_read_members, super_admin_insert_owner_member, super_admin_read_owner_members, tenant_active_gate

  **If your pgTAP results differ from these, the difference is the bug.**

- **Data model facts you need.**
  - `classes` (`0057:18-36`): `coach_id NOT NULL`, trigger-validated to a coach of the same gym; no delete or archive path, so finished one-off classes remain forever, exactly as on the admin page. `schedule_type in ('one_off','recurring')`; `recurrence_days` uses 0=Sun..6=Sat; `recurrence_time` is gym-local wall time.
  - `class_sessions` (`0057:72-78`): materialized rows, a rolling 4 weeks ahead for recurring classes (daily cron at 02:00 UTC); a reschedule deletes future sessions only if none has bookings (`0058:305-347`).
  - `class_bookings` (`0058:32-38`, `0068:19`): no status column, cancellation deletes the row, `attended_at` is null until marked, and there is no unmark. There are **no waitlists** (PRD V2.0).
  - `members.name` is `text not null` (`0003:21`); `idx_members_active_gym_user` (`0003:39`) guarantees at most one active row per (gym, user), which is why the non-`strict` `select … into v_coach_id` is safe.

- **Row cap, accepted.** `max_rows = 1000` (`supabase/config.toml:18`) also caps set-returning RPC responses, silently. `list_my_classes()` returns one row per (class, session in window). Recurring classes are bounded by the materializer's 4-week window (about 12 sessions each at 3×/week), so a Coach would need roughly 80 classes to hit it. Record it in `deferred-work.md`; do not paginate.

- **Found, not fixed** (for `deferred-work.md`, per AC #17):
  1. AD-21's empty-state copy says "Your manager schedules classes", but class creation is Manager/Supervisor/Owner (`0093:64,67`). AD-14's equivalent copy was amended to name all three (Story 9.4). The epic's verbatim text ships; the wording is a product copy decision.
  2. `list_bookable_class_sessions()` and `list_my_class_bookings()` (0078) are `SECURITY DEFINER` reads with no suspension guard, so a member of a suspended gym can still list sessions and booked counts over PostgREST. This is the same class as the already-deferred `get_workout_plan_viewer_context()` item.
  3. The `max_rows` ceiling on `list_my_classes()` above.
  4. Finished one-off classes accumulate in My Classes with "No upcoming session", because classes have no archive (shared with the admin page).

- **Deploy.** Production is at `0094`; `0095` is merged but not deployed; `0097` is in 17.2. **One batch, in order 0095 → 0096 → 0097**, over host `psql` in the shape of `scripts/deploy-0090-0094.sh`: each migration in its own `ON_ERROR_STOP` transaction, with its ledger row inserted in that same transaction. Never `supabase db push`. `sprint-change-proposal-2026-09-09.md` §5 asks the architect to review 0096 before production. Writing the deploy script is **not** this story's job; do not deploy.

- **Testing stack.** Vitest 4.1.10, `@testing-library/react` 16.3.2 and `@testing-library/user-event` 14.6.4 (jsdom, co-located `*.test.ts(x)`, `globals` off; `vitest.setup.ts` registers `cleanup`). pgTAP lives in `supabase/tests/` and runs over host psql. Async Server Components are tested by awaiting the component function (`coach/overview/page.test.tsx:37-41`).

- **Out of scope:**
  - any write path for a Coach;
  - the admin `/classes` page and its services;
  - hash-driven auto-expansion (17.5);
  - My Next Sessions itself (17.5);
  - realtime or polling on this page;
  - the "Espace Coach" / "Portail Coach" copy question (already deferred);
  - every RLS policy;
  - a production deploy.

### Project Structure Notes

- **New:**
  - `supabase/migrations/0096_coach_portal_my_classes.sql`
  - `supabase/tests/coach_portal_my_classes.test.sql`
  - `apps/dashboard/app/(dashboard)/coach/classes/actions.ts`
  - `apps/dashboard/app/(dashboard)/coach/classes/components/CoachClassesPageClient.tsx` + `.test.tsx`
  - `apps/dashboard/services/classes.listMyClasses.test.ts`
  - `apps/dashboard/services/classes.listMyClassSessionRoster.test.ts`
- **Modified:**
  - `apps/dashboard/app/(dashboard)/coach/classes/page.tsx` (rewritten)
  - `coach/classes/loading.tsx` (replaced)
  - `coach/classes/page.test.tsx` (rewritten)
  - `apps/dashboard/services/classes.ts` (additions only)
  - `apps/dashboard/locales/en.json`, `fr.json`
  - `packages/types/src/database.ts`
  - `docs/decisions.md`
  - `_bmad-output/implementation-artifacts/deferred-work.md`
  - `sprint-status.yaml`
  - this story file
- **Explicitly unmodified:**
  - `coach/layout.tsx`, `coach/components/CoachPortalNav.tsx`, `coach/overview/**`, `coach/page.tsx`, `coach/[memberId]/**`
  - `components/shared/Sidebar.tsx`
  - `app/(dashboard)/classes/**`, and the existing exports of `services/classes.ts`
  - every migration before 0096, and `suspension_rpc_coverage.test.sql`
  - every RLS policy
- The per-route `components/` folder convention holds: `coach/components/` for Portal-wide components, and `coach/classes/components/` for this route's own component, mirroring `classes/components/`. The Server Action sits beside the route (`coach/[memberId]/actions.ts` and `classes/actions.ts` are the precedents).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 17.4: Coach Portal — My Classes & Session Roster — including the 2026-09-10 amendment note]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 17 — story table, dependency order (17.4 release-blocking), scope boundary (zero RLS policies); #Story 17.5 — My Next Sessions reuses list_my_classes()]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-09-09.md — Finding 2 (roster names), Finding 3 (class metadata gym-readable), §5 (architect review of 0096)]
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md:557 FR-145; :555 FR-144; :429 FR-053 (amended); :605 FR-089; :725 FR-107]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md:1792-1824 AD-21 (as amended 2026-09-10); :1780 AD-20 My Next Sessions; :227-235 role matrix + sub-nav; :33 absent-not-disabled]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md — AD-3 (live role helpers, no new app_role call sites), AD-7, AD-8, AD-9; Consistency Conventions (dates UTC on the wire, locale formatting at render)]
- [Source: docs/decisions.md#2026-09-09 — Suspension enforcement inside SECURITY DEFINER RPCs (Story 11.8); #2026-09-09 — Workout-plan tables gated (Story 11.9); #2026-08-31 — Member App Classes Surfaces (Story 12.4); #2026-08-27 — Class Attendance Marking; #2026-08-19 — Class booking with capacity enforcement; #2026-09-10 — Story 17.2 (release batch order)]
- [Source: _bmad-output/implementation-artifacts/17-3-coach-portal-sub-navigation-landing.md — AC #11 (route shell owned by 17.4), sequencing note, AC #14 (no role guard)]
- [Source: _bmad-output/implementation-artifacts/17-2-staff-overview-gym-health-cards.md — AC #9 (0097 day helper), AC #15 (hand-added types), Dev Notes → Deploy]
- [Source: _bmad-output/implementation-artifacts/17-1-staff-overview-operational-cards-live-tables.md — Debug Log (host psql apply, no ledger row, gen types 0 bytes, pgTAP method)]
- [Source: _bmad-output/implementation-artifacts/12-2-…, 12-3-…, 12-4-member-app-classes-surfaces.md, 11-8-suspension-enforcement-in-security-definer-rpcs.md]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — 17.1 review (timestamp formatting without timeZone), 5.3 review (noteTimestamp), 11.9 review (get_workout_plan_viewer_context unguarded), 12.3 party-mode note (origin of this story)]
- [Source: supabase/migrations/0003_members_and_users.sql:17-39; 0040_coach_portal_member_list_rls.sql:33-95; 0057_class_creation_scheduling.sql:18-36, 72-92, 101-103, 140-174, 224-248; 0058_class_booking_with_capacity_enforcement.sql:22-94, 193; 0061_staff_creation_role_ceiling_enforcement.sql:31-54; 0063_staff_edit_deactivation.sql:19-38; 0068_class_attendance_marking.sql:19, 35-42, 70, 121; 0078_member_app_classes_surfaces.sql:29-78; 0090_suspension_enforcement_in_rpcs.sql:1-90; 0093_supervisor_manager_plus_access.sql:64-67; 0095_gym_revenue_mtd.sql:1-82, 136-171; 0097_gym_local_period_bounds.sql]
- [Source: supabase/tests/suspension_rpc_coverage.test.sql:63-84, 183-198, 261-273, 289-342; supabase/tests/member_app_classes_surfaces.test.sql:1-90 (fixture + role-switch style)]
- [Source: supabase/config.toml:13 (exposed schemas), :18 (max_rows)]
- [Source: packages/types/src/database.ts:2088-2097; packages/types/src/errors.ts:14-28, 214-235]
- [Source: apps/dashboard/app/(dashboard)/coach/classes/page.tsx, loading.tsx, page.test.tsx (17.3 shells); coach/layout.tsx:37-49; coach/overview/page.tsx:1-97; coach/overview/page.test.tsx:19-55; coach/page.tsx:9-25]
- [Source: apps/dashboard/app/(dashboard)/classes/components/ClassesPageClient.tsx:16, 37-40, 58-101, 131-153, 228-292; classes/actions.ts:128-140]
- [Source: apps/dashboard/services/classes.ts:7-43, 155-294, 314-338; services/gym-settings.ts:67-104, 126-150; services/session.ts:24-31, 46-75]
- [Source: apps/dashboard/services/payments.getRevenueMtd.test.ts:12-67; services/gym-settings.getGymLocalPeriodBounds.test.ts]
- [Source: apps/dashboard/app/(dashboard)/layout.tsx:17, 41-104 (suspended screen before children)]
- [Source: apps/dashboard/locales/en.json:351-412 (classes.*), :617-648 (coachPortal.*); fr.json same lines; scripts/check-i18n-key-parity.mjs]
- [Source: apps/dashboard/eslint.config.mjs:22-38; apps/dashboard/AGENTS.md; apps/dashboard/next.config.ts:6-9]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created. Story created 2026-09-10. Two scope decisions were taken with smartsana during creation and written into `epics.md` and `EXPERIENCE.md`: a second SECURITY DEFINER function, and a window from gym-local start of today. Both functions' SQL and every authorization case were proven on the local DB in a rolled-back transaction.

### File List
