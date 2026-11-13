#!/usr/bin/env node
// Story 24.12 (NFR-024, deferred-work 24.10 items): a label scan against the landing server while the core product is probed.
//
//   BASE_URL=... ROOT_DOMAIN=... GATE_ADMIN_DB_URL=... GATE_CORE_* ... node scripts/landing-gate/load.mjs
//
// 1. Reads the reader role's CONNECTION LIMIT from pg_roles (never hard-coded).
// 2. Baseline: the two core probes (dashboard Overview page load, check-in RPC round trip) with no scan.
// 3. The scan: random grammar-valid labels (mostly unknown, some real) at stepped concurrency, while pg_stat_activity is sampled every second
//    for the role and the same two probes run.
// 4. Judges (lib/load.mjs): peak connections must not exceed the limit; either probe over its budget (Overview 2 s, check-in 3 s) or more than
//    25% over its baseline median fails; any error or a real page answered with the cached 404 fails. Unknown-label latency is reported next to
//    real-label latency (the two serial reads per unknown label are settled by this run).
//
// Story 25.6: GATE_LOAD_DIRECTORY_SHARE (default 0.2) of the requests are directory pages on www (top, country, city) with random `?x=<n>` and `?page=<n>` values (past the last
// page too, which must answer the uniform 404) and stale `?category=` filters. They run against the same connection ceiling; their latency is reported separately.
// Needs GATE_DIRECTORY_COUNTRY / GATE_DIRECTORY_CITY (set locally); `run-local.sh` seeds a 46-gym city so the pages are real.
//
// Knobs: GATE_LOAD_STEPS="2,8,24,64" (concurrent clients per step), GATE_LOAD_STEP_SECONDS=15, GATE_LOAD_REAL_SHARE=0.1, GATE_LOAD_SEED=1,
// GATE_LOAD_DIRECTORY_SHARE=0.2, GATE_CORE_BASELINE_SECONDS=20, GATE_ENV_LABEL="lab, local".
import http from "node:http";
import https from "node:https";
import { config, targetFor } from "./lib/config.mjs";
import { rawGet } from "./lib/http.mjs";
import { loadPg } from "./lib/resolve.mjs";
import { pickLabel, rng } from "./lib/labels.mjs";
import { BUDGETS, classify, classifyDirectory, emptyTally, judge, pageCountFor, pickDirectoryRequest, tally } from "./lib/load.mjs";
import { cityPageCount } from "./lib/removal.mjs";
import { coreEnv, measureBaseline, startCoreProbes } from "./lib/core-probe.mjs";
import { median, p95 } from "./lib/stats.mjs";

const steps = (process.env.GATE_LOAD_STEPS ?? "2,8,24,64").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
const stepSeconds = Number(process.env.GATE_LOAD_STEP_SECONDS ?? 15);
const realShare = Number(process.env.GATE_LOAD_REAL_SHARE ?? 0.1);
const seed = Number(process.env.GATE_LOAD_SEED ?? 1);
const baselineSeconds = Number(process.env.GATE_CORE_BASELINE_SECONDS ?? 20);
const envLabel = process.env.GATE_ENV_LABEL ?? "lab, local";
const core = coreEnv();
const L = config.labels;
const directoryShare = config.loadDirectoryShare;
if (!(directoryShare >= 0 && directoryShare <= 1)) {
  console.error("load: GATE_LOAD_DIRECTORY_SHARE must be between 0 and 1");
  process.exit(2);
}
const log = (s = "") => console.log(s);

async function reachable() {
  const r = await rawGet(targetFor(L.published, "/"));
  if (r.status !== 200) throw new Error(`the published label ${L.published} answers ${r.status}, not 200: seed the fixtures first (run-local.sh does)`);
}

function agentFor(url) {
  const lib = url.startsWith("https:") ? https : http;
  return new lib.Agent({ keepAlive: true, maxSockets: 256 });
}

