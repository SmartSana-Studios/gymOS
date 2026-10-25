/** Story 23.8: only an Owner can ask about an audit entry; the actor of a support action reads "GymOS Support". */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/audit",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/hooks/use-table-pagination", () => ({ useUrlPagination: () => ({}) }));
vi.mock("@/components/TablePagination", () => ({ TablePagination: () => null }));
vi.mock("../actions", () => ({ exportAuditLogCsvAction: vi.fn(), fileDisclosureRequestAction: vi.fn() }));

import { AuditLogPageClient } from "./AuditLogPageClient";

const row = {
  id: "a1",
  actorId: "proxy-1",
  actorDisplayName: "GymOS Support",
  actionType: "refund_recorded",
  targetEntityId: null,
  targetEntityType: null,
  metadata: {},
  createdAt: "2026-10-20T10:00:00Z",
};

function renderAs(role: "owner" | "manager" | "supervisor", requests = [] as never[]) {
  return render(
    <AuditLogPageClient
      initialRows={[row]}
      total={1}
      page={1}
      pageSize={5}
      from=""
      to=""
      actorId=""
      role={role}
      actorOptions={[{ actorId: "proxy-1", actorDisplayName: "GymOS Support" }]}
      disclosureRequests={requests}
    />,
  );
}

describe("AuditLogPageClient disclosure request", () => {
  it("shows the Owner an ask button and the support actor by its gym-facing name", () => {
    renderAs("owner");
    expect(screen.getAllByText("GymOS Support").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "audit.disclosure.request" })).toBeTruthy();
  });

  it("shows a Manager and a Supervisor no ask button", () => {
    for (const role of ["manager", "supervisor"] as const) {
      const { unmount } = renderAs(role);
      expect(screen.queryByRole("button", { name: "audit.disclosure.request" })).toBeNull();
      unmount();
    }
  });

  it("lists the Owner's open request with its due date and an answered one with its answer", () => {
    search = "tab=questions";
    renderAs("owner", [
      { id: "r1", auditLogId: "aaaaaaaa-1", question: "Who made this?", requestedAt: "2026-10-21T10:00:00Z", answerDueAt: "2026-10-26T10:00:00Z", answeredAt: null, answer: null },
      { id: "r2", auditLogId: "bbbbbbbb-2", question: "And this?", requestedAt: "2026-10-18T10:00:00Z", answerDueAt: "2026-10-23T10:00:00Z", answeredAt: "2026-10-19T10:00:00Z", answer: "Reviewed by GymOS." },
    ] as never[]);
    expect(screen.getByText("Who made this?")).toBeTruthy();
    expect(screen.getByText("Reviewed by GymOS.")).toBeTruthy();
  });
});
