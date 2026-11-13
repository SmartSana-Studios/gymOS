// Story 24.12: the AD-44 header check is shown failing. Unit level (checkResponse / diffResponses on doctored responses) and end to end:
// check-http.mjs run as a process against a small doctored HTTP server, one doctoring per run.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CACHE_CONTROL, CRAWLER_CSP, SECURITY_BASE, checkListedPage, checkLlms, checkResponse, checkRobots, checkSitemapIndex, checkStructuredData, checkUrlset, decodeEntities, diffResponses, expectedCsp, locsOf, scriptsOf, singleStyleBlock, styleHash } from "../lib/headers.mjs";

const MEDIA = "http://127.0.0.1:3911";
const STYLE = "body{margin:0}";
const HEALTH_CLUB = { "@context": "https://schema.org", "@type": "HealthClub", name: "GATE FIT", url: "http://gate-grace.localhost/", address: { "@type": "PostalAddress", addressCountry: "CM" } };
const ITEM_LIST = { "@context": "https://schema.org", "@type": "ItemList", itemListElement: [{ "@type": "ListItem", position: 1, url: "http://gate-grace.localhost/", name: "GATE FIT" }, { "@type": "ListItem", position: 2, url: "http://other.localhost/", name: "OTHER" }] };
const ld = (node) => `<script type="application/ld+json">${JSON.stringify(node).replace(/[<>&]/g, (c) => "\\u00" + c.charCodeAt(0).toString(16).padStart(2, "0"))}</script>`;
const og = (title = "GATE FIT", url = "http://gate-grace.localhost/") => `<meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="d"><meta property="og:url" content="${url}">`;
const html = (extra = "", { block = ld(HEALTH_CLUB), tags = og() } = {}) => `<!doctype html><html lang="en"><head><title>GATE FIT</title><style>${STYLE}</style>${tags}${block}</head><body>GATE FIT${extra}</body></html>`;

function pageHeaders(over = {}) {
  const h = {
    "content-type": ["text/html; charset=utf-8"],
    "cache-control": [CACHE_CONTROL.page],
    "x-content-type-options": [SECURITY_BASE["x-content-type-options"]],
    "referrer-policy": [SECURITY_BASE["referrer-policy"]],
    "strict-transport-security": [SECURITY_BASE["strict-transport-security"]],
    "content-security-policy": [expectedCsp(MEDIA, styleHash(STYLE))],
    vary: ["rsc, next-router-state-tree, Accept-Language"],
    "x-middleware-rewrite": ["/gym-site"],
    date: ["now"],
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete h[k];
    else h[k] = [].concat(v);
  }
  return h;
}
const page = (over, body = html()) => ({ status: 200, headers: pageHeaders(over), body: Buffer.from(body) });
const problems = (res, kind = "page", ctx = {}) => checkResponse(kind, res, { mediaOrigin: MEDIA, ...ctx }).problems;

test("a correct page passes and the Next-added headers are reported, not failed", () => {
  const r = checkResponse("page", page(), { mediaOrigin: MEDIA });
  assert.deepEqual(r.problems, []);
  assert.ok(r.nextAdded.includes("x-middleware-rewrite: /gym-site"));
  assert.ok(r.nextAdded.includes("vary: rsc"));
});
test("known bad: every AD-44 header, dropped or altered, fails and names the header", () => {
  for (const name of ["x-content-type-options", "referrer-policy", "strict-transport-security", "content-security-policy", "cache-control", "content-type"]) {
    assert.ok(problems(page({ [name]: null })).some((p) => p.includes(`missing header ${name}`)), `dropping ${name}`);
    assert.ok(problems(page({ [name]: "x" })).some((p) => p.includes(name)), `altering ${name}`);
  }
});
test("known bad: a one-token change to the CSP fails", () => {
  const csp = expectedCsp(MEDIA, styleHash(STYLE)).replace("script-src 'none'", "script-src 'self'");
  assert.ok(problems(page({ "content-security-policy": csp })).some((p) => p.includes("content-security-policy")));
  const wrongHash = expectedCsp(MEDIA, styleHash("other{}"));
  assert.ok(problems(page({ "content-security-policy": wrongHash })).some((p) => p.includes("content-security-policy")));
});
test("known bad: a cookie, an unexpected header, a second inline style, a wrong status, a stray Vary token", () => {
  assert.ok(problems(page({ "set-cookie": "a=b" })).some((p) => p.includes("sets a cookie")));
  assert.ok(problems(page({ "x-powered-by": "Next.js" })).some((p) => p.includes("unexpected header x-powered-by")));
  assert.ok(problems(page({}, html("<style>a{}</style>"))).some((p) => p.includes("exactly one <style>")));
  assert.ok(problems({ ...page(), status: 500 }).some((p) => p.includes("status 500")));
  assert.ok(problems(page({ vary: "rsc, Cookie, Accept-Language" })).some((p) => p.includes("unexpected Vary token [cookie]")));
  assert.ok(problems(page({ vary: "rsc" })).some((p) => p.includes("Vary lacks Accept-Language")));
  assert.ok(problems(page({ "x-middleware-rewrite": "/elsewhere" })).some((p) => p.includes("x-middleware-rewrite")));
});
test("a platform header is allowed only when the platform is named, and then it is listed", () => {
  const withVercel = page({ server: "Vercel", "x-vercel-id": "fra1::abc" });
  assert.ok(problems(withVercel).some((p) => p.includes("unexpected header server")));
  const r = checkResponse("page", withVercel, { mediaOrigin: MEDIA, platform: "vercel" });
  assert.deepEqual(r.problems, []);
  assert.equal(r.platformExtras.length, 2);
  assert.deepEqual(checkResponse("page", page({ "x-edge": "1" }), { mediaOrigin: MEDIA, extraAllowed: ["x-edge"] }).problems, []);
});
test("the not-found and redirect kinds have their own exact sets", () => {
  const nf = (over = {}, body = html()) => {
    const h = pageHeaders({ "cache-control": CACHE_CONTROL.notFound, vary: "rsc, next-router-state-tree", "content-security-policy": expectedCsp("'none'", styleHash(STYLE)), ...over });
    return { status: 404, headers: h, body: Buffer.from(body) };
  };
  assert.deepEqual(problems(nf(), "notFound"), []);
  assert.ok(problems(nf({ vary: "rsc, Accept-Language" }), "notFound").some((p) => p.includes("Vary carries Accept-Language")));
  assert.ok(problems(nf({ "content-security-policy": expectedCsp(MEDIA, styleHash(STYLE)) }), "notFound").some((p) => p.includes("content-security-policy")));
  const redirect = (over = {}, body = "") => ({
    status: 301,
    headers: { location: ["http://fit.localhost/"], "cache-control": [CACHE_CONTROL.redirect], "x-content-type-options": ["nosniff"], "strict-transport-security": [SECURITY_BASE["strict-transport-security"]], vary: ["rsc"], "x-middleware-rewrite": ["/gym-site"], ...over },
    body: Buffer.from(body),
  });
  assert.deepEqual(problems(redirect(), "redirect", { location: "http://fit.localhost/" }), []);
  assert.ok(problems(redirect({ location: ["http://evil.example/"] }), "redirect", { location: "http://fit.localhost/" }).some((p) => p.includes("location")));
  assert.ok(problems(redirect({ "cache-control": ["no-store"] }), "redirect").some((p) => p.includes("cache-control")));
  assert.ok(problems(redirect({ "set-cookie": ["a=b"] }), "redirect").some((p) => p.includes("cookie")));
  assert.ok(problems({ ...redirect({}, "body"), status: 302 }, "redirect").length >= 2);
});

