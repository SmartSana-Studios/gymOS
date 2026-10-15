/**
 * Epic 20 retro S-4: a subscriber's free-days reward is written as
 * loyalty_reward_granted with counter 'subscriber'; Audit names it "free days",
 * not "free session". A guest reward keeps the session label.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/audit",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../actions", () => ({ exportAuditLogCsvAction: vi.fn() }));

import { AuditLogPageClient } from "./AuditLogPageClient";

function row(id: string, metadata: Record<string, unknown>) {
  return {
    id,
    actorId: null,
    actorDisplayName: "System",
    actionType: "loyalty_reward_granted",
    targetEntityId: "m1",
    targetEntityType: "member",
    metadata,
    createdAt: "2026-10-14T10:00:00Z",
  };
}

describe("AuditLogPageClient loyalty reward label", () => {
  it("names a subscriber reward as free days and a guest reward as a free session", () => {
    render(
      <AuditLogPageClient
        initialRows={[row("a", { counter: "subscriber", reward_days: 10 }), row("b", { counter: "guest" })]}
        total={2}
        page={1}
        pageSize={50}
        from=""
        to=""
        actorId=""
        role="owner"
        actorOptions={[]}
      />,
    );
    expect(screen.getByText("audit.actionTypes.loyaltyRewardDaysGranted")).toBeTruthy();
    expect(screen.getByText("audit.actionTypes.loyaltyRewardGranted")).toBeTruthy();
  });
});
