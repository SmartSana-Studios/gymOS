// Story 25.3 (AD-44, AD-50): the header set of a directory page, from ONE function. Every 200 response takes its headers from `directoryHeaders`
// (handler.ts); every other outcome is `notFoundResponse` (gym-site/notFound.ts, its own single header source). A test enumerates the outcomes and asserts both.
import { PAGE_CACHE_CONTROL, SECURITY_HEADERS_BASE, contentSecurityPolicy, styleHash } from "@gymos/page-templates/src/headers";

export interface DirectoryHeaderInput {
  /** The media origin the logos come from (`img-src`). */
  mediaOrigin: string;
  /** The exact text of the document's one `<style>` block. */
  styleText: string;
  /** The one flag of the page: false adds `X-Robots-Tag: noindex` (the same boolean the `<meta name="robots">` is rendered from). */
  indexable: boolean;
}

export function directoryHeaders(input: DirectoryHeaderInput): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": PAGE_CACHE_CONTROL,
    "Content-Security-Policy": contentSecurityPolicy(input.mediaOrigin, styleHash(input.styleText)),
    ...SECURITY_HEADERS_BASE,
  };
  if (!input.indexable) headers["X-Robots-Tag"] = "noindex";
  return headers;
}

