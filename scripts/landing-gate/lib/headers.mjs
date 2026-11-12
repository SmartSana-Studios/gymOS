// The AD-44 header contract as data, and the two pure functions the HTTP check is built from. Nothing here touches the network, so the
// known-bad inputs of __tests__/headers.test.mjs run without a server.
import { createHash } from "node:crypto";

export const SECURITY_BASE = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
};

export const CACHE_CONTROL = {
  page: "public, s-maxage=60",
  notFound: "public, s-maxage=30",
  redirect: "public, max-age=300, s-maxage=300",
};

/** Headers every Node response carries: transport, not policy. */
export const TRANSPORT_HEADERS = new Set(["date", "connection", "keep-alive", "content-length", "transfer-encoding"]);

/**
 * What Next.js adds to a rewritten route by itself (decisions.md 24.10: "Next adds its own `Vary: rsc, ...` line next to ours"). Allowed, never
 * silently: the check prints each one it saw. `vary` tokens are listed below; `x-middleware-rewrite` must carry the internal route and nothing else.
 */
export const NEXT_VARY_TOKENS = new Set(["rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch"]);
export const NEXT_ADDED_HEADERS = { "x-middleware-rewrite": "/gym-site" };

/** What Vercel adds in front of the app (GATE_PLATFORM=vercel). Printed too. */
export const VERCEL_HEADERS = new Set(["server", "x-vercel-id", "x-vercel-cache", "age", "accept-ranges", "x-matched-path"]);

/** Headers a platform or CDN sets per request (an id, a cache state, an age, a timing): they differ between two identical answers by design. */
export const PER_REQUEST_PLATFORM_HEADERS = new Set(["x-vercel-id", "x-vercel-cache", "age", "cf-ray", "cf-cache-status", "server-timing", "x-request-id", "x-amz-cf-id"]);

/** `sha256-<base64>` of the style text exactly as emitted. */
export function styleHash(text) {
  return `sha256-${createHash("sha256").update(text, "utf8").digest("base64")}`;
}

/** The one inline style block of a document, or null when there is not exactly one. */
export function singleStyleBlock(html) {
  const blocks = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)];
  return blocks.length === 1 ? blocks[0][1] : null;
}

/** The exact AD-44 policy (packages/page-templates/src/headers.ts), rebuilt independently from the configured media origin and the body's own style. */
export function expectedCsp(imgSrc, hash) {
  return [
    "default-src 'none'",
    `img-src ${imgSrc}`,
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

const LD_JSON_ATTRS = /^\s*type\s*=\s*"application\/ld\+json"\s*$/i;
const NAMED_ENTITIES = { quot: '"', lt: "<", gt: ">", amp: "&" };
/** One pass, so a decoded character is never decoded again ("&#38;lt;" is "&lt;", not "<"); a numeric entity outside the code-point range is left as written. */
export const decodeEntities = (v) =>
  v.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(quot|lt|gt|amp));/gi, (whole, hex, dec, name) => {
    if (name !== undefined) return NAMED_ENTITIES[name.toLowerCase()];
    const cp = hex !== undefined ? parseInt(hex, 16) : Number(dec);
    return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
  });
const absoluteUrl = (v) => {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname !== "";
  } catch {
    return false;
  }
};

