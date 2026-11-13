// Story 25.6 (PRD 10.2; FR-207, FR-211..FR-214): how fast a removed gym leaves every public surface, as data plus one poll loop and one judge. No network of its
// own: the caller injects `get(label, path, headers)`, so the same code is used by the CLI (removal-timing.mjs, raw HTTP), by the E2E spec
// (apps/dashboard/e2e/directory-gate.spec.ts, Host-header requests) and by the node tests (a doctored server that keeps a removed gym somewhere).
//
// A "surface" is one place the public site could still show a gym after it was removed (unpublished, taken down, or suspended). They are all views over
// ONE visibility predicate (private.gym_page_visible), so the list below is the list of readers of that predicate, and `__tests__/removal.test.mjs`
// fails when a migration or the landing app reads the predicate through something this list does not name.
import { locsOf } from "./headers.mjs";

/** The bounds of FR-207, in seconds. `originS`: the origin must stop serving a removed gym. `cdnS`: pages, listings and the summary through the CDN. `sitemapS`: sitemaps. */
export const BOUNDS = Object.freeze({ originS: 60, cdnS: 300, sitemapS: 900, maxSMaxAgeS: 300 });

/** The number of published gyms at which a city becomes indexable (private.directory_indexable_min, migration 0170). Used only to know when the sitemap surface applies. */
export const INDEXABLE_MIN = 3;

/**
 * What every probe receives. `label` is the removed gym's page name (its subdomain), `country` and `city` the slugs of the listing it was in, `countBefore` the
 * number of gyms that listing showed BEFORE the removal, `locale` the language of the directory paths probed.
 * @typedef {{label:string, country:string, city:string, countBefore:number, locale:"en"|"fr", rootDomain:string, wwwLabel:string}} Ctx
 */

const ok200 = (r) => r.status === 200;
const body = (r) => (typeof r.body === "string" ? r.body : Buffer.from(r.body).toString("utf8"));
const dirPath = (ctx, ...rest) => `/${[ctx.locale, "gyms", ...rest].join("/")}`;

/** The number the city page's count sentence starts with (`<p class="count">3 gyms in Kribi</p>`), or null. */
export function cityPageCount(html) {
  const m = /<p class="count">\s*(\d+)\b/.exec(html);
  return m ? Number(m[1]) : null;
}

/** The number on the country page's card for `href` (`<a href="/en/gyms/cm/kribi">...<p>3 gyms</p>`), null when there is no such card. */
export function countryCardCount(html, href) {
  const i = html.indexOf(`href="${href}"`);
  if (i < 0) return null;
  const m = /<p>\s*(\d+)\b/.exec(html.slice(i, i + 600));
  return m ? Number(m[1]) : null;
}

/**
 * A probe result: `gone` (the surface no longer shows the gym), `responses` (status and headers of every answer it took, for the s-maxage check), `note` when
 * something was odd. `broken` is set when the probe could not read the surface at all (an unexpected status, a failed request, a page without its count, or a
 * not-found for a city that listed more than one gym): that is neither "shows the gym" nor "gone", and a pre-check must not read it as either.
 */
const probeResult = (gone, responses, note, broken = false) => ({ gone, responses: responses.map((r) => ({ status: r.status, headers: r.headers })), ...(note ? { note } : {}), ...(broken ? { broken: true } : {}) });

const unexpected = (what, r) => `${what} answered ${r.status}`;
const brokenResult = (what, r) => probeResult(false, [r], unexpected(what, r), true);
/** One removal takes a city from `countBefore` gyms to one fewer, so its listing disappears (404, or no card on the country page) only when it had exactly one. */
const emptiesCity = (ctx) => ctx.countBefore === 1;
const notEmptied = (what, ctx) => `${what} is missing though the city listed ${ctx.countBefore} gyms (one removal leaves ${ctx.countBefore - 1}): check --country, --city and --count-before`;

