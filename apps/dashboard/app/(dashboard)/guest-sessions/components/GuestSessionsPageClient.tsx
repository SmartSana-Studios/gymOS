"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  GUEST_SESSIONS_PAGE_SIZE,
  GUEST_SESSIONS_PERIODS,
  GUEST_SESSIONS_TABS,
  type BlockedAttemptRow,
  type FreeGuestSessionRow,
  type GuestSessionsPeriod,
  type GuestSessionsSummary,
  type GuestSessionsTab,
  type PaidGuestSessionRow,
} from "@/lib/guest-sessions";
import { PAYMENT_METHOD_LABEL_KEY } from "../../payments/paymentLabels";

interface PageState {
  tab: GuestSessionsTab;
  period: GuestSessionsPeriod;
  page: number;
  groupByRecorder: boolean;
  refundedAfterUseOnly: boolean;
}

type Props = PageState &
  (
    | { state: "forbidden"; message: string }
    | { state: "error"; message: string }
    | {
        state: "ready";
        summary: GuestSessionsSummary;
        total: number;
        paidRows: PaidGuestSessionRow[];
        blockedRows: BlockedAttemptRow[];
        freeRows: FreeGuestSessionRow[];
      }
  );

function buildHref(state: PageState, next: Partial<PageState>): string {
  const merged = { ...state, ...next };
  const params = new URLSearchParams();
  params.set("tab", merged.tab);
  params.set("period", merged.period);
  if (merged.page > 1) params.set("page", String(merged.page));
  if (merged.tab === "paid") {
    if (!merged.groupByRecorder) params.set("group", "none");
    if (merged.refundedAfterUseOnly) params.set("refunded", "1");
  }
  return `/guest-sessions?${params.toString()}`;
}

