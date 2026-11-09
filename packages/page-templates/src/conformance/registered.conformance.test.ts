import { describe, expect, it } from "vitest";
import { REGISTERED_TEMPLATES } from "../registry";
import { allCases, runDomConformance } from "./run";
import { templateSubject } from "./subject";

// Every REGISTERED template runs the whole suite: a template added to the registry is judged without touching this file.
describe("conformance: every registered template against every fixture, DOM rules", () => {
  it("runs a meaningful number of cases", () => {
    expect(allCases().length).toBeGreaterThan(60);
    expect(REGISTERED_TEMPLATES.length).toBeGreaterThan(0);
  });
  for (const id of REGISTERED_TEMPLATES) {
    it(`${id}: renders every case with no violation`, () => {
      const violations = runDomConformance(templateSubject(id));
      expect(violations.slice(0, 20), `${violations.length} violations`).toEqual([]);
    });
  }
});
