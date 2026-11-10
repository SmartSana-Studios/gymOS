// Pure statistics for the kit. p75 is nearest-rank (the smallest value with at least 75% of the samples at or below it), which is what a field
// p75 means and cannot invent a number nobody measured.
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("percentile: no samples");
  if (!(p > 0 && p <= 100)) throw new Error("percentile: p must be in (0, 100]");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}
export const p75 = (v) => percentile(v, 75);
export const p95 = (v) => percentile(v, 95);

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("median: no samples");
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Does `with` regress against `without`? Both are medians in ms. A rise counts when it is over `pct` percent AND over `floorMs` in absolute terms.
 * The gate uses floorMs 0 (the story says "median rises over 25%", full stop); the option stays for a noisy staging link.
 */
export function regressed(without, withScan, { pct = 25, floorMs = 0 } = {}) {
  const rise = withScan - without;
  return rise > floorMs && withScan > without * (1 + pct / 100);
}
