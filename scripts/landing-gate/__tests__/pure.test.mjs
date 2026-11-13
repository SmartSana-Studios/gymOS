// Story 24.12: the pure parts of the landing-page gate kit. No network, no database, no browser: each check is shown able to fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile, p75, median, regressed } from "../lib/stats.mjs";
import { isGrammarValid, pickLabel, randomLabel, rng } from "../lib/labels.mjs";
import { MIN_RUNS, summarise } from "../lib/lcp.mjs";
import { BUDGETS, DIRECTORY_PAGE_SIZE, classify, classifyDirectory, emptyTally, judge, pageCountFor, pickDirectoryRequest, tally } from "../lib/load.mjs";
import { targetFor, browserUrlFor, missingStagingLabels } from "../lib/config.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isValidPageName } from "../../../packages/types/src/constants/pageNameGrammar.ts";

const reserved = JSON.parse(readFileSync(new URL("../../../packages/types/src/constants/reservedLabels.json", import.meta.url), "utf8"));
const isReservedLabel = (l) => reserved.labels.includes(l) || reserved.prefixes.some((p) => l.startsWith(p));

test("p75 is nearest-rank: the smallest value with 75% of the samples at or below it", () => {
  assert.equal(p75([1, 2, 3, 4]), 3);
  assert.equal(p75([10, 20, 30, 40, 50, 60, 70, 80]), 60);
  assert.equal(p75([5]), 5);
  assert.equal(p75(Array.from({ length: 20 }, (_, i) => i + 1)), 15);
  // order does not matter and the input is not mutated
  const v = [9, 1, 5, 3];
  assert.equal(p75(v), 5);
  assert.deepEqual(v, [9, 1, 5, 3]);
  assert.equal(percentile([1, 2, 3, 4], 100), 4);
});
test("p75 refuses no samples and a bad percentile instead of inventing a number", () => {
  assert.throws(() => p75([]), /no samples/);
  assert.throws(() => percentile([1], 0), /\(0, 100\]/);
  assert.throws(() => median([]), /no samples/);
});
test("median of an even and an odd count", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});
test("a rise counts when it is over the percentage; the absolute floor is 0 by default and stays an option", () => {
  assert.equal(regressed(100, 130), true);
  assert.equal(regressed(100, 124), false); // 24%
  assert.equal(regressed(13, 40), true); // a 13 ms check-in that triples is a regression, however small in milliseconds
  assert.equal(regressed(2, 5, { floorMs: 20 }), false); // the option still works
  assert.equal(regressed(1000, 1260), true);
  assert.equal(regressed(100, 90), false);
  assert.equal(BUDGETS.regressionFloorMs, 0);
});

test("random labels are always grammar-valid and never reserved (so they reach the database, not the proxy)", () => {
  const next = rng(42);
  for (let i = 0; i < 5000; i++) {
    const l = randomLabel(next);
    assert.ok(isGrammarValid(l), l);
    assert.ok(isValidPageName(l), `the real grammar rejects ${l}`);
    assert.ok(!isReservedLabel(l), `${l} is reserved`);
  }
});
test("the kit's grammar check agrees with the product grammar on the known edges", () => {
  for (const l of ["abc", "a-b-c", "gym-1", "a".repeat(30)]) assert.equal(isGrammarValid(l), isValidPageName(l), l);
  for (const l of ["ab", "-abc", "abc-", "a--b", "xn--abc", "123456", "ABC", "a".repeat(31), "a.b"]) {
    assert.equal(isGrammarValid(l), false, l);
    assert.equal(isValidPageName(l), false, l);
  }
});
test("the same seed gives the same scan, a different seed another", () => {
  const a = Array.from({ length: 5 }, ((n) => () => randomLabel(n))(rng(7)));
  const b = Array.from({ length: 5 }, ((n) => () => randomLabel(n))(rng(7)));
  const c = Array.from({ length: 5 }, ((n) => () => randomLabel(n))(rng(8)));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});
test("pickLabel mixes real and unknown labels near the requested share", () => {
  const next = rng(3);
  let real = 0;
  for (let i = 0; i < 4000; i++) if (pickLabel(next, ["gate-grace"], 0.1).real) real++;
  assert.ok(real > 300 && real < 500, `real share ${real / 4000}`);
  assert.equal(pickLabel(rng(1), [], 1).real, false); // nothing real to pick
});

