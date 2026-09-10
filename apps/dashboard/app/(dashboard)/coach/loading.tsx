// AD-14's own spec value (EXPERIENCE.md line 1727: 4 skeleton rows) --
// not the generic 8-row precedent other pages (subscriptions/loading.tsx)
// use, since a coach's caseload is a small, pilot-scale subset of a gym.
//
// No heading placeholder (Story 17.3): the real "Coach Portal" heading now
// renders from coach/layout.tsx above this fallback, so a placeholder here
// would read as a second heading.
export default function CoachPortalLoading() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-12 w-full animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}
