/**
 * Story 17.5 (AC #11): AD-20's loading state is four text-free skeleton widget
 * cards, marked busy.
 */
import { describe, expect, it } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import CoachOverviewLoading from "./loading";

function findAll(node: ReactNode, match: (el: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, match));
  if (!isValidElement(node)) return [];
  const own = match(node) ? [node] : [];
  return [...own, ...findAll((node.props as { children?: ReactNode }).children, match)];
}

function textContent(node: ReactNode): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(textContent);
  if (!isValidElement(node)) return [];
  return textContent((node.props as { children?: ReactNode }).children);
}

describe("CoachOverviewLoading", () => {
  it("renders four text-free skeleton widget cards, marked busy", () => {
    const skeleton = CoachOverviewLoading() as ReactElement<{ children: ReactNode; "aria-busy"?: string }>;

    expect(skeleton.props["aria-busy"]).toBe("true");
    expect(findAll(skeleton.props.children, () => true)).toHaveLength(4);
    expect(textContent(skeleton)).toEqual([]);
  });
});
