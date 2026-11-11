// Deliberately NOT a client module: page.tsx (a Server Component) reads these values. A value exported from a
// "use client" file reaches a Server Component only as an opaque client reference, so calling .includes() on it
// throws while rendering (React error #441 in production, invisible to jsdom unit tests).
export const PAGES_TABS = ["names", "reports", "appeals", "active"] as const;
export type PagesTab = (typeof PAGES_TABS)[number];

/** Any `?tab=` value becomes a known tab; anything else is the first one. */
export function parsePagesTab(value: string | null | undefined): PagesTab {
  return (PAGES_TABS as readonly string[]).includes(value ?? "") ? (value as PagesTab) : "names";
}

/** The public domain pages are served under (`<name>.gymosapps.com`). A plain module, same value as the dashboard's PAGE_PUBLIC_DOMAIN. */
export const PAGE_PUBLIC_DOMAIN = "gymosapps.com";

/** The public host of a page name. */
export function pagePublicHost(name: string): string {
  return `${name}.${PAGE_PUBLIC_DOMAIN}`;
}