/**
 * The surfaces. `bound`: which FR-207 bound applies through the CDN ("cdn" 5 minutes, "sitemap" 15 minutes). `reads`: the public_site views the surface is
 * built from (the coverage test compares these with the readers of the visibility predicate). `applies(ctx)` is false when removal cannot change the surface
 * (the sitemap only changes when the city crosses the indexable line).
 */
export const SURFACES = [
  {
    id: "gym-page",
    name: "gym page (gym host /)",
    bound: "cdn",
    reads: ["public_site.pages"],
    applies: () => true,
    async probe(get, ctx) {
      const r = await get(ctx.label, "/");
      if (r.status === 404) return probeResult(true, [r]);
      return r.status === 200 ? probeResult(false, [r]) : brokenResult("the gym page", r);
    },
  },
  {
    id: "gym-sitemap",
    name: "gym-host /sitemap.xml",
    bound: "sitemap",
    reads: ["public_site.pages"],
    applies: () => true,
    async probe(get, ctx) {
      const r = await get(ctx.label, "/sitemap.xml");
      if (r.status === 404) return probeResult(true, [r]);
      return r.status === 200 ? probeResult(false, [r]) : brokenResult("the gym-host sitemap", r);
    },
  },
  {
    id: "city-row",
    name: "city listing row",
    bound: "cdn",
    reads: ["public_site.directory_gym"],
    applies: () => true,
    async probe(get, ctx) {
      const r = await get(ctx.wwwLabel, dirPath(ctx, ctx.country, ctx.city));
      if (r.status === 404) return emptiesCity(ctx) ? probeResult(true, [r]) : probeResult(false, [r], notEmptied("the city page", ctx), true); // the city has no gym left: the page is the not-found
      if (!ok200(r)) return brokenResult("the city page", r);
      const listed = body(r).includes(`//${ctx.label}.${ctx.rootDomain}/"`);
      return probeResult(!listed, [r]);
    },
  },
  {
    id: "city-count",
    name: "city listing count",
    bound: "cdn",
    reads: ["public_site.directory_city"],
    applies: () => true,
    async probe(get, ctx) {
      const r = await get(ctx.wwwLabel, dirPath(ctx, ctx.country, ctx.city));
      if (r.status === 404) return emptiesCity(ctx) ? probeResult(true, [r]) : probeResult(false, [r], notEmptied("the city page", ctx), true);
      if (!ok200(r)) return brokenResult("the city page", r);
      const n = cityPageCount(body(r));
      if (n === null) return probeResult(false, [r], "the city page has no count sentence", true);
      return probeResult(n < ctx.countBefore, [r], n < ctx.countBefore ? undefined : `the city page still counts ${n}`);
    },
  },
  {
    id: "country-count",
    name: "country page count",
    bound: "cdn",
    reads: ["public_site.directory_city", "public_site.directory_country"],
    applies: () => true,
    async probe(get, ctx) {
      const r = await get(ctx.wwwLabel, dirPath(ctx, ctx.country));
      if (r.status === 404) return emptiesCity(ctx) ? probeResult(true, [r]) : probeResult(false, [r], notEmptied("the country page", ctx), true); // the country has no gym left
      if (!ok200(r)) return brokenResult("the country page", r);
      const n = countryCardCount(body(r), dirPath(ctx, ctx.country, ctx.city));
      if (n === null) return emptiesCity(ctx) ? probeResult(true, [r]) : probeResult(false, [r], notEmptied("the city's card on the country page", ctx), true); // the city's card is gone: it had one gym
      return probeResult(n < ctx.countBefore, [r], n < ctx.countBefore ? undefined : `the country page's card still counts ${n}`);
    },
  },
  {
    id: "llms",
    name: "www /llms.txt",
    bound: "cdn",
    reads: ["public_site.pages"],
    applies: () => true,
    async probe(get, ctx) {
      const r = await get(ctx.wwwLabel, "/llms.txt");
      if (!ok200(r)) return brokenResult("llms.txt", r);
      const url = `//${ctx.label}.${ctx.rootDomain}/`;
      const listed = body(r).split("\n").some((l) => l.startsWith("url: ") && l.trimEnd().endsWith(url));
      return probeResult(!listed, [r]);
    },
  },
  {
    id: "www-sitemap",
    name: "www sitemap (/sitemaps/{n}.xml)",
    bound: "sitemap",
    reads: ["public_site.directory_city", "public_site.directory_country"],
    // a city leaves the sitemap when it drops under the indexable line: from exactly INDEXABLE_MIN gyms to one fewer
    applies: (ctx) => ctx.countBefore === INDEXABLE_MIN,
    notApplicable: (ctx) => `the city had ${ctx.countBefore} gyms (the sitemap lists a city at ${INDEXABLE_MIN} or more, so one fewer changes it only from exactly ${INDEXABLE_MIN})`,
    async probe(get, ctx) {
      const index = await get(ctx.wwwLabel, "/sitemap-index.xml");
      if (!ok200(index)) return brokenResult("the sitemap index", index);
      const responses = [index];
      const wanted = new Set(["en", "fr"].map((l) => `/${l}/gyms/${ctx.country}/${ctx.city}`));
      for (const loc of locsOf(body(index))) {
        let file;
        try {
          file = new URL(loc);
        } catch {
          continue;
        }
        const r = await get(ctx.wwwLabel, file.pathname);
        responses.push(r);
        if (!ok200(r)) return probeResult(false, responses, unexpected(`sitemap file ${file.pathname}`, r), true);
        for (const entry of locsOf(body(r))) {
          let path;
          try {
            path = new URL(entry).pathname;
          } catch {
            continue;
          }
          if (wanted.has(path)) return probeResult(false, responses);
        }
      }
      return probeResult(true, responses);
    },
  },
];