test("diffResponses: identical but for Date; any other difference is named", () => {
  const a = { status: 404, headers: { date: ["a"], vary: ["rsc"], "cache-control": ["x"] }, body: Buffer.from("same") };
  const b = { status: 404, headers: { date: ["b"], vary: ["rsc"], "cache-control": ["x"] }, body: Buffer.from("same") };
  assert.deepEqual(diffResponses(a, b), []);
  assert.deepEqual(diffResponses(a, { ...b, status: 410 }), ["status 404 vs 410"]);
  assert.match(diffResponses(a, { ...b, headers: { ...b.headers, vary: ["rsc, accept-language"] } })[0], /header vary/);
  assert.match(diffResponses(a, { ...b, headers: { ...b.headers, "x-extra": ["1"] } })[0], /header x-extra: \[absent\]/);
  assert.match(diffResponses(a, { ...b, body: Buffer.from("samf") })[0], /body differs/);
});
test("diffResponses: per-request platform headers are ignored only when a platform is named, any other difference still fails", () => {
  const base = { status: 404, headers: { date: ["a"], vary: ["rsc"], "x-vercel-id": ["fra1::a"], "x-vercel-cache": ["MISS"], age: ["0"], "cf-ray": ["1"], "server-timing": ["x;dur=1"] }, body: Buffer.from("same") };
  const other = { ...base, headers: { ...base.headers, "x-vercel-id": ["fra1::b"], "x-vercel-cache": ["HIT"], age: ["9"], "cf-ray": ["2"], "server-timing": ["x;dur=2"] } };
  assert.ok(diffResponses(base, other).length >= 4, "with no platform the per-request headers are differences");
  assert.deepEqual(diffResponses(base, other, { platform: "vercel" }), []);
  assert.match(diffResponses(base, { ...other, headers: { ...other.headers, vary: ["rsc, accept-language"] } }, { platform: "vercel" })[0], /header vary/);
  assert.match(diffResponses(base, { ...other, body: Buffer.from("diff") }, { platform: "vercel" })[0], /body differs/);
});
test("singleStyleBlock", () => {
  assert.equal(singleStyleBlock("<style>a{}</style>"), "a{}");
  assert.equal(singleStyleBlock("<style>a{}</style><style>b{}</style>"), null);
  assert.equal(singleStyleBlock("no style"), null);
});

// ---- Story 25.3: the directory kind ----
const dirHtml = ({ noindex = false, extra = "", block = "", tags = og("Gyms", "http://www.localhost/en/gyms") } = {}) =>
  `<!doctype html><html lang="en"><head><meta charSet="utf-8"/><title>Gyms</title>${noindex ? '<meta name="robots" content="noindex"/>' : ""}<link rel="canonical" href="http://www.localhost/en/gyms"/><link rel="alternate" hreflang="x-default" href="http://www.localhost/en/gyms"/><style>${STYLE}</style>${tags}${block}</head><body>GATE FIT${extra}</body></html>`;
function dirHeaders(over = {}, { noindex = false } = {}) {
  const h = pageHeaders({ vary: null, "x-middleware-rewrite": null, ...(noindex ? { "x-robots-tag": "noindex" } : {}) });
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete h[k];
    else h[k] = [].concat(v);
  }
  return h;
}
const dir = ({ over, noindex = false, body } = {}) => ({ status: 200, headers: dirHeaders(over, { noindex }), body: Buffer.from(body ?? dirHtml({ noindex })) });
const dirProblems = (res, ctx = {}) => problems(res, "directory", ctx);

