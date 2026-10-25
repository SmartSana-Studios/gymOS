import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const renameGym = vi.fn();
vi.mock("../../actions", () => ({ renameGym: (...a: unknown[]) => renameGym(...a) }));

import { GymNameEditor } from "./GymNameEditor";
import { renderWithI18n } from "../../../support/components/support-test-utils";

const GYM = { id: "g1", name: "SmartSana Fitness" } as never;

beforeEach(() => vi.clearAllMocks());

describe("GymNameEditor", () => {
  it("renames through the action, shows the new name and refreshes", async () => {
    renameGym.mockResolvedValue({ error: null });
    const onSaved = vi.fn();
    renderWithI18n(<GymNameEditor gym={GYM} onSaved={onSaved} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rename gym" }));
    const input = screen.getByRole("textbox", { name: "Gym name" });
    await user.clear(input);
    await user.type(input, "SmartSana Gym");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(renameGym).toHaveBeenCalledWith("g1", { name: "SmartSana Gym" }));
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "SmartSana Gym" })).toBeInTheDocument();
  });

  it("shows the refusal (a taken name) and keeps the editor open", async () => {
    renameGym.mockResolvedValue({ error: { code: "gym_name_taken", message: "That name is already used." } });
    renderWithI18n(<GymNameEditor gym={GYM} onSaved={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rename gym" }));
    const input = screen.getByRole("textbox", { name: "Gym name" });
    await user.clear(input);
    await user.type(input, "Other Gym");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That name is already used.");
    expect(screen.getByRole("textbox", { name: "Gym name" })).toBeInTheDocument();
  });

  it("rejects a too-short name without calling the action, and does nothing for an unchanged name", async () => {
    renderWithI18n(<GymNameEditor gym={GYM} onSaved={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rename gym" }));
    const input = screen.getByRole("textbox", { name: "Gym name" });
    await user.clear(input);
    await user.type(input, "A");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "SmartSana Fitness");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(renameGym).not.toHaveBeenCalled();
  });
});
