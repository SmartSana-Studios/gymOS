// The pure part of the LCP baseline: how runs are summarised and judged. Kept free of Playwright so it runs in the unit tests.
import { p75, median } from "./stats.mjs";

/** The throttling profile of the baseline (spec 24.12): a mid-range Android phone on a slow 4G link, cache cold. Printed with every result. */
export const PROFILE = Object.freeze({
  cpuSlowdown: 4,
  downKbps: 1600, // 1.6 Mbps down
  upKbps: 750,
  rttMs: 150,
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 2,
  userAgent:
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
});

export const MIN_RUNS = 20;

/** @param {{language:string, lcpMs:number}[]} runs */
export function summarise(runs, targetMs) {
  if (!Array.isArray(runs) || runs.length < MIN_RUNS) throw new Error(`lcp: at least ${MIN_RUNS} runs are needed, got ${runs?.length ?? 0}`);
  const by = {};
  for (const r of runs) (by[r.language] ??= []).push(r.lcpMs);
  const languages = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { runs: v.length, p75: p75(v), median: median(v), min: Math.min(...v), max: Math.max(...v) }]));
  const all = runs.map((r) => r.lcpMs);
  const overall = { runs: all.length, p75: p75(all), median: median(all), min: Math.min(...all), max: Math.max(...all) };
  // the number that is judged is the worse of the languages' own p75s: a page that is fast in English and slow in French is a slow page
  const judged = Math.max(overall.p75, ...Object.values(languages).map((l) => l.p75));
  return { overall, languages, judged, targetMs, pass: judged <= targetMs };
}
