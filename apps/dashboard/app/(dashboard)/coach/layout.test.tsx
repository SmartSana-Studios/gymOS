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
import { describe, expect, it, vi } from "vitest";
import { Suspense, isValidElement, type ReactElement, type ReactNode } from "react";

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
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

function findAll(node: ReactNode, match: (el: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, match));
  if (!isValidElement(node)) return [];
  const own = match(node) ? [node] : [];
  return [...own, ...findAll((node.props as { children?: ReactNode }).children, match)];
}

async function renderLayout(children: ReactNode = <main data-testid="page" />): Promise<ReactElement> {
  return await CoachPortalLayout({ children });
}

describe("Coach Portal layout", () => {
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
});
