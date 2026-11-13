// Story 25.5: the two sitemap documents as strings. Every value is escaped for XML (a place or gym name never reaches a sitemap today, but a URL is built from
// stored slugs and the escaping is the one thing standing between a hostile value and the document). No lastmod, changefreq or priority.
import { xmlEscape } from "@gymos/page-templates";
import type { SitemapEntry } from "./entries";

const PROLOG = '<?xml version="1.0" encoding="UTF-8"?>\n';

export function renderUrlset(entries: readonly SitemapEntry[]): string {
  const lines = entries.map((e) => {
    const link = (hreflang: string, href: string) => `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${xmlEscape(href)}"/>`;
    return `  <url><loc>${xmlEscape(e.loc)}</loc>${link("en", e.alternates.en)}${link("fr", e.alternates.fr)}${link("x-default", e.alternates.xDefault)}</url>`;
  });
  return `${PROLOG}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${lines.map((l) => `${l}\n`).join("")}</urlset>\n`;
}

/** The index of `count` files: `{www}/sitemaps/1.xml` ... `{www}/sitemaps/{count}.xml`. */
export function renderSitemapIndex(www: string, count: number): string {
  const lines = Array.from({ length: count }, (_, i) => `  <sitemap><loc>${xmlEscape(`${www}/sitemaps/${i + 1}.xml`)}</loc></sitemap>\n`);
  return `${PROLOG}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("")}</sitemapindex>\n`;
}