/**
 * Readers of the visibility predicate that are NOT a removal surface, each with the reason. A reader that is neither a surface's `reads` nor listed here fails
 * the coverage test: a new view over the predicate (Story 25.7 adds one) must be added to a surface, or exempted here with a reason, on purpose.
 */
export const NOT_A_SURFACE = Object.freeze({
  "public_site.page_media": "images referenced by the gym page; it has no listing of its own and goes with the gym-page surface (the media is served only inside a visible page)",
  "public_site.page_redirects": "the old-name 301 answers only while the page is visible; the 24.12 spec asserts that the old name stops redirecting after a takedown",
  "private.page_names_sweep": "the nightly sweep that decides whether a name is idle; a private function that exposes nothing to a visitor",
  "public_site.submit_page_report": "the report form's receiving function on the gym host; it answers `not_found` for a page that is not visible, behind the same visibility check as the gym page",
});

/** Every public_site relation the surfaces read, deduplicated. */
export const surfaceReads = () => [...new Set(SURFACES.flatMap((s) => s.reads))].sort();

/** Readers that are covered neither by a surface nor by NOT_A_SURFACE. */
export function uncoveredReaders(readers) {
  const covered = new Set([...surfaceReads(), ...Object.keys(NOT_A_SURFACE)]);
  return [...new Set(readers)].filter((r) => !covered.has(r)).sort();
}

/**
 * Names of the relations and functions that read `private.gym_page_visible` in a set of migrations (SQL text per file), found statically: every
 * `create [or replace] view|function <name>` whose statement mentions the predicate outside a comment. The predicate's own definition is not a reader.
 * @param {string[]} sqlTexts
 */
export function readersOfPredicate(sqlTexts) {
  const readers = new Set();
  for (const sql of sqlTexts) {
    const text = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    const heads = [...text.matchAll(/create\s+(?:or\s+replace\s+)?(?:materialized\s+)?(view|function)\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi)];
    for (let i = 0; i < heads.length; i++) {
      const start = heads[i].index;
      const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
      const name = heads[i][2].toLowerCase();
      const qualified = name.includes(".") ? name : `public.${name}`;
      if (qualified === "private.gym_page_visible") continue;
      if (/gym_page_visible/i.test(text.slice(start, end))) readers.add(qualified);
    }
  }
  return [...readers].sort();
}