/** The real page count of the city listing (from its own count sentence), or null when the directory mix is off or the listing is not configured. */
async function directoryWhere() {
  if (directoryShare === 0) return null;
  const { country, city, label } = config.directory;
  if (!country || !city) {
    log("directory mix: OFF (set GATE_DIRECTORY_COUNTRY and GATE_DIRECTORY_CITY to a city listing to include directory pages)");
    return null;
  }
  const r = await rawGet(targetFor(label, `/en/gyms/${country}/${city}`));
  if (r.status !== 200) throw new Error(`the city listing /en/gyms/${country}/${city} answers ${r.status}, not 200: seed the directory first (run-local.sh does)`);
  const count = cityPageCount(r.body.toString("utf8"));
  if (count === null) throw new Error("the city listing has no count sentence");
  return { country, city, pages: pageCountFor(count), count, label };
}

async function main() {
  const { Client } = loadPg();
  const admin = new Client({ connectionString: config.adminDbUrl });
  await admin.connect();
  const { rows: lim } = await admin.query("select rolconnlimit from pg_roles where rolname = $1", [config.readerRole]);
  if (lim.length === 0) throw new Error(`role ${config.readerRole} not found in pg_roles`);
  const limit = Number(lim[0].rolconnlimit);
  log(`load: ${config.baseUrl} root ${config.rootDomain}; ${config.readerRole} CONNECTION LIMIT ${limit} (from pg_roles); steps ${steps.join(", ")} x ${stepSeconds}s; real share ${realShare}; seed ${seed}; ${envLabel}`);

  await reachable();
  const where = await directoryWhere();
  if (where) log(`directory mix: ${(directoryShare * 100).toFixed(0)}% of requests on ${where.label}: top, /${where.country}, /${where.country}/${where.city} (${where.count} gyms, ${where.pages} pages) with random ?x= and ?page= values`);

  let baseline = null;
  let baselineErrors = null;
  if (core) {
    log(`baseline: core probes with no scan for ${baselineSeconds}s ...`);
    const b = await measureBaseline(core, baselineSeconds);
    baseline = b.samples;
    baselineErrors = { n: b.errors.length, of: b.attempts.overview + b.attempts.checkIn };
    if (b.errors.length) log(`  baseline probe errors: ${[...new Set(b.errors)].slice(0, 3).join("; ")}`);
    log(`  baseline: overview median ${baseline.overview.length ? median(baseline.overview).toFixed(0) : "n/a"} ms (${baseline.overview.length} samples), check-in median ${baseline.checkIn.length ? median(baseline.checkIn).toFixed(0) : "n/a"} ms (${baseline.checkIn.length} samples)`);
  } else {
    log("core probes: GATE_CORE_* is not set; the gate fails without them");
  }

  // connection sampler: every second, the role's backends
  let peak = 0;
  let sampling = true;
  const connSamples = [];
  const sampler = (async () => {
    while (sampling) {
      try {
        const { rows } = await admin.query("select count(*)::int as n from pg_stat_activity where usename = $1", [config.readerRole]);
        const n = rows[0].n;
        connSamples.push(n);
        if (n > peak) peak = n;
      } catch (e) {
        log(`  sampler: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  const probes = core ? await startCoreProbes(core) : null;
  const all = emptyTally();
  const real = emptyTally();
  const unknown = emptyTally();
  const dir = emptyTally();
  const errorsSeen = new Map();
  const next = rng(seed);

  for (const clients of steps) {
    const agent = agentFor(config.baseUrl);
    const stepTally = emptyTally();
    const until = performance.now() + stepSeconds * 1000;
    const worker = async () => {
      while (performance.now() < until) {
        if (where && next() < directoryShare) {
          const pick = pickDirectoryRequest(next, where);
          let outcome;
          let ms = null;
          try {
            const res = await rawGet(targetFor(where.label, pick.path), { agent });
            ms = res.ms;
            outcome = classifyDirectory({ expected: pick.expected, status: res.status });
            if (outcome === "error") errorsSeen.set(`directory ${pick.kind} status ${res.status} (wanted ${pick.expected})`, (errorsSeen.get(`directory ${pick.kind} status ${res.status} (wanted ${pick.expected})`) ?? 0) + 1);
          } catch (e) {
            outcome = "error";
            errorsSeen.set(`directory ${e.code ?? e.message}`, (errorsSeen.get(`directory ${e.code ?? e.message}`) ?? 0) + 1);
          }
          for (const t of [all, dir, stepTally]) tally(t, outcome, ms);
          continue;
        }
        const { label, real: isReal } = pickLabel(next, [L.published], realShare);
        let outcome;
        let ms = null;
        try {
          const res = await rawGet(targetFor(label, "/"), { agent });
          ms = res.ms;
          outcome = classify({ real: isReal, status: res.status });
          if (outcome === "error") errorsSeen.set(`status ${res.status}`, (errorsSeen.get(`status ${res.status}`) ?? 0) + 1);
        } catch (e) {
          outcome = "error"; // a transport error has no latency: counted as an error only
          errorsSeen.set(e.code ?? e.message, (errorsSeen.get(e.code ?? e.message) ?? 0) + 1);
        }
        for (const t of [all, isReal ? real : unknown, stepTally]) tally(t, outcome, ms);
      }
    };
    await Promise.all(Array.from({ length: clients }, worker));
    agent.destroy();
    log(`  step ${String(clients).padStart(3)} clients: ${stepTally.requests} requests (${(stepTally.requests / stepSeconds).toFixed(0)}/s), ok ${stepTally.ok}, unknown 404 ${stepTally.unknownOk}, real-as-404 ${stepTally.realNotFound}, directory ok ${stepTally.dirOk}, errors ${stepTally.error}; p95 ${stepTally.latencies.length ? p95(stepTally.latencies).toFixed(0) : "n/a"} ms; role connections now ${connSamples.at(-1) ?? "?"}, peak so far ${peak}`);
  }

  let withScan = null;
  let probeErrors = [];
  let scanErrors = null;
  if (probes) {
    const r = await probes.stop();
    withScan = r.samples;
    probeErrors = r.errors;
    scanErrors = { n: r.errors.length, of: r.attempts.overview + r.attempts.checkIn };
  }
  sampling = false;
  await sampler;
  await admin.end();

  const verdict = judge({ peak, limit, samples: connSamples.length, tally: all, directory: { expected: where !== null, tally: dir }, core: core && baseline && withScan ? { baseline, withScan, errors: { baseline: baselineErrors, withScan: scanErrors } } : null });

  log();
  log(`Load result (${envLabel}; the scan, the server, the database and the probes share one machine, so every figure is a floor)`);
  log(`  requests ${all.requests}: real pages 200 ${real.ok}, real pages answered 404 ${real.realNotFound}, unknown labels 404 ${unknown.unknownOk}, directory pages as expected ${dir.dirOk} of ${dir.requests}, errors ${all.error}`);
  if (errorsSeen.size) log(`  error kinds: ${[...errorsSeen].map(([k, v]) => `${k} x${v}`).join(", ")}`);
  if (real.latencies.length) log(`  real label latency: median ${median(real.latencies).toFixed(0)} ms, p95 ${p95(real.latencies).toFixed(0)} ms (one read)`);
  if (dir.latencies.length) log(`  directory latency (reported separately; a city page runs up to four reads on the one pooled connection): median ${median(dir.latencies).toFixed(0)} ms, p95 ${p95(dir.latencies).toFixed(0)} ms (${dir.latencies.length} requests)`);
  if (unknown.latencies.length) log(`  unknown label latency: median ${median(unknown.latencies).toFixed(0)} ms, p95 ${p95(unknown.latencies).toFixed(0)} ms (two serial reads: page then redirect)`);
  log(`  role connections: peak ${peak} of a limit of ${limit} (${connSamples.length} one-second samples)`);
  if (withScan) {
    log(`  core probes with the scan: overview ${withScan.overview.length} samples, check-in ${withScan.checkIn.length} samples${probeErrors.length ? `; probe errors: ${[...new Set(probeErrors)].slice(0, 3).join("; ")}` : ""}`);
  }
  for (const n of verdict.notes) log(`  ${n}`);
  log(`  budgets: Overview page load ${BUDGETS.overviewMs} ms, check-in round trip ${BUDGETS.checkInMs} ms, median rise at most ${BUDGETS.regressionPct}%${BUDGETS.regressionFloorMs > 0 ? ` (and ${BUDGETS.regressionFloorMs} ms)` : ""}`);

  if (verdict.failures.length) {
    log(`\nload: FAIL (${verdict.failures.length})`);
    for (const f of verdict.failures) log(`  - ${f}`);
    process.exit(1);
  }
  log(`\nload: PASS (${envLabel})`);
}

main().catch((e) => {
  console.log(`load: FAIL, could not complete: ${e.message}`);
  process.exit(1);
});
