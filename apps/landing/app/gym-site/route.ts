import { readConfig } from "@/lib/gym-site/env";
import { reader } from "@/lib/gym-site/db";
import { TENANT_NAME_HEADER, TENANT_PATH_HEADER } from "@/lib/gym-site/names";
import { handleGymSite } from "@/lib/gym-site/handler";

// Story 24.10: the one page route of every gym host. apps/landing/proxy.ts rewrites {name}.gymosapps.com/... here and sets x-tenant-name and
// x-tenant-path; nothing else reaches it with them (the proxy deletes inbound x-tenant-* on every request). Static HTML from a template,
// no client JavaScript, no cookie, headers per AD-44. Node runtime: `pg` needs sockets.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleGymSite(
    {
      tenantName: request.headers.get(TENANT_NAME_HEADER),
      tenantPath: request.headers.get(TENANT_PATH_HEADER),
      acceptLanguage: request.headers.get("accept-language"),
    },
    {
      config: readConfig(),
      readPage: reader.readPage,
      readRedirect: reader.readRedirect,
      log: (event, fields) => console.error(JSON.stringify({ event, ...fields })),
    },
  );
}
