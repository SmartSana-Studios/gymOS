// Story 25.3 (AD-44, AD-49, AD-50): the answer to one request for a directory page, with its dependencies injected so every row of the I/O matrix is a
// test. Routes (apps/landing/app/[locale]/gyms/[[...path]]/route.ts): /{en|fr}/gyms, /{en|fr}/gyms/{cc}, /{en|fr}/gyms/{cc}/{city}[?category=&page=].
//
// Reads only public_site.directory_country, directory_city and directory_gym (through reader.ts / readerSql.ts). Every outcome that is not a 200 is the
// uniform not-found (gym-site/notFound.ts): unknown country or city, bad locale, missing configuration, a database error, a page past the last.
//
// `S`: the 25.2 country view counts by the snapshot's country, the city views by the live city, so they can differ inside the AD-46 refresh window.
// The country page and the top page therefore count the gyms of the city rows they list (S); the country page is `noindex` while S differs from the
// country view's own count (no second copy of the threshold), and a country with S = 0 is neither listed nor served.
import { GYM_CATEGORY_LABELS, PAGE_MEDIA_KEY_PATTERN, isValidPageName } from "@gymos/types";
import { CHROME, DEFAULT_MEDIA_PATH, extractStyleBlock } from "@gymos/page-templates";
import type { ReactNode } from "react";
import type { GymSiteConfig } from "@/lib/gym-site/env";
import { notFoundResponse, schemeFor } from "@/lib/gym-site/notFound";
import { isLocale, otherLocale, type Locale } from "@/lib/i18n";
import { DIRECTORY_COPY } from "./copy";
import { directoryHeaders } from "./headers";
import { DirectoryPage, type CardView, type Crumb, type DirectoryBody, type DirectoryDocument, type PageLinkView, type PillView, type RowView } from "./markup";
import { DIRECTORY_PAGE_SIZE, type CountryRow, type DirectoryReader, type GymRow } from "./types";

export interface DirectoryDeps {
  config: GymSiteConfig;
  reader: DirectoryReader;
  /** Logs an event with NO gym data: codes and paths only. */
  log(event: string, fields?: Record<string, unknown>): void;
  /** Markup renderer. Default: react-dom/server's, imported lazily (a static import is refused in a Next route handler's server layer). */
  renderToStaticMarkup?: (node: ReactNode) => string | Promise<string>;
}

export interface DirectoryRequest {
  /** The `[locale]` segment as received. */
  locale: string;
  /** The segments after `gyms`: [] (top), [cc] (country) or [cc, city]. */
  segments: string[];
  /** The query string. */
  query: URLSearchParams;
}

/** The country whose card goes first on the top page. A plain ordering rule: nothing else on the page names or treats it differently. */
const FIRST_COUNTRY = "cm";

const COUNTRY_SEGMENT = /^[a-z]{2}$/;
const CITY_SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PAGE_PARAM = /^[1-9][0-9]{0,5}$/;

const gymCategories = (code: string): code is keyof typeof GYM_CATEGORY_LABELS => Object.hasOwn(GYM_CATEGORY_LABELS, code);

/** The query a page keeps in its canonical, language link and pager. */
interface ViewQuery {
  category: string | null;
  page: number;
}

/** `?category=x&page=n`, or "" for the unfiltered first page. */
function queryString(q: { category?: string | null; page?: number }): string {
  const parts: string[] = [];
  if (q.category) parts.push(`category=${encodeURIComponent(q.category)}`);
  if (q.page && q.page > 1) parts.push(`page=${q.page}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** The category filter of a request: one `category` parameter holding a known code, else none (unknown or repeated values are ignored). */
export function parseCategory(query: URLSearchParams): string | null {
  const all = query.getAll("category");
  return all.length === 1 && gymCategories(all[0]!) ? all[0]! : null;
}

/** The page of a request: a positive integer, else 1. */
export function parsePage(query: URLSearchParams): number {
  const v = query.get("page");
  return v !== null && PAGE_PARAM.test(v) ? Number(v) : 1;
}

export async function handleDirectory(req: DirectoryRequest, deps: DirectoryDeps): Promise<Response> {
  const { rootDomain, mediaOrigin } = deps.config;
  const notFound = () => notFoundResponse(rootDomain);
  if (!rootDomain) return notFound();
  if (!mediaOrigin) {
    deps.log("directory_config_missing", { variable: "PUBLIC_SITE_MEDIA_ORIGIN" });
    return notFound();
  }
  if (!isLocale(req.locale)) return notFound();
  const locale: Locale = req.locale;
  const { segments } = req;
  if (segments.length > 2) return notFound();
  const cc = segments[0];
  const citySlug = segments[1];
  if (cc !== undefined && !COUNTRY_SEGMENT.test(cc)) return notFound();
  if (citySlug !== undefined && (citySlug.length > 60 || !CITY_SEGMENT.test(citySlug))) return notFound();

  let built: { doc: DirectoryDocument } | null;
  try {
    const ctx: Context = { locale, rootDomain, mediaOrigin, www: `${schemeFor(rootDomain)}://www.${rootDomain}`, reader: deps.reader };
    if (cc === undefined) built = await topPage(ctx);
    else if (citySlug === undefined) built = await countryPage(ctx, cc);
    else built = await cityPage(ctx, cc, citySlug, req.query);
  } catch (e) {
    // the error's code only: a message could carry data
    deps.log("directory_db_error", { code: (e as { code?: string })?.code ?? "unknown" });
    return notFound();
  }
  if (!built) return notFound();

  let html: string;
  try {
    const render = deps.renderToStaticMarkup ?? (await import("react-dom/server")).renderToStaticMarkup;
    html = `<!doctype html>${await render(DirectoryPage({ doc: built.doc }))}`;
  } catch (e) {
    deps.log("directory_render_error", { name: e instanceof Error ? e.name : "unknown" });
    return notFound();
  }
  // the ONE flag of the page feeds the meta tag (rendered above from `doc.indexable`) and the X-Robots-Tag header
  const style = extractStyleBlock(html);
  if (!style.ok) {
    // the CSP hashes exactly one <style> block: a document with another count would be served under a policy that blocks its own styles
    deps.log("directory_style_block", { count: style.count });
    return notFound();
  }
  return new Response(html, { status: 200, headers: directoryHeaders({ mediaOrigin, styleText: style.text, indexable: built.doc.indexable }) });
}

