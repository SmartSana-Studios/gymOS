// Story 25.6: the removal-timing kit. No database, no browser: a doctored HTTP server stands in for the landing app, and each rule is shown able to fail.
//   * the surface list covers every reader of the visibility predicate (Epic 22 retro 66), and fails when one is missing
//   * the poll measures `drop time - since`, prints "gone before the first poll" instead of 0 s, and fails naming the surface that keeps a removed gym
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BOUNDS, NOT_A_SURFACE, SURFACES, cityPageCount, countryCardCount, judgeRemoval, pollRemoval, probeAll, readersInLanding, readersOfPredicate, sMaxAge, surfaceReads, uncoveredReaders,
} from "../lib/removal.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const SCRIPT = here("../removal-timing.mjs");

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Coverage of the visibility predicate
// ---------------------------------------------------------------------------------------------------------------------------------------------
const migrations = () => readdirSync(here("../../../supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(here(`../../../supabase/migrations/${f}`), "utf8"));
const landingReaderFiles = () => ["../../../apps/landing/lib/gym-site/readerSql.ts"].map((p) => readFileSync(here(p), "utf8"));

test("every reader of private.gym_page_visible in the migrations is a removal surface or exempted with a reason", () => {
  const readers = readersOfPredicate(migrations());
  // sanity: the scan really finds the readers it should (a regex that finds nothing would pass the coverage check)
  for (const known of ["public_site.pages", "public_site.page_media", "public_site.page_redirects", "public_site.directory_gym", "public_site.directory_city", "public_site.directory_country"]) {
    assert.ok(readers.includes(known), `the scan did not find ${known}; found ${readers.join(", ")}`);
  }
  assert.deepEqual(uncoveredReaders(readers), [], "a view or function reads the visibility predicate but no removal surface names it (add it to lib/removal.mjs SURFACES, or to NOT_A_SURFACE with the reason)");
});

test("every public_site relation the landing app reads is covered the same way", () => {
  const read = readersInLanding(landingReaderFiles());
  assert.ok(read.includes("public_site.directory_gym") && read.includes("public_site.pages"), `the scan found ${read.join(", ")}`);
  assert.deepEqual(uncoveredReaders(read), []);
});

test("known bad: a new view over the predicate, or a new reader in the landing app, fails until it is added to the list", () => {
  const sql = [
    "create view private.gym_page_visible as select 1;",
    "-- create view public_site.in_a_comment as select * from private.gym_page_visible;",
    "create view public_site.directory_map with (security_barrier = true) as select * from private.gym_page_visible v;",
    "create or replace function public.list_something() returns setof int language sql as $$ select 1 from private.gym_page_visible $$;",
    "create view public_site.unrelated as select 1;",
  ];
  const readers = readersOfPredicate(sql);
  assert.deepEqual(readers, ["public.list_something", "public_site.directory_map"], "a comment and the predicate's own definition are not readers");
  assert.deepEqual(uncoveredReaders(readers), ["public.list_something", "public_site.directory_map"]);
  assert.deepEqual(uncoveredReaders(readersInLanding(["select 1 from public_site.directory_map where x = 1"])), ["public_site.directory_map"]);
  // covered ones do not fail
  assert.deepEqual(uncoveredReaders(["public_site.pages", "public_site.page_media"]), []);
});

test("the list names every surface of the spec, each with the views it reads and a bound kind", () => {
  assert.deepEqual(SURFACES.map((s) => s.id), ["gym-page", "gym-sitemap", "city-row", "city-count", "country-count", "llms", "www-sitemap"]);
  for (const s of SURFACES) {
    assert.ok(["cdn", "sitemap"].includes(s.bound), s.id);
    assert.ok(s.reads.length > 0, s.id);
  }
  assert.ok(surfaceReads().every((r) => r.startsWith("public_site.")));
  for (const reason of Object.values(NOT_A_SURFACE)) assert.ok(reason.length > 20);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------------------------------------------------------------------------
test("the count parsers read the markup the directory pages render, and nothing else", () => {
  assert.equal(cityPageCount('<p class="count">3 gyms in Kribi</p>'), 3);
  assert.equal(cityPageCount('<p class="count">1 salle à Buea</p>'), 1);
  assert.equal(cityPageCount("<p>3 gyms</p>"), null);
  const country = '<li class="card"><a href="/en/gyms/cm/kribi"><div><h2>Kribi</h2><p>3 gyms</p></div></a></li><li class="card"><a href="/en/gyms/cm/buea"><div><h2>Buea</h2><p>2 gyms</p></div></a></li>';
  assert.equal(countryCardCount(country, "/en/gyms/cm/kribi"), 3);
  assert.equal(countryCardCount(country, "/en/gyms/cm/buea"), 2);
  assert.equal(countryCardCount(country, "/en/gyms/cm/limbe"), null);
  assert.equal(sMaxAge({ "cache-control": ["public, s-maxage=60"] }), 60);
  assert.equal(sMaxAge({ "cache-control": ["public, max-age=300"] }), null);
  assert.equal(sMaxAge({}), null);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// A doctored world: a landing app that has (or has not) removed a gym from each surface
// ---------------------------------------------------------------------------------------------------------------------------------------------
const LABEL = "gate-removed";
const CITY = "kribi";
const xmlUrlset = (locs) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>\n`;

/**
 * `still` is the set of surface ids that still show the gym; the rest have dropped it. Mutable while the server runs. `headers` overrides the Cache-Control of
 * every answer (undefined = the real ones: page 60, not-found 30, crawler 300).
 */
function world({ still = new Set(), cacheControl } = {}) {
  const state = { still, cacheControl, requests: 0 };
  const cc = (kind) => cacheControl !== undefined ? cacheControl : { page: "public, s-maxage=60", notFound: "public, s-maxage=30", crawler: "public, s-maxage=300" }[kind];
  const server = http.createServer((req, res) => {
    state.requests++;
    const host = (req.headers.host ?? "").split(":")[0];
    const www = host.startsWith("www.");
    const send = (status, kind, text, type = "text/html; charset=utf-8") => {
      const h = { "content-type": type };
      const c = cc(kind);
      if (c !== null) h["cache-control"] = c;
      res.writeHead(status, h);
      res.end(text);
    };
    const notFound = () => send(404, "notFound", "not found");
    const has = (id) => state.still.has(id);
    const url = (req.url ?? "/").split("?")[0];
    if (!www) {
      if (url === "/" && has("gym-page")) return send(200, "page", "<html>gym</html>");
      if (url === "/sitemap.xml" && has("gym-sitemap")) return send(200, "crawler", xmlUrlset([`http://${LABEL}.localhost/`]), "application/xml");
      return notFound();
    }
    const count = has("city-count") ? 3 : 2;
    if (url === `/en/gyms/cm/${CITY}`) {
      const row = has("city-row") ? `<li class="row"><a href="http://${LABEL}.localhost/"><h2>Gone Gym</h2></a></li>` : "";
      return send(200, "page", `<html><p class="count">${count} gyms in Kribi</p><ul class="rows">${row}<li class="row"><a href="http://other.localhost/"></a></li></ul></html>`);
    }
    if (url === "/en/gyms/cm") {
      const n = has("country-count") ? 3 : 2;
      return send(200, "page", `<html><ul class="cards"><li class="card"><a href="/en/gyms/cm/${CITY}"><div><h2>Kribi</h2><p>${n} gyms</p></div></a></li></ul></html>`);
    }
    if (url === "/llms.txt") {
      const block = has("llms") ? `\n\n## Gone Gym\nurl: http://${LABEL}.localhost/\n` : "";
      return send(200, "crawler", `# GymOS gyms${block}\n\n## Other\nurl: http://other.localhost/\n`, "text/plain; charset=utf-8");
    }
    if (url === "/sitemap-index.xml") {
      return send(200, "crawler", `<?xml version="1.0"?>\n<sitemapindex><sitemap><loc>http://www.localhost/sitemaps/1.xml</loc></sitemap></sitemapindex>\n`, "application/xml");
    }
    if (url === "/sitemaps/1.xml") {
      const locs = ["http://www.localhost/en", "http://www.localhost/en/gyms", ...(has("www-sitemap") ? [`http://www.localhost/en/gyms/cm/${CITY}`, `http://www.localhost/fr/gyms/cm/${CITY}`] : [])];
      return send(200, "crawler", xmlUrlset(locs), "application/xml");
    }
    return notFound();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port })));
}

