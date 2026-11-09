// Story 24.11 (FR-196, AD-50): /sitemap.xml and /robots.txt of a gym host, as plain strings. Both exist only while the page is visible (the
// handler answers the uniform not-found otherwise); the sitemap lists exactly one URL, the page's own root. No directory, no JSON-LD, no sitemap
// index (Epic 25). The name and the root domain are validated by the caller; they are still escaped here.
import { SECURITY_HEADERS_BASE } from "./headers";
import { schemeFor } from "./renderCore";

/** 5 minutes at the CDN: the sitemap leaves within 15 minutes of an unpublish (EXPERIENCE.md "Availability"). */
export const SEO_CACHE_CONTROL = "public, s-maxage=300";

const xmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

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

export function renderSitemap(name: string, rootDomain: string): SeoParts {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${xmlEscape(pageOrigin(name, rootDomain))}/</loc></url>\n</urlset>\n`;
  return { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8", ...COMMON_HEADERS }, body };
}

export function renderRobots(name: string, rootDomain: string): SeoParts {
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${pageOrigin(name, rootDomain)}/sitemap.xml\n`;
  return { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...COMMON_HEADERS }, body };
}

/** The paths a gym host answers beyond the page itself. Anything else is the uniform not-found. */
export type GymPath = { kind: "sitemap" } | { kind: "robots" } | { kind: "report" };

export function classifyExtraPath(pathname: string): GymPath | null {
  if (pathname === "/sitemap.xml") return { kind: "sitemap" };
  if (pathname === "/robots.txt") return { kind: "robots" };
  if (pathname === "/report") return { kind: "report" };
  return null;
}
