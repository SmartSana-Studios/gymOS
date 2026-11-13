#!/usr/bin/env node
// Story 24.12 (NFR-026): the LCP baseline of a published page. Headless Chromium through Playwright, CDP throttling (CPU 4x, 1.6 Mbps down,
// 150 ms RTT), a 360x640 mobile viewport, a cold cache (a fresh browser context per run), at least 20 runs split over both languages, the largest
// contentful paint read from a PerformanceObserver. It is a LAB number: the output says so, and it never stands in for field data.
//
//   BASE_URL=... ROOT_DOMAIN=... GATE_LCP_RUNS=20 GATE_LCP_TARGET_MS=3000 GATE_ENV_LABEL="lab, local" node scripts/landing-gate/lcp.mjs
//
// Story 25.6: GATE_LCP_TARGET picks the page. `gym` (default, unchanged): the published gym page. `directory-top`: /{en|fr}/gyms on www. `directory-city`: the city listing
// (GATE_DIRECTORY_COUNTRY / GATE_DIRECTORY_CITY, locally Garoua, which `seed.mjs up --directory` fills with 46 gyms). The directory pages are measured in the language of their
// own path. The p75 is RECORDED against GATE_LCP_TARGET_MS (3000), never enforced unless GATE_LCP_ENFORCE=1: the 3 s target stays an [ASSUMPTION].
import { config, browserUrlFor } from "./lib/config.mjs";
import { loadPlaywright } from "./lib/resolve.mjs";
import { PROFILE, MIN_RUNS, summarise } from "./lib/lcp.mjs";

const runs = Number(process.env.GATE_LCP_RUNS ?? 20);
const targetMs = Number(process.env.GATE_LCP_TARGET_MS ?? 3000);
const envLabel = process.env.GATE_ENV_LABEL ?? "lab, local";
const target = process.env.GATE_LCP_TARGET ?? "gym";
if (!["gym", "directory-top", "directory-city"].includes(target)) {
  console.error(`lcp: GATE_LCP_TARGET must be gym, directory-top or directory-city, got ${target}`);
  process.exit(2);
}
if (target === "directory-city" && !(config.directory.country && config.directory.city)) {
  console.error("lcp: GATE_LCP_TARGET=directory-city needs GATE_DIRECTORY_COUNTRY and GATE_DIRECTORY_CITY (the slugs of a city listing)");
  process.exit(2);
}
/** Where a run in `language` goes: the label (host) and the path. */
const pageFor = (language) => {
  if (target === "gym") return { label: config.labels.published, path: "/" };
  if (target === "directory-top") return { label: config.directory.label, path: `/${language}/gyms` };
  return { label: config.directory.label, path: `/${language}/gyms/${config.directory.country}/${config.directory.city}` };
};
if (!Number.isInteger(runs) || runs < MIN_RUNS) {
  console.error(`lcp: GATE_LCP_RUNS must be at least ${MIN_RUNS}`);
  process.exit(2);
}

const { chromium } = loadPlaywright();
const languages = [
  ["en", "en"],
  ["fr", "fr-CM,fr;q=0.9"],
];

// Runs in the page before anything else: records every largest-contentful-paint candidate.
const observer = () => {
  window.__lcp = [];
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__lcp.push({ t: e.startTime, size: e.size, tag: e.element ? e.element.tagName : null, url: e.url || null });
  }).observe({ type: "largest-contentful-paint", buffered: true });
};

