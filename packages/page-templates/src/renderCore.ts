// Story 24.10 (AD-44, AD-48): the render pipeline, with the markup renderer INJECTED (renderPage.ts binds react-dom/server statically for tests
// and scripts; renderPageAsync.ts loads it lazily for Next's server layer, which refuses a static import of it). Content already parsed with PageContentV1 -> a complete response (status, the exact header
// set, the HTML). Pure: the request is an argument, no I/O. The landing Route Handler wraps it with the database read and the uniform not-found.
import type { ReactNode } from "react";
import type { PageContentLanguage, PageContentV1 } from "@gymos/types";
import { computeGymColors } from "./colors";
import type { RenderEnv, TemplateEntry } from "./contract";
import { PAGE_CACHE_CONTROL, SECURITY_HEADERS_BASE, contentSecurityPolicy, extractStyleBlock, styleHash } from "./headers";
import { classifyPagePath, decideLanguage, type PagePath } from "./language";
import { getTemplate } from "./registry";
import { gymHeadExtras, injectHead } from "./structuredData";

export interface RenderPageInput {
  page: PageContentV1;
  /** The request path on the gym host: `/` or `/{code}`. */
  pathname: string;
  acceptLanguage: string | null | undefined;
  /** The validated page name (first Host label). */
  name: string;
  /** Root domain from configuration, with a port in development (e.g. `gymosapps.com`, `localhost:3002`). */
  rootDomain: string;
  /** The media origin (`https://xyz.example`), without a path. */
  mediaOrigin: string;
  /** Path under the media origin where derivative keys live. Default: Supabase Storage's public bucket path (AD-47). */
  mediaPath?: string;
  /** Template lookup. Default: the registry. A test passes its own to prove a swap with a second fixture template. */
  lookup?: (id: string) => TemplateEntry | undefined;
}

export type RenderPageResult =
  | { ok: true; status: 200; headers: Record<string, string>; body: string; language: PageContentLanguage; styleHash: string }
  | { ok: false; reason: "path" | "no_language" | "unknown_template" | "style_block" | "head" };

export const DEFAULT_MEDIA_PATH = "/storage/v1/object/public/gym-page-media";

export function schemeFor(rootDomain: string): "http" | "https" {
  return /^localhost(:\d+)?$/i.test(rootDomain) ? "http" : "https";
}

export type MarkupRenderer = (node: ReactNode) => string;

export function renderPageWith(renderToStaticMarkup: MarkupRenderer, input: RenderPageInput): RenderPageResult {
  const path: PagePath = classifyPagePath(input.pathname);
  if (path.kind === "not-found") return { ok: false, reason: "path" };
  const entry = (input.lookup ?? getTemplate)(input.page.template);
  if (!entry) return { ok: false, reason: "unknown_template" };
  const decision = decideLanguage(input.page.content, path, input.acceptLanguage);
  if (!decision) return { ok: false, reason: "no_language" };

  const scheme = schemeFor(input.rootDomain);
  const root = input.rootDomain.toLowerCase();
  const env: RenderEnv = {
    origin: `${scheme}://${input.name}.${root}`,
    wwwOrigin: `${scheme}://www.${root}`,
    mediaBase: `${input.mediaOrigin}${input.mediaPath ?? DEFAULT_MEDIA_PATH}`,
    colors: computeGymColors(input.page.content.color),
    languageOrder: decision.order,
    alternates: decision.alternates,
    languageLinks: decision.languageLinks,
  };

  const rendered = `<!doctype html>${renderToStaticMarkup(entry.render(input.page, decision.shown, env))}`;
  // Story 25.4 (AD-51): the Open Graph tags and the one JSON-LD block are spliced in as strings after rendering, for every template, so no template can skip or drift them
  let html: string;
  try {
    html = injectHead(rendered, gymHeadExtras(input.page, decision.shown, env));
  } catch {
    return { ok: false, reason: "head" };
  }
  const style = extractStyleBlock(html);
  if (!style.ok) return { ok: false, reason: "style_block" };
  const hash = styleHash(style.text);

  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": PAGE_CACHE_CONTROL,
    "Content-Security-Policy": contentSecurityPolicy(input.mediaOrigin, hash),
    ...SECURITY_HEADERS_BASE,
  };
  if (decision.vary) headers["Vary"] = "Accept-Language";
  return { ok: true, status: 200, headers, body: html, language: decision.shown, styleHash: hash };
}