test("a correct directory page passes, indexable or noindex, and a language Vary is not asked for", () => {
  assert.deepEqual(dirProblems(dir(), { indexable: true }), []);
  assert.deepEqual(dirProblems(dir({ noindex: true }), { indexable: false }), []);
  assert.deepEqual(dirProblems(dir({ noindex: true })), [], "no expectation: either, as long as header and meta agree");
  assert.ok(dirProblems({ ...dir(), headers: dirHeaders({ vary: "Accept-Language" }) }).some((p) => p.includes("Vary carries Accept-Language")));
});
test("Story 25.7: a top page carrying the inline Africa map (svg, aria-hidden, tabindex -1 links, no style attribute) passes; a style attribute inside the svg still fails", () => {
  const svg = '<figure class="map"><figcaption>c</figcaption><svg class="map-svg" viewBox="0 0 760 925" aria-hidden="true" focusable="false"><g class="map-land"><path d="M1,2L3,4Z" class="lit"></path></g><a href="/en/gyms/cm/douala" tabindex="-1" class="map-dot"><circle class="map-pt" cx="1" cy="2" r="8.2"></circle><text class="map-label" x="1" y="2" text-anchor="middle">Douala</text></a></svg></figure>';
  assert.deepEqual(dirProblems(dir({ body: dirHtml({ extra: svg }) }), { indexable: true }), []);
  assert.ok(dirProblems(dir({ body: dirHtml({ extra: svg.replace('<circle ', '<circle style="fill:red" ') }) })).some((p) => p.includes("inline style attribute")));
  assert.ok(dirProblems(dir({ body: dirHtml({ extra: svg.replace('<g class="map-land">', "<style>a{}</style><g>") }) })).some((p) => p.includes("exactly one <style>")));
});
test("known bad directory page: a <script> element fails", () => {
  assert.ok(dirProblems(dir({ body: dirHtml({ extra: "<script>1</script>" }) })).some((p) => p.includes("<script>")));
  assert.ok(dirProblems(dir({ body: dirHtml({ extra: '<script src="/a.js"></script>' }) })).some((p) => p.includes("<script>")));
});
test("known bad directory page: a Set-Cookie, an inline style attribute, a second style block fail", () => {
  assert.ok(dirProblems(dir({ over: { "set-cookie": "a=b" } })).some((p) => p.includes("sets a cookie")));
  assert.ok(dirProblems(dir({ body: dirHtml({ extra: '<p style="color:red">x</p>' }) })).some((p) => p.includes("inline style attribute")));
  assert.ok(dirProblems(dir({ body: dirHtml({ extra: "<style>a{}</style>" }) })).some((p) => p.includes("exactly one <style>")));
});
test("known bad directory page: header and meta tag must agree on noindex, and match the expectation", () => {
  const headerOnly = { status: 200, headers: dirHeaders({}, { noindex: true }), body: Buffer.from(dirHtml()) };
  const metaOnly = { status: 200, headers: dirHeaders(), body: Buffer.from(dirHtml({ noindex: true })) };
  assert.ok(dirProblems(headerOnly).some((p) => p.includes("disagree")));
  assert.ok(dirProblems(metaOnly).some((p) => p.includes("disagree")));
  assert.ok(dirProblems(dir({ noindex: true }), { indexable: true }).some((p) => p.includes("expected an indexable page")));
  assert.ok(dirProblems(dir(), { indexable: false }).some((p) => p.includes("expected noindex")));
  assert.ok(dirProblems(dir({ over: { "x-robots-tag": "noindex, nofollow" }, body: dirHtml({ noindex: true }) })).some((p) => p.includes("x-robots-tag")));
});
test("known bad directory page: the AD-44 headers, a rewrite header, a missing canonical or x-default", () => {
  for (const name of ["content-security-policy", "strict-transport-security", "cache-control"]) {
    assert.ok(dirProblems(dir({ over: { [name]: null } })).some((p) => p.includes(`missing header ${name}`)), name);
  }
  assert.ok(dirProblems(dir({ over: { "cache-control": "public, s-maxage=600" } })).some((p) => p.includes("cache-control")));
  assert.ok(dirProblems(dir({ over: { "x-middleware-rewrite": "/gym-site" } })).some((p) => p.includes("never rewritten")));
  assert.ok(dirProblems(dir({ body: dirHtml().replace('<link rel="canonical" href="http://www.localhost/en/gyms"/>', "") })).some((p) => p.includes("no canonical")));
  assert.ok(dirProblems(dir({ body: dirHtml().replace('hreflang="x-default"', 'hreflang="en"') })).some((p) => p.includes("x-default")));
});

// ---- Story 25.5: the crawler kind and the body checks ----
const WWW = "http://www.localhost";
const XML_TYPE = "application/xml; charset=utf-8";
const TEXT_TYPE = "text/plain; charset=utf-8";
function crawlHeaders(contentType, over = {}) {
  const h = {
    "content-type": [contentType],
    "cache-control": [CACHE_CONTROL.crawler],
    "content-security-policy": [CRAWLER_CSP],
    "x-content-type-options": [SECURITY_BASE["x-content-type-options"]],
    "referrer-policy": [SECURITY_BASE["referrer-policy"]],
    "strict-transport-security": [SECURITY_BASE["strict-transport-security"]],
    date: ["now"],
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete h[k];
    else h[k] = [].concat(v);
  }
  return h;
}
const ROBOTS = `User-agent: *\nAllow: /\n\nSitemap: ${WWW}/sitemap-index.xml\n`;
const INDEX = (n = 1) => `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Array.from({ length: n }, (_, i) => `  <sitemap><loc>${WWW}/sitemaps/${i + 1}.xml</loc></sitemap>\n`).join("")}</sitemapindex>\n`;
const urlEntry = (path) => `  <url><loc>${WWW}${path}</loc><xhtml:link rel="alternate" hreflang="en" href="${WWW}${path.replace(/^\/fr/, "/en")}"/><xhtml:link rel="alternate" hreflang="fr" href="${WWW}${path.replace(/^\/en/, "/fr")}"/><xhtml:link rel="alternate" hreflang="x-default" href="${WWW}${path.replace(/^\/fr/, "/en")}"/></url>\n`;
const URLSET = (paths = ["/en", "/fr", "/en/gyms", "/fr/gyms"]) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${paths.map(urlEntry).join("")}</urlset>\n`;
const LLMS = (extra = "") => `# GymOS gyms\n\n> Gyms with a public page.\n> This file is a voluntary hint for crawlers, not access control.\n\n## GATE FIT\nurl: http://gate-grace.localhost/\ncategory: Gym\nlocation: Garoua, CM\n${extra}`;
const crawl = (type, body, over) => ({ status: 200, headers: crawlHeaders(type, over), body });
const crawlProblems = (res, type = TEXT_TYPE, ctx = {}) => checkResponse("crawler", res, { mediaOrigin: MEDIA, contentType: type, ...ctx }).problems;

