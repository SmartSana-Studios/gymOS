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

vi.mock("./components/CoachMemberDetailPageClient", () => ({
  CoachMemberDetailPageClient: function CoachMemberDetailPageClient() {
    return null;
  },
}));

import CoachMemberDetailPage from "./page";
import { CoachMemberDetailPageClient } from "./components/CoachMemberDetailPageClient";

type AsyncComponent = (props: unknown) => Promise<ReactElement>;

async function renderDetail(tab?: string | string[]): Promise<ReactElement> {
  const boundary = CoachMemberDetailPage({
    params: Promise.resolve({ memberId: "m-aicha" }),
    searchParams: Promise.resolve(tab === undefined ? {} : { tab }),
  }) as ReactElement<{ children: ReactElement }>;
  const child = boundary.props.children;
  return await (child.type as AsyncComponent)(child.props);
}

describe("/coach/[memberId] ?tab=", () => {
  beforeEach(() => {
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
