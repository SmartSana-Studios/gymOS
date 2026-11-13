// Story 24.11 (FR-196, AD-50): /sitemap.xml and /robots.txt of a gym host, as plain strings. Both exist only while the page is visible (the
// handler answers the uniform not-found otherwise); the sitemap lists exactly one URL, the page's own root. No directory, no JSON-LD, no sitemap
// index (Epic 25). The name and the root domain are validated by the caller; they are still escaped here.
import { SECURITY_HEADERS_BASE } from "./headers";
import { schemeFor } from "./renderCore";

/** 5 minutes at the CDN: the sitemap leaves within 15 minutes of an unpublish (EXPERIENCE.md "Availability"). */
export const SEO_CACHE_CONTROL = "public, s-maxage=300";

export const xmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function pageOrigin(name: string, rootDomain: string): string {
  const root = rootDomain.toLowerCase();
  return `${schemeFor(root)}://${name}.${root}`;
}

export interface SeoParts {
  status: 200;
  headers: Record<string, string>;
  body: string;
}

const COMMON_HEADERS = {
  "Cache-Control": SEO_CACHE_CONTROL,
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  ...SECURITY_HEADERS_BASE,
} as const;

/**
 * Story 25.5: the header set of every crawler response (a gym host's /sitemap.xml and /robots.txt, the main site's /robots.txt, /sitemap-index.xml,
 * /sitemaps/{n}.xml and /llms.txt): the content type, a 5 minute CDN cache, a CSP that allows nothing, the base security headers, no cookie.
 * ONE function, so the two hosts cannot drift.
 */
export function seoHeaders(contentType: string): Record<string, string> {
  return { "Content-Type": contentType, ...COMMON_HEADERS };
}

export function renderSitemap(name: string, rootDomain: string): SeoParts {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${xmlEscape(pageOrigin(name, rootDomain))}/</loc></url>\n</urlset>\n`;
  return { status: 200, headers: seoHeaders("application/xml; charset=utf-8"), body };
}

export function renderRobots(name: string, rootDomain: string): SeoParts {
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${pageOrigin(name, rootDomain)}/sitemap.xml\n`;
  return { status: 200, headers: seoHeaders("text/plain; charset=utf-8"), body };
}

/** The paths a gym host answers beyond the page itself. Anything else is the uniform not-found. */
export type GymPath = { kind: "sitemap" } | { kind: "robots" } | { kind: "report" };

export function classifyExtraPath(pathname: string): GymPath | null {
  if (pathname === "/sitemap.xml") return { kind: "sitemap" };
  if (pathname === "/robots.txt") return { kind: "robots" };
  if (pathname === "/report") return { kind: "report" };
  return null;
}
