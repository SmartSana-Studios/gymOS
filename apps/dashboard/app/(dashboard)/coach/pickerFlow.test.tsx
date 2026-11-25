/**
 * Story 29.4 (AC "the picker issues no write"): the whole picker flow, rendered, against a Supabase double that THROWS on any non-`rpc` call (a `.from()`,
 * a claims read, a storage call, a write) and on any RPC outside the seven picker functions. The flow: the Portal layout (the coach list), the Members page,
 * the Classes page and a session roster (the server action), a member page with the notes and the plan, and the Overview address. The real services, the
 * real context resolver and the real client components run; only the database and the shell are doubled.
 *
 * Also asserts, on the rendered DOM of every picker screen, that no write control, no Progress tab and no body or progress element exists, and, on the
 * source files of the picker, that none imports a write or the Coach's own actions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

const PICKER_RPCS = [
  "list_picker_coaches",
  "list_coach_classes",
  "list_coach_class_session_roster",
  "list_coach_assigned_members",
  "get_coach_assigned_member",
  "list_coach_member_session_notes",
  "get_coach_member_workout_plan",
];

const COACH = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";

const calls: { name: string; args: unknown }[] = [];
const data: Record<string, unknown> = {
  list_picker_coaches: [
    { coach_id: COACH, coach_name: "Coach A", is_active: true },
    { coach_id: OTHER, coach_name: "Coach B", is_active: true },
  ],
  list_coach_classes: [
    { class_id: "k1", class_name: "HIIT", capacity: 15, schedule_type: "recurring", one_off_session_at: null, slots: [{ weekday: 1, start_time: "18:00" }], gym_timezone: "Africa/Douala", cancelled_at: null, class_session_id: SESSION, scheduled_at: "2099-01-05T17:00:00Z", booked_count: 2, matches_slots: true },
  ],
  list_coach_class_session_roster: [{ member_id: MEMBER, member_name: "Alice Member", attended_at: null }],
  list_coach_assigned_members: [
    { member_id: MEMBER, member_name: "Alice Member", phone: "+237670000221", photo_url: null, goal: "build_muscle", experience_level: "beginner", status: "active", plan_name: "Premium", expiry_date: "2099-06-30", join_date: "2026-01-15", last_note_snippet: "A note" },
  ],
  get_coach_assigned_member: [
    { member_id: MEMBER, member_name: "Alice Member", phone: "+237670000221", photo_url: null, goal: "build_muscle", experience_level: "beginner", status: "active", plan_name: "Premium", expiry_date: "2099-06-30", join_date: "2026-01-15" },
  ],
  list_coach_member_session_notes: [{ note_id: "n1", coach_id: COACH, coach_name: "Coach A", note_text: "Session note text", created_at: "2026-09-10T10:00:00Z", edited_at: null }],
  get_coach_member_workout_plan: [
    { plan_id: "p1", plan_name: "Strength plan", author_id: OTHER, author_name: "Coach B", plan_exercise_id: "e1", order_index: 1, exercise_name: "Squat", sets: 3, reps: 10, note: null },
  ],
};

const double = new Proxy(
  {
    rpc: async (name: string, args?: unknown) => {
      if (!PICKER_RPCS.includes(name)) throw new Error(`the picker called an RPC outside the seven: ${name}`);
      calls.push({ name, args });
      return { data: data[name], error: null };
    },
  },
  {
    get(target, prop) {
      if (prop === "rpc") return target.rpc;
      if (prop === "then") return undefined;
      throw new Error(`the picker touched client.${String(prop)}: only rpc is allowed`);
    },
  },
);

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => double) }));

let role = "owner";
vi.mock("@/services/session", () => ({
  getDashboardShellContext: vi.fn(async () => ({ data: { role, memberId: "m-staff", memberName: "Staff" }, error: null, suspended: null })),
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key) })),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key), i18n: { language: "en" } }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/coach/classes",
  useSearchParams: () => new URLSearchParams(`coach=${COACH}`),
  useSelectedLayoutSegment: () => "classes",
}));

import CoachPortalLayout from "./layout";
import CoachPortalPage from "./page";
import CoachClassesPage from "./classes/page";
import CoachMemberDetailPage from "./[memberId]/page";
import CoachOverviewPage from "./overview/page";
import { getCoachSessionRosterAction } from "./classes/pickerActions";

type AsyncComponent = (props: unknown) => Promise<ReactElement>;

async function resolveSuspended(boundary: unknown): Promise<ReactElement> {
  const child = (boundary as ReactElement<{ children: ReactElement }>).props.children;
  return await (child.type as AsyncComponent)(child.props);
}

const WRITE_AND_BODY = /add note|edit|new plan|take ownership|create class|cancel class|progress|weight|height|waist|chest|measure|completed|last logged|no data yet|drag|move up|move down/i;

function assertNoWriteOrBodyElement(container: HTMLElement) {
  expect(screen.queryAllByRole("form")).toHaveLength(0);
  expect(container.querySelector("form, dialog, textarea, input[type='file'], img, canvas")).toBeNull();
  const labels = [
    ...Array.from(container.querySelectorAll("button, a, [role='tab']")).map((el) => el.textContent ?? ""),
    ...Array.from(container.querySelectorAll("[aria-label]")).map((el) => el.getAttribute("aria-label") ?? ""),
  ];
  for (const label of labels) {
    // `coach.picker.*` keys are the picker's own copy (noBodyData names measurements by design and is not a control); controls are checked by name.
    expect(label, `control "${label}"`).not.toMatch(WRITE_AND_BODY);
  }
  expect(screen.queryByRole("tab", { name: /progress/i })).toBeNull();
}

describe("the coach picker flow issues reads only", () => {
  beforeEach(() => {
    role = "owner";
    calls.length = 0;
    push.mockReset();
  });

  it.each(["owner", "supervisor", "manager"])("%s: layout, Members, Classes with a roster, a member page and the Overview address, using only the seven RPCs", async (r) => {
    role = r;

    const layout = await CoachPortalLayout({ children: <div data-testid="child" /> });
    const layoutView = render(layout);
    expect(screen.getByLabelText("coach.picker.label")).toBeInTheDocument();
    assertNoWriteOrBodyElement(layoutView.container);
    layoutView.unmount();

    const members = await resolveSuspended(CoachPortalPage({ searchParams: Promise.resolve({ coach: COACH }) }));
    const membersView = render(members);
    expect(screen.getByText("Alice Member")).toBeInTheDocument();
    expect(screen.getByText("A note")).toBeInTheDocument();
    assertNoWriteOrBodyElement(membersView.container);
    membersView.unmount();

    const classes = await resolveSuspended(CoachClassesPage({ searchParams: Promise.resolve({ coach: COACH }) }));
    const user = userEvent.setup();
    const classesView = render(classes);
    await user.click(screen.getByRole("button", { name: /HIIT/ }));
    await user.click(screen.getByRole("button", { name: /\d/ , expanded: false }));
    expect(await screen.findByText("Alice Member")).toBeInTheDocument();
    assertNoWriteOrBodyElement(classesView.container);
    classesView.unmount();

    const member = await resolveSuspended(CoachMemberDetailPage({ params: Promise.resolve({ memberId: MEMBER }), searchParams: Promise.resolve({ coach: COACH }) }));
    const memberView = render(member);
    expect(screen.getByText("Session note text")).toBeInTheDocument();
    assertNoWriteOrBodyElement(memberView.container);
    await user.click(screen.getByRole("tab", { name: "coachPortal.detail.tabs.workoutPlan" }));
    expect(screen.getByText("Strength plan")).toBeInTheDocument();
    assertNoWriteOrBodyElement(memberView.container);
    memberView.unmount();

    const overview = await resolveSuspended(CoachOverviewPage({ searchParams: Promise.resolve({ coach: COACH }) }));
    const overviewView = render(overview);
    expect(screen.getByRole("status")).toHaveTextContent("coach.picker.partUnavailable");
    overviewView.unmount();

    const progress = await resolveSuspended(CoachMemberDetailPage({ params: Promise.resolve({ memberId: MEMBER }), searchParams: Promise.resolve({ coach: COACH, tab: "progress" }) }));
    const progressView = render(progress);
    expect(screen.getByRole("status")).toHaveTextContent("coach.picker.partUnavailable");
    progressView.unmount();

    const used = new Set(calls.map((c) => c.name));
    expect([...used].every((name) => PICKER_RPCS.includes(name))).toBe(true);
    expect([...used].sort()).toEqual([...PICKER_RPCS].sort());
    expect(calls.filter((c) => c.name !== "list_picker_coaches").every((c) => (c.args as { p_coach_id?: string }).p_coach_id === COACH)).toBe(true);
  });

  it("the roster action is read-only and passes the chosen coach to the database", async () => {
    const result = await getCoachSessionRosterAction(COACH, SESSION);

    expect(result.data).toEqual([{ memberId: MEMBER, memberName: "Alice Member", attendedAt: null }]);
    expect(calls).toEqual([{ name: "list_coach_class_session_roster", args: { p_coach_id: COACH, p_class_session_id: SESSION } }]);
  });

  it("the double itself refuses a table read and an RPC outside the seven (so the test can fail)", async () => {
    expect(() => (double as unknown as { from: unknown }).from).toThrow(/only rpc is allowed/);
    await expect(double.rpc("add_session_note", {})).rejects.toThrow(/outside the seven/);
  });

  it("a Receptionist's layout shows the permission message and issues no RPC at all", async () => {
    role = "receptionist";

    const layout = await CoachPortalLayout({ children: <div data-testid="child" /> });
    render(layout);

    expect(screen.getByRole("alert")).toHaveTextContent("errors.permissionDenied");
    expect(screen.queryByTestId("child")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("with nothing chosen, no coach data loads: only the coach list is read", async () => {
    const members = await resolveSuspended(CoachPortalPage({ searchParams: Promise.resolve({}) }));
    render(members);

    expect(screen.getByText("coach.picker.choose")).toBeInTheDocument();
    expect(calls.map((c) => c.name)).toEqual(["list_picker_coaches"]);
  });

  it("an unavailable coach reads nothing but the coach list, and says so", async () => {
    const classes = await resolveSuspended(CoachClassesPage({ searchParams: Promise.resolve({ coach: "55555555-5555-4555-8555-555555555555" }) }));
    render(classes);

    expect(screen.getByText("coach.picker.unavailable")).toBeInTheDocument();
    expect(calls.map((c) => c.name)).toEqual(["list_picker_coaches"]);
    expect(within(document.body).queryByText("HIIT")).toBeNull();
  });
});

describe("the picker's own source", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
  const root = join(dir, "../../..");
  const files = {
    "services/coachPicker.ts": readFileSync(join(root, "services/coachPicker.ts"), "utf8"),
    "pickerContext.ts": read("pickerContext.ts"),
    "classes/pickerActions.ts": read("classes/pickerActions.ts"),
    "components/CoachPickerHeader.tsx": read("components/CoachPickerHeader.tsx"),
    "components/CoachPickerNav.tsx": read("components/CoachPickerNav.tsx"),
    "components/CoachPickerStates.tsx": read("components/CoachPickerStates.tsx"),
    "[memberId]/components/CoachPickerMemberDetail.tsx": read("[memberId]/components/CoachPickerMemberDetail.tsx"),
    "[memberId]/components/PickerSessionNotes.tsx": read("[memberId]/components/PickerSessionNotes.tsx"),
    "[memberId]/components/PickerWorkoutPlanView.tsx": read("[memberId]/components/PickerWorkoutPlanView.tsx"),
  };

  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it.each(Object.entries(files))("%s imports no write, no Coach action and no progress or completion reader", (_name, src) => {
    const code = stripComments(src);
    expect(code).not.toMatch(/from ["'][^"']*\/actions["']/);
    expect(code).not.toMatch(/\[memberId\]\/actions/);
    expect(code).not.toMatch(/ProgressTabContent|WorkoutPlanModal|SessionNoteModal|WorkoutPlanTabContent|SessionNotesSection|CoachMemberDetailPageClient/);
    expect(code).not.toMatch(/getMemberDetail|getWorkoutPlan|getMemberProgressData|listSessionNotes|listAssignedMembers\(/);
    expect(code).not.toMatch(/\.from\(|\.insert\(|\.update\(|(?<!params)\.delete\(|\.upsert\(|\.storage\b|getClaims|createSignedUrl/);
  });

  it("the picker's one server action file contains exactly one export, a read", () => {
    const code = stripComments(files["classes/pickerActions.ts"]);
    expect([...code.matchAll(/export async function (\w+)/g)].map((m) => m[1])).toEqual(["getCoachSessionRosterAction"]);
  });

  it("the picker's service calls only the seven RPCs", () => {
    const names = [...stripComments(files["services/coachPicker.ts"]).matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...new Set(names)].sort()).toEqual([...PICKER_RPCS].sort());
  });
});