const ALL = ["gym-page", "gym-sitemap", "city-row", "city-count", "country-count", "llms", "www-sitemap"];
const ctxFor = (over = {}) => ({ label: LABEL, country: "cm", city: CITY, countBefore: 3, locale: "en", rootDomain: "localhost", wwwLabel: "www", ...over });
const getFor = (port) => async (label, path) => {
  const r = await new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, headers: { host: `${label}.localhost` } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, [].concat(v)])), body: Buffer.concat(chunks).toString("utf8") }));
    }).on("error", reject);
  });
  return r;
};

const run = (args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ROOT_DOMAIN: "localhost", GATE_ENV_LABEL: "test", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
const args = (over = {}) => [
  "--since", over.since ?? new Date().toISOString(), "--label", LABEL, "--country", "cm", "--city", CITY, "--count-before", "3", "--poll-ms", "100", "--bound-seconds", over.bound ?? "3",
  ...(over.extra ?? []),
];

test("probeAll sees a present gym on every surface and a removed one on none", async () => {
  const present = await world({ still: new Set(ALL) });
  const gone = await world({ still: new Set() });
  try {
    const a = await probeAll({ get: getFor(present.port), ctx: ctxFor() });
    assert.deepEqual(Object.keys(a), ALL);
    assert.deepEqual(Object.entries(a).filter(([, v]) => v.gone).map(([k]) => k), [], "a visible gym is gone from no surface");
    const b = await probeAll({ get: getFor(gone.port), ctx: ctxFor() });
    assert.deepEqual(Object.entries(b).filter(([, v]) => !v.gone).map(([k]) => k), [], "a removed gym is still on a surface");
  } finally {
    present.server.close();
    gone.server.close();
  }
});

test("the sitemap surface applies only to a city at exactly three gyms", async () => {
  const w = await world({ still: new Set() });
  try {
    const results = await pollRemoval({ get: getFor(w.port), ctx: ctxFor({ countBefore: 5 }), since: Date.now(), boundS: 2, pollMs: 50 });
    const sm = results.find((r) => r.id === "www-sitemap");
    assert.equal(sm.applicable, false);
    assert.match(sm.notApplicable, /exactly 3/);
    const verdict = judgeRemoval(results, { bounds: { ...BOUNDS, originS: 2 } });
    assert.match(verdict.lines.join("\n"), /www sitemap.*n\/a/);
  } finally {
    w.server.close();
  }
});

test("poll: elapsed is the drop time minus --since, with an injected clock", async () => {
  // a fake world that drops the llms.txt entry at t = 7 s
  let t = 1_000_000;
  const dropAt = t + 7_000;
  const get = async (label, path) => {
    const base = await getFor(w.port)(label, path);
    return base;
  };
  const w = await world({ still: new Set(["llms"]) });
  try {
    const sleep = async (ms) => {
      t += ms;
      if (t >= dropAt) w.state.still.delete("llms");
    };
    const results = await pollRemoval({ get, ctx: ctxFor({ countBefore: 5 }), since: t - 2_000, boundS: 60, pollMs: 1_000, now: () => t, sleep });
    const llms = results.find((r) => r.id === "llms");
    assert.equal(llms.gone, true);
    assert.equal(llms.beforeFirstPoll, false);
    assert.equal(llms.elapsedMs, 9_000, "7 s of polling plus the 2 s between --since and the first poll");
    const other = results.find((r) => r.id === "gym-page");
    assert.equal(other.beforeFirstPoll, true);
    assert.equal(other.elapsedMs, 2_000, "the first round's time is an upper bound");
    assert.equal(other.firstPollAfterMs, 2_000);
  } finally {
    w.server.close();
  }
});

test("CLI: a faithful server passes, and a surface already gone at the first poll says so instead of 0 s", async () => {
  const w = await world({ still: new Set() });
  try {
    const r = await run(args(), { BASE_URL: `http://127.0.0.1:${w.port}` });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /gym page \(gym host \/\): gone before the first poll \(at most [\d.]+ s after --since, within 3 s\)/);
    assert.doesNotMatch(r.out, /gone 0\.0 s/);
    assert.match(r.out, /by construction \(not measured\): s-maxage (30|60|300) s/);
    assert.match(r.out, /removal-timing: PASS/);
  } finally {
    w.server.close();
  }
});