/** The <script> elements of a body: the inert JSON-LD data blocks (their text) and the count of every other <script> (executable, forbidden). */
export function scriptsOf(body) {
  const blocks = [];
  for (const m of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (LD_JSON_ATTRS.test(m[1])) blocks.push(m[2]);
  const all = (body.match(/<script\b/gi) ?? []).length;
  return { blocks, executable: all - blocks.length };
}

/**
 * Story 25.4 (AD-51): the structured data and Open Graph tags of a gym page or a directory page, judged on the body of a real response.
 * Executable script stays forbidden; the ONE script allowed is an application/ld+json block whose text is JSON, holds no literal "<" and carries a
 * schema.org type of ours. expect: "HealthClub" | "ItemList" = exactly one such block; "none" = no block; undefined = at most one of either.
 * The og tags: type, title (equal to the <title>), description and url must be present; a directory page's og:url is its canonical link.
 */
export function checkStructuredData(kind, body, expect) {
  const problems = [];
  const { blocks, executable } = scriptsOf(body);
  if (executable > 0) problems.push(kind + ": the body holds a <script> element");
  const want = expect === "none" ? 0 : expect === undefined ? null : 1;
  if (want !== null && blocks.length !== want) problems.push(kind + ": " + blocks.length + " application/ld+json block(s), expected " + want);
  if (want === null && blocks.length > 1) problems.push(kind + ": " + blocks.length + " application/ld+json blocks, expected at most one");
  for (const text of blocks) {
    if (/[<>&]/.test(text)) problems.push(kind + ": the JSON-LD block holds an unescaped < > or &");
    let node;
    try {
      node = JSON.parse(text);
    } catch {
      problems.push(kind + ": the application/ld+json block is not valid JSON");
      continue;
    }
    const type = node?.["@type"];
    if (node?.["@context"] !== "https://schema.org") problems.push(kind + ": JSON-LD @context is not https://schema.org");
    const typeOk = expect === "HealthClub" || expect === "ItemList" ? type === expect : type === "HealthClub" || type === "ItemList";
    if (!typeOk) problems.push(kind + ": JSON-LD @type is " + JSON.stringify(type) + (expect === "HealthClub" || expect === "ItemList" ? ", expected " + expect : ""));
    if (type === "HealthClub") {
      if (typeof node.name !== "string" || node.name === "") problems.push(kind + ": HealthClub has no name");
      if (!absoluteUrl(node.url)) problems.push(kind + ": HealthClub url is not absolute");
      if (typeof node.address?.addressCountry !== "string") problems.push(kind + ": HealthClub has no address.addressCountry");
    } else if (type === "ItemList") {
      const items = node.itemListElement;
      if (!Array.isArray(items) || items.length === 0) problems.push(kind + ": ItemList has no items");
      else
        items.forEach((item, i) => {
          if (item?.["@type"] !== "ListItem" || !Number.isInteger(item.position) || item.position !== items[0]?.position + i) problems.push(kind + ": ItemList item " + i + " is not a ListItem at the next position");
          if (!absoluteUrl(item?.url)) problems.push(kind + ": ItemList item " + i + " has no absolute url");
        });
    }
  }
  const og = {};
  for (const m of body.matchAll(/<meta property="(og:[a-z:]+)" content="([^"]*)"/g)) og[m[1]] = decodeEntities(m[2]);
  for (const p of ["og:type", "og:title", "og:description", "og:url"]) if (!og[p]) problems.push(kind + ": missing " + p);
  const title = /<title>([\s\S]*?)<\/title>/.exec(body)?.[1];
  if (title === undefined) problems.push(kind + ": no <title>");
  else if (og["og:title"] !== undefined && og["og:title"] !== decodeEntities(title)) problems.push(kind + ": og:title differs from the <title>");
  if (og["og:url"] !== undefined && !absoluteUrl(og["og:url"])) problems.push(kind + ": og:url is not absolute");
  if (kind === "directory") {
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(body)?.[1];
    if (canonical !== undefined && og["og:url"] !== undefined && og["og:url"] !== decodeEntities(canonical)) problems.push("directory: og:url differs from the canonical link");
    if (og["og:image"] !== undefined) problems.push("directory: a listing has no published image, og:image must be absent");
  }
  return problems;
}

/**
 * Story 25.3: what a directory page adds to the page contract. Script-free (no executable <script>, no inline style attribute, no cookie is checked by the caller),
 * and ONE indexability signal: the `noindex` robots meta tag and the X-Robots-Tag header are both present or both absent, and equal what the caller expects.
 * Marks `x-robots-tag` as an expected header so the generic unexpected-header sweep does not flag it.
 */
export function checkDirectoryDocument(h, body, indexable, expected) {
  const problems = [];
  expected.add("x-robots-tag");
  if (/<[a-z][^>]*\sstyle\s*=/i.test(body)) problems.push("directory: the body holds an inline style attribute (the CSP hashes one <style> block only)");
  if (!/<link rel="canonical" href="[^"]+"/.test(body)) problems.push("directory: no canonical link");
  if (!/hrefLang="x-default"|hreflang="x-default"/i.test(body)) problems.push("directory: no hreflang x-default alternate");
  const header = h["x-robots-tag"];
  const metaNoindex = /<meta name="robots" content="noindex"/i.test(body);
  if (header !== undefined && (header.length !== 1 || header[0] !== "noindex")) problems.push(`directory: x-robots-tag is [${header.join(" | ")}], expected [noindex] or absent`);
  if ((header !== undefined) !== metaNoindex) problems.push(`directory: the X-Robots-Tag header (${header === undefined ? "absent" : "noindex"}) and the robots meta tag (${metaNoindex ? "noindex" : "absent"}) disagree`);
  if (indexable === true && (header !== undefined || metaNoindex)) problems.push("directory: expected an indexable page, it carries noindex");
  if (indexable === false && (header === undefined || !metaNoindex)) problems.push("directory: expected noindex in the header and the meta tag");
  return problems;
}

/**
 * Judge one response against the exact header set of its kind.
 * @param {"page"|"notFound"|"redirect"|"directory"} kind  "directory" (Story 25.3) is a directory page on www: the page set, no language Vary, an X-Robots-Tag that must agree with the document, and a script-free body
 * @param {{status:number, headers:Record<string,string[]>, body:Buffer|string}} res  headers as folded by lib/http.mjs
 * @param {{mediaOrigin:string, platform?:string, extraAllowed?:string[], varyLanguage?:boolean, location?:string, indexable?:boolean, structuredData?:"HealthClub"|"ItemList"|"none"}} ctx  `indexable` (directory only): true = no X-Robots-Tag, false = `noindex`, undefined = either, but header and meta tag must agree; `structuredData` (page, directory): the one JSON-LD block expected ("none" = no block; undefined = a gym page is a HealthClub, a directory page has at most one)
 * @returns {{problems:string[], nextAdded:string[], platformExtras:string[]}}
 */
export function checkResponse(kind, res, ctx) {
  const problems = [];
  const nextAdded = [];
  const platformExtras = [];
  const h = res.headers;
  const one = (name) => (h[name] && h[name].length === 1 ? h[name][0] : undefined);
  const want = (name, value) => {
    if (h[name] === undefined) problems.push(`${kind}: missing header ${name}`);
    else if (h[name].length !== 1 || h[name][0] !== value) problems.push(`${kind}: ${name} is [${h[name].join(" | ")}], expected [${value}]`);
  };
  const body = typeof res.body === "string" ? res.body : res.body.toString("utf8");

  const expectedStatus = { page: 200, directory: 200, notFound: 404, redirect: 301 }[kind];
  if (res.status !== expectedStatus) problems.push(`${kind}: status ${res.status}, expected ${expectedStatus}`);

  const expected = new Set();
  const expect_ = (name, value) => { expected.add(name); want(name, value); };

  if (kind === "page" || kind === "notFound" || kind === "directory") {
    expect_("content-type", "text/html; charset=utf-8");
    expect_("cache-control", kind === "notFound" ? CACHE_CONTROL.notFound : CACHE_CONTROL.page);
    for (const [k, v] of Object.entries(SECURITY_BASE)) expect_(k, v);
    const style = singleStyleBlock(body);
    if (style === null) problems.push(`${kind}: the body does not hold exactly one <style> block`);
    else expect_("content-security-policy", expectedCsp(kind === "notFound" ? "'none'" : ctx.mediaOrigin, styleHash(style)));
    if (kind === "directory") problems.push(...checkDirectoryDocument(h, body, ctx.indexable, expected));
    // Story 25.4: no executable script, and the one inert JSON-LD block plus the og tags on a gym page and a directory page (a gym page is a HealthClub unless the caller says otherwise)
    if (kind === "page" || kind === "directory") problems.push(...checkStructuredData(kind, body, ctx.structuredData ?? (kind === "page" ? "HealthClub" : undefined)));
  } else {
    expect_("cache-control", CACHE_CONTROL.redirect);
    expect_("x-content-type-options", SECURITY_BASE["x-content-type-options"]);
    expect_("strict-transport-security", SECURITY_BASE["strict-transport-security"]);
    if (ctx.location !== undefined) expect_("location", ctx.location);
    else expected.add("location");
    if (h["location"] === undefined) problems.push("redirect: missing header location");
    if (body.length !== 0) problems.push(`redirect: body is ${body.length} bytes, expected none`);
  }

  // Vary: our own token only on a page that has two complete languages; the rest must be Next's known tokens.
  const varyTokens = (h["vary"] ?? []).flatMap((v) => v.split(",")).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const wantLanguage = kind === "page" && ctx.varyLanguage !== false;
  if (wantLanguage && !varyTokens.includes("accept-language")) problems.push("page: Vary lacks Accept-Language");
  if (!wantLanguage && varyTokens.includes("accept-language")) problems.push(`${kind}: Vary carries Accept-Language`);
  for (const t of varyTokens) {
    if (t === "accept-language") continue;
    if (NEXT_VARY_TOKENS.has(t)) nextAdded.push(`vary: ${t}`);
    else problems.push(`${kind}: unexpected Vary token [${t}]`);
  }
  expected.add("vary");

  if (h["set-cookie"] !== undefined) problems.push(`${kind}: sets a cookie (${h["set-cookie"].length})`);

  const allowedExtra = new Set(ctx.extraAllowed ?? []);
  for (const name of Object.keys(h)) {
    if (expected.has(name) || TRANSPORT_HEADERS.has(name) || name === "set-cookie") continue;
    if (kind === "directory" && name in NEXT_ADDED_HEADERS) {
      problems.push(`directory: unexpected header ${name}: ${(h[name] ?? []).join(" | ")} (a directory page is served by its own route, never rewritten)`);
    } else if (name in NEXT_ADDED_HEADERS) {
      if (one(name) !== NEXT_ADDED_HEADERS[name]) problems.push(`${kind}: ${name} is [${(h[name] ?? []).join(" | ")}], Next adds [${NEXT_ADDED_HEADERS[name]}]`);
      else nextAdded.push(`${name}: ${NEXT_ADDED_HEADERS[name]}`);
    } else if ((ctx.platform === "vercel" && VERCEL_HEADERS.has(name)) || allowedExtra.has(name)) {
      platformExtras.push(`${name}: ${h[name].join(" | ")}`);
    } else {
      problems.push(`${kind}: unexpected header ${name}: ${h[name].join(" | ")}`);
    }
  }
  return { problems, nextAdded: [...new Set(nextAdded)], platformExtras };
}

/**
 * Two responses are identical when status, every header except Date, and the body bytes are equal. Returns the differences (empty = identical).
 * With `platform` other than `none` the per-request platform headers (PER_REQUEST_PLATFORM_HEADERS) are ignored too; any OTHER difference still fails.
 */
export function diffResponses(a, b, { platform = "none" } = {}) {
  const diffs = [];
  if (a.status !== b.status) diffs.push(`status ${a.status} vs ${b.status}`);
  const names = new Set([...Object.keys(a.headers), ...Object.keys(b.headers)]);
  names.delete("date");
  if (platform !== "none") for (const n of PER_REQUEST_PLATFORM_HEADERS) names.delete(n);
  for (const n of [...names].sort()) {
    const x = (a.headers[n] ?? []).join(" | ");
    const y = (b.headers[n] ?? []).join(" | ");
    if (x !== y) diffs.push(`header ${n}: [${a.headers[n] === undefined ? "absent" : x}] vs [${b.headers[n] === undefined ? "absent" : y}]`);
  }
  if (!Buffer.from(a.body).equals(Buffer.from(b.body))) diffs.push(`body differs (${a.body.length} vs ${b.body.length} bytes)`);
  return diffs;
}
