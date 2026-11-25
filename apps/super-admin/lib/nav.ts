/** The Super Admin menu: five top-level entries, three of them dropdown groups. One source for the inline bar (>=768px) and the hamburger panel, so the two never drift apart. */
export type NavLeaf = { href: string; labelKey: string };
export type NavEntry = ({ type: "link" } & NavLeaf) | { type: "group"; labelKey: string; items: readonly NavLeaf[] };

export const NAV_ENTRIES: readonly NavEntry[] = [
  { type: "link", href: "/metrics", labelKey: "nav.overview" },
  {
    type: "group",
    labelKey: "nav.groups.gyms",
    items: [
      { href: "/gyms", labelKey: "nav.allGyms" },
      { href: "/billing", labelKey: "nav.billing" },
      { href: "/tiers", labelKey: "nav.tiers" },
    ],
  },
  {
    type: "group",
    labelKey: "nav.groups.publicPages",
    items: [
      { href: "/pages", labelKey: "nav.pages" },
      { href: "/page-names", labelKey: "nav.pageNames" },
      { href: "/cities", labelKey: "nav.cities" },
    ],
  },
  {
    type: "group",
    labelKey: "nav.groups.platform",
    items: [
      { href: "/payment-providers", labelKey: "nav.paymentProviders" },
      { href: "/messaging", labelKey: "nav.messaging" },
    ],
  },
  {
    type: "group",
    labelKey: "nav.groups.access",
    items: [
      { href: "/admins", labelKey: "nav.admins" },
      { href: "/support", labelKey: "nav.support" },
      { href: "/security", labelKey: "nav.security" },
    ],
  },
];

/** A link is current on its own path and on any child path (/gyms stays lit on /gyms/[id]). */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isGroupActive(pathname: string, items: readonly { href: string }[]): boolean {
  return items.some((item) => isActivePath(pathname, item.href));
}

/** Every destination in the menu, in order: used by the tests to prove nothing the old flat bar offered was lost. */
export function allNavHrefs(entries: readonly NavEntry[] = NAV_ENTRIES): string[] {
  return entries.flatMap((e) => (e.type === "link" ? [e.href] : e.items.map((i) => i.href)));
}