test("CLI: a gym that drops while it polls is timed from --since", async () => {
  const w = await world({ still: new Set(["llms"]) });
  setTimeout(() => w.state.still.delete("llms"), 700);
  try {
    const r = await run(args({ bound: "5" }), { BASE_URL: `http://127.0.0.1:${w.port}` });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /www \/llms\.txt: gone [\d.]+ s after --since \(bound 5 s\)/);
  } finally {
    w.server.close();
  }
});

for (const [id, name] of [["llms", "www /llms.txt"], ["www-sitemap", "www sitemap"], ["gym-sitemap", "gym-host /sitemap.xml"], ["city-row", "city listing row"], ["city-count", "city listing count"], ["country-count", "country page count"], ["gym-page", "gym page"]]) {
  test(`CLI known bad: a server that keeps the removed gym in ${name} exits 1 naming it`, async () => {
    const w = await world({ still: new Set([id]) });
    try {
      const r = await run(args({ bound: "1" }), { BASE_URL: `http://127.0.0.1:${w.port}` });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, new RegExp(`- ${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}.*still serving`));
      assert.match(r.out, /removal-timing: FAIL \(1\)/, "only the doctored surface fails");
    } finally {
      w.server.close();
    }
  });
}

test("CLI known bad: an answer without s-maxage, or with one over 300 s, fails: the CDN bound cannot be shown", async () => {
  for (const [cc, expected] of [[null, /carries no s-maxage/], ["public, s-maxage=900", /s-maxage 900 s is over 300 s/], ["public, max-age=60", /carries no s-maxage/]]) {
    const w = await world({ still: new Set(), cacheControl: cc });
    try {
      const r = await run(args(), { BASE_URL: `http://127.0.0.1:${w.port}` });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, expected);
    } finally {
      w.server.close();
    }
  }
});