export function GuestSessionsPageClient(props: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = i18n.language;
  const state: PageState = {
    tab: props.tab,
    period: props.period,
    page: props.page,
    groupByRecorder: props.groupByRecorder,
    refundedAfterUseOnly: props.refundedAfterUseOnly,
  };

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/">
            <ArrowLeft />
            {t("guestSessions.back")}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t("guestSessions.title")}</h1>
      </div>
    </div>
  );

  if (props.state === "forbidden") {
    return (
      <div className="space-y-4">
        {header}
        <div role="alert" className="rounded-md border border-dashed py-16 text-center text-sm text-muted-foreground">
          {props.message}
        </div>
      </div>
    );
  }

  const periodPhrase = t(props.period === "today" ? "guestSessions.periodToday" : "guestSessions.periodMonth");

  const controls = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label={t("guestSessions.tabs.label")} className="inline-flex rounded-md bg-muted p-1">
        {GUEST_SESSIONS_TABS.map((tab) => (
          <Link
            key={tab}
            aria-current={props.tab === tab ? "page" : undefined}
            href={buildHref(state, { tab, page: 1 })}
            className={`rounded-sm px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              props.tab === tab ? "bg-background text-foreground shadow" : "text-muted-foreground"
            }`}
          >
            {t(`guestSessions.tabs.${tab}`)}
          </Link>
        ))}
      </nav>
      <nav aria-label={t("guestSessions.period")} className="inline-flex rounded-md bg-muted p-1">
        {GUEST_SESSIONS_PERIODS.map((p) => (
          <Link
            key={p}
            aria-current={props.period === p ? "page" : undefined}
            href={buildHref(state, { period: p, page: 1 })}
            className={`rounded-sm px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              props.period === p ? "bg-background text-foreground shadow" : "text-muted-foreground"
            }`}
          >
            {t(p === "today" ? "guestSessions.today" : "guestSessions.month")}
          </Link>
        ))}
      </nav>
    </div>
  );

  if (props.state === "error") {
    return (
      <div className="space-y-4">
        {header}
        {controls}
        <div role="alert" className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm">{props.message}</p>
          <Button variant="outline" onClick={() => router.refresh()}>
            {t("guestSessions.refresh")}
          </Button>
        </div>
      </div>
    );
  }

  const { summary, total, paidRows, blockedRows, freeRows } = props;
  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(lang);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(lang);
  const fmtNumber = (n: number) => n.toLocaleString(lang);

  const memberCell = (id: string, name: string) => (
    <Link href={`/members?memberId=${id}`} className="font-medium hover:underline">
      {name}
    </Link>
  );

  const totalPages = Math.max(1, Math.ceil(total / GUEST_SESSIONS_PAGE_SIZE));
  const from = (props.page - 1) * GUEST_SESSIONS_PAGE_SIZE + 1;
  const to = Math.min(total, props.page * GUEST_SESSIONS_PAGE_SIZE);

  const empty = (
    <div className="rounded-md border border-dashed py-16 text-center text-sm text-muted-foreground">
      {props.tab === "paid" && props.refundedAfterUseOnly
        ? t("guestSessions.empty.paidRefundedAfterUse")
        : t(`guestSessions.empty.${props.tab}`, { period: periodPhrase })}
    </div>
  );

  const th = (key: string) => (
    <th className="p-3 font-medium">{t(`guestSessions.columns.${key}`)}</th>
  );

  function recorderLabel(row: PaidGuestSessionRow): string {
    if (row.recorderKind === "staff" && row.recorderName) return row.recorderName;
    return row.recorderKind === "tara" ? t("guestSessions.recorderTara") : t("guestSessions.recorderUnknown");
  }

  const refundLabel = (row: PaidGuestSessionRow) =>
    row.refundState === "refunded"
      ? t("guestSessions.refund.refunded")
      : row.refundState === "refunded_after_use"
        ? t("guestSessions.refund.refundedAfterUse")
        : t("guestSessions.refund.none");

  let body: React.ReactNode;
  if (total === 0) {
    body = empty;
  } else if (props.tab === "paid") {
    const groupKey = (r: PaidGuestSessionRow) => r.recorderId ?? `~${r.recorderKind}`;
    body = (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              {th("member")}
              {th("amount")}
              {th("method")}
              {th("recordedBy")}
              {th("time")}
              {th("refund")}
            </tr>
          </thead>
          <tbody>
            {paidRows.map((row, i) => {
              const showHeader =
                row.groupSessions != null && (i === 0 || groupKey(paidRows[i - 1]) !== groupKey(row));
              return (
                <Fragment key={row.paymentId}>
                  {showHeader && (
                    <tr className="border-b bg-muted/30">
                      <th colSpan={6} scope="colgroup" className="p-3 text-left font-semibold">
                        {t("guestSessions.groupHeader", {
                          name: recorderLabel(row),
                          count: row.groupSessions ?? 0,
                          total: fmtNumber(row.groupTotal ?? 0),
                        })}
                      </th>
                    </tr>
                  )}
                  <tr className="border-b last:border-0">
                    <td className="p-3">{memberCell(row.memberId, row.memberName)}</td>
                    <td className="p-3">XAF {fmtNumber(row.amount)}</td>
                    <td className="p-3">
                      {PAYMENT_METHOD_LABEL_KEY[row.method] ? t(PAYMENT_METHOD_LABEL_KEY[row.method]) : row.method}
                    </td>
                    <td className="p-3">{recorderLabel(row)}</td>
                    <td className="p-3">{fmtDateTime(row.createdAt)}</td>
                    <td className="p-3">{refundLabel(row)}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  } else if (props.tab === "blocked") {
    body = (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              {th("member")}
              {th("time")}
              {th("source")}
              {th("class")}
            </tr>
          </thead>
          <tbody>
            {blockedRows.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="p-3">{memberCell(row.memberId, row.memberName)}</td>
                <td className="p-3">
                  {fmtDateTime(row.time)}
                  {row.scannedAt && (
                    <span className="ml-2 text-muted-foreground">
                      {t("guestSessions.synced", { time: fmtDateTime(row.syncedAt) })}
                    </span>
                  )}
                </td>
                <td className="p-3">{t(`guestSessions.source.${row.source}`)}</td>
                <td className="p-3">{row.className ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else {
    body = (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              {th("member")}
              {th("earned")}
              {th("useBy")}
              {th("status")}
            </tr>
          </thead>
          <tbody>
            {freeRows.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="p-3">{memberCell(row.memberId, row.memberName)}</td>
                <td className="p-3">{fmtDate(row.earnedAt)}</td>
                <td className="p-3">{fmtDate(row.usableUntil)}</td>
                <td className="p-3">{t(`guestSessions.status.${row.status}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      {controls}

      {props.tab === "paid" && (
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label={t("guestSessions.groupBy.label")} className="inline-flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("guestSessions.groupBy.label")}</span>
            <span className="inline-flex rounded-md bg-muted p-1">
              {([true, false] as const).map((grouped) => (
                <Link
                  key={String(grouped)}
                  aria-current={props.groupByRecorder === grouped ? "true" : undefined}
                  href={buildHref(state, { groupByRecorder: grouped, page: 1 })}
                  className={`rounded-sm px-3 py-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    props.groupByRecorder === grouped ? "bg-background text-foreground shadow" : "text-muted-foreground"
                  }`}
                >
                  {t(grouped ? "guestSessions.groupBy.recorder" : "guestSessions.groupBy.none")}
                </Link>
              ))}
            </span>
          </nav>
          <Link
            href={buildHref(state, { refundedAfterUseOnly: !props.refundedAfterUseOnly, page: 1 })}
            aria-pressed={props.refundedAfterUseOnly}
            className={`rounded-full border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              props.refundedAfterUseOnly ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"
            }`}
          >
            {t("guestSessions.refundedAfterUseOnly")}
          </Link>
        </div>
      )}

      {props.tab === "blocked" && (
        <p className="text-sm text-muted-foreground">
          {t("guestSessions.blockedSummary", {
            attempts: fmtNumber(summary.blocked),
            members: fmtNumber(summary.blockedMembers),
          })}
        </p>
      )}

      {body}

      {total > GUEST_SESSIONS_PAGE_SIZE && (
        <nav className="flex items-center justify-between text-sm" aria-label={t("guestSessions.title")}>
          <span>{t("guestSessions.pagination.range", { from, to, total: fmtNumber(total) })}</span>
          <span className="flex gap-2">
            {props.page > 1 ? (
              <Link className="rounded-md border px-3 py-1" href={buildHref(state, { page: props.page - 1 })}>
                {t("guestSessions.pagination.previous")}
              </Link>
            ) : null}
            {props.page < totalPages ? (
              <Link className="rounded-md border px-3 py-1" href={buildHref(state, { page: props.page + 1 })}>
                {t("guestSessions.pagination.next")}
              </Link>
            ) : null}
          </span>
        </nav>
      )}
    </div>
  );
}

