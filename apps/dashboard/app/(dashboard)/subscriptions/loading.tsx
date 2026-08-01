// Mirrors members/loading.tsx's/plans/loading.tsx's Suspense fallback
// pattern -- 8 skeleton rows (AD-08's own 25-rows-per-page spec, same
// generic row-count precedent members/loading.tsx already uses).
export default function SubscriptionsLoading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
