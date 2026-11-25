import { describe, expect, it } from "vitest";

import { isTargetCountry, SUB_SAHARAN_AFRICA_COUNTRY_CODES } from "./subSaharanAfrica";

describe("Sub-Saharan Africa target countries", () => {
  it("has 49 unique upper-case ISO codes", () => {
    expect(SUB_SAHARAN_AFRICA_COUNTRY_CODES).toHaveLength(49);
    expect(new Set(SUB_SAHARAN_AFRICA_COUNTRY_CODES).size).toBe(49);
    for (const code of SUB_SAHARAN_AFRICA_COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it("includes the home market and the neighbours the owner named, and leaves out North Africa and the rest of the world", () => {
    for (const code of ["CM", "NG", "SN", "CI", "CD", "KE", "ZA", "SD", "MR"]) expect(isTargetCountry(code)).toBe(true);
    for (const code of ["DZ", "EG", "LY", "MA", "TN", "EH", "FR", "US", "RE", "YT"]) expect(isTargetCountry(code)).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(isTargetCountry("cm")).toBe(true);
  });
});
