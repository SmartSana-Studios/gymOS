import { describe, expect, it } from "vitest";

import { allNavHrefs, isActivePath, isGroupActive, NAV_ENTRIES } from "./nav";

// The old flat bar, in its order: every one of these must still be reachable.
const OLD_FLAT_BAR = ["/gyms", "/metrics", "/tiers", "/cities", "/payment-providers", "/messaging", "/billing", "/admins", "/support", "/pages", "/security"];

describe("Super Admin menu", () => {
  it("keeps every destination of the old flat bar", () => {
    const hrefs = allNavHrefs();
    for (const href of OLD_FLAT_BAR) expect(hrefs).toContain(href);
  });

  it("has five top-level entries and no destination twice", () => {
    expect(NAV_ENTRIES).toHaveLength(5);
    const hrefs = allNavHrefs();
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("lights a link on its own path and on a child path, not on a lookalike prefix", () => {
    expect(isActivePath("/gyms", "/gyms")).toBe(true);
    expect(isActivePath("/gyms/abc", "/gyms")).toBe(true);
    expect(isActivePath("/gyms-archive", "/gyms")).toBe(false);
  });

  it("lights a group when the current page is any of its items", () => {
    const gyms = NAV_ENTRIES.find((e) => e.type === "group" && e.labelKey === "nav.groups.gyms");
    expect(gyms && gyms.type === "group" && isGroupActive("/billing", gyms.items)).toBe(true);
    expect(gyms && gyms.type === "group" && isGroupActive("/gyms/123", gyms.items)).toBe(true);
    expect(gyms && gyms.type === "group" && isGroupActive("/security", gyms.items)).toBe(false);
  });
});
