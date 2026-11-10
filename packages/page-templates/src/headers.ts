// Story 24.10 (AD-44): the header policy of a public page, in one place. The CSP string is asserted EXACTLY (conformance suite and
// landing tests): a story that needs script, an external style or another origin must amend AD-44, not this file quietly.
import { createHash } from "node:crypto";

export const SECURITY_HEADERS_BASE = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
} as const;

/** `sha256-<base64>` of the style text exactly as emitted (UTF-8). */
export function styleHash(styleText: string): string {
  return `sha256-${createHash("sha256").update(styleText, "utf8").digest("base64")}`;
}

/** The exact AD-44 policy for a page whose one inline style block hashes to `hash` and whose images come from `mediaOrigin`. */
export function contentSecurityPolicy(mediaOrigin: string, hash: string): string {
  return [
    "default-src 'none'",
    `img-src ${mediaOrigin}`,
    `style-src '${hash}'`,
    "font-src 'self'",
    "connect-src 'none'",
    "script-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const PAGE_CACHE_CONTROL = "public, s-maxage=60";
export const NOT_FOUND_CACHE_CONTROL = "public, s-maxage=30";
export const REDIRECT_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

/** The one `<style>` block of a document (its exact text), or an error when there is not exactly one. */
export function extractStyleBlock(html: string): { ok: true; text: string } | { ok: false; count: number } {
  const blocks = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)];
  if (blocks.length !== 1) return { ok: false, count: blocks.length };
  return { ok: true, text: blocks[0]![1]! };
}