/** `public_site.<name>` relations a set of landing-app source texts read. */
export function readersInLanding(sourceTexts) {
  const out = new Set();
  for (const t of sourceTexts) for (const m of t.matchAll(/public_site\.([a-z_][a-z0-9_]*)/g)) out.add(`public_site.${m[1]}`);
  return [...out].sort();
}

/** The `s-maxage` values (seconds) of a header map `{name: [values]}`, or null when no Cache-Control carries one. */
export function sMaxAge(headers) {
  const values = headers?.["cache-control"] ?? [];
  for (const v of values) {
    const m = /(?:^|[\s,])s-maxage=(\d+)/i.exec(v);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * One round of probes over `surfaces`, no waiting: which are gone right now. Used by the E2E spec to assert a gym is visible everywhere BEFORE it removes it,
 * so a measured removal is a removal that really happened.
 */
export async function probeAll({ get, ctx, surfaces = SURFACES }) {
  const out = {};
  for (const s of surfaces) {
    if (!s.applies(ctx)) continue;
    try {
      out[s.id] = await s.probe(get, ctx);
    } catch (e) {
      out[s.id] = { gone: false, responses: [], note: `request failed: ${e.message}`, broken: true };
    }
  }
  return out;
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls every applicable surface until it drops or its deadline passes. `since` is the time of the owner's action (ms since the epoch). Elapsed is
 * `drop time - since`; a surface already gone at the FIRST round is reported as `beforeFirstPoll` with the time of that round as an upper bound, never as 0 s.
 * @param {{get:Function, ctx:Ctx, since:number, boundS:number|{cdnS:number, sitemapS:number}, pollMs?:number, now?:()=>number, sleep?:(ms:number)=>Promise<void>, surfaces?:typeof SURFACES}} o
 *   `boundS`: the number of seconds after `since` that each surface may take (one number for all, or per kind)
 */
export async function pollRemoval({ get, ctx, since, boundS, pollMs = 500, now = Date.now, sleep = sleepMs, surfaces = SURFACES }) {
  const limitS = (s) => (typeof boundS === "number" ? boundS : s.bound === "sitemap" ? boundS.sitemapS : boundS.cdnS);
  const results = surfaces.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.bound,
    applicable: s.applies(ctx),
    notApplicable: s.applies(ctx) ? undefined : s.notApplicable?.(ctx),
    gone: false,
    elapsedMs: null,
    beforeFirstPoll: false,
    firstPollAfterMs: null,
    polls: 0,
    notes: [],
    sMaxAges: [],
    missingSMaxAge: false,
  }));
  const live = results.filter((r) => r.applicable);
  const by = new Map(surfaces.map((s) => [s.id, s]));

  for (let round = 0; ; round++) {
    const pending = live.filter((r) => !r.gone);
    for (const r of pending) {
      // stamped per surface, just before ITS probe: a surface probed late in a serial round must not claim the round's earlier time
      if (round === 0) r.firstPollAfterMs = now() - since;
      let p;
      try {
        p = await by.get(r.id).probe(get, ctx);
      } catch (e) {
        p = { gone: false, responses: [], note: `request failed: ${e.message}`, broken: true };
      }
      r.polls++;
      for (const resp of p.responses) {
        const age = sMaxAge(resp.headers);
        if (age === null) r.missingSMaxAge = true;
        else r.sMaxAges.push(age);
      }
      if (p.note && !r.notes.includes(p.note)) r.notes.push(p.note);
      if (p.gone) {
        r.gone = true;
        r.beforeFirstPoll = round === 0;
        r.elapsedMs = now() - since;
      }
    }
    const open = live.filter((r) => !r.gone && now() - since < limitS(by.get(r.id)) * 1000);
    if (open.length === 0) break;
    await sleep(pollMs);
  }
  return results;
}

/**
 * Judges poll results against FR-207.
 *   mode "origin" (a local run, or any run straight at the origin): every surface must drop within `originS` (60 s). The CDN (5 minutes) and sitemap (15 minutes)
 *     bounds are then BY CONSTRUCTION: `s-maxage` on every answer must be at most 300 s, and `s-maxage + origin time` must fit the bound. Recorded as such, never as measured.
 *   mode "cdn" (staging, the real CDN in front): the time to drop is measured against `cdnS` (300 s) and `sitemapS` (900 s).
 * `originS` can be overridden (the node tests use a few seconds). Returns the failures (each names the surface) and the lines to print.
 */
