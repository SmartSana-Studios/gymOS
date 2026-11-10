// Story 24.2 (AD-45/AD-43): the one reserved list for gym page names under *.gymosapps.com. Source of truth is reservedLabels.json,
// which scripts/check-reserved-labels.mjs reads directly (a test asserts the two agree). It is the union of FR-202's list, every
// grammar-valid label in docs/dns/gymosapps.com.zone, and smtp/imap/pop/test (not in the zone, but a wildcard would resolve them).
import data from "./reservedLabels.json";

export const RESERVED_LABELS: readonly string[] = data.labels;
export const RESERVED_LABEL_PREFIXES: readonly string[] = data.prefixes;

export function isReservedLabel(label: string): boolean {
  const l = label.toLowerCase();
  return RESERVED_LABELS.includes(l) || RESERVED_LABEL_PREFIXES.some((p) => l.startsWith(p));
}
