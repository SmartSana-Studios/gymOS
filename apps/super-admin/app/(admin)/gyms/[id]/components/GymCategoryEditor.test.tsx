import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import { RESOURCES } from "@/lib/i18n/get-server-translation";
import frTranslations from "../../../../../locales/fr.json";
import type { GymDetail } from "@/services/gyms";

const changeGymCategoryMock = vi.fn<
  (gymId: string, input: unknown) => Promise<{ error: { code: string; message: string } | null }>
>(async () => ({ error: null }));

vi.mock("../../actions", () => ({
  changeGymCategory: (gymId: string, input: unknown) => changeGymCategoryMock(gymId, input),
}));

const { GymCategoryEditor } = await import("./GymCategoryEditor");

const GYM = { id: "00000000-0000-4000-8000-000000000001", category: "gym" } as GymDetail;

function renderEditor(lng: "en" | "fr" = "en", onSaved = vi.fn()) {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({
    lng,
    resources: RESOURCES,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <GymCategoryEditor gym={GYM} onSaved={onSaved} />
    </I18nextProvider>,
  );
  return { onSaved };
}

beforeEach(() => {
  changeGymCategoryMock.mockClear();
});

describe("GymCategoryEditor", () => {
  it("shows the current label in the admin's language with a Change button", () => {
    renderEditor("fr");
    expect(screen.getByText("Salle de sport")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: frTranslations.gyms.detail.change }),
    ).toBeInTheDocument();
  });

  it("offers the five categories, saves the chosen code with no confirmation, and announces it", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Change" }));

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "gym",
      "pilates_studio",
      "yoga_studio",
      "fitness_center",
      "other",
    ]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.selectOptions(select, "yoga_studio");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(changeGymCategoryMock).toHaveBeenCalledWith(GYM.id, { category: "yoga_studio" }),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText("Category updated.")).toBeInTheDocument();
  });

  it("shows a refusal inline and stays in edit mode", async () => {
    changeGymCategoryMock.mockResolvedValueOnce({
      error: { code: "unknown", message: "Not allowed" },
    });
    const user = userEvent.setup();
    const { onSaved } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.selectOptions(screen.getByRole("combobox"), "other");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Not allowed")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("Cancel restores the stored value without calling the action", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.selectOptions(screen.getByRole("combobox"), "other");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(changeGymCategoryMock).not.toHaveBeenCalled();
    expect(screen.getByText("Gym")).toBeInTheDocument();
  });
});
