import { readConfig } from "@/lib/gym-site/env";
import { reader } from "@/lib/gym-site/db";
import { notFoundResponse } from "@/lib/gym-site/notFound";
import { handleCrawl, type CrawlDeps } from "@/lib/crawl/handler";

// Story 25.5 (AD-50, AD-52): /sitemaps/{n}.xml of the main site, one chunk of at most 50,000 entries. A Route Handler, dynamic (never Next's cached
// sitemap.ts). `file` is the segment as received; the handler accepts only `^[1-9][0-9]*\.xml$` within 1..N and answers the uniform not-found otherwise.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps(): CrawlDeps {
  return { config: readConfig(), reader, log: (event, fields) => console.error(JSON.stringify({ event, ...fields })) };
}

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await context.params;
  return handleCrawl({ kind: "chunk", file }, deps());
}

// Every other method is the uniform not-found (HEAD is answered from GET by Next).
const other = (): Response => notFoundResponse(readConfig().rootDomain);
export { other as POST, other as PUT, other as PATCH, other as DELETE, other as OPTIONS };
