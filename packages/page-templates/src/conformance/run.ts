// Story 24.10: the conformance run. Every registered template is rendered against every fixture and request below and judged by the DOM rules
// (rules.ts) and the Chromium layout rules (layout.ts). The registry offers only templates for which this returns no violation.
import { PAGE_CONTENT_LANGUAGES } from "@gymos/types";
import { fixtures, languageFixtures, STANDARD_REQUESTS, type Fixture, type RequestCase } from "./fixtures";
import { runDomRules, type DomRuleId, type Violation } from "./rules";
import type { Case, Subject } from "./subject";

export interface NamedViolation extends Violation {
  fixture: string;
  request: string;
}

/** Requests for a language fixture: the default address with each language preferred, and each explicit /{code}. */
export function languageRequests(): RequestCase[] {
  return [
    ...PAGE_CONTENT_LANGUAGES.map((l) => ({ id: `home-${l}`, pathname: "/", acceptLanguage: l })),
    { id: "home-no-header", pathname: "/" },
    ...PAGE_CONTENT_LANGUAGES.map((l) => ({ id: `code-${l}`, pathname: `/${l}`, acceptLanguage: PAGE_CONTENT_LANGUAGES.find((o) => o !== l) ?? l })),
  ];
}

/** Every case the suite renders. */
export function allCases(): Case[] {
  const cases: Case[] = [];
  for (const fixture of fixtures()) for (const request of STANDARD_REQUESTS) cases.push({ fixture, request });
  for (const lf of languageFixtures()) {
    const fixture: Fixture = { id: lf.id, page: lf.page };
    for (const request of languageRequests()) cases.push({ fixture, request });
  }
  return cases;
}

export function runDomConformance(subject: Subject, cases: Case[] = allCases(), only?: readonly DomRuleId[]): NamedViolation[] {
  const out: NamedViolation[] = [];
  for (const kase of cases) {
    const rendered = subject.render(kase);
    for (const v of runDomRules(subject, kase, rendered, only)) out.push({ ...v, fixture: kase.fixture.id, request: kase.request.id });
  }
  return out;
}
