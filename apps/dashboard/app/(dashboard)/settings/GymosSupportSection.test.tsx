/**
 * Story 23.3: GymosSupportSection -- one-state readout, confirm before saving, own-setter save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const saveAllowGymosSupport = vi.fn();
const loadGymosSupportStatus = vi.fn();

vi.mock("./actions", () => ({
  saveAllowGymosSupport: (...args: unknown[]) => saveAllowGymosSupport(...args),
  loadGymosSupportStatus: (...args: unknown[]) => loadGymosSupportStatus(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => (vars?.when ? `${key}|${vars.when}` : key),
    i18n: { language: "en" },
  }),
}));

import { GymosSupportSection } from "./GymosSupportSection";

describe("GymosSupportSection", () => {
  beforeEach(() => {
    saveAllowGymosSupport.mockReset();
    loadGymosSupportStatus.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the state readout and 'not yet' when on", () => {
    render(<GymosSupportSection initial={{ allowed: true, state: "waiting", lastActedAt: null }} onSaved={vi.fn()} />);
    expect(screen.getByText("settings.gymosSupport.state.waiting")).toBeTruthy();
    expect(screen.getByText("settings.gymosSupport.lastActed|settings.gymosSupport.lastActedNever")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("does nothing when the confirm is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GymosSupportSection initial={{ allowed: true, state: "none", lastActedAt: null }} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(saveAllowGymosSupport).not.toHaveBeenCalled();
  });

  it("saves false after confirm and shows the re-read state", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    saveAllowGymosSupport.mockResolvedValue({ data: { ok: true }, error: null });
    loadGymosSupportStatus.mockResolvedValue({ data: { allowed: false, state: "off", lastActedAt: null }, error: null });
    const onSaved = vi.fn();
    render(<GymosSupportSection initial={{ allowed: true, state: "assigned", lastActedAt: null }} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByText("settings.gymosSupport.state.off")).toBeTruthy());
    expect(saveAllowGymosSupport).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalledWith("settings.gymosSupport.savedOff");
  });

  it("shows a fixed error and keeps the switch when the save fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    saveAllowGymosSupport.mockResolvedValue({ data: null, error: { code: "unknown", message: "x" } });
    render(<GymosSupportSection initial={{ allowed: false, state: "off", lastActedAt: null }} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByText("settings.gymosSupport.saveFailed")).toBeTruthy());
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("does not call onSaved when the save fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    saveAllowGymosSupport.mockResolvedValue({ data: null, error: { code: "unknown", message: "x" } });
    const onSaved = vi.fn();
    render(<GymosSupportSection initial={{ allowed: true, state: "none", lastActedAt: null }} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByText("settings.gymosSupport.saveFailed")).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps the saved result when the re-read returns null (switch flipped, state off)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    saveAllowGymosSupport.mockResolvedValue({ data: { ok: true }, error: null });
    loadGymosSupportStatus.mockResolvedValue({ data: null, error: { code: "unknown", message: "x" } });
    const onSaved = vi.fn();
    render(<GymosSupportSection initial={{ allowed: true, state: "assigned", lastActedAt: null }} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("settings.gymosSupport.savedOff"));
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("settings.gymosSupport.state.off")).toBeTruthy();
    expect(screen.queryByText("settings.gymosSupport.saveFailed")).toBeNull();
  });

  it("treats a rejected save action as a failed save", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    saveAllowGymosSupport.mockRejectedValue(new Error("boom"));
    const onSaved = vi.fn();
    render(<GymosSupportSection initial={{ allowed: true, state: "none", lastActedAt: null }} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByText("settings.gymosSupport.saveFailed")).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
  });
});