test("a correct crawler response passes, and Next's own rewrite header does not", () => {
  assert.deepEqual(crawlProblems(crawl(TEXT_TYPE, ROBOTS)), []);
  assert.deepEqual(crawlProblems(crawl(XML_TYPE, INDEX()), XML_TYPE), []);
  assert.ok(crawlProblems(crawl(TEXT_TYPE, ROBOTS, { "x-middleware-rewrite": "/gym-site" })).some((p) => p.includes("never rewritten")));
});
test("known bad crawler response: every header dropped or altered fails and names it; a cookie, a wrong content type, a stray header fail", () => {
  for (const name of ["content-type", "cache-control", "content-security-policy", "x-content-type-options", "referrer-policy", "strict-transport-security"]) {
    assert.ok(crawlProblems(crawl(TEXT_TYPE, ROBOTS, { [name]: null })).some((p) => p.includes(`missing header ${name}`)), `dropping ${name}`);
    assert.ok(crawlProblems(crawl(TEXT_TYPE, ROBOTS, { [name]: "x" })).some((p) => p.includes(name)), `altering ${name}`);
  }
  assert.ok(crawlProblems(crawl(TEXT_TYPE, ROBOTS, { "cache-control": "public, s-maxage=3600" })).some((p) => p.includes("cache-control")));
  assert.ok(crawlProblems(crawl(TEXT_TYPE, ROBOTS, { "set-cookie": "a=b" })).some((p) => p.includes("sets a cookie")));
  assert.ok(crawlProblems(crawl(XML_TYPE, INDEX()), TEXT_TYPE).some((p) => p.includes("content-type")));
  assert.ok(crawlProblems(crawl(TEXT_TYPE, ROBOTS, { "x-debug": "1" })).some((p) => p.includes("unexpected header x-debug")));
  assert.ok(crawlProblems({ ...crawl(TEXT_TYPE, ROBOTS), status: 404 }).some((p) => p.includes("status 404, expected 200")));
});
test("checkRobots: a correct file passes; a Disallow, no Allow, a wrong or second Sitemap fail", () => {
  assert.deepEqual(checkRobots(ROBOTS, WWW), []);
  assert.ok(checkRobots(`${ROBOTS}Disallow: /en/gyms\n`, WWW).some((p) => p.includes("Disallow")));
  assert.ok(checkRobots(ROBOTS.replace("Allow: /\n", ""), WWW).some((p) => p.includes("Allow")));
  assert.ok(checkRobots(ROBOTS.replace("sitemap-index.xml", "sitemap.xml"), WWW).some((p) => p.includes("Sitemap")));
  assert.ok(checkRobots(`${ROBOTS}Sitemap: ${WWW}/other.xml\n`, WWW).some((p) => p.includes("exactly")));
  assert.ok(checkRobots(ROBOTS, "https://www.example.com").some((p) => p.includes("Sitemap")), "the origin is the configured one");
});
test("checkSitemapIndex: a correct index passes; a missing file, a gap, a foreign origin, lastmod and a wrong root fail", () => {
  assert.deepEqual(checkSitemapIndex(INDEX(3), WWW), []);
  assert.ok(checkSitemapIndex("<sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"></sitemapindex>", WWW).some((p) => p.includes("lists no file")));
  assert.ok(checkSitemapIndex(INDEX(3).replace("/sitemaps/2.xml", "/sitemaps/3.xml"), WWW).some((p) => p.includes("<loc> 2")));
  assert.ok(checkSitemapIndex(INDEX().replace("http://www.localhost", "http://evil.example"), WWW).some((p) => p.includes("<loc> 1")));
  assert.ok(checkSitemapIndex(INDEX().replace("</sitemap>", "<lastmod>2026-01-01</lastmod></sitemap>"), WWW).some((p) => p.includes("lastmod")));
  assert.ok(checkSitemapIndex(URLSET(), WWW).some((p) => p.includes("not a sitemapindex")));
});
test("checkUrlset: a correct chunk passes; a gym page, a filtered view, a foreign origin, a missing alternate, a duplicate and too many entries fail", () => {
  assert.deepEqual(checkUrlset(URLSET(), WWW), []);
  assert.deepEqual(checkUrlset(URLSET(["/en/gyms/cm", "/fr/gyms/cm", "/en/gyms/cm/garoua", "/fr/gyms/cm/garoua"]), WWW), []);
  const gymPage = URLSET().replace("</urlset>", `  <url><loc>http://gate-grace.localhost/</loc></url>\n</urlset>`);
  assert.ok(checkUrlset(gymPage, WWW).some((p) => p.includes("gate-grace.localhost") && p.includes("not on the www origin")));
  assert.ok(checkUrlset(URLSET(["/en/gyms/cm/garoua?category=gym"]), WWW).some((p) => p.includes("not a marketing or directory page")));
  assert.ok(checkUrlset(URLSET(["/en/gyms/cm/garoua?page=2"]), WWW).some((p) => p.includes("not a marketing or directory page")));
  assert.ok(checkUrlset(URLSET(["/privacy"]), WWW).some((p) => p.includes("not a marketing or directory page")));
  assert.ok(checkUrlset(URLSET().replace(/<xhtml:link rel="alternate" hreflang="x-default"[^>]*\/>/, ""), WWW).some((p) => p.includes("no x-default alternate")));
  assert.ok(checkUrlset(URLSET(["/en", "/en"]), WWW).some((p) => p.includes("listed twice")));
  assert.ok(checkUrlset(URLSET().replace("</url>", "<lastmod>2026-01-01</lastmod></url>"), WWW).some((p) => p.includes("lastmod")));
  assert.ok(checkUrlset(URLSET(), WWW, { max: 3 }).some((p) => p.includes("at most 3")));
  assert.ok(checkUrlset(INDEX(), WWW).some((p) => p.includes("not a urlset")));
});
test("checkListedPage: 200 without noindex passes; a 404, an X-Robots-Tag and a robots meta tag fail", () => {
  assert.deepEqual(checkListedPage({ status: 200, headers: {}, body: "<html></html>" }), []);
  assert.ok(checkListedPage({ status: 404, headers: {}, body: "" }).some((p) => p.includes("status 404")));
  assert.ok(checkListedPage({ status: 200, headers: { "x-robots-tag": ["noindex"] }, body: "" }).some((p) => p.includes("X-Robots-Tag")));
  assert.ok(checkListedPage({ status: 200, headers: {}, body: '<meta name="robots" content="noindex"/>' }).some((p) => p.includes("noindex meta")));
  assert.ok(checkListedPage({ status: 200, headers: {}, body: '<meta content="noindex, nofollow" name="robots">' }).some((p) => p.includes("noindex meta")));
});
test("checkLlms: a correct file passes; a missing hint, a forged block, a non-allowlisted line, a removed gym and a missing gym fail", () => {
  const gate = "http://gate-grace.localhost/";
  assert.deepEqual(checkLlms(LLMS(), { absent: ["http://gate-draft.localhost/"], present: [gate] }), []);
  assert.deepEqual(checkLlms(LLMS("hours: Mon 06:00-21:00\nplans:\n- Monthly: 15,000 XAF per month\n")), []);
  assert.deepEqual(checkLlms("# GymOS gyms\n\n> This file is a voluntary hint, not access control.\n"), []);
  assert.ok(checkLlms(LLMS().replace("voluntary hint", "hint")).some((p) => p.includes("voluntary hint")));
  assert.ok(checkLlms(LLMS("phone: +237600000000\n")).some((p) => p.includes("not an allowlisted field")));
  assert.ok(checkLlms(LLMS("about: lots of text\n")).some((p) => p.includes("not an allowlisted field")));
  assert.ok(checkLlms(`${LLMS()}\n## FORGED\ncategory: Gym\n`).some((p) => p.includes("no url")));
  assert.ok(checkLlms(LLMS().replace("url: http://gate-grace.localhost/", "url: https://evil.example/path")).some((p) => p.includes("not a gym's subdomain address")));
  assert.ok(checkLlms(`${LLMS()}\n## GATE DRAFT\nurl: http://gate-draft.localhost/\n`, { absent: ["http://gate-draft.localhost/"] }).some((p) => p.includes("gate-draft")));
  assert.ok(checkLlms("# GymOS gyms\n\n> This file is a voluntary hint, not access control.\n", { present: [gate] }).some((p) => p.includes("does not list")));
  assert.ok(checkLlms("nothing").some((p) => p.includes("header")));
});
test("locsOf decodes entities", () => {
  assert.deepEqual(locsOf("<loc>http://a/?x=1&amp;y=2</loc><loc>b</loc>"), ["http://a/?x=1&y=2", "b"]);
});

// ---- end to end: check-http.mjs against a doctored server ----
const SCRIPT = fileURLToPath(new URL("../check-http.mjs", import.meta.url));

/** What the landing server answers on www for the directory paths the check requests (the data of the local fixture: a thin city). */
function directoryResponse(url) {
  const p = url.pathname;
  const nf = () => ({ status: 404, headers: pageHeaders({ "cache-control": CACHE_CONTROL.notFound, vary: "rsc, next-router-state-tree", "x-middleware-rewrite": null, "content-security-policy": expectedCsp("'none'", styleHash(STYLE)) }), body: html("-NF") });
  if (p === "/robots.txt") return crawl(TEXT_TYPE, ROBOTS);
  if (p === "/sitemap-index.xml") return crawl(XML_TYPE, INDEX());
  if (p === "/sitemaps/1.xml") return crawl(XML_TYPE, URLSET());
  if (p === "/llms.txt") return crawl(TEXT_TYPE, LLMS());
  if (p === "/en" || p === "/fr") return { status: 200, headers: { "content-type": ["text/html; charset=utf-8"], "cache-control": ["public, max-age=0, must-revalidate"] }, body: "<html><body>marketing</body></html>" };
  if (p === "/gyms/cm") return { status: 307, headers: { location: ["http://www.localhost/fr/gyms/cm"], "cache-control": ["no-store"] }, body: "" };
  if (p === "/en/gyms" || p === "/fr/gyms") return { status: 200, headers: dirHeaders(), body: dirHtml() };
  if (p === "/en/gyms/cm") return { status: 200, headers: dirHeaders({}, { noindex: true }), body: dirHtml({ noindex: true }) };
  if (p === "/en/gyms/cm/garoua" && url.searchParams.get("page") === null) {
    if (url.searchParams.get("category") === "gym") return { status: 200, headers: dirHeaders(), body: dirHtml({ block: ld(ITEM_LIST) }) };
    return { status: 200, headers: dirHeaders({}, { noindex: true }), body: dirHtml({ noindex: true, block: ld(ITEM_LIST) }) };
  }
  return nf();
}

/** A server that behaves like the landing server; `doctor(label, response)` may break one response. */
function startServer(doctor = () => undefined) {
  const server = http.createServer((req, res) => {
    const label = (req.headers.host ?? "").split(".")[0];
    const url = new URL(req.url ?? "/", "http://x");
    let r;
    if (label === "www") r = directoryResponse(url);
    else if (label === "gate-grace" && url.pathname === "/") r = { status: 200, headers: pageHeaders(), body: html() };
    else if (label === "gate-grace-old") r = { status: 301, headers: { location: ["http://gate-grace.localhost/"], "cache-control": [CACHE_CONTROL.redirect], "x-content-type-options": ["nosniff"], "strict-transport-security": [SECURITY_BASE["strict-transport-security"]], vary: ["rsc"], "x-middleware-rewrite": ["/gym-site"] }, body: "" };
    else r = { status: 404, headers: pageHeaders({ "cache-control": CACHE_CONTROL.notFound, vary: "rsc, next-router-state-tree", "content-security-policy": expectedCsp("'none'", styleHash(STYLE)) }), body: html("-NF") };
    r = structuredClone(r);
    doctor(label, r, req.url);
    const raw = [];
    for (const [k, v] of Object.entries(r.headers)) for (const x of v) raw.push([k, x]);
    res.writeHead(r.status, raw);
    res.end(r.body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}
function runCheck(port, extraEnv = {}, rawEnv = false) {
  return new Promise((resolve) => {
    const base = rawEnv ? { ...process.env } : { ...process.env, BASE_URL: `http://127.0.0.1:${port}`, ROOT_DOMAIN: "localhost", GATE_MEDIA_ORIGIN: MEDIA, GATE_LABEL_SUSPENDED: "", GATE_LABEL_INVALID: "" };
    const p = spawn(process.execPath, [SCRIPT], { env: { ...base, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}
async function withServer(doctor, fn) {
  const { server, port } = await startServer(doctor);
  try {
    return await fn(port);
  } finally {
    server.close();
  }
}

test("check-http passes against a faithful server", async () => {
  await withServer(undefined, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 0, out);
    assert.match(out, /check-http: PASS/);
  });
});
test("check-http: a directory page with a <script> or a Set-Cookie fails the run (known bad), naming the page", async () => {
  await withServer((label, r, url) => { if (label === "www" && url === "/en/gyms") r.body = r.body.replace("</body>", "<script>1</script></body>"); }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /www \/en\/gyms: directory: the body holds a <script> element/);
  });
  await withServer((label, r, url) => { if (label === "www" && url === "/en/gyms/cm") r.headers["set-cookie"] = ["a=b"]; }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /www \/en\/gyms\/cm: directory: sets a cookie/);
  });
});
test("check-http: a filtered directory view that carries noindex fails the run", async () => {
  await withServer((label, r, url) => { if (label === "www" && url?.includes("category=gym")) { r.headers["x-robots-tag"] = ["noindex"]; r.body = dirHtml({ noindex: true }); } }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /category=gym: directory: expected an indexable page/);
  });
});
test("check-http fails (exit 1) when the page drops a header, naming it", async () => {
  await withServer((label, r) => { if (label === "gate-grace") delete r.headers["strict-transport-security"]; }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /gate-grace: page: missing header strict-transport-security/);
  });
});
test("check-http fails when a not-found adds a header", async () => {
  await withServer((label, r) => { if (label === "gate-nobody-here") r.headers["x-debug"] = ["1"]; }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /unexpected header x-debug/);
  });
});
test("check-http fails when a redirect lands somewhere that is not the page", async () => {
  await withServer((label, r) => { if (label === "gate-grace-old") r.headers.location = ["http://elsewhere.localhost/"]; }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /location/);
  });
});
test("check-http fails when one hidden cause answers differently from the others (a cause that leaks)", async () => {
  await withServer((label, r) => { if (label === "gate-down") { r.body = html("-TAKEN-DOWN"); } }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /not-found differs, unknown vs taken down: body differs/);
  });
  await withServer((label, r) => { if (label === "gate-draft") r.headers["cache-control"] = ["public, s-maxage=31"]; }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /not-found differs, unknown vs unpublished: header cache-control/);
  });
});
test("check-http reads the body marker from GATE_PUBLISHED_MARKER", async () => {
  await withServer(undefined, async (port) => {
    const { code, out } = await runCheck(port, { GATE_PUBLISHED_MARKER: "NOT ON THE PAGE" });
    assert.equal(code, 1);
    assert.match(out, /does not carry the marker "NOT ON THE PAGE"/);
  });
});
test("check-http in {label} mode fails with a clear message when the redirect, unpublished and taken-down labels are unset", async () => {
  const { code, out } = await runCheck(1, { BASE_URL: "http://{label}.localhost:1", GATE_LABEL_PUBLISHED: "x-pub", GATE_LABEL_REDIRECT_OLD: "", GATE_LABEL_UNPUBLISHED: "", GATE_LABEL_TAKEN_DOWN: "" }, true);
  assert.equal(code, 1);
  assert.match(out, /set GATE_LABEL_REDIRECT_OLD, GATE_LABEL_UNPUBLISHED, GATE_LABEL_TAKEN_DOWN/);
});
test("check-http fails when the server is not there", async () => {
  const { code, out } = await runCheck(1);
  assert.equal(code, 1);
  assert.match(out, /could not complete/);
});

