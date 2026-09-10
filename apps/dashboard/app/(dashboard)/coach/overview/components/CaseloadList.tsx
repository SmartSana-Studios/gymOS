import Link from "next/link";

export interface CaseloadListRow {
  key: string;
  href: string;
  primary: string;
  secondary: string;
  meta?: string;
}

/**
 * Story 17.5 (AC #10): the body of AD-20's three list widgets -- My Next
 * Sessions, Needs Follow-Up and Recent Progress Activity. Every row is a link;
 * `meta` (a session's booked count) sits right-aligned. Its own error and
 * empty states keep a failed or empty read inside its widget. Translated
 * strings only.
 */
export function CaseloadList({
  state,
  errorLabel,
  emptyLabel,
  rows,
  moreLabel,
}: {
  state: "error" | "ready";
  errorLabel: string;
  emptyLabel: string;
  rows: CaseloadListRow[];
  moreLabel: string | null;
}) {
  if (state === "error") {
    return <p className="text-sm text-red-600">{errorLabel}</p>;
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.key}>
            <Link
              href={row.href}
              className="flex items-center gap-3 rounded-md py-2 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{row.primary}</span>
                <span className="block truncate text-muted-foreground">{row.secondary}</span>
              </span>
              {row.meta && <span className="shrink-0 text-muted-foreground">{row.meta}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {moreLabel && <p className="text-xs text-muted-foreground">{moreLabel}</p>}
    </div>
  );
}
