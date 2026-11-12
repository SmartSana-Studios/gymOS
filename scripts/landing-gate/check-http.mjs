#!/usr/bin/env node
// Story 24.12 (NFR-025, AD-44): real HTTP requests against a running landing server.
//
//   BASE_URL=http://127.0.0.1:3200 ROOT_DOMAIN=localhost node scripts/landing-gate/check-http.mjs
//
// 1. A published page, a not-found and a redirect each carry the EXACT header set of their kind (CSP string, nosniff, referrer policy, HSTS,
//    Cache-Control, Vary, no Set-Cookie) and nothing else. The headers Next.js (and, on staging, the platform) add are printed, and any other
//    header fails the run.
// 3. Story 25.3: the directory pages on www (top, country, city, a filtered view, an unknown place, the bare /gyms redirect) carry the page set with no
//    script, no inline style attribute, no cookie, s-maxage at most 300, and ONE indexability signal (X-Robots-Tag and the robots meta tag agree; a filtered
//    view is never noindex).
// 2. The not-found of an unknown, an unpublished, a taken-down, a suspended and a reserved label is byte-identical: status, every header but
//    Date, body.
// 4. Story 25.4: the gym page carries exactly one HealthClub JSON-LD block and the Open Graph tags (og:title equal to the <title>); a city page lists its gyms in one
//    ItemList; the top and country pages carry the tags and no block; no response holds an executable <script> (the one allowed script is that inert data block).
// 5. Story 25.5: the crawler files of www. robots.txt allows everything and names the index; /sitemap-index.xml and each file it lists are well formed, on the www origin,
//    list no gym page or filtered view; EVERY <loc> of every file is requested and answers 200 with no noindex; /llms.txt holds only allowlisted lines and none of the
//    unpublished, taken-down or suspended fixture gyms; a chunk that does not exist is the uniform not-found; and on a GYM host each of /llms.txt, /sitemap-index.xml,
//    /sitemaps/1.xml, /en/gyms and /en/gyms/cm (and /robots.txt of an unknown gym) is byte-identical to the unknown label's not-found.
import { config, targetFor, schemeFor, missingStagingLabels } from "./lib/config.mjs";
import { rawGet } from "./lib/http.mjs";
import { checkListedPage, checkLlms, checkResponse, checkRobots, checkSitemapIndex, checkUrlset, diffResponses, locsOf } from "./lib/headers.mjs";

const L = config.labels;
const fail = [];
const note = (s) => console.log(s);
const get = (label, path = "/") => rawGet(targetFor(label, path));

/** Story 25.3. `judge` is main()'s; every directory response goes through checkResponse("directory" | "notFound" | ...). */
async function checkDirectory(judge) {
  const D = config.directory;
  const at = (path, headers) => rawGet(targetFor(D.label, path), headers ? { headers } : undefined);
  const top = await at("/en/gyms");
  judge("directory", "www /en/gyms", top, { indexable: true, structuredData: "none" });
  judge("directory", "www /fr/gyms", await at("/fr/gyms"), { indexable: true, structuredData: "none" });
  const unknown = await at("/en/gyms/zz");
  judge("notFound", "www /en/gyms/zz (unknown country)", unknown);
  judge("notFound", "www /de/gyms (bad locale)", await at("/de/gyms"));
  judge("notFound", "www /en/gyms/CM (upper-case code)", await at("/en/gyms/CM"));

  // the bare path: one 307 by Accept-Language, no cookie
  const bare = await at("/gyms/cm", { "accept-language": "fr" });
  const loc = bare.headers["location"]?.[0] ?? "";
  if (bare.status !== 307 || new URL(loc, "http://x").pathname !== "/fr/gyms/cm") fail.push(`www /gyms/cm: expected a 307 to /fr/gyms/cm, got ${bare.status} [${loc}]`);
  else note("ok   bare /gyms/cm -> 307 /fr/gyms/cm");
  if (bare.headers["set-cookie"]) fail.push("www /gyms/cm: the redirect sets a cookie");

  if (!D.country) return note("note: GATE_DIRECTORY_COUNTRY / GATE_DIRECTORY_CITY are unset (staging): only the top pages were checked");
  const country = await at(`/en/gyms/${D.country}`);
  judge("directory", `www /en/gyms/${D.country}`, country, { structuredData: "none" });
  if (!D.city) return;
  const cityPath = `/en/gyms/${D.country}/${D.city}`;
  const city = await at(cityPath);
  judge("directory", `www ${cityPath}`, city, { structuredData: "ItemList" });
  if (!city.body.toString("utf8").includes(config.publishedMarker)) fail.push(`www ${cityPath}: the page does not list the published fixture gym "${config.publishedMarker}"`);
  const filtered = await at(`${cityPath}?category=gym`);
  judge("directory", `www ${cityPath}?category=gym`, filtered, { indexable: true, structuredData: "ItemList" });
  if (!filtered.body.toString("utf8").includes(config.publishedMarker)) fail.push(`www ${cityPath}?category=gym: the filtered page does not list the published fixture gym`);
  judge("notFound", `www ${cityPath}?page=9 (past the last page)`, await at(`${cityPath}?page=9`));
}

