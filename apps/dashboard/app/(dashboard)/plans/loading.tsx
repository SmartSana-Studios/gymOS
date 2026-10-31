export default function PlansLoading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-40 animate-pulse rounded-md bg-primary/10" />
      <div className="divide-y rounded-md border bg-card">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse bg-primary/5" />
        ))}
      </div>
    </div>
  );
}
