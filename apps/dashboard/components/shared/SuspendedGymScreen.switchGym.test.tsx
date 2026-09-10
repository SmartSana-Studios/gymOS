/**
 * Story 17.3 review: the suspended screens' gym list lands on `/` after a
 * successful switch, exactly as the sidebar's GymSwitcher does, so the new
 * gym's role picks the destination. A failed switch stays put and says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const switchActiveGym = vi.fn();
vi.mock("@/app/(dashboard)/actions", () => ({
  switchActiveGym: (...args: unknown[]) => switchActiveGym(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

// Neither is exercised here: SignOutLink's client is only created on click,
// and the neutral screen renders no PayNowButton.
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/components/shared/PayNowButton", () => ({ PayNowButton: () => null }));

import { NeutralSuspendedScreen } from "./SuspendedGymScreen";

const GYMS = [
  { gymId: "gym-a", gymName: "Gym A", role: "receptionist" as const },
  { gymId: "gym-b", gymName: "Gym B", role: "coach" as const },
];

const replace = vi.fn();

async function switchToGymB() {
  const user = userEvent.setup();
  render(<NeutralSuspendedScreen gymId="gym-a" availableGyms={GYMS} />);
  await user.click(screen.getByRole("button", { name: "Gym B" }));
}

describe("SuspendedGymScreen gym list", () => {
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

    await switchToGymB();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(switchActiveGym).toHaveBeenCalledWith({ gymId: "gym-b" });
  });

  it("stays on the screen and shows the error when the switch fails", async () => {
    switchActiveGym.mockResolvedValue({ error: { code: "unknown", message: "boom" } });

    await switchToGymB();

    expect(await screen.findByText("sidebar.gymSwitchError")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Gym B" })).toBeEnabled();
  });
});