test("CLI known bad: --since far older than the first poll, with everything already gone, proves nothing and fails", async () => {
  const w = await world({ still: new Set() });
  try {
    const r = await run(args({ since: new Date(Date.now() - 10 * 60_000).toISOString(), bound: "60" }), { BASE_URL: `http://127.0.0.1:${w.port}` });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /gone before the first poll .* NOT PROVEN/);
    assert.match(r.out, /so the time is not proven/);
  } finally {
    w.server.close();
  }
});

test("CLI: staging mode measures against 300 s and 900 s (and says so)", async () => {
  const w = await world({ still: new Set() });
  try {
    const r = await run([...args(), "--mode", "cdn"], { BASE_URL: `http://127.0.0.1:${w.port}` });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /bounds: CDN 300 s, sitemap 900 s/);
    assert.match(r.out, /www sitemap .*within 900 s/);
    assert.match(r.out, /gym page .*within 300 s/);
    assert.doesNotMatch(r.out, /by construction/);
  } finally {
    w.server.close();
  }
});

test("CLI usage: no --since, an unparsable --since, no label, and no count are exit 2", async () => {
  const base = { BASE_URL: "http://127.0.0.1:9" };
  const full = ["--label", LABEL, "--country", "cm", "--city", CITY, "--count-before", "3"];
  const a = await run(full, base);
  assert.equal(a.code, 2);
  assert.match(a.out, /--since <ISO time of the action> is required/);
  assert.equal((await run(["--since", "yesterday-ish", ...full], base)).code, 2);
  assert.equal((await run(["--since", new Date().toISOString(), "--country", "cm", "--city", CITY, "--count-before", "3"], base)).code, 2);
  assert.equal((await run(["--since", new Date().toISOString(), "--label", LABEL, "--country", "cm", "--city", CITY], base)).code, 2);
});