/** Story 25.5. `judge` is main()'s; `nf` is the answer for an unknown gym label (the uniform not-found as a gym host sends it). */
async function checkCrawlers(judge, nf) {
  const D = config.directory;
  const at = (path) => rawGet(targetFor(D.label, path));
  const www = `${schemeFor(config.rootDomain)}://www.${config.rootDomain}`;
  const problems = (label, list) => list.forEach((p) => fail.push(`${label}: ${p}`));
  const text = (res) => res.body.toString("utf8");
  const XML = "application/xml; charset=utf-8";
  const TEXT = "text/plain; charset=utf-8";

  const robots = await at("/robots.txt");
  judge("crawler", "www /robots.txt", robots, { contentType: TEXT });
  problems("www /robots.txt", checkRobots(text(robots), www));

  const index = await at("/sitemap-index.xml");
  judge("crawler", "www /sitemap-index.xml", index, { contentType: XML });
  problems("www /sitemap-index.xml", checkSitemapIndex(text(index), www));

  // every file the index lists, then every <loc> of every file
  const listed = [];
  for (const loc of locsOf(text(index))) {
    if (!loc.startsWith(`${www}/sitemaps/`)) continue; // already reported by checkSitemapIndex
    const path = loc.slice(www.length);
    const chunk = await at(path);
    judge("crawler", `www ${path}`, chunk, { contentType: XML });
    problems(`www ${path}`, checkUrlset(text(chunk), www));
    for (const l of locsOf(text(chunk))) if (l.startsWith(`${www}/`)) listed.push(l.slice(www.length));
  }
  const unique = [...new Set(listed)];
  let reached = 0;
  for (let i = 0; i < unique.length; i += 8) {
    const batch = unique.slice(i, i + 8);
    const results = await Promise.all(batch.map((p) => at(p)));
    results.forEach((res, j) => {
      const list = checkListedPage(res);
      if (list.length) problems(`www ${batch[j]} (listed in a sitemap)`, list);
      else reached++;
    });
  }
  note(`${reached === unique.length ? "ok  " : "FAIL"} sitemap: ${reached} of ${unique.length} listed URL(s) answer 200 with no noindex`);
  if (unique.length === 0) fail.push("www sitemap: no URL is listed (the marketing and top pages are always listed)");

  const llms = await at("/llms.txt");
  judge("crawler", "www /llms.txt", llms, { contentType: TEXT });
  const gymUrl = (label) => `${schemeFor(config.rootDomain)}://${label}.${config.rootDomain}/`;
  const absent = [L.unpublished, L.takenDown, L.suspended, L.redirectOld].filter(Boolean).map(gymUrl);
  problems("www /llms.txt", checkLlms(text(llms), { absent, present: [gymUrl(L.published)] }));

  // a chunk that does not exist, and a name that breaks the grammar: the uniform not-found
  for (const path of ["/sitemaps/0.xml", "/sitemaps/99999999.xml", "/sitemaps/x.xml", "/sitemaps/1"]) judge("notFound", `www ${path}`, await at(path));

  // the main site's files and pages do not exist on a gym host: each is byte-identical to the unknown label's not-found
  if (!L.unknown) return note("note: no GATE_LABEL_UNKNOWN: the gym-host rows for the main-site files and pages were NOT checked");
  for (const path of ["/llms.txt", "/sitemap-index.xml", "/sitemaps/1.xml", "/en/gyms", "/en/gyms/cm"]) {
    const res = await get(L.published, path);
    judge("notFound", `${L.published} ${path} (gym host)`, res);
    for (const d of diffResponses(nf, res, { platform: config.platform })) fail.push(`${L.published} ${path}: not the unknown label's not-found: ${d}`);
  }
  const unknownRobots = await get(L.unknown, "/robots.txt");
  judge("notFound", `${L.unknown} /robots.txt (unknown gym)`, unknownRobots);
  for (const d of diffResponses(nf, unknownRobots, { platform: config.platform })) fail.push(`${L.unknown} /robots.txt: not the unknown label's not-found: ${d}`);
}