// ---- Story 25.4: structured data and Open Graph, shown failing ----
test("scriptsOf separates the inert JSON-LD data blocks from executable script", () => {
  assert.deepEqual(scriptsOf(html()), { blocks: [JSON.stringify(HEALTH_CLUB).replace(/[<>&]/g, "")], executable: 0 });
  assert.equal(scriptsOf(html("<script>1</script>")).executable, 1);
  assert.equal(scriptsOf(html('<script src="/a.js"></script>')).executable, 1);
  assert.equal(scriptsOf(html('<script type="module">1</script>')).executable, 1);
  assert.equal(scriptsOf(html('<script type="application/ld+json" src="/a.js"></script>')).executable, 1, "extra attributes are not the inert block");
  assert.equal(scriptsOf(html("<script")).executable, 1, "an unterminated opener still counts");
});
test("a correct gym page passes the structured-data check; a correct city page with an ItemList and a top page with none pass too", () => {
  assert.deepEqual(checkStructuredData("page", html(), "HealthClub"), []);
  assert.deepEqual(problems(page({})), []);
  assert.deepEqual(dirProblems(dir({ body: dirHtml({ block: ld(ITEM_LIST) }) }), { structuredData: "ItemList" }), []);
  assert.deepEqual(dirProblems(dir(), { structuredData: "none" }), []);
  assert.deepEqual(dirProblems(dir(), {}), [], "no expectation: zero or one block");
});
test("known bad gym page: no block, a second block, an executable script, invalid JSON, another type each fail", () => {
  const bad = (body) => problems(page({}, body));
  assert.ok(bad(html("", { block: "" })).some((p) => p.includes("0 application/ld+json block(s), expected 1")));
  assert.ok(bad(html("", { block: ld(HEALTH_CLUB) + ld(HEALTH_CLUB) })).some((p) => p.includes("2 application/ld+json block(s), expected 1")));
  assert.ok(bad(html("<script>alert(1)</script>")).some((p) => p.includes("page: the body holds a <script> element")));
  assert.ok(bad(html("", { block: '<script type="application/ld+json">{"@context": </script>' })).some((p) => p.includes("not valid JSON")));
  assert.ok(bad(html("", { block: ld({ ...HEALTH_CLUB, "@type": "LocalBusiness" }) })).some((p) => p.includes("@type")));
  assert.ok(bad(html("", { block: ld({ ...HEALTH_CLUB, "@type": "ItemList" }) })).some((p) => p.includes("expected HealthClub")));
});
test("known bad gym page: a relative url, no country, a literal < in the block, no name each fail", () => {
  const bad = (node) => problems(page({}, html("", { block: ld(node) })));
  assert.ok(bad({ ...HEALTH_CLUB, url: "/" }).some((p) => p.includes("url is not absolute")));
  assert.ok(bad({ ...HEALTH_CLUB, address: { "@type": "PostalAddress" } }).some((p) => p.includes("addressCountry")));
  assert.ok(bad({ ...HEALTH_CLUB, name: "" }).some((p) => p.includes("no name")));
  assert.ok(bad({ ...HEALTH_CLUB, "@context": "http://example.test" }).some((p) => p.includes("@context")));
  assert.ok(problems(page({}, html("", { block: '<script type="application/ld+json">{"name":"a<b"}</script>' }))).some((p) => p.includes("unescaped")));
});
test("known bad gym page: a missing og tag, an og:title that differs from the <title>, a relative og:url each fail", () => {
  const bad = (tags) => problems(page({}, html("", { tags })));
  assert.ok(bad("").some((p) => p.includes("missing og:type")));
  assert.ok(bad(og().replace(/<meta property="og:description"[^>]*>/, "")).some((p) => p.includes("missing og:description")));
  assert.ok(bad(og("Something else")).some((p) => p.includes("og:title differs from the <title>")));
  assert.ok(bad(og("GATE FIT", "/")).some((p) => p.includes("og:url is not absolute")));
  assert.deepEqual(bad(og("GATE &amp; FIT")).filter((p) => p.includes("og:title")), ["page: og:title differs from the <title>"], "entities are decoded before comparing: the title here has no ampersand");
});
test("known bad directory page: a block where none belongs, no ItemList on a city, wrong positions, og:image, og:url not the canonical", () => {
  assert.ok(dirProblems(dir({ body: dirHtml({ block: ld(ITEM_LIST) }) }), { structuredData: "none" }).some((p) => p.includes("1 application/ld+json block(s), expected 0")));
  assert.ok(dirProblems(dir(), { structuredData: "ItemList" }).some((p) => p.includes("0 application/ld+json block(s), expected 1")));
  assert.ok(dirProblems(dir({ body: dirHtml({ block: ld(HEALTH_CLUB) }) }), { structuredData: "ItemList" }).some((p) => p.includes("expected ItemList")));
  const skipped = { ...ITEM_LIST, itemListElement: [ITEM_LIST.itemListElement[0], { ...ITEM_LIST.itemListElement[1], position: 5 }] };
  assert.ok(dirProblems(dir({ body: dirHtml({ block: ld(skipped) }) }), { structuredData: "ItemList" }).some((p) => p.includes("next position")));
  const nullFirst = { ...ITEM_LIST, itemListElement: [null, ITEM_LIST.itemListElement[1]] };
  assert.ok(dirProblems(dir({ body: dirHtml({ block: ld(nullFirst) }) }), { structuredData: "ItemList" }).some((p) => p.includes("next position")), "a non-object first item is reported, not thrown");
  const relative = { ...ITEM_LIST, itemListElement: [{ ...ITEM_LIST.itemListElement[0], url: "/x" }] };
  assert.ok(dirProblems(dir({ body: dirHtml({ block: ld(relative) }) }), { structuredData: "ItemList" }).some((p) => p.includes("absolute url")));
  assert.ok(dirProblems(dir({ body: dirHtml({ tags: og("Gyms", "http://www.localhost/en/gyms/cm") }) })).some((p) => p.includes("og:url differs from the canonical")));
  assert.ok(dirProblems(dir({ body: dirHtml({ tags: og("Gyms", "http://www.localhost/en/gyms") + '<meta property="og:image" content="http://m/x.webp">' }) })).some((p) => p.includes("og:image must be absent")));
});

