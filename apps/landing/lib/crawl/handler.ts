// Story 25.5 (AD-50, AD-52): the answer to one request for a crawler file of the main site, with its dependencies injected so every row of the I/O matrix is
// a test. Routes (apps/landing/app/robots.txt, sitemap-index.xml, sitemaps/[file], llms.txt): /robots.txt, /sitemap-index.xml, /sitemaps/{n}.xml, /llms.txt.
//
// Reads only the directory views and `public_site.pages` (through readerSql.ts). Every outcome that is not a 200 is the uniform not-found (gym-site/notFound.ts):
// a missing configuration, a database error, a chunk that does not exist, any method but GET. Logged with codes only. Gym hosts never reach this: the proxy
// rewrites every gym-host path, and the gym handler answers the uniform not-found for these paths.
import { seoHeaders } from "@gymos/page-templates";
import type { GymSiteConfig } from "@/lib/gym-site/env";
import { notFoundResponse, schemeFor } from "@/lib/gym-site/notFound";
import type { CrawlReader } from "@/lib/directory/types";
import { SITEMAP_CHUNK_SIZE, buildEntries, chunkCount, chunkOf } from "./entries";
import { LLMS_MAX_GYMS, renderLlms } from "./llms";
import { renderSitemapIndex, renderUrlset } from "./xml";

export interface CrawlDeps {
  config: GymSiteConfig;
  reader: CrawlReader;
  /** Logs an event with NO gym data: codes and paths only. */
  log(event: string, fields?: Record<string, unknown>): void;
  /** Entries per sitemap file. Default `SITEMAP_CHUNK_SIZE`; tests lower it. */
  chunkSize?: number;
  /** Gyms in `/llms.txt`. Default `LLMS_MAX_GYMS`; tests lower it. */
  llmsCap?: number;
}

export type CrawlRequest =
  | { method?: string; kind: "robots" | "index" | "llms" }
  /** `file` is the `[file]` segment as received, e.g. `3.xml`. */
  | { method?: string; kind: "chunk"; file: string };

const CHUNK_FILE = /^[1-9][0-9]*\.xml$/;

const XML = "application/xml; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";
const ok = (body: string, contentType: string): Response => new Response(body, { status: 200, headers: seoHeaders(contentType) });

export async function handleCrawl(req: CrawlRequest, deps: CrawlDeps): Promise<Response> {
  const { rootDomain, mediaOrigin } = deps.config;
  const notFound = () => notFoundResponse(rootDomain);
  if ((req.method ?? "GET") !== "GET") return notFound();
  if (!rootDomain) return notFound();
  const www = `${schemeFor(rootDomain)}://www.${rootDomain}`;

  if (req.kind === "robots") return ok(`User-agent: *\nAllow: /\n\nSitemap: ${www}/sitemap-index.xml\n`, TEXT);

  // The directory pages answer the uniform not-found without a media origin; a sitemap or summary listing them would advertise pages nobody can see.
  if (!mediaOrigin) {
    deps.log("crawl_config_missing", { variable: "PUBLIC_SITE_MEDIA_ORIGIN" });
    return notFound();
  }
  const size = deps.chunkSize ?? SITEMAP_CHUNK_SIZE;

  let chunk: number | undefined;
  if (req.kind === "chunk") {
    // the grammar first: nothing malformed reaches the database
    if (!CHUNK_FILE.test(req.file)) return notFound();
    chunk = Number(req.file.slice(0, -".xml".length));
    if (!Number.isSafeInteger(chunk)) return notFound();
  }

  try {
    if (req.kind === "llms") {
      const cap = deps.llmsCap ?? LLMS_MAX_GYMS;
      const rows = await deps.reader.readLlmsPages(cap + 1);
      return ok(renderLlms({ rows, rootDomain, cap, log: deps.log }), TEXT);
    }
    const [countries, totals, cities] = await Promise.all([deps.reader.readCountries(), deps.reader.readCityTotals(), deps.reader.readIndexableCities()]);
    const entries = buildEntries(www, { countries, totals, cities });
    const count = chunkCount(entries.length, size);
    if (req.kind === "index") return ok(renderSitemapIndex(www, count), XML);
    if (chunk === undefined || chunk > count) return notFound();
    return ok(renderUrlset(chunkOf(entries, chunk, size)), XML);
  } catch (e) {
    // the error's code only: a message could carry data. No partial body: nothing was written before this point.
    deps.log("crawl_db_error", { code: (e as { code?: string })?.code ?? "unknown" });
    return notFound();
  }
}
