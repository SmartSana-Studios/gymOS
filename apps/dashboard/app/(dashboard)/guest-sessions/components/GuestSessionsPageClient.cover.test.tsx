/**
 * Story 28.3 (UX AD-22): the Paid tab's Used column reads "covered day", "visit [date], [time]" or "class [name], [date]" by coveredKind,
 * in the gym's timezone, in both locales, with the REAL en.json / fr.json strings. GuestSessionsPageClient.test.tsx runs unchanged beside it.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import en from "../../../../locales/en.json";
import fr from "../../../../locales/fr.json";

let lang: "en" | "fr" = "en";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const dict = (lang === "en" ? en : fr) as unknown;
      const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);
      if (typeof text !== "string") return key;
      return text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ""));
    },
    i18n: { language: lang },
  }),
}));

import { GuestSessionsPageClient } from "./GuestSessionsPageClient";

const base = { tab: "paid" as const, period: "month" as const, page: 1, groupByRecorder: false, refundedAfterUseOnly: false };

function row(o: Record<string, unknown>) {
  return {
    paymentId: "p",
    memberId: "m",
    memberName: "Amina",
    amount: 2000,
    method: "cash",
    createdAt: "2026-11-01T08:00:00Z",
    consumedAt: null,
    refundState: "none",
    recorderId: "u1",
    recorderName: "Rita",
    recorderKind: "staff",
    groupSessions: null,
    groupTotal: null,
    coveredKind: null,
    coveredBookingId: null,
    className: null,
    classStartsAt: null,
    gymTimezone: "Africa/Douala",
    ...o,
  };
}

const rows = [
  row({ paymentId: "p-visit", memberName: "Visit", consumedAt: "2026-11-18T23:30:00Z", coveredKind: "visit" }),
  row({ paymentId: "p-class", memberName: "Klass", consumedAt: "2026-11-20T10:00:00Z", coveredKind: "class", coveredBookingId: "b", className: "Yoga", classStartsAt: "2026-11-20T23:30:00Z" }),
  row({ paymentId: "p-day", memberName: "Day", consumedAt: "2026-11-10T10:00:00Z", coveredKind: "day" }),
  row({ paymentId: "p-legacy", memberName: "Legacy", consumedAt: "2026-11-09T10:00:00Z", coveredKind: null }),
  row({ paymentId: "p-unused", memberName: "Unused" }),
];

function cells(name: string): string[] {
  const tr = screen.getByRole("link", { name }).closest("tr") as HTMLElement;
  return within(tr).getAllByRole("cell").map((c) => c.textContent ?? "");
}

describe.each([
  { locale: "en" as const, header: "Used", visit: /^visit 11\/19\/26, 12:30\s?AM$/, klass: /^class Yoga, 11\/21\/26$/, day: "covered day" },
  { locale: "fr" as const, header: "Utilisée", visit: /^visite 19\/11\/2026, 00:30$/, klass: /^cours Yoga, 21\/11\/2026$/, day: "journée couverte" },
])("Paid tab Used column, $locale", ({ locale, header, visit, klass, day }) => {
  it("reads covered day, visit [date], [time] and class [name], [date] in the gym's timezone", () => {
    lang = locale;
    render(<GuestSessionsPageClient {...base} state="ready" summary={{ paid: 5, blocked: 0, blockedMembers: 0, free: 0 }} total={5} paidRows={rows as never} blockedRows={[]} freeRows={[]} />);

    expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    const used = (name: string) => cells(name).at(-1) as string;
    expect(used("Visit")).toMatch(visit);
    expect(used("Klass")).toMatch(klass);
    expect(used("Day")).toBe(day);
    // A consumed legacy row with no kind reads as a covered day and never throws; an unconsumed row has nothing to show.
    expect(used("Legacy")).toBe(day);
    expect(used("Unused")).toBe("—");
  });
});
