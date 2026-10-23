/**
 * Story 23-6b: the explicit gym picker. It lists the person's active assignments and nothing is preselected; choosing one switches
 * the active gym and navigates; with none it says so and signs the person out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const switchActiveGym = vi.fn();
const signOut = vi.fn();
const replace = vi.fn();
const assign = vi.fn();

vi.mock("@/app/(dashboard)/actions", () => ({ switchActiveGym: (...a: unknown[]) => switchActiveGym(...a) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: () => signOut() } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { SupportGymPicker } from "./support-gym-picker";

const GYMS = [
  { gymId: "g1", gymName: "Gym One" },
  { gymId: "g2", gymName: "Gym Two" },
];

beforeEach(() => {
  vi.clearAllMocks();
  switchActiveGym.mockResolvedValue({ error: null });
  signOut.mockResolvedValue({ error: null });
  Object.defineProperty(window, "location", { value: { replace, assign }, writable: true });
});

describe("SupportGymPicker", () => {
  it("lists only the given gyms, with none chosen", () => {
    render(<SupportGymPicker gyms={GYMS} />);
    expect(screen.getByRole("button", { name: "Gym One" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gym Two" })).toBeInTheDocument();
    expect(switchActiveGym).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("choosing a gym switches to exactly that gym and navigates", async () => {
    render(<SupportGymPicker gyms={GYMS} next="/payments" />);
    await userEvent.click(screen.getByRole("button", { name: "Gym Two" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/payments"));
    expect(switchActiveGym).toHaveBeenCalledTimes(1);
    expect(switchActiveGym).toHaveBeenCalledWith({ gymId: "g2" });
  });

  it("a refused switch shows an error and stays on the picker", async () => {
    switchActiveGym.mockResolvedValue({ error: { code: "x", message: "no" } });
    render(<SupportGymPicker gyms={GYMS} />);
    await userEvent.click(screen.getByRole("button", { name: "Gym One" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("supportAccess.switchFailed");
    expect(replace).not.toHaveBeenCalled();
  });

  it("with no active assignment it says so and offers only sign-out", async () => {
    render(<SupportGymPicker gyms={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("supportAccess.noGym");
    await userEvent.click(screen.getByRole("button", { name: "supportAccess.signOut" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login"));
    expect(signOut).toHaveBeenCalled();
  });

  it("an unreadable list is never shown as an empty assignment list", () => {
    render(<SupportGymPicker gyms={[]} failed />);
    expect(screen.getByRole("status")).toHaveTextContent("common.loadError");
  });
});
