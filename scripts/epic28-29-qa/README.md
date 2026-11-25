# Epics 28 and 29 — local browser QA kit

Local Supabase only. Builds on the Epic 19 world (`scripts/epic19-qa`): the gym "Epic19 QA Gym", staff `owner@ supervisor@ manager@ receptionist@ coach@ coach2@` + `epic19qa.test`, password `Epic19Pass!`.

```
node scripts/epic28-29-qa/seed.mjs            # wipes and recreates the gym, ~10 s; prints the coach ids and the member table
cd apps/dashboard && npx next start --port 3400   # production build of the current tree (run `next build` first if the tree changed)
```

Ports 3000, 3200 and 3300 are ghost-bound in this devcontainer (EADDRINUSE with no listener): test-bind a port with node before using it.
Re-running the seed deletes the gym, so every open tab goes stale: sign out and in again.

## Epic 28 — Session validity (Owner or Supervisor sets it; Settings → Session validity)

1. **Setting.** Owner → Settings. Section sits under "Charge guests per session", above Loyalty. Whole day is selected; [Save] is disabled until the choice changes. Receptionist and Coach have no section.
2. **Whole day parity (Wanda, before the flip).** Receptionist → desk check-in of Wholeday Wanda: admitted, one session used. Check her in again: nothing more is charged.
3. **Flip to Single use** (Owner): Save, toast shows, an audit row `session_validity_changed` appears. Wanda's earlier session still covers her for the day.
4. **Single use visit (Vic, two sessions).** Check in: admitted, one session used. Scan again during the visit: "already checked in", no cost. Check out, check in again: admitted, second session used (Guest sessions card counts per visit).
5. **Class attendance (Cleo).** Single use, Cleo has no open visit: mark her attended on QA Boxing → consumes her session. Flip back to Whole day: sessions already used keep their coverage.
6. **Blocked (Bea).** Desk check-in → refused (session required); Blocked tab shows a "Desk check-in" row.

## Epic 29 — Classes and the coach picker

Classes (Owner or Manager, Classes page; Coach, Coach Portal → My Classes):
- **Per-day times.** Owner → Classes → QA Spin → Edit: Mon, Wed, Fri share 18:00; give each day its own time, save, check the result view and the "Old time" tag on the next session. QA Yoga already shows three different times.
- **Cancel class.** Owner → QA Spin → Cancel class: the dialog counts 2 bookings. Confirm: Cancelled badge, sessions gone from members' lists.
- **Coach's own classes.** coach@ → My Classes: QA Boxing and QA Spin are theirs (create, edit, cancel). QA Yoga is not there. coach2@ sees QA Yoga only.

Coach picker (Owner, Supervisor or Manager → Coach Portal; Receptionist gets the permission message, Coach gets no picker):
- Nothing chosen: "choose" message, select focused. Choose QA Coach: banner under the select, Classes and Members tabs only (no Overview).
- Classes: read-only, roster per session, link [Open in Classes]. Members: Pia, Pete (not Ned, not Dora), note snippet column.
- Pia's page: header, Session Notes, Workout Plan only. NO weight 83.7712, waist 91.3312, chest 101.7712, starting weight 77.7712, height 183.3312, progress note, photo, Progress tab, completion mark.
- `/coach/overview?coach=…` and `?tab=progress` on a member: "This part isn't available in this view" with links.
- Pick QA Coach Two, then open Pia's URL: "isn't assigned". Open Ned's URL under QA Coach: same.
- Stale link to QA Coach Retired (id printed by the seed): "no longer a coach". A random uuid: "not available".
- French: switch the language and read the Group G copy.
