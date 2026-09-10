// AD-20's loading state (Story 17.5): 4 skeleton widget cards, text-free. Also
// the page's own <Suspense> fallback, so navigating here and streaming the
// page show the same shape. Without this file, coach/loading.tsx -- AD-14's
// member-list rows -- would be the fallback while navigating here.
export default function CoachOverviewLoading() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-40 w-full animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}
