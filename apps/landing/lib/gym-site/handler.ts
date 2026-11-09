// Story 24.10 (AD-43, AD-44, AD-46, AD-48, AD-50): the answer to one request on a gym host, with its dependencies injected so every row of the
// I/O matrix is a test. The proxy has already validated the Host label and set `x-tenant-*`; this re-checks both (a direct request to the route
// carries neither and gets the uniform not-found).
import { classifyHost, isReservedLabel, isValidPageName, parsePageContentV1 } from "@gymos/types";
import { classifyPagePath, renderPageAsync, REDIRECT_CACHE_CONTROL, SECURITY_HEADERS_BASE } from "@gymos/page-templates";
import type { GymSiteConfig } from "./env";
import type { PageRow } from "./db";
import { notFoundResponse, schemeFor } from "./notFound";

export interface GymSiteDeps {
  config: GymSiteConfig;
  readPage(name: string): Promise<PageRow | null>;
  readRedirect(oldName: string): Promise<string | null>;
  /** Logs an event with NO gym data: codes and paths only. */
  log(event: string, fields?: Record<string, unknown>): void;
}

export interface GymSiteRequest {
  tenantName: string | null;
  tenantPath: string | null;
  acceptLanguage: string | null;
}

export async function handleGymSite(req: GymSiteRequest, deps: GymSiteDeps): Promise<Response> {
  const { rootDomain, mediaOrigin } = deps.config;
  const notFound = () => notFoundResponse(rootDomain);
  const name = req.tenantName;
  // defence in depth: the proxy is the only thing that sets these, but a label is re-judged by the same grammar and list
  if (!rootDomain || !name || !isValidPageName(name) || isReservedLabel(name) || classifyHost(`${name}.${rootDomain}`, rootDomain).kind !== "gym") return notFound();
  const path = classifyPagePath(req.tenantPath ?? "");
  if (path.kind === "not-found") return notFound();
  if (!mediaOrigin) {
    deps.log("gym_site_config_missing", { variable: "PUBLIC_SITE_MEDIA_ORIGIN" });
    return notFound();
  }

  let row: PageRow | null;
  try {
    row = await deps.readPage(name);
  } catch (e) {
    deps.log("gym_site_db_error", { code: (e as { code?: string })?.code ?? "unknown" });
    return notFound();
  }

  if (row) {
    const parsed = parsePageContentV1(row);
    if (!parsed.ok) {
      deps.log("gym_site_content_invalid", { issues: parsed.issues.slice(0, 10) });
      return notFound();
    }
    let rendered: Awaited<ReturnType<typeof renderPageAsync>>;
    try {
      rendered = await renderPageAsync({ page: parsed.value, pathname: req.tenantPath!, acceptLanguage: req.acceptLanguage, name, rootDomain, mediaOrigin });
    } catch (e) {
      // the error's name only: a message could carry gym text
      deps.log("gym_site_render_error", { name: e instanceof Error ? e.name : "unknown" });
      return notFound();
    }
    if (!rendered.ok) {
      deps.log("gym_site_not_rendered", { reason: rendered.reason, template: String(parsed.value.template).slice(0, 31) });
      return notFound();
    }
    return new Response(rendered.body, { status: rendered.status, headers: rendered.headers });
  }

  let current: string | null;
  try {
    current = await deps.readRedirect(name);
  } catch (e) {
    deps.log("gym_site_db_error", { code: (e as { code?: string })?.code ?? "unknown" });
    return notFound();
  }
  // one hop, to the root path of the CURRENT name, only for a name that passes the same grammar
  if (current && isValidPageName(current) && !isReservedLabel(current)) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `${schemeFor(rootDomain)}://${current}.${rootDomain}/`,
        "Cache-Control": REDIRECT_CACHE_CONTROL,
        "X-Content-Type-Options": SECURITY_HEADERS_BASE["X-Content-Type-Options"],
        "Strict-Transport-Security": SECURITY_HEADERS_BASE["Strict-Transport-Security"],
      },
    });
  }
  return notFound();
}
