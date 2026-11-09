// Story 24.10 (PS-02, FR-207): the ONE not-found response. Every cause that is not a visible page answers with these exact bytes and headers:
// bad grammar, reserved, unknown, unpublished, taken down, suspended, released name, any other path, a content check failure, an unknown
// template, a database error. Language-agnostic markup (each block carries its own lang), no cause, no gym name. Plain string, no React: the
// proxy answers with it for names that never reach the database.
import { NOT_FOUND_CACHE_CONTROL, SECURITY_HEADERS_BASE, contentSecurityPolicy, styleHash } from "@gymos/page-templates/src/headers";

const CSS = [
  "*,*::before,*::after{box-sizing:border-box}",
  "body{margin:0;background:#F3F4F0;color:#1B2A41;font:16px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;overflow-wrap:anywhere}",
  "main{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px 16px;text-align:center}",
  "p{margin:0;max-width:34em}",
  ".msg{font-size:22px;line-height:28px;font-weight:700}",
  ".links{display:flex;flex-wrap:wrap;gap:0 24px;justify-content:center}",
  "a{display:inline-flex;align-items:center;min-height:44px;color:#1B2A41;font-weight:600;text-decoration:underline}",
  "a:focus-visible{outline:3px solid #1B2A41;outline-offset:2px}",
].join("\n");

export function schemeFor(rootDomain: string): "http" | "https" {
  return /^localhost(:\d+)?$/i.test(rootDomain) ? "http" : "https";
}

export function notFoundBody(rootDomain: string): string {
  const www = `${schemeFor(rootDomain)}://www.${rootDomain}`;
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GymOS</title>` +
    `<style>${CSS}</style></head><body><main>` +
    `<p class="msg" lang="en">This page isn't available.</p>` +
    `<p class="msg" lang="fr">Cette page n'est pas disponible.</p>` +
    `<p class="links"><a lang="en" href="${www}/en/gyms/">Browse gyms on GymOS</a><a lang="fr" href="${www}/fr/gyms/">Parcourir les salles sur GymOS</a></p>` +
    `</main></body></html>`
  );
}

/** The response, as plain data: status, headers, body. */
export function notFoundParts(rootDomain: string): { status: 404; headers: Record<string, string>; body: string } {
  const body = notFoundBody(rootDomain);
  const hash = styleHash(CSS);
  return {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": NOT_FOUND_CACHE_CONTROL,
      "Content-Security-Policy": contentSecurityPolicy("'none'", hash),
      ...SECURITY_HEADERS_BASE,
    },
    body,
  };
}

export function notFoundResponse(rootDomain: string | undefined): Response {
  const p = notFoundParts(rootDomain ?? "gymosapps.com");
  return new Response(p.body, { status: p.status, headers: p.headers });
}
