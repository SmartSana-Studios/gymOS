/**
 * Story 17.3 (AC #4, #5, #15). Two things are pinned here:
 *
 *  - Story 5.2 AC#1's role matrix, which had no automated test before this
 *    file: a Coach's sidebar contains the Coach Portal link and NO Payments,
 *    Members, Settings or Audit Log link. The owner case is the positive
 *    control -- an absence assertion that passes because nothing rendered at
 *    all would be worse than no test.
 *  - The active-state rule: an exact match wins, otherwise the longest href
 *    the pathname sits under, never "/" by prefix.
 *
 * Rendered with `isMobileOpen={false}`: at `true`, `SidebarContent` renders
 * twice and every `getBy*` link query throws on the duplicate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { MemberRole } from "@/services/session";

let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: async () => ({ error: null }) } }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

// Sidebar.tsx imports GymSwitcher, which pulls a "use server" actions module
// and next/headers into jsdom. availableGyms is empty below, so it never
// renders anyway.
vi.mock("./GymSwitcher", () => ({ GymSwitcher: () => null }));

import { Sidebar } from "./Sidebar";

function renderSidebar(role: MemberRole) {
  return render(
    <Sidebar role={role} gymId="gym-a" gymName="Gym A" availableGyms={[]} isMobileOpen={false} onCloseMobile={() => {}} />,
  );
}

/** The labels (i18n keys, via the mock above) of every link styled active. */
function activeLinkLabels(): string[] {
  return screen
    .getAllByRole("link")
    .filter((link) => link.className.includes("font-bold"))
    .map((link) => link.textContent ?? "");
}

describe("Sidebar", () => {
  it("after a successful sign-out the logout dialog is closed and re-armed for the next account", async () => {
    // jsdom has no showModal; mimic the browser, which throws if already open.
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    const original = { showModal: proto.showModal, close: proto.close };
    proto.showModal = function (this: HTMLDialogElement) {
      if (this.open) throw new DOMException("already open", "InvalidStateError");
      this.setAttribute("open", "");
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
    try {
      render(
        <Sidebar role="owner" gymId="gym-a" gymName="Gym A" availableGyms={[]} isMobileOpen={false} onCloseMobile={() => {}} />,
      );
      const user = userEvent.setup();
      await user.click(screen.getAllByRole("button", { name: "sidebar.logout" })[0]!);
      const dialog = document.querySelector("dialog")!;
      expect(dialog.hasAttribute("open")).toBe(true);

      await user.click(screen.getAllByRole("button", { name: "sidebar.logout" }).at(-1)!);

      await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
      // Not stuck in the "logging out" state for the next login.
      expect(screen.getAllByRole("button", { name: "sidebar.logout" }).every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
      // A second login/logout cycle on the same footer must not throw.
      await user.click(screen.getAllByRole("button", { name: "sidebar.logout" })[0]!);
      expect(dialog.hasAttribute("open")).toBe(true);
    } finally {
      proto.showModal = original.showModal;
      proto.close = original.close;
    }
  });

  describe("role matrix (Story 5.2 AC#1)", () => {
    it("renders only the Coach Portal link for a Coach", () => {
      pathname = "/coach";
      renderSidebar("coach");

      expect(screen.getByRole("link", { name: "nav.coachPortal" })).toHaveAttribute("href", "/coach");
      for (const absent of ["nav.payments", "nav.members", "nav.settings", "nav.auditLog"]) {
        expect(screen.queryByRole("link", { name: absent }), absent).toBeNull();
      }
      expect(screen.getAllByRole("link")).toHaveLength(1);
    });

    it("renders those same items for an Owner (positive control)", () => {
      renderSidebar("owner");

      for (const present of ["nav.payments", "nav.members", "nav.settings", "nav.auditLog"]) {
        expect(screen.getByRole("link", { name: present }), present).toBeInTheDocument();
      }
      expect(screen.queryByRole("link", { name: "nav.coachPortal" })).toBeNull();
    });
  });

  describe("active state", () => {
    it.each([
      ["/", ["nav.overview"]],
      ["/members", ["nav.members"]],
      ["/members/new", ["nav.members"]],
      // The one place one href prefixes another: exact match must win.
      ["/settings/staff", ["nav.staff"]],
      ["/settings", ["nav.settings"]],
      ["/settings/staff/some-id", ["nav.staff"]],
      // A shared string prefix is not a child route.
      ["/membersarchive", []],
      ["/nowhere", []],
    ])("owner on %s lights %j", (path, expected) => {
      pathname = path;
      renderSidebar("owner");

      expect(activeLinkLabels()).toEqual(expected);
    });

    it.each(["/coach", "/coach/overview", "/coach/classes", "/coach/3f2b8c1e-5d4a-4e7b-9c1d-2a6f8e0b7d35"])(
      "coach on %s keeps Coach Portal lit",
      (path) => {
        pathname = path;
        renderSidebar("coach");

        expect(activeLinkLabels()).toEqual(["nav.coachPortal"]);
      },
    );
  });
});
