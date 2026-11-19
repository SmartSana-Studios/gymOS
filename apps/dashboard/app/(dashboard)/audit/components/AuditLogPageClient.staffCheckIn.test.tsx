/**
 * Story 27.3: the Details cell of the three staff check-in audit actions. A check-in names the time and whether it carried a warning, a
 * rejection names its reason code, a void names the original entry time and the reason; metadata that is missing or unexpected falls
 * back to the generic cell, so a row never renders empty and never shows a wrong sentence.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/audit",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: "en" },
  }),
}));
vi.mock("../actions", () => ({ exportAuditLogCsvAction: vi.fn() }));

import { AuditLogPageClient } from "./AuditLogPageClient";

function row(id: string, actionType: string, metadata: Record<string, unknown>) {
  return {
    id,
    actorId: null,
    actorDisplayName: "Reception",
    actionType,
    targetEntityId: "m1",
    targetEntityType: "member",
    metadata,
    createdAt: "2026-11-15T10:00:00Z",
  };
}

function detailsOf(rows: ReturnType<typeof row>[]) {
  const { container } = render(
    <AuditLogPageClient initialRows={rows} total={rows.length} page={1} pageSize={50} from="" to="" actorId="" role="manager" actorOptions={[]} />,
  );
  return Array.from(container.querySelectorAll("tbody tr")).map((tr) => tr.querySelectorAll("td")[4]?.textContent ?? "");
}

describe("AuditLogPageClient staff check-in details", () => {
  it("names a clean check-in and a check-in with a warning differently, each with its time", () => {
    const [clean, warning] = detailsOf([
      row("a", "staff_check_in", { checked_in_at: "2026-11-15T07:02:00Z", outcome: "checked_in" }),
      row("b", "staff_check_in", { checked_in_at: "2026-11-15T07:02:00Z", outcome: "checked_in_with_warning" }),
    ]);
    expect(clean).toMatch(/^audit\.staffCheckIn\.checkedIn \{"time":"\d{2}:\d{2}"\}$/);
    expect(warning).toMatch(/^audit\.staffCheckIn\.checkedInWarning \{"time":"\d{2}:\d{2}"\}$/);
  });

  it("names the reason code of a rejection", () => {
    const [expired, noSession] = detailsOf([
      row("a", "staff_check_in_rejected", { reason: "expired" }),
      row("b", "staff_check_in_rejected", { reason: "no_paid_session" }),
    ]);
    expect(expired).toBe("audit.staffCheckIn.reason.expired");
    expect(noSession).toBe("audit.staffCheckIn.reason.no_paid_session");
  });

  it("names the original entry time and the reason of a void", () => {
    const [voided] = detailsOf([
      row("a", "staff_check_in_voided", { original_checked_in_at: "2026-11-15T07:02:00Z", reason: "wrong member selected", session_released: true }),
    ]);
    expect(voided).toMatch(/^audit\.staffCheckIn\.voided \{"time":"\d{2}:\d{2}","reason":"wrong member selected"\}$/);
  });

  it("falls back to the generic cell when the metadata does not have what the sentence needs", () => {
    const cells = detailsOf([
      row("a", "staff_check_in", { outcome: "checked_in" }),
      row("b", "staff_check_in_rejected", { outcome: "rejected_expired" }),
      row("c", "staff_check_in_voided", { reason: "wrong member selected" }),
    ]);
    for (const cell of cells) expect(cell).not.toMatch(/^audit\.staffCheckIn\./);
  });
});
