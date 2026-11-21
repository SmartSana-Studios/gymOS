/**
 * Story 17.5 (AC #12, #15): AD-15's `?tab=` deep link. The Coach Portal
 * Overview's Recent Progress rows link to `/coach/<id>?tab=progress`, so the
 * page must hand the client component the tab to open -- and ONLY an exact,
 * known tab name may open one; anything else lands on Session Notes.
 *
 * Asserted on the element tree: reach through the page's <Suspense> to the
 * async child and await it. The client component is mocked, which keeps its
 * "use server" actions, Radix and lucide out of jsdom.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const getMemberDetail = vi.fn();
const listSessionNotes = vi.fn();
const getMemberProgressData = vi.fn();
vi.mock("@/services/coaches", () => ({
  getMemberDetail: (...args: unknown[]) => getMemberDetail(...args),
  listSessionNotes: (...args: unknown[]) => listSessionNotes(...args),
  getMemberProgressData: (...args: unknown[]) => getMemberProgressData(...args),
}));

const getWorkoutPlan = vi.fn();
vi.mock("@/services/workoutPlans", () => ({
  getWorkoutPlan: (...args: unknown[]) => getWorkoutPlan(...args),
}));

const listExerciseLibrary = vi.fn();
vi.mock("@/services/exercises", () => ({
  listExerciseLibrary: (...args: unknown[]) => listExerciseLibrary(...args),
}));

const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({
  getDashboardShellContext: (...args: unknown[]) => getDashboardShellContext(...args),
}));

const listPickerCoaches = vi.fn();
const getCoachAssignedMember = vi.fn();
const listCoachMemberSessionNotes = vi.fn();
const getCoachMemberWorkoutPlan = vi.fn();
vi.mock("@/services/coachPicker", () => ({
  listPickerCoaches: (...args: unknown[]) => listPickerCoaches(...args),
  getCoachAssignedMember: (...args: unknown[]) => getCoachAssignedMember(...args),
  listCoachMemberSessionNotes: (...args: unknown[]) => listCoachMemberSessionNotes(...args),
  getCoachMemberWorkoutPlan: (...args: unknown[]) => getCoachMemberWorkoutPlan(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("../components/CoachPickerStates", () => ({
  CoachPickerNotice: function CoachPickerNotice() {
    return null;
  },
}));

vi.mock("./components/CoachPickerMemberDetail", () => ({
  CoachPickerMemberDetail: function CoachPickerMemberDetail() {
    return null;
  },
}));

vi.mock("./components/CoachMemberDetailPageClient", () => ({
  CoachMemberDetailPageClient: function CoachMemberDetailPageClient() {
    return null;
  },
}));

import CoachMemberDetailPage from "./page";
import { CoachMemberDetailPageClient } from "./components/CoachMemberDetailPageClient";
import { CoachPickerMemberDetail } from "./components/CoachPickerMemberDetail";
import { CoachPickerNotice } from "../components/CoachPickerStates";

type AsyncComponent = (props: unknown) => Promise<ReactElement>;

async function renderDetail(tab?: string | string[], coach?: string | string[], memberId = "m-aicha"): Promise<ReactElement> {
  const boundary = CoachMemberDetailPage({
    params: Promise.resolve({ memberId }),
    searchParams: Promise.resolve({ ...(tab === undefined ? {} : { tab }), ...(coach === undefined ? {} : { coach }) }),
  }) as ReactElement<{ children: ReactElement }>;
  const child = boundary.props.children;
  return await (child.type as AsyncComponent)(child.props);
}

describe("/coach/[memberId] ?tab=", () => {
  beforeEach(() => {
    getDashboardShellContext.mockReset().mockResolvedValue({ data: { role: "coach", memberId: "m-coach", memberName: "Coach" }, error: null, suspended: null });
    getMemberDetail.mockReset().mockResolvedValue({
      data: {
        memberId: "m-aicha",
        memberName: "Aicha Mbarga",
        phoneMasked: null,
        goal: null,
        experienceLevel: null,
        startingWeightKg: null,
        planName: "Monthly",
        planType: "monthly",
        status: "active",
        expiryDate: "2026-10-01",
      },
      error: null,
    });
    listSessionNotes.mockReset().mockResolvedValue({ data: [], error: null });
    getMemberProgressData.mockReset().mockResolvedValue({ data: { entries: [], sharedPhotos: [] }, error: null });
    getWorkoutPlan.mockReset().mockResolvedValue({ data: null, canCreatePlan: true, error: null });
    listExerciseLibrary.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it.each([
    ["progress", "progress"],
    ["workout-plan", "workout-plan"],
  ])("opens the %s tab for ?tab=%s", async (tab, expected) => {
    const tree = await renderDetail(tab);

    expect(tree.type).toBe(CoachMemberDetailPageClient);
    expect((tree.props as { initialTab: string }).initialTab).toBe(expected);
  });

  it.each([
    ["no tab", undefined],
    ["an unknown tab", "garbage"],
    ["a differently-cased tab", "PROGRESS"],
    ["a repeated tab", ["progress", "progress"]],
  ])("lands on Session Notes for %s", async (_label, tab) => {
    const tree = await renderDetail(tab);

    expect((tree.props as { initialTab: string }).initialTab).toBe("session-notes");
  });

  it("still loads the member it was asked for", async () => {
    await renderDetail("progress");

    expect(getMemberDetail).toHaveBeenCalledWith("m-aicha");
  });
});

const COACH_A = "11111111-1111-4111-8111-111111111111";
const COACH_B = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";

describe("/coach/[memberId] in picker mode (Story 29.4)", () => {
  function asRole(role: string) {
    getDashboardShellContext.mockResolvedValue({ data: { role, memberId: "m-x", memberName: "Staff" }, error: null, suspended: null });
  }

  beforeEach(() => {
    for (const fn of [getMemberDetail, listSessionNotes, getMemberProgressData, getWorkoutPlan, listExerciseLibrary]) fn.mockReset();
    asRole("manager");
    listPickerCoaches.mockReset().mockResolvedValue({
      data: [
        { id: COACH_A, name: "Coach A", isActive: true },
        { id: COACH_B, name: "Coach B", isActive: true },
      ],
      error: null,
    });
    getCoachAssignedMember.mockReset().mockResolvedValue({ data: { memberId: MEMBER, memberName: "Aicha" }, error: null });
    listCoachMemberSessionNotes.mockReset().mockResolvedValue({ data: [], error: null });
    getCoachMemberWorkoutPlan.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it.each(["owner", "supervisor", "manager"])("%s reads the member through the three picker reads only, never the Coach's own reads", async (role) => {
    asRole(role);

    const tree = await renderDetail(undefined, COACH_A, MEMBER);

    expect(tree.type).toBe(CoachPickerMemberDetail);
    expect(tree.props).toMatchObject({ coachId: COACH_A, initialTab: "session-notes" });
    expect(getCoachAssignedMember).toHaveBeenCalledWith(COACH_A, MEMBER);
    expect(listCoachMemberSessionNotes).toHaveBeenCalledWith(COACH_A, MEMBER);
    expect(getCoachMemberWorkoutPlan).toHaveBeenCalledWith(COACH_A, MEMBER);
    expect(getMemberDetail).not.toHaveBeenCalled();
    expect(listSessionNotes).not.toHaveBeenCalled();
    expect(getMemberProgressData).not.toHaveBeenCalled();
    expect(getWorkoutPlan).not.toHaveBeenCalled();
    expect(listExerciseLibrary).not.toHaveBeenCalled();
  });

  it("opens the Workout Plan tab for ?tab=workout-plan and nothing else", async () => {
    expect((await renderDetail("workout-plan", COACH_A, MEMBER)).props).toMatchObject({ initialTab: "workout-plan" });
    expect((await renderDetail("garbage", COACH_A, MEMBER)).props).toMatchObject({ initialTab: "session-notes" });
  });

  it("?tab=progress shows the part-unavailable message and reads nothing about the member", async () => {
    const tree = await renderDetail("progress", COACH_A, MEMBER);

    expect(tree.type).toBe(CoachPickerNotice);
    expect(tree.props).toMatchObject({ state: { kind: "partUnavailable", coachId: COACH_A } });
    expect(getCoachAssignedMember).not.toHaveBeenCalled();
    expect(getMemberProgressData).not.toHaveBeenCalled();
  });

  it("a repeated ?tab=progress&tab=x is still the Progress address: part-unavailable, nothing read", async () => {
    const tree = await renderDetail(["x", "progress"], COACH_A, MEMBER);

    expect(tree.type).toBe(CoachPickerNotice);
    expect(tree.props).toMatchObject({ state: { kind: "partUnavailable", coachId: COACH_A } });
    expect(getCoachAssignedMember).not.toHaveBeenCalled();
  });

  it("a member not currently assigned to the chosen coach shows not-assigned, never the profile", async () => {
    getCoachAssignedMember.mockResolvedValue({ data: null, error: null });

    const tree = await renderDetail(undefined, COACH_B, MEMBER);

    expect(tree.type).toBe(CoachPickerNotice);
    expect(tree.props).toMatchObject({ state: { kind: "notAssigned", coachId: COACH_B, coachName: "Coach B" } });
  });

  it("a malformed member id is not-assigned without a database call", async () => {
    const tree = await renderDetail(undefined, COACH_A, "not-a-uuid");

    expect(tree.props).toMatchObject({ state: { kind: "notAssigned" } });
    expect(getCoachAssignedMember).not.toHaveBeenCalled();
  });

  it("nothing chosen, several coaches: the choose message, no read; one active coach: redirect keeping the member", async () => {
    const tree = await renderDetail(undefined, undefined, MEMBER);
    expect(tree.props).toMatchObject({ state: { kind: "choose" } });
    expect(getCoachAssignedMember).not.toHaveBeenCalled();

    listPickerCoaches.mockResolvedValue({ data: [{ id: COACH_A, name: "Coach A", isActive: true }], error: null });
    await expect(renderDetail(undefined, undefined, MEMBER)).rejects.toThrow(`NEXT_REDIRECT:/coach/${MEMBER}?coach=${COACH_A}`);
  });

  it("the one-coach redirect keeps a Progress or Workout Plan tab, so a Progress address still reaches its message", async () => {
    listPickerCoaches.mockResolvedValue({ data: [{ id: COACH_A, name: "Coach A", isActive: true }], error: null });
    await expect(renderDetail("progress", undefined, MEMBER)).rejects.toThrow(`NEXT_REDIRECT:/coach/${MEMBER}?coach=${COACH_A}&tab=progress`);
    await expect(renderDetail("workout-plan", undefined, MEMBER)).rejects.toThrow(`NEXT_REDIRECT:/coach/${MEMBER}?coach=${COACH_A}&tab=workout-plan`);
    await expect(renderDetail("nonsense", undefined, MEMBER)).rejects.toThrow(`NEXT_REDIRECT:/coach/${MEMBER}?coach=${COACH_A}`);
  });

  it("a read failure shows the inline load error", async () => {
    listCoachMemberSessionNotes.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });

    const tree = await renderDetail(undefined, COACH_A, MEMBER);

    expect(tree.type).toBe("div");
  });

  it("the Coach role ignores a typed ?coach=: their own reads, no picker read", async () => {
    asRole("coach");
    getMemberDetail.mockResolvedValue({ data: { memberId: "m-aicha", memberName: "Aicha Mbarga" }, error: null });
    listSessionNotes.mockResolvedValue({ data: [], error: null });
    getMemberProgressData.mockResolvedValue({ data: { entries: [], sharedPhotos: [] }, error: null });
    getWorkoutPlan.mockResolvedValue({ data: null, canCreatePlan: true, error: null });
    listExerciseLibrary.mockResolvedValue({ data: [], error: null });

    const tree = await renderDetail(undefined, COACH_B, "m-aicha");

    expect(tree.type).toBe(CoachMemberDetailPageClient);
    expect(getMemberDetail).toHaveBeenCalledWith("m-aicha");
    expect(listPickerCoaches).not.toHaveBeenCalled();
    expect(getCoachAssignedMember).not.toHaveBeenCalled();
  });
});
