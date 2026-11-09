import type { Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtures, STANDARD_REQUESTS } from "./fixtures";
import { REGISTERED_TEMPLATES } from "../registry";
import { launchBrowser, runLayoutRules } from "./layout";
import { allCases } from "./run";
import { templateSubject } from "./subject";

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

// Every REGISTERED template runs the layout stage: a template added to the registry is judged without touching this file.
for (const templateId of REGISTERED_TEMPLATES) describe(`conformance (Chromium): ${templateId} layout at 360, 768, 1280 and 1366`, () => {
  const subject = templateSubject(templateId);

  for (const fixture of fixtures()) {
    it(`${templateId} fixture ${fixture.id}: no horizontal scroll, no overlap, contact first, 44 px targets, AA contrast, source order`, async () => {
      const violations = [];
      for (const request of STANDARD_REQUESTS) {
        const kase = { fixture, request };
        const out = subject.render(kase);
        violations.push(...(await runLayoutRules(browser, out, kase)).map((v) => ({ ...v, request: request.id })));
      }
      expect(violations.slice(0, 12), `${violations.length} violations`).toEqual([]);
    });
  }

  it("language fixtures (a) to (d) lay out too", async () => {
    const violations = [];
    for (const kase of allCases().filter((c) => !fixtures().some((f) => f.id === c.fixture.id))) {
      const out = subject.render(kase);
      violations.push(...(await runLayoutRules(browser, out, kase, [{ width: 360, height: 640, rules: ["no-overflow", "contact-first-screen", "tap-target", "contrast", "csp-browser"] }])).map((v) => ({ ...v, fixture: kase.fixture.id, request: kase.request.id })));
    }
    expect(violations.slice(0, 12), `${violations.length} violations`).toEqual([]);
  });
});
