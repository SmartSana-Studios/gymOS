"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Server-paginated tables: page and size live in the URL (`?page=&size=`), the
 * server page re-reads them. Changing the size resets to page 1. Pass different
 * param names when one page has two tables (e.g. "logPage" / "logSize").
 */
export function useUrlPagination(opts: { pageParam?: string; sizeParam?: string } = {}) {
  const { pageParam = "page", sizeParam = "size" } = opts;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function push(next: { page?: number; size?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.size !== undefined) params.set(sizeParam, String(next.size));
    params.set(pageParam, String(next.page ?? 1));
    router.push(`${pathname}?${params.toString()}`);
  }

  return {
    onPageChange: (page: number) => push({ page }),
    onPageSizeChange: (size: number) => push({ size, page: 1 }),
  };
}

/**
 * Client-only tables: slices an in-memory list. Page snaps back when the list shrinks;
 * pass `resetKey` (e.g. the active filters) to return to page 1 whenever it changes.
 */
export function useClientPagination<T>(items: readonly T[], defaultSize = 5, resetKey?: string) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultSize);

  // Reset during render (React's "adjust state on prop change" pattern) rather than in an effect.
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  );

  return {
    pageItems,
    page: safePage,
    pageSize,
    total: items.length,
    onPageChange: setPage,
    onPageSizeChange: (size: number) => {
      setPageSize(size);
      setPage(1);
    },
  };
}
