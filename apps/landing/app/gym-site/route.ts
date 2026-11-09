import { readConfig } from "@/lib/gym-site/env";
import { reader } from "@/lib/gym-site/db";
import { TENANT_NAME_HEADER, TENANT_PATH_HEADER } from "@/lib/gym-site/names";
import { handleGymSite, type GymSiteDeps } from "@/lib/gym-site/handler";
import { clientAddress, readFormBody } from "@/lib/gym-site/formBody";
import { notFoundResponse } from "@/lib/gym-site/notFound";

// Story 24.10: the one page route of every gym host. apps/landing/proxy.ts rewrites {name}.gymosapps.com/... here and sets x-tenant-name and
// x-tenant-path; nothing else reaches it with them (the proxy deletes inbound x-tenant-* on every request). Static HTML from a template,
// no client JavaScript, no cookie, headers per AD-44. Node runtime: `pg` needs sockets.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps(): GymSiteDeps {
  return {
    config: readConfig(),
    readPage: reader.readPage,
    readRedirect: reader.readRedirect,
    submitReport: reader.submitReport,
    log: (event, fields) => console.error(JSON.stringify({ event, ...fields })),
  };
}

export async function GET(request: Request): Promise<Response> {
  return handleGymSite(
    {
      method: "GET",
      tenantName: request.headers.get(TENANT_NAME_HEADER),
      tenantPath: request.headers.get(TENANT_PATH_HEADER),
      acceptLanguage: request.headers.get("accept-language"),
    },
    deps(),
  );
}

// Story 24.11: the one POST of a gym host is the report form (/report). The handler answers the uniform not-found for any other path, and the body is
// read only for that path (so a POST to a page never buffers anything).
export async function POST(request: Request): Promise<Response> {
  const tenantPath = request.headers.get(TENANT_PATH_HEADER);
  return handleGymSite(
    {
      method: "POST",
      tenantName: request.headers.get(TENANT_NAME_HEADER),
      tenantPath,
      acceptLanguage: request.headers.get("accept-language"),
      clientAddress: clientAddress(request.headers),
      readForm: () => readFormBody(request),
    },
    deps(),
  );
}

// Every other method is the same uniform not-found (HEAD is answered from GET by Next).
const other = (): Response => notFoundResponse(readConfig().rootDomain);
export { other as PUT, other as PATCH, other as DELETE, other as OPTIONS };