export function judgeRemoval(results, { mode = "origin", bounds = BOUNDS } = {}) {
  const failures = [];
  const lines = [];
  const limit = (r) => (mode === "origin" ? bounds.originS : r.kind === "sitemap" ? bounds.sitemapS : bounds.cdnS);
  const fmt = (ms) => `${(ms / 1000).toFixed(1)} s`;
  for (const r of results) {
    if (!r.applicable) {
      lines.push(`  ${r.name}: n/a (${r.notApplicable ?? "not affected by this removal"})`);
      continue;
    }
    const bound = limit(r);
    if (!r.gone) {
      failures.push(`${r.name}: still serving the removed gym after the ${bound} s bound${r.notes.length ? ` (${r.notes.join("; ")})` : ""}`);
      lines.push(`  ${r.name}: STILL SERVING after ${bound} s`);
      continue;
    }
    if (r.beforeFirstPoll) {
      // Gone at the first round: the time of that round is all that is known. Inside the bound it proves the bound; outside it proves nothing.
      if (r.firstPollAfterMs > bound * 1000) {
        failures.push(`${r.name}: gone before the first poll, but the first poll was ${fmt(r.firstPollAfterMs)} after --since, over the ${bound} s bound, so the time is not proven (run the tool right after the action)`);
        lines.push(`  ${r.name}: gone before the first poll (first poll ${fmt(r.firstPollAfterMs)} after --since: NOT PROVEN, over ${bound} s)`);
      } else {
        lines.push(`  ${r.name}: gone before the first poll (at most ${fmt(r.firstPollAfterMs)} after --since, within ${bound} s)`);
      }
    } else {
      lines.push(`  ${r.name}: gone ${fmt(r.elapsedMs)} after --since (bound ${bound} s)`);
      if (r.elapsedMs > bound * 1000) failures.push(`${r.name}: took ${fmt(r.elapsedMs)} to leave, over the ${bound} s bound`);
    }
    // Origin mode only: the CDN bound is shown by the header, so no s-maxage is no bound at all. In cdn mode the measured time is the proof (and on Vercel the
    // client-visible Cache-Control drops s-maxage, so the header cannot be judged there).
    const worst = r.sMaxAges.length ? Math.max(...r.sMaxAges) : null;
    if (mode === "origin" && r.missingSMaxAge) failures.push(`${r.name}: an answer carries no s-maxage, so the CDN bound cannot be shown`);
    if (mode === "origin" && worst !== null && worst > bounds.maxSMaxAgeS) failures.push(`${r.name}: s-maxage ${worst} s is over ${bounds.maxSMaxAgeS} s`);
    if (mode === "origin" && worst !== null) {
      // The CDN keeps a copy for at most s-maxage, so a page, listing or summary is stale for at most that long: the 5 minute bound is the header. A sitemap is
      // fetched later again by a crawler, so the 15 minute bound is the header plus the time the origin took.
      const seen = Math.ceil((r.beforeFirstPoll ? r.firstPollAfterMs : r.elapsedMs) / 1000);
      if (r.kind === "sitemap") {
        const total = worst + seen;
        lines.push(`    through a CDN, by construction (not measured): s-maxage ${worst} s + ${seen} s at the origin = ${total} s, bound ${bounds.sitemapS} s`);
        if (total > bounds.sitemapS) failures.push(`${r.name}: by construction it can take ${total} s (s-maxage ${worst} s + ${seen} s at the origin), over the ${bounds.sitemapS} s bound`);
      } else {
        lines.push(`    through a CDN, by construction (not measured): s-maxage ${worst} s, bound ${bounds.cdnS} s`);
        if (worst > bounds.cdnS) failures.push(`${r.name}: s-maxage ${worst} s is over the ${bounds.cdnS} s CDN bound`);
      }
    }
  }
  return { failures, lines };
}
