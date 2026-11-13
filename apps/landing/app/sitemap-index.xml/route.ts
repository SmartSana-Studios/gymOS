import { readConfig } from "@/lib/gym-site/env";
import { reader } from "@/lib/gym-site/db";
import { notFoundResponse } from "@/lib/gym-site/notFound";
import { handleCrawl, type CrawlDeps } from "@/lib/crawl/handler";

// Story 25.5 (AD-50, AD-52): /sitemap-index.xml of the main site. A Route Handler, dynamic (never Next's cached sitemap.ts): the answer is the database's, and the CDN caches it for 5 minutes
// through the response's own Cache-Control. Node runtime (`pg` needs sockets). Gym hosts never reach this route: the proxy rewrites every gym-host path.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps(): CrawlDeps {
  return { config: readConfig(), reader, log: (event, fields) => console.error(JSON.stringify({ event, ...fields })) };
}

export async function GET(): Promise<Response> {
  return handleCrawl({ kind: "index" }, deps());
}

// Every other method is the uniform not-found (HEAD is answered from GET by Next).
const other = (): Response => notFoundResponse(readConfig().rootDomain);
export { other as POST, other as PUT, other as PATCH, other as DELETE, other as OPTIONS };
