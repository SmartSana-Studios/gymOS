/**
 * The Gyms list has one "Actions" menu per row (like the rest of the platform): the lifecycle actions valid for the
 * gym's status plus "Resend invitation" for a gym that is not deactivated.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/gyms",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../actions", () => ({
  suspendGym: vi.fn(),
  deactivateGym: vi.fn(),
  reinstateGym: vi.fn(),
  createGym: vi.fn(),
  resendOwnerInvitation: vi.fn(),
}));
vi.mock("./CreateGymModal", () => ({ CreateGymModal: () => null }));
vi.mock("../[id]/components/ResendInvitationDialog", () => ({
  ResendInvitationDialog: ({ gym }: { gym: { name: string } }) => <div>RESEND-DIALOG {gym.name}</div>,
}));
vi.mock("./GymLifecycleDialog", () => ({
  GymLifecycleDialog: ({ gym, action }: { gym: { name: string }; action: string }) => (
    <div>
      LIFECYCLE-DIALOG {action} {gym.name}
    </div>
  ),
}));

import { GymsPageClient } from "./GymsPageClient";
import { renderWithI18n } from "../../support/components/support-test-utils";

const row = (id: string, name: string, status: string) => ({
  id,
  name,
  status,
  category: "gym",
  createdAt: "2026-10-01T00:00:00Z",
  tierName: "Free/Test",
  ownerName: "Owner",
  ownerPhone: "+237600000000",
});

function renderPage() {
  renderWithI18n(
    <GymsPageClient
      initialGyms={[row("g1", "Active Gym", "active"), row("g2", "Suspended Gym", "suspended"), row("g3", "Deactivated Gym", "deactivated")]}
      total={3}
      page={1}
      pageSize={10}
      search=""
      status=""
      tiers={[]}
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

describe("Gyms list row actions", () => {
  it("offers Suspend, Deactivate and Resend invitation for an active gym", async () => {
    renderPage();
    expect(await menuLabels(userEvent.setup(), "Active Gym")).toEqual(["Suspend", "Deactivate", "Resend invitation"]);
  });

  it("offers Reinstate, Deactivate and Resend invitation for a suspended gym", async () => {
    renderPage();
    expect(await menuLabels(userEvent.setup(), "Suspended Gym")).toEqual(["Reinstate", "Deactivate", "Resend invitation"]);
  });

  it("offers only Reinstate for a deactivated gym", async () => {
    renderPage();
    expect(await menuLabels(userEvent.setup(), "Deactivated Gym")).toEqual(["Reinstate"]);
  });

  it("opens the resend dialog for that gym and the lifecycle dialog for the chosen action", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Active Gym" }));
    await user.click(await screen.findByRole("menuitem", { name: "Resend invitation" }));
    expect(await screen.findByText("RESEND-DIALOG Active Gym")).toBeInTheDocument();
  });
});
