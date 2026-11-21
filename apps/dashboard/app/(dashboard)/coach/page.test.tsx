/**
 * Story 29.4 (UX AD-14 in picker mode): `/coach`, the Members tab.
 *  - Owner, Supervisor and Manager with a coach chosen read that coach's members through the picker read, with the page's search, sort and direction,
 *    and never the Coach's own RLS read; the client gets the chosen coach;
 *  - nothing chosen: the choose message and no data; one active coach: a redirect to Classes; unavailable / inactive / no-coaches states;
 *  - the Coach role ignores a typed ?coach=: their own list, exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

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

const listPickerCoaches = vi.fn();
const listCoachAssignedMembers = vi.fn();
vi.mock("@/services/coachPicker", () => ({
  listPickerCoaches: (...args: unknown[]) => listPickerCoaches(...args),
  listCoachAssignedMembers: (...args: unknown[]) => listCoachAssignedMembers(...args),
}));

const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({
  getDashboardShellContext: (...args: unknown[]) => getDashboardShellContext(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("./components/CoachPortalPageClient", () => ({
  CoachPortalPageClient: function CoachPortalPageClient() {
    return null;
  },
}));
vi.mock("./components/CoachPickerStates", () => ({
  CoachPickerNotice: function CoachPickerNotice() {
    return null;
  },
}));

import CoachPortalPage from "./page";
import { CoachPortalPageClient } from "./components/CoachPortalPageClient";
import { CoachPickerNotice } from "./components/CoachPickerStates";

type AsyncComponent = (props: unknown) => Promise<ReactElement>;

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

async function render(searchParams: Record<string, string | string[]> = {}): Promise<ReactElement> {
  const boundary = CoachPortalPage({ searchParams: Promise.resolve(searchParams) }) as ReactElement<{ children: ReactElement }>;
  const child = boundary.props.children;
  return await (child.type as AsyncComponent)(child.props);
}

function asRole(role: string) {
  getDashboardShellContext.mockResolvedValue({ data: { role, memberId: "m-x", memberName: "Staff" }, error: null, suspended: null });
}

describe("/coach", () => {
  beforeEach(() => {
    asRole("manager");
    listAssignedMembers.mockReset().mockResolvedValue({ data: [], error: null });
    listCoachAssignedMembers.mockReset().mockResolvedValue({ data: [{ memberId: "m1" }], error: null });
    listPickerCoaches.mockReset().mockResolvedValue({
      data: [
        { id: A, name: "Coach A", isActive: true },
        { id: B, name: "Coach B", isActive: true },
      ],
      error: null,
    });
  });

  it.each(["owner", "supervisor", "manager"])("%s: reads the chosen coach's members with the page's search and sort, and hands the client the coach", async (role) => {
    asRole(role);

    const tree = await render({ coach: A, search: "ali", sort: "plan", dir: "desc" });

    expect(listCoachAssignedMembers).toHaveBeenCalledWith(A, { search: "ali", sort: "plan", dir: "desc" });
    expect(listAssignedMembers).not.toHaveBeenCalled();
    expect(tree.type).toBe(CoachPortalPageClient);
    expect(tree.props).toMatchObject({ picker: { coachId: A, coachName: "Coach A" }, search: "ali", sort: "plan", dir: "desc" });
  });

  it("nothing chosen: the choose message, and no member read", async () => {
    const tree = await render();

    expect(tree.type).toBe(CoachPickerNotice);
    expect(tree.props).toMatchObject({ state: { kind: "choose" } });
    expect(listCoachAssignedMembers).not.toHaveBeenCalled();
    expect(listAssignedMembers).not.toHaveBeenCalled();
  });

  it("one active coach and nothing chosen: redirects to Classes with that coach", async () => {
    listPickerCoaches.mockResolvedValue({ data: [{ id: A, name: "Coach A", isActive: true }], error: null });

    await expect(render()).rejects.toThrow(`NEXT_REDIRECT:/coach/classes?coach=${A}`);
  });

  it("an unknown coach: unavailable; a deactivated one: inactive; no coach in the gym: no-coaches", async () => {
    expect((await render({ coach: "44444444-4444-4444-8444-444444444444" })).props).toMatchObject({ state: { kind: "unavailable" } });

    listPickerCoaches.mockResolvedValue({ data: [{ id: A, name: "Gone", isActive: false }, { id: B, name: "B", isActive: true }], error: null });
    expect((await render({ coach: A })).props).toMatchObject({ state: { kind: "inactive", name: "Gone" } });

    listPickerCoaches.mockResolvedValue({ data: [], error: null });
    expect((await render()).props).toMatchObject({ state: { kind: "no-coaches", canOpenStaff: false } });
    expect(listCoachAssignedMembers).not.toHaveBeenCalled();
  });

  it("a failed read shows the inline load error", async () => {
    listCoachAssignedMembers.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });

    expect((await render({ coach: A })).type).toBe("div");
  });

  it("the Coach role ignores a typed ?coach=: their own list, no picker, no coach list read", async () => {
    asRole("coach");
    listAssignedMembers.mockResolvedValue({ data: [{ memberId: "own" }], error: null });

    const tree = await render({ coach: B, search: "x" });

    expect(listAssignedMembers).toHaveBeenCalledWith({ search: "x", sort: undefined, dir: undefined });
    expect(listPickerCoaches).not.toHaveBeenCalled();
    expect(listCoachAssignedMembers).not.toHaveBeenCalled();
    expect(tree.type).toBe(CoachPortalPageClient);
    expect((tree.props as { picker?: unknown }).picker ?? null).toBeNull();
  });
});
