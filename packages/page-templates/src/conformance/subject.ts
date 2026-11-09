// Story 24.10: what the conformance suite renders. A Subject turns a case (fixture + request) into a response. A registered template is a
// Subject through the real pipeline (renderPage); the known-bad subjects are the Classic pipeline output with ONE flaw applied.
import { renderPage, type RenderPageInput } from "../renderPage";
import type { Fixture, RequestCase } from "./fixtures";

export interface Rendered {
  status: number;
  headers: Record<string, string>;
  html: string;
}

export interface Case {
  fixture: Fixture;
  request: RequestCase;
}

export interface Subject {
  id: string;
  /** The template id whose chrome dictionaries and fonts the rules compare against. */
  templateId: string;
  render(kase: Case): Rendered;
}

export const TEST_CONFIG = {
  name: "grace",
  rootDomain: "gymosapps.com",
  mediaOrigin: "https://media.example.com",
} as const;

export const MEDIA_BASE = `${TEST_CONFIG.mediaOrigin}/storage/v1/object/public/gym-page-media`;
export const PAGE_ORIGIN = `https://${TEST_CONFIG.name}.${TEST_CONFIG.rootDomain}`;
export const WWW_ORIGIN = `https://www.${TEST_CONFIG.rootDomain}`;

export function inputFor(kase: Case, templateId?: string): RenderPageInput {
  return {
    page: templateId ? { ...kase.fixture.page, template: templateId } : kase.fixture.page,
    pathname: kase.request.pathname,
    acceptLanguage: kase.request.acceptLanguage,
    ...TEST_CONFIG,
  };
}

/** A registered template, through the real render pipeline. */
export function templateSubject(templateId: string): Subject {
  return {
    id: templateId,
    templateId,
    render(kase) {
      const r = renderPage(inputFor(kase, templateId));
      if (!r.ok) throw new Error(`${templateId} did not render ${kase.fixture.id} / ${kase.request.id}: ${r.reason}`);
      return { status: r.status, headers: r.headers, html: r.body };
    },
  };
}
