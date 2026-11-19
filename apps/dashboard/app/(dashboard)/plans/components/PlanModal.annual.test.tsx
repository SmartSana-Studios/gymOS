/**
 * Story 27.4 (FR-240, UX AD-23): under Billing Interval Annual the PlanModal says members pay once, names the duration typed in the field
 * ("…for [D] days", or "…for the duration below" before it is filled), and that instalments are not available. Switching the interval
 * never changes the Duration; Duration is not pre-filled with 365; a monthly interval shows none of it.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { realT } from "@/test-utils/realT";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: realT("en"), i18n: { language: "en" } }) }));
vi.mock("../actions", () => ({ createPlan: vi.fn(), editPlan: vi.fn() }));

const NO_DURATION = "Members pay the full price once. The plan then runs for the duration below. Renewing is a new payment.";
const NO_INSTALMENTS = "To let members pay monthly, create a separate monthly plan. Paying an annual plan in instalments isn't available.";

async function renderCreate() {
  const { PlanModal } = await import("./PlanModal");
  render(<PlanModal open onClose={vi.fn()} onSaved={vi.fn()} editingPlan={null} />);
}

describe("PlanModal annual helper (Story 27.4)", () => {
  it("shows nothing under a monthly interval", async () => {
    await renderCreate();
    expect(screen.queryByText(NO_INSTALMENTS)).not.toBeInTheDocument();
  });

  it("annual with no duration yet: 'for the duration below', then the instalments line; Duration is not pre-filled", async () => {
    const user = userEvent.setup();
    await renderCreate();
    await user.selectOptions(screen.getByLabelText(/Billing Interval/), "annual");
    expect(screen.getByText(NO_DURATION)).toBeInTheDocument();
    expect(screen.getByText(NO_INSTALMENTS)).toBeInTheDocument();
    expect(screen.getByLabelText(/Duration/)).toHaveValue(null);
  });

  it("names the duration typed in the field, live, and never changes it when the interval switches", async () => {
    const user = userEvent.setup();
    await renderCreate();
    await user.type(screen.getByLabelText(/Duration/), "365");
    await user.selectOptions(screen.getByLabelText(/Billing Interval/), "annual");
    expect(screen.getByText("Members pay the full price once. The plan then runs for 365 days. Renewing is a new payment.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Duration/)).toHaveValue(365);
    await user.clear(screen.getByLabelText(/Duration/));
    await user.type(screen.getByLabelText(/Duration/), "400");
    expect(screen.getByText(/runs for 400 days/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Billing Interval/), "monthly");
    expect(screen.getByLabelText(/Duration/)).toHaveValue(400);
    expect(screen.queryByText(NO_INSTALMENTS)).not.toBeInTheDocument();
  });
});
