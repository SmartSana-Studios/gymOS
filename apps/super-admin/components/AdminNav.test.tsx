/** The grouped Super Admin menu: a dropdown group on the inline bar and headed groups in the hamburger panel. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let pathname = "/billing";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/components/LanguageToggle", () => ({ LanguageToggle: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));

import { AdminNavGroup } from "./AdminNavGroup";
import { MobileNavMenu } from "./MobileNavMenu";

const items = [
  { href: "/gyms", label: "All gyms" },
  { href: "/billing", label: "Billing" },
  { href: "/tiers", label: "Tiers" },
];

describe("AdminNavGroup", () => {
  it("shows only the group label until it is opened, then lists the items and marks the current one", async () => {
    pathname = "/billing";
    const user = userEvent.setup();
    render(<AdminNavGroup label="Gyms" items={items} />);
    expect(screen.queryByText("Billing")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Gyms" }));
    const links = await screen.findAllByRole("menuitem");
    expect(links.map((l) => l.textContent)).toEqual(["All gyms", "Billing", "Tiers"]);
    expect(screen.getByRole("menuitem", { name: "Billing" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("menuitem", { name: "Tiers" }).getAttribute("aria-current")).toBeNull();
  });
});

describe("MobileNavMenu", () => {
  it("lists a plain link and each group under its heading", async () => {
    pathname = "/metrics";
    const user = userEvent.setup();
    render(
      <MobileNavMenu
        entries={[
          { type: "link", href: "/metrics", label: "Overview" },
          { type: "group", label: "Gyms", items },
          { type: "group", label: "Access", items: [{ href: "/admins", label: "Admins" }] },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "nav.openMenu" }));
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("href")).toBe("/metrics");
    const gymsGroup = screen.getByRole("group", { name: "Gyms" });
    expect(gymsGroup.textContent).toContain("Billing");
    expect(screen.getByRole("group", { name: "Access" }).textContent).toContain("Admins");
    expect(screen.getByRole("link", { name: "Billing" }).getAttribute("href")).toBe("/billing");
  });
});
