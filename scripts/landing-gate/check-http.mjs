#!/usr/bin/env node
// Story 24.12 (NFR-025, AD-44): real HTTP requests against a running landing server.
//
//   BASE_URL=http://127.0.0.1:3200 ROOT_DOMAIN=localhost node scripts/landing-gate/check-http.mjs
//
// 1. A published page, a not-found and a redirect each carry the EXACT header set of their kind (CSP string, nosniff, referrer policy, HSTS,
//    Cache-Control, Vary, no Set-Cookie) and nothing else. The headers Next.js (and, on staging, the platform) add are printed, and any other
//    header fails the run.
// 2. The not-found of an unknown, an unpublished, a taken-down, a suspended and a reserved label is byte-identical: status, every header but
//    Date, body.
import { config, targetFor, schemeFor, missingStagingLabels } from "./lib/config.mjs";
import { rawGet } from "./lib/http.mjs";
import { checkResponse, diffResponses } from "./lib/headers.mjs";

const L = config.labels;
const fail = [];
const note = (s) => console.log(s);
const get = (label, path = "/") => rawGet(targetFor(label, path));

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
