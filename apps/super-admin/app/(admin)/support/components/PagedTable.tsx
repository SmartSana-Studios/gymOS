"use client";

import { TablePagination } from "@/components/TablePagination";
import { useClientPagination } from "@/hooks/use-table-pagination";

/** Story 23.12: the platform's standard table (compact pager above, full pager below, 10 rows by default) over an in-memory list. */
export function PagedTable<T>({
  items,
  empty,
  head,
  row,
  label,
}: {
  items: readonly T[];
  empty: string;
  head: string[];
  row: (item: T) => React.ReactNode;
  label?: string;
}) {
  const pagination = useClientPagination(items);
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const { pageItems, ...pager } = pagination;
  return (
    <div className="space-y-1">
      <TablePagination compact {...pager} />
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm" aria-label={label}>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {head.map((h, i) => (
                <th key={i} className="whitespace-nowrap py-2 pl-3 pr-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{pageItems.map(row)}</tbody>
        </table>
      </div>
      <TablePagination {...pager} />
    </div>
  );
}
