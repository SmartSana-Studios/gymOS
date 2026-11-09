import type { Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BAD_LAYOUT_FLAWS, badCase, badSubject } from "./bad";
import { LAYOUT_RULE_IDS, launchBrowser, runLayoutRules } from "./layout";
import { templateSubject } from "./subject";

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

describe("conformance (Chromium): known-bad layout fixtures fail exactly their rule", () => {
  it("control: the unflawed output passes", async () => {
    const kase = badCase(BAD_LAYOUT_FLAWS[0]!);
    const base = templateSubject("classic");
    expect(await runLayoutRules(browser, base.render(kase), kase)).toEqual([]);
  });

  for (const flaw of BAD_LAYOUT_FLAWS) {
    it(`${flaw.id} fails ${flaw.rule}`, async () => {
      const kase = badCase(flaw);
      const violations = await runLayoutRules(browser, badSubject(flaw).render(kase), kase);
      const rules = [...new Set(violations.map((v) => v.rule))];
      if (flaw.rule === "csp-browser") expect(rules).toContain("csp-browser"); // an unstyled page may break other rules too
      else expect(rules, violations.map((v) => `${v.rule}: ${v.message}`).join("\n")).toEqual([flaw.rule]);
    });
  }

  it("every layout rule has a known-bad fixture", () => {
    const covered = new Set(BAD_LAYOUT_FLAWS.map((f) => f.rule));
    expect(LAYOUT_RULE_IDS.filter((r) => !covered.has(r))).toEqual([]);
  });
});
