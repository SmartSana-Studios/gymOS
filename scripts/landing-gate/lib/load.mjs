// The pure part of the label-scan load check: how a response is classified and how the whole run is judged. No network, so the known-bad cases
// (connections over the limit, a slow core probe, a cached 404 for a real label) run in the unit tests.
import { median, p95, regressed } from "./stats.mjs";

/** Budgets from the story: Overview page load 2 s, scan to alert 3 s (here: the check-in RPC round trip, the part the scan could slow). */
export const BUDGETS = Object.freeze({ overviewMs: 2000, checkInMs: 3000, regressionPct: 25, regressionFloorMs: 0, probeErrorRisePoints: 2 });

/** @returns {"ok"|"unknownOk"|"realNotFound"|"error"} */
export function classify({ real, status }) {
  if (real) return status === 200 ? "ok" : status === 404 ? "realNotFound" : "error";
  return status === 404 ? "unknownOk" : "error";
}

export function emptyTally() {
  return { requests: 0, ok: 0, unknownOk: 0, realNotFound: 0, dirOk: 0, error: 0, latencies: [] };
}

// Story 25.6: the directory share of the scan (deferred-work "load check to the directory routes", 25.3 review). A directory page costs up to four reads on the
// reader's one pooled connection (a city page), and a varying query string is a new CDN key, so a scan can reach the database at will: the mix uses random
// `?x=<n>` values and random `?page=<n>` values, past the last page too.

/** Gyms per directory page (apps/landing/lib/directory/types.ts DIRECTORY_PAGE_SIZE). */
export const DIRECTORY_PAGE_SIZE = 20;
export const DIRECTORY_CATEGORIES = ["gym", "pilates_studio", "yoga_studio", "fitness_center", "other"];

/** @returns {"dirOk"|"error"} a directory answer is right when it is the status the request was built to get (200, or the uniform 404 past the last page). */
export function classifyDirectory({ expected, status }) {
  return status === expected ? "dirOk" : "error";
}

/** How many pages a listing of `count` gyms has. */
export const pageCountFor = (count) => Math.max(1, Math.ceil(count / DIRECTORY_PAGE_SIZE));

/**
 * One directory request: a top, country or city page in a random language with a random query. `pages` is the real page count of the city listing, so a
 * `?page=` past it is built to answer the uniform 404. Returns the path (with query) and the status it must answer.
 * @param {()=>number} next  the seeded generator
 * @param {{country:string, city:string, pages:number}} where
 */
export function pickDirectoryRequest(next, { country, city, pages }) {
  const locale = next() < 0.5 ? "en" : "fr";
  const r = next();
  const kind = r < 0.15 ? "top" : r < 0.35 ? "country" : "city";
  const base = kind === "top" ? `/${locale}/gyms` : kind === "country" ? `/${locale}/gyms/${country}` : `/${locale}/gyms/${country}/${city}`;
  const q = next();
  let query = "";
  let expected = 200;
  if (q < 0.4) {
    query = `?x=${Math.floor(next() * 1e9)}`; // a cache-busting query on any page
  } else if (q < 0.8) {
    const n = next() < 0.75 ? 1 + Math.floor(next() * pages) : pages + 1 + Math.floor(next() * 50);
    query = `?page=${n}`;
    // only a city listing has pages: the top and country pages ignore the parameter; a city page past the last is the uniform not-found
    if (kind === "city" && n > pages) expected = 404;
  } else if (q < 0.9 && kind === "city") {
    query = `?category=${DIRECTORY_CATEGORIES[Math.floor(next() * DIRECTORY_CATEGORIES.length)]}`; // a stale filter is a 200 with a message
  }
  return { path: `${base}${query}`, expected, kind };
}

export function tally(t, outcome, ms) {
  t.requests++;
  t[outcome]++;
  if (typeof ms === "number" && Number.isFinite(ms)) t.latencies.push(ms);
}

/**
 * `samples` is how many one-second pg_stat_activity samples were taken; `peak` is the highest session count seen. Postgres refuses a connection above the
 * role's limit, so `peak > limit` can never be observed: a peak AT the limit means the role was saturated. A sampler that saw no session at all while
 * requests were made proves nothing (wrong role, wrong database, no rights) and fails.
 * `directory` (Story 25.6): `{expected, tally}`, the tally of the directory requests of the same run (their errors are already part of `tally`).
 * @param {{peak:number, limit:number, samples?:number, tally:object, directory?:{expected:boolean, tally:object}|null, core:null|{baseline:{overview:number[], checkIn:number[]}, withScan:{overview:number[], checkIn:number[]}, errors?:{baseline:{n:number, of:number}, withScan:{n:number, of:number}}}}} run
 * @returns {{failures:string[], notes:string[]}}
 */
