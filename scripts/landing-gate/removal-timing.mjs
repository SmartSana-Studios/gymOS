#!/usr/bin/env node
// Story 25.6 (FR-207, FR-211..FR-214): how long a removed gym keeps showing on each public surface. Run it RIGHT AFTER the action (unpublish, takedown or
// suspension); it creates, publishes and removes nothing. It polls the gym page, the gym-host sitemap, the city listing row and count, the country page count,
// www /llms.txt and (when the city crossed the indexable line) the www sitemap until each drops, then prints the elapsed time per surface against the bounds.
//
//   BASE_URL=... ROOT_DOMAIN=... node scripts/landing-gate/removal-timing.mjs \
//       --since 2026-11-12T10:15:00Z --label <page name> --country cm --city <city slug> --count-before 3 [--cause unpublish|takedown|suspension] [--locale en|fr]
//
//   --since          the time of the owner's action (ISO 8601). Required: without it the tool cannot know what to measure (exit 2).
//   --label          the removed gym's page name (its subdomain). Locally GATE_LABEL_REMOVED works too.
//   --country/--city the slugs of the listing the gym was in. --count-before: how many gyms that city listing showed BEFORE the removal (read it first).
//   --mode           origin (default when ROOT_DOMAIN is localhost): every surface within 60 s; the CDN (5 min) and sitemap (15 min) bounds are shown BY CONSTRUCTION
//                    (s-maxage <= 300 s on every answer). cdn (default elsewhere, staging): the time is measured against 300 s (pages, listings, llms.txt) and 900 s (sitemaps).
//   --bound-seconds  overrides the origin bound (60), for the kit's own tests.
//
//   --check-visible BEFORE the action (needs no --since; export BASE_URL and ROOT_DOMAIN first): requests every surface once and exits 1 naming each one that does NOT
//                    show the gym or could not be read (a 5xx, a refused connection), so a mistyped --label or --city, a gym that is not live, a row on page 2 of the
//                    listing or a wrong target is found before it can read as "gone before the first poll". Exit 0: all show it.
//
// Exit 0: every surface dropped within its bound. Exit 1: a surface kept the gym past its bound, an answer has no s-maxage or one over 300 s, or a time cannot be proven. Exit 2: usage.
import { parseArgs } from "node:util";
import { config, targetFor } from "./lib/config.mjs";
import { rawGet } from "./lib/http.mjs";
import { BOUNDS, INDEXABLE_MIN, SURFACES, judgeRemoval, pollRemoval, probeAll } from "./lib/removal.mjs";

const usage = (msg) => {
  console.error(`removal-timing: ${msg}`);
  console.error("usage: removal-timing.mjs [--check-visible | --since <ISO time>] --label <page name> --country <cc> --city <slug> --count-before <n> [--cause unpublish|takedown|suspension] [--locale en|fr] [--mode origin|cdn] [--bound-seconds n]");
  process.exit(2);
};

let values;
try {
  ({ values } = parseArgs({
    options: {
      since: { type: "string" },
      label: { type: "string" },
      country: { type: "string" },
      city: { type: "string" },
      "count-before": { type: "string" },
      cause: { type: "string" },
      locale: { type: "string" },
      mode: { type: "string" },
      "bound-seconds": { type: "string" },
      "poll-ms": { type: "string" },
      "check-visible": { type: "boolean" },
    },
  }));
} catch (e) {
  usage(e.message);
}

