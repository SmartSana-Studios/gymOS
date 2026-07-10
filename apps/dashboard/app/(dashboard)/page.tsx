/**
 * AD-02 Overview -- minimal shell only (story Dev Notes -> Scope Boundary /
 * Open Question 2, resolved: no stat cards, tables, or Front-Desk Alert
 * Panel here). `subscriptions`/`attendance_events`/`payments` all have RLS
 * enabled with zero business policies for a gym-scoped role today, so any
 * such query would silently return 0 rows regardless of real gym activity
 * -- deferred to whichever Epic 3/4 story (or a future correct-course pass)
 * ends up owning that build-out.
 */
export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <p className="text-muted-foreground">
        Your gym&apos;s activity summary will appear here as more of GymOS comes online.
      </p>
    </div>
  );
}
