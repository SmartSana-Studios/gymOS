/**
 * A suspended gym on a 0 XAF plan (Free/Test) is not offered Pay Now: it is told that GymOS renews the plan.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/(dashboard)/actions", () => ({ switchActiveGym: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/components/shared/PayNowButton", () => ({ PayNowButton: () => <button>PAY-NOW</button> }));

import { OwnerSuspendedScreen } from "./SuspendedGymScreen";

const base = { gymName: "SmartSana", gymId: "g1", availableGyms: [], selectableTiers: [] };

describe("OwnerSuspendedScreen", () => {
  it("offers Pay Now on a paid plan", () => {
    render(<OwnerSuspendedScreen {...base} />);
    expect(screen.getByText("PAY-NOW")).toBeInTheDocument();
  });

  it("shows the contact-GymOS message instead of Pay Now on a free plan", () => {
    render(<OwnerSuspendedScreen {...base} isFreeBilling />);
    expect(screen.queryByText("PAY-NOW")).toBeNull();
    expect(screen.getByText("saasBilling.ownerFreePlanMessage")).toBeInTheDocument();
  });
});
