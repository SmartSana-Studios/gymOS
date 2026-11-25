/**
 * Story 28.3: the Used rows of the member modal Sessions section read what a consumed session covered, in the gym's timezone, in both
 * locales. These use the REAL en.json and fr.json strings (the interpolating `t` below), so a missing or wrong key fails here.
 * MemberModal.sessions.test.tsx (mocked `t`, no cover fields) runs unchanged beside this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import en from "../../../../locales/en.json";
import fr from "../../../../locales/fr.json";

const listMemberGuestSessionsAction = vi.fn();
let lang: "en" | "fr" = "en";

vi.mock("../actions", () => ({
  createMember: vi.fn(),
  editMember: vi.fn(),
  assignCoach: vi.fn(),
  getCoachAssignments: vi.fn(async () => ({ data: null, error: null })),
  getMemberLoyaltyAction: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("@/app/(dashboard)/payments/actions", () => ({
  getMemberRegistrationFeeStateAction: vi.fn(async () => ({ data: { kind: "none" }, error: null })),
  listMemberGuestSessionsAction: (...args: unknown[]) => listMemberGuestSessionsAction(...args),
}));
vi.mock("@/components/shared/RecordSessionPaymentDialog", () => ({ RecordSessionPaymentDialog: () => null }));
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

const member = {
  id: "m1",
  name: "Alice",
  phone: "+237680811041",
  email: null,
  dob: null,
  photoUrl: null,
  emergencyContact: null,
  planId: "plan-1",
  planName: "Drop-in",
  planType: "pay_per_session",
  status: "active" as const,
  expiryDate: null,
  joinDate: "2026-01-01",
  deactivatedAt: null,
  registrationFeeSettledAt: "2026-01-02T00:00:00Z",
};
const plans = [{ id: "plan-1", name: "Drop-in", planType: "pay_per_session", price: 2000, currency: "XAF" }] as never;
const FUTURE = new Date(Date.now() + 5 * 86_400_000).toISOString();

const session = (overrides: Record<string, unknown>) => ({
  id: "s",
  source: "paid",
  createdAt: "2026-10-09T10:00:00Z",
  usableUntil: FUTURE,
  consumedAt: null,
  coveredDay: null,
  validityMode: null,
  coveredKind: null,
  coveredAttendanceId: null,
  coveredBookingId: null,
  className: null,
  classStartsAt: null,
  gymTimezone: "Africa/Douala",
  voidedAt: null,
  method: "cash",
  recordedByName: "Rita",
  ...overrides,
});

async function renderView() {
  const { MemberModal } = await import("./MemberModal");
  render(
    <MemberModal
      open
      readOnly
      editingMember={member as never}
      plans={plans}
      coaches={[]}
      role="manager"
      chargeGuestsPerSession
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
}

// 2026-11-18T23:30Z is 00:30 on the 19th at the gym (Africa/Douala, UTC+1): the gym's day, not UTC's, not the browser's.
const VISIT = session({
  id: "v",
  consumedAt: "2026-11-18T23:30:00Z",
  validityMode: "single_use",
  coveredKind: "visit",
  coveredAttendanceId: "a1",
});
// A class at 2026-11-20T23:30Z is on the 21st at the gym.
const CLASS = session({
  id: "c",
  consumedAt: "2026-11-20T10:00:00Z",
  validityMode: "single_use",
  coveredKind: "class",
  coveredBookingId: "b1",
  className: "Yoga",
  classStartsAt: "2026-11-20T23:30:00Z",
});
const DAY = session({ id: "d", consumedAt: "2026-10-08T09:00:00Z", coveredDay: "2026-10-08", validityMode: "whole_day", coveredKind: "day" });

describe.each([
  { locale: "en" as const, visit: /^Used · visit on 11\/19\/26, 12:30\s?AM$/, klass: /^Used · class Yoga, 11\/21\/26$/, day: /^Used .*covered /, covers: ["This session covered one visit", "This session covered one class"] },
  { locale: "fr" as const, visit: /^Utilisée · visite le 19\/11\/2026, 00:30$/, klass: /^Utilisée · cours Yoga, 21\/11\/2026$/, day: /^Utilisée le .*couvre le /, covers: ["Cette séance a couvert une visite", "Cette séance a couvert un cours"] },
])("member modal Used rows, $locale", ({ locale, visit, klass, day, covers }) => {
  beforeEach(() => {
    lang = locale;
    listMemberGuestSessionsAction.mockReset();
  });

  it("reads a visit row as visit on the gym-local date and time", async () => {
    listMemberGuestSessionsAction.mockResolvedValue({ data: [VISIT], error: null });
    await renderView();
    const row = await screen.findByText(visit);
    expect(row).toHaveAttribute("title", covers[0]);
  });

  it("reads a class row as class [name], gym-local date of the class", async () => {
    listMemberGuestSessionsAction.mockResolvedValue({ data: [CLASS], error: null });
    await renderView();
    const row = await screen.findByText(klass);
    expect(row).toHaveAttribute("title", covers[1]);
  });

  it("keeps a day row on today's wording, and renders a legacy row with no kind as used", async () => {
    listMemberGuestSessionsAction.mockResolvedValue({
      data: [DAY, session({ id: "legacy", consumedAt: "2026-10-01T09:00:00Z", gymTimezone: null })],
      error: null,
    });
    await renderView();
    const dayRow = await screen.findByText(day);
    expect(dayRow).not.toHaveAttribute("title");
    expect(screen.getAllByRole("listitem").filter((li) => /^(Used|Utilisée)/.test(li.textContent ?? "")).length).toBe(2);
  });

  it("renders a class row whose class did not come back as used, without throwing", async () => {
    listMemberGuestSessionsAction.mockResolvedValue({
      data: [session({ id: "c2", consumedAt: "2026-11-20T10:00:00Z", validityMode: "single_use", coveredKind: "class", coveredBookingId: "b2" })],
      error: null,
    });
    await renderView();
    expect(await screen.findByText(locale === "en" ? /^Used · class , / : /^Utilisée · cours , /)).toBeInTheDocument();
  });
});
