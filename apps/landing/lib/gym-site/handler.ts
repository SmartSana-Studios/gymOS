// Story 24.10 (AD-43, AD-44, AD-46, AD-48, AD-50): the answer to one request on a gym host, with its dependencies injected so every row of the
// I/O matrix is a test. The proxy has already validated the Host label and set `x-tenant-*`; this re-checks both (a direct request to the route
// carries neither and gets the uniform not-found).
//
// Story 24.11 adds /sitemap.xml, /robots.txt and /report (GET and POST). Each answers only while the page is visible (the existing `readPage`
// is the judge; no new view): otherwise the byte-identical uniform not-found, with no redirect. The report POST is answered in the same response.
import { createHmac } from "node:crypto";
import { classifyHost, completePageLanguages, isReservedLabel, isValidPageName, parsePageContentV1, type PageContentV1 } from "@gymos/types";
import {
  chooseReportLanguage,
  classifyExtraPath,
  classifyPagePath,
  getTemplate,
  parseReportForm,
  renderReportPage,
  renderPageAsync,
  renderRobots,
  renderSitemap,
  REDIRECT_CACHE_CONTROL,
  SECURITY_HEADERS_BASE,
  type ReportView,
  type SeoParts,
} from "@gymos/page-templates";
import type { GymSiteConfig } from "./env";
import type { PageRow, ReportSubmission } from "./db";
import type { FormBody } from "./formBody";
import { notFoundResponse, schemeFor } from "./notFound";
import type { PageReportResult } from "@gymos/types";

export interface GymSiteDeps {
  config: GymSiteConfig;
  readPage(name: string): Promise<PageRow | null>;
  readRedirect(oldName: string): Promise<string | null>;
  /** Story 24.11: stores a visitor's report through `public_site.submit_page_report` (its own read-write transaction). */
  submitReport(report: ReportSubmission): Promise<PageReportResult>;
  /** Logs an event with NO gym data: codes and paths only. */
  log(event: string, fields?: Record<string, unknown>): void;
}

export interface GymSiteRequest {
  method?: "GET" | "POST";
  tenantName: string | null;
  tenantPath: string | null;
  acceptLanguage: string | null;
  /** POST /report only. Used for the keyed source hash and never stored or logged. */
  clientAddress?: string | null;
  /** POST /report only: the url-encoded body, read lazily so a POST to any other path buffers nothing. */
  readForm?: () => Promise<FormBody>;
}

const seoResponse = (p: SeoParts): Response => new Response(p.body, { status: p.status, headers: p.headers });

/** HMAC-SHA256(key, address) as hex. The address is never stored; with a missing address every such visitor shares one source. */
export function sourceHash(key: string, address: string | null | undefined): string {
  return createHmac("sha256", key).update(address || "unknown", "utf8").digest("hex");
}

export async function handleGymSite(req: GymSiteRequest, deps: GymSiteDeps): Promise<Response> {
  const { rootDomain, mediaOrigin } = deps.config;
  const notFound = () => notFoundResponse(rootDomain);
  const method = req.method ?? "GET";
  const name = req.tenantName;
  // defence in depth: the proxy is the only thing that sets these, but a label is re-judged by the same grammar and list
  if (!rootDomain || !name || !isValidPageName(name) || isReservedLabel(name) || classifyHost(`${name}.${rootDomain}`, rootDomain).kind !== "gym") return notFound();

  const extra = classifyExtraPath(req.tenantPath ?? "");
  // A POST is only ever the report form; every other (method, path) pair that is not a GET of the page is the uniform not-found.
  if (method === "POST" && extra?.kind !== "report") return notFound();
  if (extra) return handleExtra(extra.kind, name, rootDomain, req, deps, notFound);

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

/**
 * The page that stands behind /sitemap.xml, /robots.txt and /report: the same row the page itself would be rendered from, judged the same way (valid
 * content, a registered template, at least one complete language). `null` is "answer the uniform not-found". An old name is never redirected from these paths.
 */
async function visiblePage(name: string, deps: GymSiteDeps): Promise<PageContentV1 | null> {
  let row: PageRow | null;
  try {
    row = await deps.readPage(name);
  } catch (e) {
    deps.log("gym_site_db_error", { code: (e as { code?: string })?.code ?? "unknown" });
    return null;
  }
  if (!row) return null;
  const parsed = parsePageContentV1(row);
  if (!parsed.ok) {
    deps.log("gym_site_content_invalid", { issues: parsed.issues.slice(0, 10) });
    return null;
  }
  if (!getTemplate(parsed.value.template) || completePageLanguages(parsed.value.content).length === 0) return null;
  return parsed.value;
}

async function handleExtra(
  kind: "sitemap" | "robots" | "report",
  name: string,
  rootDomain: string,
  req: GymSiteRequest,
  deps: GymSiteDeps,
  notFound: () => Response,
): Promise<Response> {
  if (kind === "report" && !deps.config.reportKey) {
    // a missing key means no reports: the form is not offered and nothing is stored
    deps.log("gym_site_config_missing", { variable: "PUBLIC_SITE_REPORT_KEY" });
    return notFound();
  }
  // the page itself answers the uniform not-found without a media origin; a sitemap or a report form for it would advertise a page nobody can see
  if (!deps.config.mediaOrigin) {
    deps.log("gym_site_config_missing", { variable: "PUBLIC_SITE_MEDIA_ORIGIN" });
    return notFound();
  }
  const page = await visiblePage(name, deps);
  if (!page) return notFound();

  if (kind === "sitemap") return seoResponse(renderSitemap(name, rootDomain));
  if (kind === "robots") return seoResponse(renderRobots(name, rootDomain));

  const language = chooseReportLanguage(req.acceptLanguage, page.content.default_language);
  const send = (view: ReportView, method: "GET" | "POST") => {
    const p = renderReportPage({ name, rootDomain, language, view, method });
    return new Response(p.body, { status: p.status, headers: p.headers });
  };
  if ((req.method ?? "GET") === "GET") return send({ kind: "form" }, "GET");

  const form = req.readForm ? await req.readForm() : ({ kind: "bad" } as const);
  if (form.kind === "bad") return send({ kind: "form", errors: ["failed"] }, "POST");
  const parsed = parseReportForm(form.params);
  // the hidden field is filled: a bot gets the confirmation and nothing is stored
  if (parsed.kind === "honeypot") return send({ kind: "thanks" }, "POST");
  if (parsed.kind === "invalid") return send({ kind: "form", reason: parsed.reason, details: parsed.details, errors: parsed.errors }, "POST");

  let result: PageReportResult;
  try {
    result = await deps.submitReport({
      name,
      reason: parsed.reason,
      details: parsed.details,
      sourceHash: sourceHash(deps.config.reportKey!, req.clientAddress),
    });
  } catch (e) {
    deps.log("gym_site_db_error", { code: (e as { code?: string })?.code ?? "unknown" });
    return send({ kind: "form", reason: parsed.reason, details: parsed.details, errors: ["failed"] }, "POST");
  }
  if (result === "ok") return send({ kind: "thanks" }, "POST");
  if (result === "rate_limited") return send({ kind: "rate_limited" }, "POST");
  if (result === "not_found") return notFound();
  // `invalid` after our own validation passed means the database judged it differently: say so without guessing
  return send({ kind: "form", reason: parsed.reason, details: parsed.details, errors: ["failed"] }, "POST");
}
