/**
 * The Billing table has one "Actions" menu per row (like the Gyms list and the rest of the platform), not a row of buttons: the three billing actions,
 * then Reactivate for a suspended or deactivated gym or Suspend for an active one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/billing",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../actions", () => ({ markPaymentReceived: vi.fn(), applyCredit: vi.fn(), triggerRetry: vi.fn() }));
vi.mock("../../gyms/actions", () => ({ suspendGym: vi.fn(), reinstateGym: vi.fn() }));
vi.mock("../../gyms/components/GymLifecycleDialog", () => ({
  GymLifecycleDialog: ({ gym, action }: { gym: { name: string }; action: string }) => (
    <div>
      LIFECYCLE-DIALOG {action} {gym.name}
    </div>
  ),
}));
vi.mock("./ApplyCreditDialog", () => ({ ApplyCreditDialog: ({ gymName }: { gymName: string }) => <div>CREDIT-DIALOG {gymName}</div> }));
vi.mock("./MarkPaymentReceivedDialog", () => ({ MarkPaymentReceivedDialog: () => null }));
vi.mock("./TriggerRetryDialog", () => ({ TriggerRetryDialog: () => null }));

import { BillingPageClient } from "./BillingPageClient";
import { renderWithI18n } from "../../support/components/support-test-utils";

const row = (id: string, name: string, status: string, saasBillingStatus: string) => ({
  id,
  name,
  status,
  tierName: "Free/Test",
  saasBillingInterval: "monthly",
  saasBillingStatus,
  nextBillingDate: "2026-12-04",
  lastPaymentDate: null,
  failedAttemptCount: 0,
});

function renderPage() {
  renderWithI18n(
    <BillingPageClient
      initialRows={[
        row("g1", "Active Gym", "active", "active"),
        row("g2", "Suspended Gym", "suspended", "suspended"),
        row("g3", "Deactivated Gym", "deactivated", "grace_period"),
      ] as never}
      total={3}
      page={1}
      pageSize={10}
      search=""
      status=""
    />,
  );
}

async function menuLabels(user: ReturnType<typeof userEvent.setup>, gym: string): Promise<string[]> {
  await user.click(screen.getByRole("button", { name: `Actions for ${gym}` }));
  const items = (await screen.findAllByRole("menuitem")).map((i) => i.textContent ?? "");
  await user.keyboard("{Escape}");
  return items;
}

beforeEach(() => vi.clearAllMocks());

describe("Billing table row actions", () => {
  it("shows no row of buttons: the actions are inside one menu per gym", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "Apply credit" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Actions for / })).toHaveLength(3);
  });

  it("offers Suspend for an active gym and Reactivate for a suspended or deactivated one, after the three billing actions", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await menuLabels(user, "Active Gym")).toEqual(["Mark payment received", "Apply credit", "Trigger retry", "Suspend"]);
    expect(await menuLabels(user, "Suspended Gym")).toEqual(["Mark payment received", "Apply credit", "Trigger retry", "Reactivate"]);
    expect(await menuLabels(user, "Deactivated Gym")).toEqual(["Mark payment received", "Apply credit", "Trigger retry", "Reactivate"]);
  });

  it("opens the credit dialog from the menu", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Actions for Suspended Gym" }));
    await user.click(await screen.findByRole("menuitem", { name: "Apply credit" }));
    expect(await screen.findByText("CREDIT-DIALOG Suspended Gym")).toBeTruthy();
  });
});