interface Context {
  locale: Locale;
  rootDomain: string;
  mediaOrigin: string;
  /** `https://www.{rootDomain}` (`http` for localhost): never the request Host. */
  www: string;
  reader: DirectoryReader;
}

const directoryPath = (locale: Locale, ...rest: string[]): string => `/${[locale, "gyms", ...rest].join("/")}`;

/** The fields every page shares, from its locale-free path (`rest`) and the query kept in its canonical. */
function frame(ctx: Context, rest: string[], canonicalQuery: string, languageQuery: string) {
  const other = otherLocale(ctx.locale);
  const url = (l: Locale) => `${ctx.www}${directoryPath(l, ...rest)}${canonicalQuery}`;
  return {
    locale: ctx.locale,
    canonical: url(ctx.locale),
    alternates: { en: url("en"), fr: url("fr"), xDefault: url("en") },
    languageHref: `${directoryPath(other, ...rest)}${languageQuery}`,
    homeHref: `/${ctx.locale}`,
    gymsHref: directoryPath(ctx.locale),
  };
}

const collator = (locale: Locale) => new Intl.Collator(locale);
const countryName = (c: CountryRow, locale: Locale) => (locale === "fr" ? c.nameFr : c.nameEn);

/** The gyms the city rows of each country list (`S`). */
async function listedByCountry(ctx: Context): Promise<Map<string, number>> {
  const totals = await ctx.reader.readCityTotals();
  return new Map(totals.map((t) => [t.countryCode, t.listedCount]));
}

async function topPage(ctx: Context): Promise<{ doc: DirectoryDocument }> {
  const copy = DIRECTORY_COPY[ctx.locale];
  const [countries, listed] = await Promise.all([ctx.reader.readCountries(), listedByCountry(ctx)]);
  const withS = countries.map((c) => ({ c, s: listed.get(c.countryCode) ?? 0 })).filter((x) => x.s > 0);
  const byName = collator(ctx.locale);
  withS.sort((a, b) => {
    const af = a.c.countryCode.toLowerCase() === FIRST_COUNTRY ? 0 : 1;
    const bf = b.c.countryCode.toLowerCase() === FIRST_COUNTRY ? 0 : 1;
    return af - bf || byName.compare(countryName(a.c, ctx.locale), countryName(b.c, ctx.locale)) || a.c.countryCode.localeCompare(b.c.countryCode);
  });
  const cards: CardView[] = withS.map(({ c, s }) => ({
    name: countryName(c, ctx.locale),
    href: directoryPath(ctx.locale, c.countryCode.toLowerCase()),
    count: copy.gymCount(s),
  }));
  const gyms = withS.reduce((n, x) => n + x.s, 0);
  const body: DirectoryBody = {
    kind: "top",
    cards,
    lede: copy.top.lede,
    count: cards.length ? copy.top.countSentence(gyms, cards.length) : null,
    empty: cards.length ? null : copy.top.empty,
  };
  return {
    doc: {
      ...frame(ctx, [], "", ""),
      title: `${copy.top.titleLead} ${copy.top.titleAccent} | ${copy.siteName}`,
      description: copy.top.metaDescription,
      indexable: true, // the top page is never thin
      crumbs: [{ label: copy.gyms, href: null }],
      heading: { lead: copy.top.titleLead, accent: copy.top.titleAccent },
      body,
    },
  };
}

