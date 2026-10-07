"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PAGE_SIZE_OPTIONS, pageWindow } from "@gymos/types";

import { Button } from "@/components/ui/button";

interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Top-of-table copy: just the size selector and "a-b of N"; page buttons stay below the table. */
  compact?: boolean;
}

/**
 * One footer for every table: "Rows per page" (5/10/25/50), "a-b of N", and
 * previous / numbered / next. Stateless -- server tables wire it to the URL
 * (`useUrlPagination`), client-only tables to `useClientPagination`. Rendered
 * whenever there is at least one row so the size choice never disappears.
 */
export function TablePagination({ page, pageSize, total, onPageChange, onPageSizeChange, compact = false }: TablePaginationProps) {
  const { t } = useTranslation();
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  // A size outside the list (a table's legacy default) still shows as selected.
  const sizes: number[] = PAGE_SIZE_OPTIONS.includes(pageSize as never)
    ? [...PAGE_SIZE_OPTIONS]
    : [...PAGE_SIZE_OPTIONS, pageSize].sort((a, b) => a - b);

  return (
    <div className="flex flex-col items-center gap-3 py-2 sm:flex-row sm:justify-between" data-testid="table-pagination">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <label className="flex items-center gap-2">
          <span>{t("pagination.rowsPerPage")}</span>
          <select
            aria-label={t("pagination.rowsPerPage")}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span>{t("pagination.showing", { from, to, total })}</span>
      </div>
      {!compact && totalPages > 1 && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label={t("pagination.previous")}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft size={16} />
          </Button>
          {pageWindow(page, totalPages).map((p, i) =>
            p === "ellipsis" ? (
              <span key={`ellipsis-${i}`} className="px-2 text-sm text-muted-foreground">
                {t("pagination.ellipsis")}
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "default" : "outline"}
                size="sm"
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPageChange(p)}
              >
                {p}
              </Button>
            ),
          )}
          <Button
            variant="outline"
            size="sm"
            aria-label={t("pagination.next")}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}
