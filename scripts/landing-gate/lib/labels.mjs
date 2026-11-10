// Random page labels for the label-scan load check: always valid under the name grammar (3 to 30 characters of a-z0-9-, no leading or trailing
// hyphen, no `--`, no `xn--`, not digits only), so the request reaches the database instead of being answered by the proxy. 12 to 24 characters
// long, which no reserved label is (the longest reserved word is 12 characters, and a random 12 is not a word).
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Small seeded generator (mulberry32): the same seed gives the same scan, so a failing run can be repeated. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isGrammarValid(label) {
  return (
    typeof label === "string" &&
    label.length >= 3 && label.length <= 30 &&
    /^[a-z0-9-]+$/.test(label) &&
    !label.startsWith("-") && !label.endsWith("-") &&
    !label.includes("--") &&
    !label.startsWith("xn--") &&
    !/^[0-9]+$/.test(label)
  );
}

export function randomLabel(next) {
  const len = 12 + Math.floor(next() * 13); // 12..24
  let out = "";
  for (let i = 0; i < len; i++) {
    // an interior single hyphen now and then, never at an end and never doubled
    if (i > 0 && i < len - 1 && out[i - 1] !== "-" && next() < 0.08) out += "-";
    else out += ALPHABET[Math.floor(next() * ALPHABET.length)];
  }
  // at least one letter (a digits-only label is invalid) and no trailing hyphen
  if (!/[a-z]/.test(out)) out = `x${out.slice(1)}`;
  return out.replace(/-+$/, "z");
}

/** `realShare` of the labels (0..1) are drawn from `real`; the rest are random unknown labels. */
export function pickLabel(next, real, realShare) {
  if (real.length > 0 && next() < realShare) return { label: real[Math.floor(next() * real.length)], real: true };
  return { label: randomLabel(next), real: false };
}