async function oneRun(browser, language, acceptLanguage) {
  const context = await browser.newContext({
    viewport: PROFILE.viewport,
    deviceScaleFactor: PROFILE.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    userAgent: PROFILE.userAgent,
    extraHTTPHeaders: { "accept-language": acceptLanguage },
    serviceWorkers: "block",
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(observer);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: PROFILE.rttMs,
      downloadThroughput: (PROFILE.downKbps * 1000) / 8,
      uploadThroughput: (PROFILE.upKbps * 1000) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpuSlowdown });
    const consoleCsp = [];
    page.on("console", (m) => {
      if (/content security policy|securitypolicyviolation/i.test(m.text())) consoleCsp.push(m.text().slice(0, 160));
    });
    const where = pageFor(language);
    const response = await page.goto(browserUrlFor(where.label, where.path), { waitUntil: "load", timeout: 60_000 });
    // a not-found or an error page has an LCP too: it would be recorded as the baseline of a page that is not the page
    if (!response || response.status() !== 200) throw new Error(`the ${target} page (${where.path}) answered ${response ? response.status() : "nothing"}, not 200`);
    await page.waitForTimeout(1000); // let a late candidate land; the page has no script and no input, so the last candidate is the final one
    const violations = [...consoleCsp, ...(await page.evaluate(() => window.__csp))];
    if (violations.length) throw new Error(`the page broke its own Content-Security-Policy (${violations.length}): ${[...new Set(violations)].slice(0, 3).join("; ")}`);
    const entries = await page.evaluate(() => window.__lcp);
    if (!entries || entries.length === 0) throw new Error("no largest-contentful-paint entry was recorded");
    const last = entries[entries.length - 1];
    const html = await page.evaluate(() => document.documentElement.lang);
    return { language, lcpMs: last.t, element: last.tag, url: last.url, htmlLang: html };
  } finally {
    await context.close();
  }
}

let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  console.error(`lcp: FAIL, headless Chromium could not start (run: npx playwright install chromium). ${e.message.split("\n")[0]}`);
  process.exit(1);
}
const results = [];
try {
  for (let i = 0; i < runs; i++) {
    const [language, accept] = languages[i % languages.length];
    const r = await oneRun(browser, language, accept);
    if (r.htmlLang !== language) throw new Error(`run ${i + 1}: asked for ${language}, the page is lang=${r.htmlLang}`);
    results.push(r);
    process.stdout.write(`  run ${String(i + 1).padStart(2)} ${language} LCP ${r.lcpMs.toFixed(0)} ms (${r.element}${r.url ? ` ${r.url.split("/").pop()}` : ""})\n`);
  }
} catch (e) {
  console.error(`lcp: FAIL, ${e.message}`);
  await browser.close();
  process.exit(1);
}
await browser.close();

const s = summarise(results, targetMs);
const fmt = (n) => `${n.toFixed(0)} ms`;
console.log(`\nLCP baseline, target ${target}: LAB data (${envLabel}); not field data`);
console.log(`  profile: CPU ${PROFILE.cpuSlowdown}x slowdown, ${PROFILE.downKbps / 1000} Mbps down, ${PROFILE.rttMs} ms RTT, ${PROFILE.viewport.width}x${PROFILE.viewport.height} mobile, cold cache, ${results.length} runs`);
for (const [lang, v] of Object.entries(s.languages)) console.log(`  ${lang}: p75 ${fmt(v.p75)}  median ${fmt(v.median)}  min ${fmt(v.min)}  max ${fmt(v.max)}  (${v.runs} runs)`);
console.log(`  all: p75 ${fmt(s.overall.p75)}  median ${fmt(s.overall.median)}`);
const el = [...new Set(results.map((r) => `${r.element}${r.url ? " (image)" : ""}`))].join(", ");
console.log(`  LCP element: ${el}`);
console.log(`  judged value ${fmt(s.judged)} against the target ${targetMs} ms (the 3 s target stays [ASSUMPTION] until the owner has a staging number)`);
// The 3 s target is an [ASSUMPTION] until the owner has a staging number, so by default this RECORDS the baseline and says whether it is over or
// under; GATE_LCP_ENFORCE=1 (for after the owner confirms the target) turns "over" into a failing exit.
const enforce = process.env.GATE_LCP_ENFORCE === "1";
console.log(`\nlcp: BASELINE RECORDED (${envLabel}, target ${target}): ${s.pass ? "under" : "OVER"} the ${targetMs} ms [ASSUMPTION] target${enforce ? "" : " (not enforced; GATE_LCP_ENFORCE=1 enforces it)"}`);
process.exit(enforce && !s.pass ? 1 : 0);
