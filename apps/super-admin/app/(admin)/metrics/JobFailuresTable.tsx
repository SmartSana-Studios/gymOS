"use client";

import { useTranslation } from "react-i18next";

import { TablePagination } from "@/components/TablePagination";
import { useClientPagination } from "@/hooks/use-table-pagination";
import type { JobFailure } from "@/services/metrics";

// Client island so metrics/page.tsx can stay a Server Component: the
// failures arrive fully loaded and are sliced in memory.
export function JobFailuresTable({ failures, locale }: { failures: JobFailure[]; locale: string }) {
  const { t } = useTranslation();
  const pagination = useClientPagination(failures, 5);

  return (
    <>
      <TablePagination compact
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        onPageChange={pagination.onPageChange}
        onPageSizeChange={pagination.onPageSizeChange}
      />
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-2 font-medium">{t("metrics.jobFailuresJobName")}</th>
              <th className="p-2 font-medium">{t("metrics.jobFailuresStartedAt")}</th>
              <th className="p-2 font-medium">{t("metrics.jobFailuresFinishedAt")}</th>
              <th className="p-2 font-medium">{t("metrics.jobFailuresError")}</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((failure) => (
              <tr key={failure.id} className="border-b last:border-0">
                <td className="p-2 align-top">{failure.jobName}</td>
                <td className="p-2 align-top whitespace-nowrap">
                  {new Date(failure.startedAt).toLocaleString(locale)}
                </td>
                <td className="p-2 align-top whitespace-nowrap">
                  {failure.finishedAt ? new Date(failure.finishedAt).toLocaleString(locale) : "—"}
                </td>
                <td className="max-w-sm break-words whitespace-pre-wrap p-2 align-top">
                  {failure.errorMessage ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        onPageChange={pagination.onPageChange}
        onPageSizeChange={pagination.onPageSizeChange}
      />
    </>
  );
}