test("check-http: a gym page without the block, with a second block or an executable script fails the run (doctored responses), naming the page", async () => {
  await withServer((label, r) => { if (label === "gate-grace") r.body = html("", { block: "" }); }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /gate-grace: page: 0 application\/ld\+json block\(s\), expected 1/);
  });
  await withServer((label, r) => { if (label === "gate-grace") r.body = html("", { block: ld(HEALTH_CLUB) + ld(HEALTH_CLUB) }); }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /gate-grace: page: 2 application\/ld\+json block\(s\), expected 1/);
  });
  await withServer((label, r) => { if (label === "gate-grace") r.body = html("<script>1</script>"); }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /gate-grace: page: the body holds a <script> element/);
  });
  await withServer((label, r) => { if (label === "gate-grace") r.body = html("", { tags: og("Other title") }); }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /gate-grace: page: og:title differs from the <title>/);
  });
});
test("check-http: a city page without its ItemList, and a top page that carries one, fail the run", async () => {
  await withServer((label, r, url) => { if (label === "www" && url === "/en/gyms/cm/garoua") r.body = dirHtml({ noindex: true }); }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /www \/en\/gyms\/cm\/garoua: directory: 0 application\/ld\+json block\(s\), expected 1/);
  });
  await withServer((label, r, url) => { if (label === "www" && url === "/en/gyms") r.body = dirHtml({ block: ld(ITEM_LIST) }); }, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1);
    assert.match(out, /www \/en\/gyms: directory: 1 application\/ld\+json block\(s\), expected 0/);
  });
});

