import { describe, expect, it } from "vitest";
import { BAD_FLAWS, badCase, badSubject } from "./bad";
import { DOM_RULE_IDS, runDomRules } from "./rules";
import { templateSubject } from "./subject";

describe("conformance: known-bad fixtures fail exactly their rule", () => {
  it("control: the unflawed Classic output passes every DOM rule for every flaw's fixture and request", () => {
    const base = templateSubject("classic");
    for (const flaw of BAD_FLAWS) {
      const kase = badCase(flaw);
      expect(runDomRules(base, kase, base.render(kase)), `${flaw.id}`).toEqual([]);
    }
  });

  for (const flaw of BAD_FLAWS) {
    it(`${flaw.id} fails ${flaw.rule} and nothing else`, () => {
      const subject = badSubject(flaw);
      const kase = badCase(flaw);
      const violations = runDomRules(subject, kase, subject.render(kase));
      expect([...new Set(violations.map((v) => v.rule))], violations.map((v) => `${v.rule}: ${v.message}`).join("\n")).toEqual([flaw.rule]);
    });
  }

  it("every DOM rule has at least one known-bad fixture", () => {
    const covered = new Set(BAD_FLAWS.map((f) => f.rule));
    expect(DOM_RULE_IDS.filter((r) => !covered.has(r))).toEqual([]);
  });
});
