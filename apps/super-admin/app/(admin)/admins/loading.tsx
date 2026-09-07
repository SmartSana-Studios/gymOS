// Story 1.16 loading skeleton, mirroring gyms/loading.tsx's shape (SA-02
// precedent) -- 5 rows honoring EXPERIENCE.md's Loading States timing rule
// via React Suspense.
export default function AdminsLoading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
