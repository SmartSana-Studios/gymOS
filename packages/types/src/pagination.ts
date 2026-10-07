// Shared table pagination helpers for apps/dashboard and apps/super-admin.
// Every table offers the same "rows per page" choices; servers validate the
// `size` query param against this list, so an arbitrary value (?size=100000)
// can never widen a query.

export const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

/** Returns `raw` when it is one of PAGE_SIZE_OPTIONS, else `fallback`. */
export function parsePageSize(raw: string | number | null | undefined, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : fallback;
}

/** `?page=` -> a positive integer, else 1. */
export function parsePage(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Page numbers to render: always first and last, a window around `current`, "ellipsis" gaps. */
export function pageWindow(current: number, total: number, radius = 2): (number | "ellipsis")[] {
  if (total <= 1) return total === 1 ? [1] : [];
  const middle: number[] = [];
  for (let p = Math.max(2, current - radius); p <= Math.min(total - 1, current + radius); p++) middle.push(p);
  const result: (number | "ellipsis")[] = [1];
  if (middle.length > 0 && (middle[0] ?? 0) > 2) result.push("ellipsis");
  else if (middle.length === 0 && total > 2) result.push("ellipsis");
  result.push(...middle);
  if (middle.length > 0 && (middle[middle.length - 1] ?? 0) < total - 1) result.push("ellipsis");
  result.push(total);
  return result;
}
