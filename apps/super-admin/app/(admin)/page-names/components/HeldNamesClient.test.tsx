import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const decideHeldPageName = vi.fn();
vi.mock("../actions", () => ({ decideHeldPageName: (...a: unknown[]) => decideHeldPageName(...a) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import en from "../../../../locales/en.json";
import fr from "../../../../locales/fr.json";
import { menuItems, pickRowAction, renderWithI18n } from "../../support/components/support-test-utils";
import { HeldNamesClient, heldReasonParts } from "./HeldNamesClient";

const ROW = {
  id: "00000000-0000-4000-8000-0000000000aa", gymId: "g1", gymName: "Iron Gym", name: "x-fitness", origin: "rename",
  heldReason: "generic_word:fitness", heldAt: "2026-11-02T10:00:00Z", dueAt: "2026-11-04T10:00:00Z", overdue: true, currentName: "iron-yard",
};

describe("HeldNamesClient", () => {
  beforeEach(() => {
    decideHeldPageName.mockReset();
    refresh.mockReset();
  });

  it("splits a hold reason into its code and detail", () => {
    expect(heldReasonParts("near_match_name:iron-yard")).toEqual({ code: "near_match_name", detail: "iron-yard" });
    expect(heldReasonParts("other")).toEqual({ code: "other", detail: "" });
  });

  it("says so when nothing is waiting", () => {
    renderWithI18n(<HeldNamesClient rows={[]} />);
    expect(screen.getByText("No page names are waiting for a decision.")).toBeTruthy();
  });

  it("shows the name, gym, request, reason and the overdue flag", () => {
    renderWithI18n(<HeldNamesClient rows={[ROW]} />);
    expect(screen.getByText("x-fitness")).toBeTruthy();
    expect(screen.getByText("Iron Gym")).toBeTruthy();
    expect(screen.getByText("Rename from iron-yard")).toBeTruthy();
    expect(screen.getByText('Contains the generic word "fitness"')).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
  });

  it("has one Actions menu per row holding Approve and Reject", async () => {
    const user = userEvent.setup();
    renderWithI18n(<HeldNamesClient rows={[ROW]} />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(await menuItems(user, "x-fitness")).toEqual(["Approve", "Reject"]);
  });

  it("shows the French copy", () => {
    renderWithI18n(<HeldNamesClient rows={[ROW]} />, "fr");
    expect(screen.getByText("En retard")).toBeTruthy();
    expect(screen.getByText(/Contient le mot générique/)).toBeTruthy();
  });

  it("cannot submit without a reason, then approves with it", async () => {
    const user = userEvent.setup();
    decideHeldPageName.mockResolvedValue({ data: { state: "active" }, error: null });
    renderWithI18n(<HeldNamesClient rows={[ROW]} />);
    await pickRowAction(user, "x-fitness", "Approve");
    const dialog = await screen.findByRole("dialog");
    const submit = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Approve") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(screen.getByLabelText(/Reason/), "Verified as the gym's own name");
    expect(submit.disabled).toBe(false);
    await user.click(submit);
    await waitFor(() =>
      expect(decideHeldPageName).toHaveBeenCalledWith({ id: ROW.id, approve: true, reason: "Verified as the gym's own name" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("rejects with a reason and shows a server refusal inline", async () => {
    const user = userEvent.setup();
    decideHeldPageName.mockResolvedValue({ data: null, error: { code: "not_held", message: "This name is no longer waiting for a decision." } });
    renderWithI18n(<HeldNamesClient rows={[ROW]} />);
    await pickRowAction(user, "x-fitness", "Reject");
    await user.type(await screen.findByLabelText(/Reason/), "Too generic");
    const dialog = await screen.findByRole("dialog");
    await user.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Reject") as HTMLButtonElement);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(decideHeldPageName).toHaveBeenCalledWith({ id: ROW.id, approve: false, reason: "Too generic" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows no Overdue badge for a hold that is not overdue", () => {
    renderWithI18n(<HeldNamesClient rows={[{ ...ROW, overdue: false }]} />);
    expect(screen.getByText("x-fitness")).toBeTruthy();
    expect(screen.queryByText("Overdue")).toBeNull();
  });

  it("shows a message and keeps the dialog open when the server action throws", async () => {
    const user = userEvent.setup();
    decideHeldPageName.mockRejectedValue(new Error("network"));
    renderWithI18n(<HeldNamesClient rows={[ROW]} />);
    await pickRowAction(user, "x-fitness", "Approve");
    await user.type(await screen.findByLabelText(/Reason/), "Verified as the gym's own name");
    const dialog = await screen.findByRole("dialog");
    await user.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Approve") as HTMLButtonElement);
    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong. Please try again.");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("page name copy", () => {
  const HOLD_CODES = ["generic_word", "place_word", "near_match_name", "near_match_reserved", "near_match_brand"];
  // every pageNames.errors.* key the actions use: the typed decision refusals, the reason validation and the generic fallback
  const ERROR_KEYS = ["reason_required", "not_held", "reserved_name", "name_taken", "generic"];
  const pick = (o: unknown, path: string[]) => path.reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], o);

  it.each(["en", "fr"] as const)("%s has copy for every hold reason and every error key", (lng) => {
    const messages = lng === "en" ? en : fr;
    for (const c of HOLD_CODES) expect(String(pick(messages, ["pageNames", "reasons", c]) ?? "").length, `reasons.${c}`).toBeGreaterThan(0);
    for (const k of ERROR_KEYS) expect(String(pick(messages, ["pageNames", "errors", k]) ?? "").length, `errors.${k}`).toBeGreaterThan(0);
  });

  it("the decision error codes the database raises are all covered", async () => {
    const { PAGE_NAME_DECISION_ERROR_CODES } = await import("@gymos/types");
    for (const c of PAGE_NAME_DECISION_ERROR_CODES) expect(ERROR_KEYS).toContain(c);
  });
});
