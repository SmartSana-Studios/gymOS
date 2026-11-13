import { readConfig } from "@/lib/gym-site/env";
import { reader } from "@/lib/gym-site/db";
import { notFoundResponse } from "@/lib/gym-site/notFound";
import { handleDirectory, type DirectoryDeps } from "@/lib/directory/handler";

// Story 25.3 (AD-44, AD-50): the directory pages of the main site, `/{en|fr}/gyms`, `/{cc}` and `/{cc}/{city}`. A Route Handler, not an App Router page:
// pages ship Next's client scripts, and these are script-free strings with the AD-44 header set. Node runtime (`pg` needs sockets). The served and
// canonical form has no trailing slash (Next redirects the slashed one). Gym hosts never reach this route: the proxy rewrites every gym-host path.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps(): DirectoryDeps {
  return { config: readConfig(), reader, log: (event, fields) => console.error(JSON.stringify({ event, ...fields })) };
}

export async function GET(request: Request, context: { params: Promise<{ locale: string; path?: string[] }> }): Promise<Response> {
  const { locale, path } = await context.params;
  return handleDirectory({ locale, segments: path ?? [], query: new URL(request.url).searchParams }, deps());
}

// Every other method is the uniform not-found (HEAD is answered from GET by Next).
const other = (): Response => notFoundResponse(readConfig().rootDomain);
export { other as POST, other as PUT, other as PATCH, other as DELETE, other as OPTIONS };
