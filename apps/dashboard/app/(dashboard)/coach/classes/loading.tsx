// Story 17.4: AD-21's loading state -- 3 skeleton class rows, text-free.
// Also the page's own <Suspense> fallback, so navigating here and streaming
// the page show the same shape. Without a loading.tsx of its own this route
// would inherit coach/loading.tsx's member-list rows (Story 17.3 review).
export default function CoachClassesLoading() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 w-full animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}