test("judge: with no s-maxage on any answer, cdn mode (measured time is the proof) passes and origin mode fails", async () => {
  const w = await world({ still: new Set(), cacheControl: null });
  try {
    const results = await pollRemoval({ get: getFor(w.port), ctx: ctxFor(), since: Date.now(), boundS: 5, pollMs: 50 });
    const origin = judgeRemoval(results, { mode: "origin", bounds: { ...BOUNDS, originS: 5 } });
    assert.ok(origin.failures.some((f) => /carries no s-maxage/.test(f)), origin.failures.join("\n"));
    const cdn = judgeRemoval(results, { mode: "cdn" });
    assert.deepEqual(cdn.failures, [], "a drop inside the bound with no s-maxage visible passes in cdn mode");
    // an s-maxage over 300 is likewise judged in origin mode only
    const big = await world({ still: new Set(), cacheControl: "public, s-maxage=900" });
    try {
      const r2 = await pollRemoval({ get: getFor(big.port), ctx: ctxFor(), since: Date.now(), boundS: 5, pollMs: 50 });
      assert.ok(judgeRemoval(r2, { mode: "origin", bounds: { ...BOUNDS, originS: 5 } }).failures.some((f) => /s-maxage 900 s is over 300 s/.test(f)));
      assert.deepEqual(judgeRemoval(r2, { mode: "cdn" }).failures, []);
    } finally {
      big.server.close();
    }
  } finally {
    w.server.close();
  }
});

test("poll: firstPollAfterMs is stamped per surface, just before its own probe", async () => {
  let t = 5_000;
  const w = await world({ still: new Set() });
  try {
    const base = getFor(w.port);
    const get = async (label, path) => {
      t += 1_000; // every request takes one second of the injected clock
      return base(label, path);
    };
    const results = await pollRemoval({ get, ctx: ctxFor({ countBefore: 5 }), since: 0, boundS: 600, pollMs: 50, now: () => t, sleep: async () => {} });
    const stamps = results.filter((r) => r.applicable).map((r) => r.firstPollAfterMs);
    assert.ok(stamps.every((v, i) => i === 0 || v > stamps[i - 1]), `later surfaces were probed later: ${stamps.join(", ")}`);
  } finally {
    w.server.close();
  }
});

test("CLI --check-visible: needs no --since; exits 0 when every surface shows the gym, 1 naming each surface that does not", async () => {
  const noSince = ["--check-visible", "--label", LABEL, "--country", "cm", "--city", CITY, "--count-before", "3"];
  const all = await world({ still: new Set(ALL) });
  const partly = await world({ still: new Set(ALL.filter((id) => id !== "llms" && id !== "city-row")) });
  try {
    const ok = await run(noSince, { BASE_URL: `http://127.0.0.1:${all.port}` });
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /--check-visible: PASS/);
    assert.match(ok.out, /www \/llms\.txt: shows the gym/);
    const bad = await run(noSince, { BASE_URL: `http://127.0.0.1:${partly.port}` });
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /FAIL \(2\)/);
    assert.match(bad.out, /- www \/llms\.txt does not show the gym/);
    assert.match(bad.out, /- city listing row does not show the gym/);
    assert.doesNotMatch(bad.out, /- gym page .* does not show/);
    // the sitemap surface is n/a at another count, and is not demanded
    const other = await run(["--check-visible", "--label", LABEL, "--country", "cm", "--city", CITY, "--count-before", "5"], { BASE_URL: `http://127.0.0.1:${all.port}` });
    assert.match(other.out, /www sitemap .*n\/a/);
  } finally {
    all.server.close();
    partly.server.close();
  }
});

test("CLI usage: a --since more than 5 s in the future, and a --poll-ms below 50 or not a number, are exit 2", async () => {
  const env = { BASE_URL: "http://127.0.0.1:9" };
  const rest = ["--label", LABEL, "--country", "cm", "--city", CITY, "--count-before", "3"];
  const future = await run(["--since", new Date(Date.now() + 60_000).toISOString(), ...rest], env);
  assert.equal(future.code, 2);
  assert.match(future.out, /more than 5 s in the future/);
  const now = new Date().toISOString();
  for (const bad of ["10", "0", "abc", "49"]) {
    const r = await run(["--since", now, ...rest, "--poll-ms", bad], env);
    assert.equal(r.code, 2, `--poll-ms ${bad}: ${r.out}`);
    assert.match(r.out, /--poll-ms must be a number of at least 50/);
  }
});
