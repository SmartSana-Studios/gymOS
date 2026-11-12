import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const addCity = vi.fn();
const updateCity = vi.fn();
const mapGymToCity = vi.fn();
vi.mock("../actions", () => ({
  addCity: (...a: unknown[]) => addCity(...a),
  updateCity: (...a: unknown[]) => updateCity(...a),
  mapGymToCity: (...a: unknown[]) => mapGymToCity(...a),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { renderWithI18n } from "../../support/components/support-test-utils";
import type { CitiesPageData } from "../actions";
import { CitiesPageClient } from "./CitiesPageClient";
import { parseAliases } from "./CityModal";

const DOUALA = "6a8f4c52-1b0e-4d7a-9a55-0d6f3c8e1a01";
const DAKAR = "6a8f4c52-1b0e-4d7a-9a55-0d6f3c8e1a09";
const GYM = "11111111-1111-4111-8111-111111111111";

const DATA: CitiesPageData = {
  countries: [
    { code: "CM", nameEn: "Cameroon", nameFr: "Cameroun" },
    { code: "SN", nameEn: "Senegal", nameFr: "Sénégal" },
  ],
  cities: [
    { id: DOUALA, countryCode: "CM", name: "Douala", slug: "douala", lat: 4.0511, lng: 9.7679, aliases: ["Duala"], gymCount: 2 },
    { id: DAKAR, countryCode: "SN", name: "Dakar", slug: "dakar", lat: null, lng: null, aliases: [], gymCount: 0 },
  ],
  unmapped: [{ gymId: GYM, gymName: "IRON GYM", country: "CM", legacyCity: "Dwala" }],
};

beforeEach(() => {
  addCity.mockReset();
  updateCity.mockReset();
  mapGymToCity.mockReset();
  refresh.mockReset();
  HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.showModal || function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});

describe("parseAliases", () => {
  it("splits on lines and commas, trims and drops blanks", () => {
    expect(parseAliases(" Duala\n\nDla, Douala City \n")).toEqual(["Duala", "Dla", "Douala City"]);
    expect(parseAliases("")).toEqual([]);
  });
});

describe("the list", () => {
  it("shows each city with its country, slug, gym count, position and extra spellings", () => {
    renderWithI18n(<CitiesPageClient data={DATA} />);
    const list = within(screen.getByTestId("city-list"));
    expect(list.getByText("Douala")).toBeTruthy();
    expect(list.getByText(/Slug: douala · 2 gyms · 4.0511, 9.7679/)).toBeTruthy();
    expect(list.getByText("Also found as: Duala")).toBeTruthy();
    expect(list.getByText(/Slug: dakar · 0 gyms · no map position/)).toBeTruthy();
  });

  it("filters by country and by search text", async () => {
    const user = userEvent.setup();
    renderWithI18n(<CitiesPageClient data={DATA} />);
    await user.selectOptions(screen.getByLabelText("Country"), "SN");
    const list = within(screen.getByTestId("city-list"));
    expect(list.queryByText("Douala")).toBeNull();
    expect(list.getByText("Dakar")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Country"), "");
    await user.type(screen.getByRole("textbox", { name: "Search cities" }), "duala");
    expect(within(screen.getByTestId("city-list")).getByText("Douala")).toBeTruthy();
    expect(within(screen.getByTestId("city-list")).queryByText("Dakar")).toBeNull();
  });

  it("says so when there is no city, and the French copy exists", () => {
    renderWithI18n(<CitiesPageClient data={{ ...DATA, cities: [], unmapped: [] }} />, "fr");
    expect(screen.getByText("Aucune ville pour le moment. Ajoutez la première.")).toBeTruthy();
    expect(screen.getByText("Toutes les salles qui ont un texte de ville ont une ville.")).toBeTruthy();
  });
});

describe("add and edit", () => {
  it("adds a city: the form is parsed (aliases, coordinates) and sent, then the list refreshes", async () => {
    const user = userEvent.setup();
    addCity.mockResolvedValue({ data: { id: DOUALA }, error: null });
    renderWithI18n(<CitiesPageClient data={DATA} />);
    await user.click(screen.getByRole("button", { name: "+ Add city" }));
    const dialog = within(await screen.findByRole("dialog", { hidden: true }));
    await user.selectOptions(dialog.getByLabelText("Country *"), "CM");
    await user.type(dialog.getByLabelText("City name *"), "Mbouda");
    await user.type(dialog.getByLabelText("Other spellings"), "Mboudah\nMbouda City");
    await user.type(dialog.getByLabelText("Latitude"), "5,6");
    await user.type(dialog.getByLabelText("Longitude"), "10.25");
    await user.click(dialog.getByRole("button", { name: "Add city" }));
    await waitFor(() => expect(addCity).toHaveBeenCalledTimes(1));
    expect(addCity).toHaveBeenCalledWith({ country_code: "CM", name: "Mbouda", slug: "", aliases: ["Mboudah", "Mbouda City"], lat: 5.6, lng: 10.25 });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("previews the slug that will be derived from the name", async () => {
    const user = userEvent.setup();
    renderWithI18n(<CitiesPageClient data={DATA} />);
    await user.click(screen.getByRole("button", { name: "+ Add city" }));
    const dialog = within(await screen.findByRole("dialog", { hidden: true }));
    await user.type(dialog.getByLabelText("City name *"), "Ngaoundéré");
    expect(dialog.getByText(/Left blank it will be: ngaoundere/)).toBeTruthy();
  });

  it("a typed refusal lands on its own field and the dialog stays open", async () => {
    const user = userEvent.setup();
    addCity.mockResolvedValue({ data: null, error: { code: "slug_taken", message: "That slug is already used by another city in this country, or was used by one in the last 12 months." } });
    renderWithI18n(<CitiesPageClient data={DATA} />);
    await user.click(screen.getByRole("button", { name: "+ Add city" }));
    const dialog = within(await screen.findByRole("dialog", { hidden: true }));
    await user.selectOptions(dialog.getByLabelText("Country *"), "CM");
    await user.type(dialog.getByLabelText("City name *"), "Douala Two");
    await user.type(dialog.getByLabelText("Slug (web address)"), "douala");
    await user.click(dialog.getByRole("button", { name: "Add city" }));
    const alert = await dialog.findByRole("alert");
    expect(alert.textContent).toMatch(/already used by another city/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("alias_taken is shown under the spellings field", async () => {
    const user = userEvent.setup();
    addCity.mockResolvedValue({ data: null, error: { code: "alias_taken", message: "One of these spellings already reaches another city in this country." } });
    renderWithI18n(<CitiesPageClient data={DATA} />);
    await user.click(screen.getByRole("button", { name: "+ Add city" }));
    const dialog = within(await screen.findByRole("dialog", { hidden: true }));
    await user.selectOptions(dialog.getByLabelText("Country *"), "CM");
    await user.type(dialog.getByLabelText("City name *"), "Dual");
    await user.type(dialog.getByLabelText("Other spellings"), "Douala");
    await user.click(dialog.getByRole("button", { name: "Add city" }));
    expect((await dialog.findByRole("alert")).textContent).toMatch(/already reaches another city/);
  });

  it("a half position and a bad number are refused in the form, before any call", async () => {
    const user = userEvent.setup();
    renderWithI18n(<CitiesPageClient data={DATA} />);
    await user.click(screen.getByRole("button", { name: "+ Add city" }));
    const dialog = within(await screen.findByRole("dialog", { hidden: true }));
    await user.selectOptions(dialog.getByLabelText("Country *"), "CM");
    await user.type(dialog.getByLabelText("City name *"), "Halfway");
    await user.type(dialog.getByLabelText("Latitude"), "4.5");
    await user.click(dialog.getByRole("button", { name: "Add city" }));
    expect((await dialog.findByRole("alert")).textContent).toMatch(/both a latitude/);
    await user.clear(dialog.getByLabelText("Latitude"));
    await user.type(dialog.getByLabelText("Latitude"), "1e1");
    await user.type(dialog.getByLabelText("Longitude"), "4");
    await user.click(dialog.getByRole("button", { name: "Add city" }));
    expect(addCity).not.toHaveBeenCalled();
  });

  it("edits a city: the country is fixed, the form is prefilled, and the whole form is sent with the id", async () => {
    const user = userEvent.setup();
    updateCity.mockResolvedValue({ data: { id: DOUALA }, error: null });
    renderWithI18n(<CitiesPageClient data={DATA} />);
    // the list is ordered by country then name: Douala (CM) first
    await user.click(within(screen.getByTestId("city-list")).getAllByRole("button", { name: "Edit" })[0]);
    const dialog = within(await screen.findByRole("dialog", { hidden: true }));
    expect((dialog.getByLabelText("Country *") as HTMLSelectElement).disabled).toBe(true);
    expect((dialog.getByLabelText("City name *") as HTMLInputElement).value).toBe("Douala");
    expect((dialog.getByLabelText("Slug (web address)") as HTMLInputElement).value).toBe("douala");
    expect((dialog.getByLabelText("Other spellings") as HTMLTextAreaElement).value).toBe("Duala");
    await user.clear(dialog.getByLabelText("City name *"));
    await user.type(dialog.getByLabelText("City name *"), "Douala Ville");
    await user.click(dialog.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateCity).toHaveBeenCalledWith(DOUALA, { country_code: "CM", name: "Douala Ville", slug: "douala", aliases: ["Duala"], lat: 4.0511, lng: 9.7679 }));
  });
});

describe("the Gyms without a city panel", () => {
  it("lists the gym with its country and legacy text, offers only that country's cities, and maps by id", async () => {
    const user = userEvent.setup();
    mapGymToCity.mockResolvedValue({ error: null });
    renderWithI18n(<CitiesPageClient data={DATA} />);
    const panel = within(screen.getByTestId("unmapped-panel"));
    expect(panel.getByText("IRON GYM")).toBeTruthy();
    expect(panel.getByText(/Cameroon · typed: "Dwala"/)).toBeTruthy();
    const select = panel.getByLabelText("City for IRON GYM") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Choose a city", "Douala"]);
    expect((panel.getByRole("button", { name: "Set city" }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(select, DOUALA);
    await user.click(panel.getByRole("button", { name: "Set city" }));
    await waitFor(() => expect(mapGymToCity).toHaveBeenCalledWith({ gymId: GYM, country: "CM", cityId: DOUALA }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows a refusal on the row", async () => {
    const user = userEvent.setup();
    mapGymToCity.mockResolvedValue({ error: { code: "invalid_city", message: "That city does not belong to the gym's country." } });
    renderWithI18n(<CitiesPageClient data={DATA} />);
    const panel = within(screen.getByTestId("unmapped-panel"));
    await user.selectOptions(panel.getByLabelText("City for IRON GYM"), DOUALA);
    await user.click(panel.getByRole("button", { name: "Set city" }));
    expect((await panel.findByRole("alert")).textContent).toMatch(/does not belong/);
    expect(refresh).not.toHaveBeenCalled();
  });
});
