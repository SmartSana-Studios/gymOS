/**
 * Story 17.3 review: a successful gym switch always lands on `/`, with a full
 * document navigation, so `(dashboard)/page.tsx`'s landing redirect routes by
 * the NEW gym's role. Refreshing in place left a user who switched from a
 * coach gym to a staff gym on `/coach/overview`, with the whole gym counted
 * as "My Members". A failed switch must stay put and say so.
 *
 * The menu is opened the way MembersPageClient.sendInvite.test.tsx opens its
 * Radix dropdown: click the trigger, then find the `menuitem`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const switchActiveGym = vi.fn();
vi.mock("@/app/(dashboard)/actions", () => ({
  switchActiveGym: (...args: unknown[]) => switchActiveGym(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import { GymSwitcher } from "./GymSwitcher";

const GYMS = [
  { gymId: "gym-a", gymName: "Gym A", role: "coach" as const },
  { gymId: "gym-b", gymName: "Gym B", role: "owner" as const },
];

const replace = vi.fn();

async function switchToGymB(onNavigate = vi.fn()) {
  const user = userEvent.setup();
  render(
    <GymSwitcher
      currentGymId="gym-a"
      currentGymName="Gym A"
      availableGyms={GYMS}
      railAware={false}
      onNavigate={onNavigate}
    />,
  );
  await user.click(screen.getByRole("button", { name: "sidebar.switchGym" }));
  await user.click(await screen.findByRole("menuitem", { name: /Gym B/ }));
  return onNavigate;
}

describe("GymSwitcher", () => {
  beforeEach(() => {
    switchActiveGym.mockReset();
    replace.mockReset();
    vi.stubGlobal("location", { ...window.location, replace });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lands on / with a full navigation after a successful switch", async () => {
    switchActiveGym.mockResolvedValue({ error: null });

    const onNavigate = await switchToGymB();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(switchActiveGym).toHaveBeenCalledWith({ gymId: "gym-b" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("stays on the current page and shows the error when the switch fails", async () => {
    switchActiveGym.mockResolvedValue({ error: { code: "unknown", message: "boom" } });

    const onNavigate = await switchToGymB();

    expect(await screen.findByText("sidebar.gymSwitchError")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
