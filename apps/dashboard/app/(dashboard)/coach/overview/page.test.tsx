/**
 * Story 17.3 (AC #10): the Coach's landing page, `/coach/overview`, and its
 * one widget -- My Members At A Glance. Asserted on the element tree using
 * layout.gymSwitchRemount.test.tsx's technique: reach through the page's
 * <Suspense> to the async child and await it.
 *
 *  - one `listAssignedMembers({})` call, no new query;
 *  - the assigned total and a per-status breakdown, labelled with the
 *    existing `members.status.*` keys, zero-count statuses left out;
 *  - "All →" goes to `/coach`;
 *  - no assignments -> AD-14's existing `coachPortal.emptyNoAssignments` copy;
 *  - a failed read -> the app's inline `common.loadError`, never a throw.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import type { CoachPortalMemberRow } from "@/services/coaches";

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const listAssignedMembers = vi.fn();
vi.mock("@/services/coaches", () => ({
  listAssignedMembers: (...args: unknown[]) => listAssignedMembers(...args),
}));

import CoachOverviewPage from "./page";
import { Badge } from "@/components/ui/badge";

type AsyncComponent = (props: unknown) => Promise<ReactElement>;

async function renderOverview(): Promise<ReactElement> {
  const boundary = CoachOverviewPage() as ReactElement<{ children: ReactElement }>;
  const child = boundary.props.children;
  return await (child.type as AsyncComponent)(child.props);
}

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

function rows(counts: Partial<Record<CoachPortalMemberRow["status"], number>>): CoachPortalMemberRow[] {
  return Object.entries(counts).flatMap(([status, count]) =>
    Array.from({ length: count ?? 0 }, (_, i) => ({
      memberId: `${status}-${i}`,
      memberName: `Member ${status} ${i}`,
      planName: "Monthly",
      planType: "monthly",
      status: status as CoachPortalMemberRow["status"],
      expiryDate: "2026-10-01",
    })),
  );
}

describe("/coach/overview", () => {
  beforeEach(() => {
    listAssignedMembers.mockReset().mockResolvedValue({
      data: rows({ active: 9, expiring_soon: 2, expired: 1 }),
      error: null,
    });
  });

  it("reads the caseload with one listAssignedMembers({}) call", async () => {
    await renderOverview();

    expect(listAssignedMembers).toHaveBeenCalledTimes(1);
    expect(listAssignedMembers).toHaveBeenCalledWith({});
  });

  it("shows the assigned total", async () => {
    const tree = await renderOverview();
    const text = textContent(tree);

    expect(text).toContain("coachPortal.overview.membersAtAGlance.title");
    expect(text).toContain("12");
    expect(text).toContain("coachPortal.overview.membersAtAGlance.assignedLabel");
  });

  it("breaks the total down by subscription status, in status order, skipping empty statuses", async () => {
    const tree = await renderOverview();

    const breakdown = findAll(tree, (el) => el.type === Badge).map((badge) => textContent(badge));
    expect(breakdown).toEqual([
      ["members.status.active", "9"],
      ["members.status.expiringSoon", "2"],
      ["members.status.expired", "1"],
    ]);
  });

  it("links 'All →' to the My Members list", async () => {
    const tree = await renderOverview();

    const [link] = findAll(tree, (el) => (el.props as { href?: string }).href === "/coach");
    expect(link).toBeDefined();
    expect(textContent(link)).toEqual(["coachPortal.overview.membersAtAGlance.viewAll"]);
  });

  it("shows AD-14's no-assignments guidance instead of an empty widget", async () => {
    listAssignedMembers.mockResolvedValue({ data: [], error: null });

    const tree = await renderOverview();
    const text = textContent(tree);

    expect(text).toContain("coachPortal.emptyNoAssignments");
    expect(text).not.toContain("coachPortal.overview.membersAtAGlance.title");
    expect(findAll(tree, (el) => el.type === Badge)).toHaveLength(0);
  });

  it("renders the inline load error when the read fails", async () => {
    listAssignedMembers.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });

    const tree = await renderOverview();

    expect(textContent(tree)).toEqual(["common.loadError"]);
  });
});
