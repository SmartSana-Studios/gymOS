// Story 24.10 (AD-43, AD-50): what the proxy does with a request, as ONE pure function so a test can enumerate every outcome.
// Tenant identity comes from the Host header alone; the path allowlist of a gym host lives here and in the handler.
import { classifyHost } from "@gymos/types";
import { FONT_ALLOWLIST } from "@gymos/page-templates/src/contract";

const FONT_PATHS: ReadonlySet<string> = new Set(Object.values(FONT_ALLOWLIST).map((f) => f.path));

export type GymRequestDecision =
  /** The marketing site (apex, www, any host that is not under the root domain): untouched. */
  | { kind: "marketing" }
  /** A self-hosted font on a valid gym host: served as the static file it is. */
  | { kind: "asset" }
  /** Answered by the uniform not-found without a database call. */
  | { kind: "not-found"; reason: "depth" | "grammar" | "reserved" | "no-root" }
  /** A candidate gym page: rewritten to the one route handler, which reads the database. */
  | { kind: "page"; name: string; pathname: string };

export function decideGymRequest(host: string | null | undefined, pathname: string, rootDomain: string | undefined): GymRequestDecision {
  if (!rootDomain) return { kind: "marketing" };
  const h = classifyHost(host, rootDomain);
  if (h.kind === "marketing") return { kind: "marketing" };
  if (h.kind === "not-found") return { kind: "not-found", reason: h.reason };
  if (FONT_PATHS.has(pathname)) return { kind: "asset" };
  return { kind: "page", name: h.label, pathname };
}