const checkVisible = values["check-visible"] === true;
let since = NaN;
if (!checkVisible) {
  if (!values.since) usage("--since <ISO time of the action> is required");
  since = Date.parse(values.since);
  if (!Number.isFinite(since)) usage(`--since ${values.since} is not a time (use ISO 8601, e.g. 2026-11-12T10:15:00Z)`);
  // a start in the future would make every elapsed time negative and every surface "within the bound"
  if (since - Date.now() > 5000) usage(`--since ${values.since} is more than 5 s in the future (a typo, or a clock that is behind?)`);
}
const label = values.label ?? process.env.GATE_LABEL_REMOVED;
if (!label) usage("--label <the removed gym's page name> is required");
const country = (values.country ?? config.directory.country ?? "").toLowerCase();
const city = (values.city ?? config.directory.city ?? "").toLowerCase();
if (!country || !city) usage("--country and --city (the slugs of the listing the gym was in) are required");
const countBefore = Number(values["count-before"]);
if (!Number.isInteger(countBefore) || countBefore < 1) usage("--count-before <n> (the number of gyms the city listing showed before the removal) is required");
const locale = values.locale ?? "en";
if (!["en", "fr"].includes(locale)) usage("--locale is en or fr");
const mode = values.mode ?? (config.rootDomain === "localhost" ? "origin" : "cdn");
if (!["origin", "cdn"].includes(mode)) usage("--mode is origin or cdn");
const originS = values["bound-seconds"] === undefined ? BOUNDS.originS : Number(values["bound-seconds"]);
if (!(originS > 0)) usage("--bound-seconds must be a positive number");
const pollMs = Number(values["poll-ms"] ?? 500);
if (!(pollMs >= 50)) usage(`--poll-ms must be a number of at least 50, got ${values["poll-ms"]}`);
const cause = values.cause ?? "unspecified";
const envLabel = process.env.GATE_ENV_LABEL ?? (mode === "origin" ? "local, origin" : "staging, through the CDN");

const get = async (lbl, path, headers = {}) => {
  const r = await rawGet(targetFor(lbl, path, config), { headers, timeoutMs: 15_000 });
  return { status: r.status, headers: r.headers, body: r.body.toString("utf8") };
};

const ctx = { label, country, city, countBefore, locale, rootDomain: config.rootDomain, wwwLabel: config.directory.label };

if (checkVisible) {
  console.log(`removal-timing --check-visible (${envLabel}): gym ${label}.${config.rootDomain}, listing /${locale}/gyms/${country}/${city} (${countBefore} gyms)`);
  const state = await probeAll({ get, ctx });
  const missing = [];
  for (const surface of SURFACES) {
    if (!surface.applies(ctx)) {
      console.log(`  ${surface.name}: n/a (${surface.notApplicable?.(ctx) ?? "not affected by this removal"})`);
      continue;
    }
    const r = state[surface.id];
    // a surface that could not be read (5xx, request failed, no count sentence) neither shows the gym nor proves it gone: it is not a pass
    if (r.gone) missing.push(`${surface.name} does not show the gym`);
    else if (r.broken) missing.push(`${surface.name} could not be read`);
    console.log(`  ${surface.name}: ${r.gone ? "NOT SHOWING THE GYM" : r.broken ? "COULD NOT BE READ" : "shows the gym"}${r.note ? ` (${r.note})` : ""}`);
  }
  if (missing.length) {
    console.log(`\nremoval-timing --check-visible: FAIL (${missing.length}) (${envLabel})`);
    for (const m of missing) console.log(`  - ${m}: check BASE_URL and ROOT_DOMAIN, --label, --city, --country, --count-before and that the gym is live (a listing row on page 2 is not seen)`);
    process.exit(1);
  }
  console.log(`\nremoval-timing --check-visible: PASS, every applicable surface shows the gym (${envLabel})`);
  process.exit(0);
}

const bounds = { ...BOUNDS, originS };
const boundS = mode === "origin" ? originS : { cdnS: BOUNDS.cdnS, sitemapS: BOUNDS.sitemapS };

console.log(`removal-timing (${envLabel}): cause ${cause}, gym ${label}.${config.rootDomain}, listing /${locale}/gyms/${country}/${city} (${countBefore} gyms before)`);
console.log(`  since ${new Date(since).toISOString()}; mode ${mode}; bounds: ${mode === "origin" ? `origin ${originS} s` : `CDN ${BOUNDS.cdnS} s, sitemap ${BOUNDS.sitemapS} s`}; s-maxage at most ${BOUNDS.maxSMaxAgeS} s; sitemap surface applies at exactly ${INDEXABLE_MIN} gyms`);

const results = await pollRemoval({ get, ctx, since, boundS, pollMs, surfaces: SURFACES });
const verdict = judgeRemoval(results, { mode, bounds });
for (const l of verdict.lines) console.log(l);
if (mode === "origin") console.log("  The CDN and sitemap bounds above are by construction (header and origin time), NOT measured; they are measured only by a run with --mode cdn on staging.");

if (verdict.failures.length) {
  console.log(`\nremoval-timing: FAIL (${verdict.failures.length}) (${envLabel})`);
  for (const f of verdict.failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nremoval-timing: PASS (${envLabel}; ${mode === "origin" ? "origin measured, CDN by construction" : "measured through the CDN"})`);
