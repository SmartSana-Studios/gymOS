// No AD-15-specific skeleton shape is defined in EXPERIENCE.md's Loading
// States table (unlike AD-14's explicit "4 rows") -- generic two-block
// skeleton (header block + 3 note-row placeholders), following
// coach/loading.tsx's animate-pulse/bg-muted styling convention.
export default function CoachMemberDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="h-24 w-full animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
