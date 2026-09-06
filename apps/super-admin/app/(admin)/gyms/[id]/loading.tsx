// Story 1.14: two more skeleton blocks for the Member/Payment records
// sections. Row counts follow EXPERIENCE.md:2146-2167's precedent table (8
// for members, 6 for payments). Plain presentational component, no logic --
// matches the rest of this file and gyms/loading.tsx:4-15.
export default function GymDetailLoading() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-56 animate-pulse rounded-md border bg-muted/50" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