const run = (language, ms) => ({ language, lcpMs: ms });
test("the LCP summary needs at least 20 runs and judges the worse language", () => {
  assert.throws(() => summarise(Array.from({ length: MIN_RUNS - 1 }, () => run("en", 1000)), 3000), /at least 20 runs/);
  const fast = [...Array.from({ length: 10 }, () => run("en", 1000)), ...Array.from({ length: 10 }, () => run("fr", 1200))];
  const s = summarise(fast, 3000);
  assert.equal(s.pass, true);
  assert.equal(s.languages.en.p75, 1000);
  assert.equal(s.languages.fr.p75, 1200);
  // fast in English and slow in French is a slow page
  const slowFr = [...Array.from({ length: 10 }, () => run("en", 1000)), ...Array.from({ length: 10 }, () => run("fr", 3600))];
  const bad = summarise(slowFr, 3000);
  assert.equal(bad.pass, false);
  assert.equal(bad.judged, 3600);
});

const okTally = () => {
  const t = emptyTally();
  tally(t, classify({ real: true, status: 200 }), 20);
  tally(t, classify({ real: false, status: 404 }), 30);
  return t;
};
const samples = (ms) => Array.from({ length: 10 }, () => ms);
const goodCore = () => ({ baseline: { overview: samples(800), checkIn: samples(100) }, withScan: { overview: samples(850), checkIn: samples(105) } });

