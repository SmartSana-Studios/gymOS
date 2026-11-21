/**
 * Story 17.3 (AC #6, #9, #13): the Coach Portal layout's structure.
 *
 * AC #9 is the reason this file exists. `CoachPortalNav` calls
 * `useSelectedLayoutSegment()`, which suspends under `cacheComponents` on
 * `/coach/[memberId]`. Without its OWN <Suspense>, the suspension bubbles to
 * `(dashboard)/layout.tsx`'s `fallback={null}` and blanks the whole dashboard
 * chrome while streaming -- and `next build` still exits 0, because that
 * ancestor boundary satisfies it. Nothing else would catch a refactor that
 * drops the boundary, so it is asserted here on the element tree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense, isValidElement, type ReactElement, type ReactNode } from "react";

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({
  getDashboardShellContext: (...args: unknown[]) => getDashboardShellContext(...args),
}));

const listPickerCoaches = vi.fn();
vi.mock("@/services/coachPicker", () => ({
  listPickerCoaches: (...args: unknown[]) => listPickerCoaches(...args),
}));

vi.mock("./components/CoachPickerHeader", () => ({
  CoachPickerHeader: function CoachPickerHeader() {
    return null;
  },
  CoachPickerHeaderFallback: function CoachPickerHeaderFallback() {
    return null;
  },
}));

vi.mock("./components/CoachPickerNav", () => ({
  CoachPickerNav: function CoachPickerNav() {
    return null;
  },
}));

vi.mock("./components/CoachPortalNav", () => ({
  CoachPortalNav: function CoachPortalNav() {
    return null;
  },
  CoachPortalNavFallback: function CoachPortalNavFallback() {
    return null;
  },
}));

import CoachPortalLayout from "./layout";
import { CoachPortalNav, CoachPortalNavFallback } from "./components/CoachPortalNav";
import { CoachPickerHeader } from "./components/CoachPickerHeader";
import { CoachPickerNav } from "./components/CoachPickerNav";

function findAll(node: ReactNode, match: (el: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, match));
  if (!isValidElement(node)) return [];
  const own = match(node) ? [node] : [];
  return [...own, ...findAll((node.props as { children?: ReactNode }).children, match)];
}

async function renderLayout(children: ReactNode = <main data-testid="page" />): Promise<ReactElement> {
  return await CoachPortalLayout({ children });
}

function asRole(role: string | null) {
  getDashboardShellContext.mockResolvedValue({ data: role ? { role, memberId: "m-x", memberName: "Staff" } : null, error: null, suspended: null });
}

describe("Coach Portal layout", () => {
  beforeEach(() => {
    asRole("coach");
    listPickerCoaches.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it("renders the Portal heading once, above the sub-nav", async () => {
    const tree = await renderLayout();

    const headings = findAll(tree, (el) => el.type === "h1");
    expect(headings).toHaveLength(1);
    expect((headings[0].props as { children: ReactNode }).children).toBe("coachPortal.title");
  });

  it("wraps the sub-nav in its own Suspense boundary with a placeholder fallback, not null", async () => {
    const tree = await renderLayout();

    const [boundary] = findAll(tree, (el) => el.type === Suspense);
    expect(boundary).toBeDefined();

    const props = boundary.props as { children: ReactElement; fallback: ReactElement | null };
    expect(props.children.type).toBe(CoachPortalNav);
    expect(props.fallback).not.toBeNull();
    expect(props.fallback?.type).toBe(CoachPortalNavFallback);
  });

  it("renders heading, then sub-nav, then the page", async () => {
    const page = <main data-testid="page" />;
    const tree = await renderLayout(page);

    const order = (tree.props as { children: ReactNode[] }).children;
    expect((order[0] as ReactElement).type).toBe("h1");
    expect((order[1] as ReactElement).type).toBe(Suspense);
    expect(order[2]).toBe(page);
  });

  it("the Coach role keeps today's frame: no coach list read, no picker header", async () => {
    const tree = await renderLayout();

    expect(listPickerCoaches).not.toHaveBeenCalled();
    expect(findAll(tree, (el) => el.type === CoachPickerHeader)).toHaveLength(0);
    expect(findAll(tree, (el) => el.type === CoachPickerNav)).toHaveLength(0);
    expect(findAll(tree, (el) => el.type === CoachPortalNav)).toHaveLength(1);
  });

  it.each(["receptionist", "support"])("%s gets the global permission message from this one guard, and the page is not rendered", async (role) => {
    asRole(role);
    const page = <main data-testid="page" />;

    const tree = await renderLayout(page);

    expect((tree.props as { role: string }).role).toBe("alert");
    expect((tree.props as { children: ReactNode }).children).toBe("errors.permissionDenied");
    expect(findAll(tree, (el) => el === page)).toHaveLength(0);
    expect(findAll(tree, (el) => el.type === Suspense)).toHaveLength(0);
    expect(listPickerCoaches).not.toHaveBeenCalled();
  });

  it.each(["owner", "supervisor", "manager"])("%s gets the picker: the select with the gym's ACTIVE coaches, then Classes and Members, then the page", async (role) => {
    asRole(role);
    listPickerCoaches.mockResolvedValue({
      data: [
        { id: "c1", name: "Coach One", isActive: true },
        { id: "c2", name: "Coach Gone", isActive: false },
        { id: "c3", name: "Coach Three", isActive: true },
      ],
      error: null,
    });
    const page = <main data-testid="page" />;

    const tree = await renderLayout(page);

    const [header] = findAll(tree, (el) => el.type === CoachPickerHeader);
    expect((header.props as { coaches: unknown }).coaches).toEqual([
      { id: "c1", name: "Coach One" },
      { id: "c3", name: "Coach Three" },
    ]);
    expect(findAll(tree, (el) => el.type === CoachPickerNav)).toHaveLength(1);
    expect(findAll(tree, (el) => el.type === CoachPortalNav)).toHaveLength(0);
    const order = (tree.props as { children: ReactNode[] }).children;
    expect((order[0] as ReactElement).type).toBe("h1");
    expect(order[2]).toBe(page);
  });

  it("wraps the picker's nav in its own Suspense boundary with a placeholder fallback (useSelectedLayoutSegment suspends), and the header in its own", async () => {
    asRole("owner");

    const tree = await renderLayout();

    const boundaries = findAll(tree, (el) => el.type === Suspense) as ReactElement<{ children: ReactElement; fallback: ReactElement | null }>[];
    expect(boundaries).toHaveLength(2);
    expect(boundaries.map((b) => b.props.children.type)).toEqual([CoachPickerHeader, CoachPickerNav]);
    for (const b of boundaries) expect(b.props.fallback).not.toBeNull();
  });

  it("a failed coach read leaves an empty select; the page itself reports the failure", async () => {
    asRole("manager");
    listPickerCoaches.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });

    const tree = await renderLayout();

    const [header] = findAll(tree, (el) => el.type === CoachPickerHeader);
    expect((header.props as { coaches: unknown }).coaches).toEqual([]);
  });

  it("with no shell (no staff session) it renders the Coach frame as before", async () => {
    asRole(null);

    const tree = await renderLayout();

    expect(findAll(tree, (el) => el.type === CoachPortalNav)).toHaveLength(1);
  });
});
