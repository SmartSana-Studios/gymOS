/**
 * Story 17.3 (AC #11): `/coach/classes` exists so the My Classes sub-nav item
 * does not 404; Story 17.4 owns what it shows. Until then it renders one
 * neutral note and nothing else. In particular it must not render AD-21's
 * "You are not assigned to any classes yet" empty state -- a false statement
 * to a Coach who does teach classes.
 */
import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import CoachClassesPage from "./page";

function textContent(node: ReactNode): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(textContent);
  if (!isValidElement(node)) return [];
  return textContent((node.props as { children?: ReactNode }).children);
}

describe("/coach/classes (route shell until Story 17.4)", () => {
  it("renders only the neutral placeholder note", async () => {
    const boundary = CoachClassesPage() as ReactElement<{ children: ReactElement }>;
    const child = boundary.props.children;
    const tree = await (child.type as (props: unknown) => Promise<ReactElement>)(child.props);

    expect(textContent(tree)).toEqual(["coachPortal.classes.pendingNote"]);
  });
});
