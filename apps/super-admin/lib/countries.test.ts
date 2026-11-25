import { describe, expect, it } from "vitest";

import { isSupportedCountry, listCountries } from "./countries";

describe("Super Admin country list (owner decision 2026-11-25: Sub-Saharan Africa only)", () => {
  it("offers the 49 target countries, sorted by name, in either language", () => {
    const en = listCountries("en");
    expect(en).toHaveLength(49);
    expect(en.map((c) => c.name)).toEqual([...en.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
    expect(en.find((c) => c.code === "CM")).toMatchObject({ name: "Cameroon", callingCode: "+237" });
    expect(listCountries("fr").find((c) => c.code === "CI")?.name).toBe("Côte d’Ivoire");
  });

  it("leaves out North Africa and the rest of the world", () => {
    const codes = listCountries("en").map((c) => c.code);
    for (const code of ["DZ", "EG", "LY", "MA", "TN", "FR", "US", "GB"]) expect(codes).not.toContain(code);
  });

  it("still accepts any ISO code when validating a stored gym country", () => {
    expect(isSupportedCountry("FR")).toBe(true);
    expect(isSupportedCountry("CM")).toBe(true);
    expect(isSupportedCountry("XX")).toBe(false);
  });
});
