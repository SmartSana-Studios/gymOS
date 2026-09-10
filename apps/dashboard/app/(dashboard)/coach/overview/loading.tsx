// One skeleton widget card for the one widget this page has (Story 17.3);
// AD-20's "4 skeleton widget cards" arrive with the other three widgets in
// Story 17.5. Without this file, coach/loading.tsx -- AD-14's member-list
// rows -- would be the fallback while navigating here.
export default function CoachOverviewLoading() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="h-40 w-full animate-pulse rounded-md bg-muted" />
    </div>
  );
}
