import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Story 17.1 (AC #15): the AD-02 Overview stat tile, shared so Story 17.2's
 * gym-health row reuses it unchanged. Presentational and server-renderable
 * (no "use client" -- `next/link` works in Server Components). `value` is a
 * PRE-FORMATTED string: this component does no number or currency formatting,
 * so it stays locale-agnostic and every caller owns its explicit-locale
 * `toLocaleString(locale)`.
 *
 * Deliberately not built on `card.tsx`'s `<Card>` (rounded-xl + shadow + a
 * p-6 header/content split, used for auth forms and detail panels): AD-02's
 * tiles are the flatter `rounded-md border p-4` idiom from
 * apps/super-admin's metrics page, which is the repo's only stat-tile
 * precedent. The whole tile is the click target.
 *
 * `tone="alert"` is opt-in only -- Story 17.2's "At risk" card, when non-zero.
 */
export interface StatCardProps {
  label: string;
  value: string;
  href: string;
  tone?: "default" | "alert";
}

export function StatCard({ label, value, href, tone = "default" }: StatCardProps) {
  return (
    <Link
      href={href}
      className="block rounded-md border p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-semibold", tone === "alert" && "text-destructive")}>{value}</p>
    </Link>
  );
}