test("decodeEntities decodes in a single pass and leaves an out-of-range numeric entity as written", () => {
  assert.equal(decodeEntities("&#38;lt;"), "&lt;", "a decoded ampersand is not decoded again");
  assert.equal(decodeEntities("&amp;lt;"), "&lt;");
  assert.equal(decodeEntities("&#x27;&#39;&quot;&lt;&gt;&amp;"), "''\"<>&");
  assert.equal(decodeEntities("a&#x110000;b"), "a&#x110000;b");
  assert.equal(decodeEntities("a&#99999999;b"), "a&#99999999;b");
  assert.equal(decodeEntities("&#x10FFFF;").codePointAt(0), 0x10ffff);
});

// ---- Story 25.5: the crawler checks of check-http.mjs, shown failing on doctored responses ----
const onWww = (path, fn) => (label, r, url) => {
  if (label === "www" && url === path) fn(r);
};
async function expectFailure(doctor, pattern) {
  await withServer(doctor, async (port) => {
    const { code, out } = await runCheck(port);
    assert.equal(code, 1, out);
    assert.match(out, pattern);
  });
}

test("check-http: a doctored sitemap fails the run (known bad): a gym page, a filtered view, a lastmod, a gap in the index", async () => {
  await expectFailure(onWww("/sitemaps/1.xml", (r) => (r.body = URLSET().replace("</urlset>", `  <url><loc>http://gate-grace.localhost/</loc></url>\n</urlset>\n`))), /www \/sitemaps\/1\.xml: sitemap: http:\/\/gate-grace\.localhost\/ is not on the www origin/);
  await expectFailure(onWww("/sitemaps/1.xml", (r) => (r.body = URLSET(["/en", "/fr", "/en/gyms/cm/garoua?category=gym"]))), /not a marketing or directory page/);
  await expectFailure(onWww("/sitemaps/1.xml", (r) => (r.body = r.body.replace("</url>", "<lastmod>2026-01-01</lastmod></url>"))), /carries lastmod, changefreq or priority/);
  await expectFailure(onWww("/sitemap-index.xml", (r) => (r.body = INDEX().replace("/sitemaps/1.xml", "/sitemaps/2.xml"))), /sitemap-index: <loc> 1 is/);
});
test("check-http: a sitemap that lists a URL which is not served, or is noindex, fails the run naming the URL", async () => {
  await expectFailure(onWww("/sitemaps/1.xml", (r) => (r.body = URLSET(["/en", "/fr", "/en/gyms", "/en/gyms/cm/nowhere"]))), /www \/en\/gyms\/cm\/nowhere \(listed in a sitemap\): status 404, expected 200/);
  await expectFailure(onWww("/fr/gyms", (r) => ((r.headers["x-robots-tag"] = ["noindex"]), (r.body = dirHtml({ noindex: true })))), /www \/fr\/gyms \(listed in a sitemap\): it carries X-Robots-Tag/);
  await expectFailure(onWww("/sitemap-index.xml", (r) => (r.body = INDEX(2))), /www \/sitemaps\/2\.xml: crawler: status 404, expected 200/);
});
test("check-http: robots.txt with a Disallow, a wrong header, or a Set-Cookie fails the run", async () => {
  await expectFailure(onWww("/robots.txt", (r) => (r.body += "Disallow: /en/gyms\n")), /www \/robots\.txt: robots: it carries a Disallow/);
  await expectFailure(onWww("/robots.txt", (r) => (r.headers["cache-control"] = ["public, s-maxage=3600"])), /www \/robots\.txt: crawler: cache-control is/);
  await expectFailure(onWww("/sitemap-index.xml", (r) => (r.headers["set-cookie"] = ["a=b"])), /www \/sitemap-index\.xml: crawler: sets a cookie/);
});
test("check-http: llms.txt that lists a removed gym, a non-allowlisted line or no hint fails the run", async () => {
  await expectFailure(onWww("/llms.txt", (r) => (r.body += "\n## GATE DRAFT\nurl: http://gate-draft.localhost/\n")), /www \/llms\.txt: llms: it lists http:\/\/gate-draft\.localhost\/, a gym whose page is not served/);
  await expectFailure(onWww("/llms.txt", (r) => (r.body += "phone: +237600000000\n")), /llms: line \d+ is not an allowlisted field/);
  await expectFailure(onWww("/llms.txt", (r) => (r.body = r.body.replace("voluntary hint", "hint"))), /voluntary hint/);
});
test("check-http: a gym host that answers a main-site file or page with anything but the uniform not-found fails the run", async () => {
  for (const path of ["/llms.txt", "/sitemap-index.xml", "/sitemaps/1.xml", "/en/gyms", "/en/gyms/cm"]) {
    await withServer((label, r, url) => {
      if (label === "gate-grace" && url === path) Object.assign(r, { status: 200, headers: pageHeaders(), body: html() });
    }, async (port) => {
      const { code, out } = await runCheck(port);
      assert.equal(code, 1, path);
      assert.match(out, new RegExp(`gate-grace ${path.replace(/[/.]/g, "\\$&")} \\(gym host\\): notFound: status 200, expected 404`));
    });
  }
  await expectFailure((label, r, url) => {
    if (label === "gate-nobody-here" && url === "/robots.txt") r.body = html("-DIFFERENT");
  }, /gate-nobody-here \/robots\.txt: not the unknown label's not-found: body differs/);
  await expectFailure((label, r, url) => {
    if (label === "gate-grace" && url === "/llms.txt") r.headers["cache-control"] = ["public, s-maxage=31"];
  }, /gate-grace \/llms\.txt: not the unknown label's not-found: header cache-control/);
});
test("check-http: a chunk that should not exist but answers 200 fails the run", async () => {
  await expectFailure((label, r, url) => {
    if (label === "www" && url === "/sitemaps/0.xml") Object.assign(r, crawl(XML_TYPE, URLSET()));
  }, /www \/sitemaps\/0\.xml: notFound: status 200, expected 404/);
});