async function main() {
  note(`check-http: ${config.baseUrl} root ${config.rootDomain} platform ${config.platform}`);
  const missing = missingStagingLabels();
  if (missing.length) throw new Error(`BASE_URL has a {label} placeholder (staging): set ${missing.map((m) => `${m}`).join(", ")} to labels that exist on staging (the local fixture labels do not), or the uniformity check would compare unknown labels with each other`);
  const ctx = { mediaOrigin: config.mediaOrigin, platform: config.platform, extraAllowed: config.extraAllowedHeaders };
  const nextAdded = new Set();
  const platformExtras = new Set();
  const judge = (kind, label, res, extra = {}) => {
    const r = checkResponse(kind, res, { ...ctx, ...extra });
    for (const p of r.problems) fail.push(`${label}: ${p}`);
    r.nextAdded.forEach((x) => nextAdded.add(x));
    r.platformExtras.forEach((x) => platformExtras.add(x));
    note(`${r.problems.length === 0 ? "ok  " : "FAIL"} ${kind.padEnd(8)} ${label} -> ${res.status}${r.problems.length ? ` (${r.problems.length} problem(s))` : ""}`);
  };

  // ---- the three kinds ----
  const page = await get(L.published);
  judge("page", L.published, page);
  if (!page.body.toString("utf8").includes(config.publishedMarker)) fail.push(`${L.published}: the page body does not carry the marker "${config.publishedMarker}" (set GATE_PUBLISHED_MARKER to text the published page shows)`);

  const nf = await get(L.unknown);
  judge("notFound", L.unknown, nf);

  if (L.redirectOld) {
    const r = await get(L.redirectOld);
    const location = `${schemeFor(config.rootDomain)}://${L.published}.${config.rootDomain}/`;
    judge("redirect", L.redirectOld, r, { location });
    // one hop: the target is the current page, not another redirect
    const loc = r.headers["location"]?.[0];
    if (loc) {
      const host = new URL(loc).hostname;
      const label = host.endsWith(`.${config.rootDomain}`) ? host.slice(0, host.length - config.rootDomain.length - 1) : host;
      const target = await get(label);
      if (target.status !== 200) fail.push(`${L.redirectOld}: the redirect target ${label} answers ${target.status}, expected 200 (one hop only)`);
      else note(`ok   redirect ${L.redirectOld} -> ${label} is one hop (200)`);
    }
  }

  // ---- uniform not-found ----
  const causes = [
    ["unknown", L.unknown],
    ["unpublished", L.unpublished],
    ["taken down", L.takenDown],
    ["suspended", L.suspended],
    ["reserved", L.reserved],
    ["invalid grammar", L.invalid],
  ].filter(([, label]) => label);
  const answers = [];
  for (const [cause, label] of causes) {
    const res = await get(label);
    judge("notFound", `${label} (${cause})`, res);
    answers.push([cause, res]);
  }
  const [firstCause, first] = answers[0];
  for (const [cause, res] of answers.slice(1)) {
    const diffs = diffResponses(first, res, { platform: config.platform });
    if (diffs.length === 0) note(`ok   identical: ${firstCause} == ${cause}`);
    else for (const d of diffs) fail.push(`not-found differs, ${firstCause} vs ${cause}: ${d}`);
  }

  await checkDirectory(judge);
  await checkCrawlers(judge, nf);

  note("");
  note(`Headers Next.js adds itself (allowed, listed so a change is seen): ${nextAdded.size ? [...nextAdded].sort().join("; ") : "none"}`);
  note(`Headers the platform adds (allowed by GATE_PLATFORM / GATE_ALLOWED_EXTRA_HEADERS): ${platformExtras.size ? [...platformExtras].sort().join("; ") : "none"}`);
}

try {
  await main();
} catch (e) {
  fail.push(`could not complete: ${e.message}`);
}
if (fail.length) {
  console.log(`\ncheck-http: FAIL (${fail.length})`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\ncheck-http: PASS");
