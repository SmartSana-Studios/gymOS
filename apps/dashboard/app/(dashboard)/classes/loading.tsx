export default function ClassesLoading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
      <div className="divide-y rounded-md border bg-card">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse bg-muted/50" />
        ))}
      </div>
    </div>
  );
}