export function judge({ peak, limit, samples = 1, tally: t, core, directory = null }, budgets = BUDGETS) {
  const failures = [];
  const notes = [];
  if (!(limit > 0)) failures.push(`the role has no usable CONNECTION LIMIT (rolconnlimit ${limit}): a scan could take every connection`);
  else if (peak >= limit) failures.push(`peak role connections ${peak} reached the role's CONNECTION LIMIT ${limit}: the role was saturated (Postgres refuses connections above the limit, so a peak can only reach it)`);
  else notes.push(`peak role connections ${peak} of a limit of ${limit}`);
  if (t.requests > 0 && (samples === 0 || peak === 0)) failures.push(`the connection sampler saw no session of the role (${samples} samples, peak ${peak}) while ${t.requests} requests were made: it watched the wrong role or database, or lacks the right to read pg_stat_activity, so the connection check proves nothing`);
  if (t.error > 0) failures.push(`${t.error} request(s) failed (a transport error, a 5xx, or an unexpected status)`);
  if (t.realNotFound > 0) failures.push(`${t.realNotFound} request(s) for a REAL page answered the cached not-found (the reader pool or the database failed under load)`);
  if (t.requests === 0) failures.push("no request was made");
  // Story 25.6: when the scan was meant to include directory pages, a run that sent none proves nothing about them
  if (directory?.expected && directory.tally.requests === 0) failures.push("the scan was to include directory requests and made none");
  if (directory?.tally.error > 0) failures.push(`${directory.tally.error} directory request(s) answered something other than the status they were built to get (200, or the uniform 404 past the last page)`);

  if (!core) {
    failures.push("the core-product probes did not run (set the GATE_CORE_* variables; run-local.sh does it); the gate cannot be claimed without them");
  } else {
    for (const [name, label, budget] of [["overview", "dashboard Overview load", budgets.overviewMs], ["checkIn", "check-in RPC round trip", budgets.checkInMs]]) {
      const base = core.baseline[name];
      const scan = core.withScan[name];
      if (base.length < 5 || scan.length < 5) {
        failures.push(`${label}: too few samples (${base.length} without the scan, ${scan.length} with it)`);
        continue;
      }
      const mb = median(base);
      const ms = median(scan);
      const p = p95(scan);
      notes.push(`${label}: median ${mb.toFixed(0)} ms without the scan, ${ms.toFixed(0)} ms with it (${(((ms - mb) / mb) * 100).toFixed(0)}%), p95 with the scan ${p.toFixed(0)} ms (budget ${budget} ms)`);
      if (p > budget) failures.push(`${label}: p95 ${p.toFixed(0)} ms with the scan is over the ${budget} ms budget`);
      if (regressed(mb, ms, { pct: budgets.regressionPct, floorMs: budgets.regressionFloorMs })) {
        failures.push(`${label}: median rose from ${mb.toFixed(0)} ms to ${ms.toFixed(0)} ms (over ${budgets.regressionPct}%${budgets.regressionFloorMs > 0 ? ` and over ${budgets.regressionFloorMs} ms` : ""})`);
      }
    }
  }
  // A probe that FAILS (not just slows) while the scan runs is a core-product failure too. Compared with the same probes without the scan, so a
  // flake of the stack under test (see decisions.md 24.12, Kong keep-alive resets) is not blamed on the scan: the error rate may not rise by more than
  // `probeErrorRisePoints` percentage points.
  if (core?.errors) {
    const rate = (e) => (e.of > 0 ? (e.n / e.of) * 100 : 0);
    const b = core.errors.baseline;
    const s = core.errors.withScan;
    notes.push(`core probe errors: ${b.n} of ${b.of} without the scan, ${s.n} of ${s.of} with it`);
    if (rate(s) - rate(b) > budgets.probeErrorRisePoints) failures.push(`core probes failed ${s.n} of ${s.of} times with the scan (${rate(s).toFixed(1)}%) against ${b.n} of ${b.of} without it (${rate(b).toFixed(1)}%)`);
  }
  return { failures, notes };
}
