/**
 * Story 29.4 (UX AD-15 in picker mode): a member currently assigned to the chosen coach, read-only, with no body or progress data.
 *  - header: name, status, plan, expiry, goal, experience and the phone in full; no starting weight, height or any measurement field;
 *  - tabs: Session Notes and Workout Plan ONLY (no Progress tab or panel in the DOM, not locked, not blurred, not empty);
 *  - the persistent no-body-data line sits under the tabs; the expired bar is the picker's wording;
 *  - notes: the author and time, no add, edit or hover affordance; plan: ordered exercises, the author line only when the author is not the chosen coach;
 *  - no count, chart, thumbnail, image, "last logged" date or "no data yet" placeholder, no completion mark, no write control.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
    i18n: { language: "en" },
  }),
}));

import { CoachPickerMemberDetail } from "./CoachPickerMemberDetail";
import type { PickerMemberRow, PickerWorkoutPlan } from "@/services/coachPicker";

const COACH = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const MEMBER: PickerMemberRow = {
  memberId: "m-alice",
  memberName: "Alice Member",
  phone: "+237670000221",
  photoUrl: "avatars/alice.png",
  goal: "build_muscle",
  experienceLevel: "beginner",
  status: "active",
  planName: "Premium",
  expiryDate: "2099-06-30",
  joinDate: "2026-01-15",
};

const NOTES = [
  { id: "n2", coachId: COACH, coachName: "Coach A", noteText: "Newest note", createdAt: "2026-09-10T10:00:00Z", editedAt: "2026-09-11T10:00:00Z" },
  { id: "n1", coachId: COACH, coachName: "Coach A", noteText: "Older note", createdAt: "2026-08-01T10:00:00Z", editedAt: null },
];

const PLAN: PickerWorkoutPlan = {
  planId: "p1",
  planName: "Strength plan",
  authorId: OTHER,
  authorName: "Coach B",
  exercises: [
    { id: "e1", orderIndex: 1, exerciseName: "Squat", sets: 3, reps: 10, note: null },
    { id: "e2", orderIndex: 2, exerciseName: "Row", sets: 4, reps: 8, note: "slow tempo" },
  ],
};

function renderDetail(over: Partial<{ member: PickerMemberRow; plan: PickerWorkoutPlan | null; notes: typeof NOTES; initialTab: "session-notes" | "workout-plan" }> = {}) {
  return render(
    <CoachPickerMemberDetail
      member={over.member ?? MEMBER}
      notes={over.notes ?? NOTES}
      plan={over.plan === undefined ? PLAN : over.plan}
      coachId={COACH}
      initialTab={over.initialTab ?? "session-notes"}
    />,
  );
}

describe("CoachPickerMemberDetail", () => {
  it("shows the profile header with the phone in full", () => {
    renderDetail();

    expect(screen.getByText("Alice Member")).toBeInTheDocument();
    expect(screen.getByText("+237670000221")).toBeInTheDocument();
    expect(screen.getByText("Premium")).toBeInTheDocument();
    expect(screen.getByText("members.status.active")).toBeInTheDocument();
    expect(screen.getByText("coachPortal.detail.goalOptions.buildMuscle")).toBeInTheDocument();
    expect(screen.getByText("coachPortal.detail.experienceOptions.beginner")).toBeInTheDocument();
  });

  it("has the Session Notes and Workout Plan tabs only: Progress is absent from the DOM", () => {
    const { container } = renderDetail();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["coachPortal.detail.tabs.sessionNotes", "coachPortal.detail.tabs.workoutPlan"]);
    expect(container.innerHTML).not.toMatch(/progress/i);
    expect(container.querySelector('[value="progress"], [data-value="progress"], [id*="progress"]')).toBeNull();
  });

  it("has the persistent no-body-data line under the tabs", () => {
    renderDetail();

    const line = screen.getByText("coach.picker.noBodyData");
    const tablist = screen.getByRole("tablist");
    expect(tablist.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the expired bar uses the picker's wording, and only for an expired member", () => {
    const { unmount } = renderDetail();
    expect(screen.queryByText("coach.picker.expiredBar")).toBeNull();
    unmount();

    renderDetail({ member: { ...MEMBER, status: "expired" } });
    expect(screen.getByText("coach.picker.expiredBar")).toBeInTheDocument();
    expect(screen.queryByText("coachPortal.detail.expiredInfoBar")).toBeNull();
  });

  it("lists the notes newest first with author and time, and no add, edit or hover control", () => {
    renderDetail();

    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("p")?.textContent)).toEqual(["Newest note", "Older note"]);
    expect(items[0].textContent).toContain("Coach A");
    expect(screen.queryByRole("button", { name: /add|edit|coachPortal.detail.notes/i })).toBeNull();
    expect(screen.queryByText("coachPortal.detail.notes.addButton")).toBeNull();
    expect(screen.queryByText("coachPortal.detail.notes.edit")).toBeNull();
  });

  it("the workout plan lists the exercises in order with sets, reps and note, and names the author when it is not the chosen coach", async () => {
    renderDetail({ initialTab: "workout-plan" });

    expect(screen.getByText("Strength plan")).toBeInTheDocument();
    expect(screen.getByText('coach.picker.planAuthor|{"name":"Coach B"}')).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("1. Squat"),
      expect.stringContaining("2. Row"),
    ]);
    expect(items[1].textContent).toContain("coachPortal.detail.workoutPlanTab.noteLine");
  });

  it("no author line when the chosen coach wrote the plan; the empty line when there is no plan", () => {
    const { unmount } = renderDetail({ initialTab: "workout-plan", plan: { ...PLAN, authorId: COACH, authorName: "Coach A" } });
    expect(screen.queryByText(/coach.picker.planAuthor/)).toBeNull();
    unmount();

    renderDetail({ initialTab: "workout-plan", plan: null });
    expect(screen.getByText("coachPortal.detail.workoutPlanTab.emptyState")).toBeInTheDocument();
  });

  it("the workout plan has no edit, new-plan, take-ownership, reorder or completion element", () => {
    renderDetail({ initialTab: "workout-plan" });

    expect(screen.queryAllByRole("button").filter((b) => b.getAttribute("role") !== "tab")).toHaveLength(0);
    expect(screen.queryByText(/completedCount|takeOwnership|editButton|addButton/)).toBeNull();
    expect(screen.queryByLabelText(/move|drag/i)).toBeNull();
  });

  it("renders no image, chart, canvas, thumbnail, 'last logged' or 'no data yet' anywhere, on either tab", async () => {
    const user = userEvent.setup();
    const { container } = renderDetail();

    for (const tab of [null, "coachPortal.detail.tabs.workoutPlan"]) {
      if (tab) await user.click(screen.getByRole("tab", { name: tab }));
      expect(container.querySelector("img, canvas, svg[role='img'], .recharts-wrapper")).toBeNull();
      expect(container.textContent).not.toMatch(/last logged|no data yet|weight|height|waist|chest/i);
    }
  });

  it("a goal or experience that is a built-in property name is shown as the raw value, never looked up as a key", () => {
    renderDetail({ member: { ...MEMBER, goal: "constructor", experienceLevel: "__proto__" } });

    expect(screen.getByText("constructor")).toBeInTheDocument();
    expect(screen.getByText("__proto__")).toBeInTheDocument();
  });

  it("a member with no subscription renders without a status badge or an expired bar", () => {
    renderDetail({ member: { ...MEMBER, status: null, planName: null, expiryDate: null } });

    expect(screen.queryByText(/members.status/)).toBeNull();
    expect(screen.queryByText("coach.picker.expiredBar")).toBeNull();
  });
});
