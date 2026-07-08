// SA-02 loading skeleton: 5 rows, matching EXPERIENCE.md's Loading States
// table. Next.js shows this automatically while page.tsx's data fetch is in
// flight, honoring the 300ms/1000ms timing rule via React Suspense.
export default function GymsLoading() {
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
