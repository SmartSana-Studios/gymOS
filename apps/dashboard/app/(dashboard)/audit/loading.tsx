// Mirrors subscriptions/loading.tsx's Suspense fallback pattern -- 8
// skeleton rows (no sibling loading.tsx matches the real 50/page size
// either -- the skeleton row count is purely cosmetic).
export default function AuditLoading() {
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