test("classify: a real page answered 404 is the cached-404 failure, an unknown label must be 404", () => {
  assert.equal(classify({ real: true, status: 200 }), "ok");
  assert.equal(classify({ real: true, status: 404 }), "realNotFound");
  assert.equal(classify({ real: true, status: 503 }), "error");
  assert.equal(classify({ real: false, status: 404 }), "unknownOk");
  assert.equal(classify({ real: false, status: 200 }), "error");
});
test("load judge: a clean run passes", () => {
  const v = judge({ peak: 7, limit: 20, tally: okTally(), core: goodCore() });
  assert.deepEqual(v.failures, []);
});
test("load judge, known bad: connections beyond the role's limit fail and name the peak", () => {
  const v = judge({ peak: 21, limit: 20, tally: okTally(), core: goodCore() });
  assert.equal(v.failures.length, 1);
  assert.match(v.failures[0], /peak role connections 21 reached.*LIMIT 20/);
});
test("load judge, known bad: a peak AT the limit is saturation (Postgres never lets it go above)", () => {
  const f = judge({ peak: 20, limit: 20, tally: okTally(), core: goodCore() }).failures;
  assert.equal(f.length, 1);
  assert.match(f[0], /reached the role's CONNECTION LIMIT 20.*saturated/);
  assert.deepEqual(judge({ peak: 19, limit: 20, tally: okTally(), core: goodCore() }).failures, []);
});
test("load judge, known bad: a sampler that saw no session while requests were made cannot pass the connection check", () => {
  assert.match(judge({ peak: 0, limit: 20, samples: 60, tally: okTally(), core: goodCore() }).failures.join("\n"), /sampler saw no session/);
  assert.match(judge({ peak: 3, limit: 20, samples: 0, tally: okTally(), core: goodCore() }).failures.join("\n"), /sampler saw no session/);
  assert.deepEqual(judge({ peak: 1, limit: 20, samples: 60, tally: okTally(), core: goodCore() }).failures, []);
});
test("a transport error counts as an error and records no latency", () => {
  const t = emptyTally();
  tally(t, "ok", 20);
  tally(t, "error", null);
  assert.equal(t.requests, 2);
  assert.equal(t.error, 1);
  assert.deepEqual(t.latencies, [20]);
});
test("load judge, known bad: a role with no connection limit fails", () => {
  assert.match(judge({ peak: 1, limit: -1, tally: okTally(), core: goodCore() }).failures[0], /no usable CONNECTION LIMIT/);
});
test("load judge, known bad: the Overview probe over its 2 s budget, and the check-in probe over 3 s", () => {
  const slowOverview = { baseline: { overview: samples(2500), checkIn: samples(100) }, withScan: { overview: samples(2500), checkIn: samples(100) } };
  assert.match(judge({ peak: 1, limit: 20, tally: okTally(), core: slowOverview }).failures.join("\n"), /Overview load: p95 2500 ms.*2000 ms budget/);
  const slowCheckIn = { baseline: { overview: samples(800), checkIn: samples(3200) }, withScan: { overview: samples(800), checkIn: samples(3200) } };
  assert.match(judge({ peak: 1, limit: 20, tally: okTally(), core: slowCheckIn }).failures.join("\n"), /check-in RPC round trip: p95 3200 ms/);
});
test("load judge, known bad: a median that rises more than 25% against the run without the scan", () => {
  const core = { baseline: { overview: samples(800), checkIn: samples(100) }, withScan: { overview: samples(1100), checkIn: samples(100) } };
  const v = judge({ peak: 1, limit: 20, tally: okTally(), core });
  assert.equal(v.failures.length, 1);
  assert.match(v.failures[0], /median rose from 800 ms to 1100 ms \(over 25%\)/);
});
test("load judge, known bad: errors, a cached 404 for a real page, no requests, missing probes, too few samples", () => {
  const t = okTally();
  tally(t, classify({ real: true, status: 404 }), 5);
  tally(t, classify({ real: false, status: 500 }), 5);
  const f = judge({ peak: 1, limit: 20, tally: t, core: goodCore() }).failures.join("\n");
  assert.match(f, /1 request\(s\) failed/);
  assert.match(f, /1 request\(s\) for a REAL page answered the cached not-found/);
  assert.match(judge({ peak: 1, limit: 20, tally: emptyTally(), core: goodCore() }).failures.join("\n"), /no request was made/);
  assert.match(judge({ peak: 1, limit: 20, tally: okTally(), core: null }).failures.join("\n"), /core-product probes did not run/);
  const few = { baseline: { overview: samples(800), checkIn: [100] }, withScan: { overview: samples(800), checkIn: [100, 100] } };
  assert.match(judge({ peak: 1, limit: 20, tally: okTally(), core: few }).failures.join("\n"), /too few samples/);
});
test("the story's budgets", () => {
  assert.equal(BUDGETS.overviewMs, 2000);
  assert.equal(BUDGETS.checkInMs, 3000);
  assert.equal(BUDGETS.regressionPct, 25);
});

test("targetFor puts the label in the Host header, or in the URL when BASE_URL has a {label} placeholder", () => {
  const local = { baseUrl: "http://127.0.0.1:3200", rootDomain: "localhost" };
  assert.deepEqual(targetFor("fit", "/", local), { url: "http://127.0.0.1:3200/", host: "fit.localhost" });
  const staging = { baseUrl: "https://{label}.staging.example.com", rootDomain: "staging.example.com" };
  assert.deepEqual(targetFor("fit", "/x", staging), { url: "https://fit.staging.example.com/x", host: undefined });
  assert.equal(browserUrlFor("fit", "/", local), "http://fit.localhost:3200/");
  assert.equal(browserUrlFor("fit", "/", staging), "https://fit.staging.example.com/");
  assert.throws(() => browserUrlFor("fit", "/", { baseUrl: "http://10.0.0.5:3200", rootDomain: "example.com" }), /\{label\}/);
});

test("load judge, known bad: core probes that FAIL under the scan (beyond the failures they have without it) fail the gate", () => {
  const core = { ...goodCore(), errors: { baseline: { n: 0, of: 100 }, withScan: { n: 10, of: 100 } } };
  assert.match(judge({ peak: 1, limit: 20, tally: okTally(), core }).failures.join("\n"), /core probes failed 10 of 100 times with the scan/);
  const flaky = { ...goodCore(), errors: { baseline: { n: 3, of: 100 }, withScan: { n: 4, of: 100 } } };
  assert.deepEqual(judge({ peak: 1, limit: 20, tally: okTally(), core: flaky }).failures, []);
});

// ---- staging configuration cannot pass without testing (review of 24-12) ----
test("a {label} BASE_URL requires the published, redirect, unpublished and taken-down labels", () => {
  const cfg = { baseUrl: "https://{label}.staging.example.com" };
  assert.deepEqual(missingStagingLabels(cfg, {}), ["GATE_LABEL_PUBLISHED", "GATE_LABEL_REDIRECT_OLD", "GATE_LABEL_UNPUBLISHED", "GATE_LABEL_TAKEN_DOWN"]);
  // an empty redirect label no longer skips the redirect check on staging
  const set = { GATE_LABEL_PUBLISHED: "a", GATE_LABEL_UNPUBLISHED: "b", GATE_LABEL_TAKEN_DOWN: "c", GATE_LABEL_REDIRECT_OLD: "" };
  assert.deepEqual(missingStagingLabels(cfg, set), ["GATE_LABEL_REDIRECT_OLD"]);
  assert.deepEqual(missingStagingLabels(cfg, { ...set, GATE_LABEL_REDIRECT_OLD: "d" }), []);
  // a Host-header BASE_URL (local) needs none
  assert.deepEqual(missingStagingLabels({ baseUrl: "http://127.0.0.1:3200" }, {}), []);
});

test("the suspended label defaults to a local fixture only locally, never to a label that does not exist on staging", () => {
  const suspendedFor = (baseUrl) =>
    execFileSync(process.execPath, ["--input-type=module", "-e", 'const { config } = await import(process.argv[1]); process.stdout.write(JSON.stringify(config.labels.suspended))', new URL("../lib/config.mjs", import.meta.url).href], {
      env: { PATH: process.env.PATH, ...(baseUrl ? { BASE_URL: baseUrl } : {}) },
    }).toString();
  assert.equal(suspendedFor("http://127.0.0.1:3200"), '"gate-paused"');
  assert.equal(suspendedFor("https://{label}.staging.example.com"), '""');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Story 25.6: the directory share of the load check
// ---------------------------------------------------------------------------------------------------------------------------------------------
const WHERE = { country: "cm", city: "garoua", pages: 3 };

test("directory requests: top, country and city pages in both languages, with random ?x= and ?page= values, built from the real page count", () => {
  const next = rng(11);
  const seen = { kinds: new Set(), langs: new Set(), x: 0, page: 0, past: 0, category: 0, plain: 0 };
  for (let i = 0; i < 6000; i++) {
    const r = pickDirectoryRequest(next, WHERE);
    assert.match(r.path, /^\/(en|fr)\/gyms(\/cm(\/garoua)?)?(\?(x=\d+|page=\d+|category=[a-z_]+))?$/, r.path);
    seen.kinds.add(r.kind);
    seen.langs.add(r.path.slice(1, 3));
    const page = /page=(\d+)/.exec(r.path);
    if (/x=/.test(r.path)) seen.x++;
    else if (page) {
      seen.page++;
      const n = Number(page[1]);
      assert.ok(n >= 1 && n <= WHERE.pages + 50);
      // only a city listing past its last page is the uniform not-found
      const expected = r.kind === "city" && n > WHERE.pages ? 404 : 200;
      assert.equal(r.expected, expected, r.path);
      if (n > WHERE.pages) seen.past++;
    } else if (/category=/.test(r.path)) {
      assert.equal(r.kind, "city");
      assert.equal(r.expected, 200, "a stale category filter is a 200 with a message");
      seen.category++;
    } else {
      seen.plain++;
      assert.equal(r.expected, 200);
    }
  }
  assert.deepEqual([...seen.kinds].sort(), ["city", "country", "top"]);
  assert.deepEqual([...seen.langs].sort(), ["en", "fr"]);
  assert.ok(seen.x > 1500 && seen.page > 1500 && seen.past > 100 && seen.category > 100 && seen.plain > 100, JSON.stringify({ ...seen, kinds: undefined, langs: undefined }));
});
test("directory requests repeat with the same seed", () => {
  const a = Array.from({ length: 20 }, ((n) => () => pickDirectoryRequest(n, WHERE).path)(rng(5)));
  const b = Array.from({ length: 20 }, ((n) => () => pickDirectoryRequest(n, WHERE).path)(rng(5)));
  assert.deepEqual(a, b);
});
test("page counts follow the directory page size of 20", () => {
  assert.equal(DIRECTORY_PAGE_SIZE, 20);
  assert.deepEqual([0, 1, 20, 21, 46].map(pageCountFor), [1, 1, 1, 2, 3]);
});
test("a directory answer is right only when it is the status the request was built to get", () => {
  assert.equal(classifyDirectory({ expected: 200, status: 200 }), "dirOk");
  assert.equal(classifyDirectory({ expected: 404, status: 404 }), "dirOk");
  assert.equal(classifyDirectory({ expected: 200, status: 404 }), "error");
  assert.equal(classifyDirectory({ expected: 404, status: 200 }), "error");
  assert.equal(classifyDirectory({ expected: 200, status: 500 }), "error");
});
test("load judge: directory requests are judged with the same ceiling; none sent when expected, or one wrong, fails", () => {
  const dirTally = (n, wrong = 0) => {
    const t = emptyTally();
    for (let i = 0; i < n; i++) tally(t, "dirOk", 30);
    for (let i = 0; i < wrong; i++) tally(t, "error", null);
    return t;
  };
  const withDir = (dir, over = {}) => {
    const all = okTally();
    for (let i = 0; i < dir.requests; i++) all.requests++;
    all.error += dir.error;
    return judge({ peak: 7, limit: 20, tally: all, core: goodCore(), directory: { expected: true, tally: dir }, ...over });
  };
  assert.deepEqual(withDir(dirTally(50)).failures, []);
  assert.match(withDir(dirTally(0)).failures.join("\n"), /was to include directory requests and made none/);
  assert.match(withDir(dirTally(50, 2)).failures.join("\n"), /2 directory request\(s\) answered something other/);
  // the connection ceiling still applies to a run with directory pages
  assert.match(withDir(dirTally(50), { peak: 20 }).failures.join("\n"), /reached the role's CONNECTION LIMIT 20/);
  // a run that did not ask for the directory is judged as before
  assert.deepEqual(judge({ peak: 7, limit: 20, tally: okTally(), core: goodCore(), directory: { expected: false, tally: dirTally(0) } }).failures, []);
});
