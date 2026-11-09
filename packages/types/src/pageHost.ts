// Story 24.10 (AD-43, AD-50): tenant identity comes from the Host header alone. This is the one function that reads it. It is pure (no
// environment, no I/O) so the landing proxy, its tests and the conformance suite all call the same thing.
import { isValidPageName } from "./constants/pageNameGrammar";
import { isReservedLabel } from "./constants/reservedLabels";

export type HostClass =
  /** The marketing site: the apex, `www.`, and any host that is not under the root domain (a `*.vercel.app` preview, an unknown root). */
  | { kind: "marketing"; reason: "apex" | "www" | "other" }
  /** A host under the root domain that can never be a gym page. No database call is made for it. */
  | { kind: "not-found"; reason: "depth" | "grammar" | "reserved" }
  /** A candidate gym page: the label passed the grammar and is not reserved. The database decides the rest. */
  | { kind: "gym"; label: string };

/** Lowercase, without a port and without a trailing dot. Returns "" for anything that is not a plain host name. */
export function normalizeHostName(host: string | null | undefined): string {
  if (!host) return "";
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return ""; // an IPv6 literal is never a gym host
  const withoutPort = h.replace(/:\d{1,5}$/, "");
  return withoutPort.replace(/\.$/, "");
}

/** The first Host label under `rootDomain` (itself with or without a port), classified. */
export function classifyHost(hostHeader: string | null | undefined, rootDomain: string): HostClass {
  const host = normalizeHostName(hostHeader);
  const root = normalizeHostName(rootDomain);
  if (!root || !host) return { kind: "marketing", reason: "other" };
  if (host === root) return { kind: "marketing", reason: "apex" };
  if (host === `www.${root}`) return { kind: "marketing", reason: "www" };
  if (!host.endsWith(`.${root}`)) return { kind: "marketing", reason: "other" };
  const label = host.slice(0, host.length - root.length - 1);
  // The wildcard certificate covers one label level: `a.b.root` is never a page.
  if (label.includes(".")) return { kind: "not-found", reason: "depth" };
  if (!isValidPageName(label)) return { kind: "not-found", reason: "grammar" };
  if (isReservedLabel(label)) return { kind: "not-found", reason: "reserved" };
  return { kind: "gym", label };
}