async function countryPage(ctx: Context, cc: string): Promise<{ doc: DirectoryDocument } | null> {
  const copy = DIRECTORY_COPY[ctx.locale];
  const code = cc.toUpperCase();
  const [country, cities] = await Promise.all([ctx.reader.readCountry(code), ctx.reader.readCities(code)]);
  const s = cities.reduce((n, c) => n + c.publishedCount, 0);
  if (!country || s === 0) return null;
  const name = countryName(country, ctx.locale);
  const byName = collator(ctx.locale);
  const sorted = [...cities].sort((a, b) => byName.compare(a.cityName, b.cityName) || a.citySlug.localeCompare(b.citySlug));
  const cards: CardView[] = sorted.map((c) => ({ name: c.cityName, href: directoryPath(ctx.locale, cc, c.citySlug), count: copy.gymCount(c.publishedCount) }));
  return {
    doc: {
      ...frame(ctx, [cc], "", ""),
      title: `${copy.country.titleLead} ${name} | ${copy.siteName}`,
      description: copy.country.metaDescription(name),
      // the flag of the country view AND the rows agreeing with it: while they disagree (refresh window) the page is not offered to crawlers
      indexable: country.indexable && s === country.publishedCount,
      crumbs: [
        { label: copy.gyms, href: directoryPath(ctx.locale) },
        { label: name, href: null },
      ],
      heading: { lead: copy.country.titleLead, accent: name },
      body: { kind: "country", cards, count: copy.country.countSentence(s, cards.length) },
    },
  };
}

function gymRowView(ctx: Context, g: GymRow): RowView | null {
  if (!isValidPageName(g.pageName)) return null;
  const label = g.category && gymCategories(g.category) ? CHROME[ctx.locale].categories[g.category] : null;
  return {
    name: g.name,
    href: `${schemeFor(ctx.rootDomain)}://${g.pageName}.${ctx.rootDomain}/`,
    logoSrc: g.logoKey && PAGE_MEDIA_KEY_PATTERN.test(g.logoKey) ? `${ctx.mediaOrigin}${DEFAULT_MEDIA_PATH}/${g.logoKey}` : null,
    categoryLabel: label ?? null,
    city: g.cityName,
  };
}

async function cityPage(ctx: Context, cc: string, citySlug: string, query: URLSearchParams): Promise<{ doc: DirectoryDocument } | null> {
  const copy = DIRECTORY_COPY[ctx.locale];
  const code = cc.toUpperCase();
  const category = parseCategory(query);
  const page = parsePage(query);
  const [country, city, present, gyms] = await Promise.all([
    ctx.reader.readCountry(code),
    ctx.reader.readCity(code, citySlug),
    ctx.reader.readCategories(code, citySlug),
    ctx.reader.readGyms(code, citySlug, category, page),
  ]);
  if (!country || !city) return null;
  // a page past the last is not-found; page 1 of an empty list is the stale-filter case (or the views disagreeing for an instant)
  if (gyms.rows.length === 0 && page > 1) return null;

  const name = countryName(country, ctx.locale);
  const cityPath = directoryPath(ctx.locale, cc, citySlug);
  const view: ViewQuery = { category, page };
  const labels = CHROME[ctx.locale].categories;
  const byName = collator(ctx.locale);

  const codes = [...new Set(present)].filter(gymCategories).sort((a, b) => byName.compare(labels[a], labels[b]));
  const pills: PillView[] = codes.length
    ? [
        { label: copy.all, href: cityPath, current: category === null },
        ...codes.map((c) => ({ label: labels[c], href: `${cityPath}${queryString({ category: c })}`, current: c === category })),
      ]
    : [];

  const rows = gyms.rows.map((g) => gymRowView(ctx, g)).filter((r): r is RowView => r !== null);
  const pageCount = Math.ceil(gyms.total / DIRECTORY_PAGE_SIZE);
  const pager: PageLinkView[] | null =
    gyms.total > DIRECTORY_PAGE_SIZE
      ? Array.from({ length: pageCount }, (_, i) => ({ n: i + 1, href: `${cityPath}${queryString({ category, page: i + 1 })}`, current: i + 1 === page }))
      : null;

  const stale =
    rows.length === 0 && category !== null
      ? {
          message: copy.city.noneInCategory(labels[category as keyof typeof labels], city.cityName),
          showAllLabel: copy.city.showAll(city.cityName),
          showAllHref: cityPath,
        }
      : null;

  // The canonical of a filtered view is the unfiltered listing without `page`; page 2 and up are self-canonical.
  const canonicalQuery = category ? "" : queryString({ page });
  const crumbs: Crumb[] = [
    { label: copy.gyms, href: directoryPath(ctx.locale) },
    { label: name, href: directoryPath(ctx.locale, cc) },
    { label: city.cityName, href: null },
  ];
  return {
    doc: {
      ...frame(ctx, [cc, citySlug], canonicalQuery, queryString(view)),
      title: `${copy.city.titleLead} ${city.cityName} | ${copy.siteName}`,
      description: copy.city.metaDescription(city.cityName, name),
      // AD-50: a filtered view is never `noindex`; its canonical (the unfiltered listing) carries the flag
      indexable: category !== null ? true : city.indexable,
      crumbs,
      heading: { lead: copy.city.titleLead, accent: city.cityName },
      body: {
        kind: "city",
        // a filtered view counts the gyms it lists (all pages), the unfiltered one the city's own count
        count: copy.city.countSentence(category !== null ? gyms.total : city.publishedCount, city.cityName),
        pills,
        rows,
        pager,
        stale,
        empty: rows.length === 0 && stale === null ? copy.city.empty : null,
      },
    },
  };
}

