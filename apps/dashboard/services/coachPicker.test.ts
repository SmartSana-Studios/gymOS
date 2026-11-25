/**
 * Story 29.4 (FR-247): the picker service is the seven RPCs of migration 0183 and nothing else.
 *  - each function calls exactly its RPC with the coach (and member / session) ids, and uses no other client method: the Supabase double throws on
 *    anything but `rpc`, so a `.from()`, a claims read, a storage call or a write fails here;
 *  - rows map to the shapes the pages render from; the Members list search and sort are applied in memory;
 *  - an empty result is an empty list or null (the page turns it into "not assigned"), never an error; an RPC error is a mapped `{ data: null, error }`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type RpcResult = { data: unknown; error: unknown };
let results: Record<string, RpcResult> = {};
const rpc = vi.fn(async (name: string) => results[name] ?? { data: [], error: null });

const double = new Proxy(
  { rpc },
  {
    get(target, prop) {
      if (prop === "rpc") return target.rpc;
      if (prop === "then") return undefined;
      throw new Error(`picker service touched client.${String(prop)}: only rpc is allowed`);
    },
  },
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => double),
}));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import {
  getCoachAssignedMember,
  getCoachMemberWorkoutPlan,
  listCoachAssignedMembers,
  listCoachClasses,
  listCoachClassSessionRoster,
  listCoachMemberSessionNotes,
  listPickerCoaches,
} from "./coachPicker";

const COACH = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";

function memberRow(over: Record<string, unknown>) {
  return {
    member_id: "m",
    member_name: "Name",
    phone: null,
    photo_url: null,
    goal: null,
    experience_level: null,
    status: "active",
    plan_name: "Basic",
    expiry_date: "2099-01-01",
    join_date: "2026-01-01",
    last_note_snippet: null,
    ...over,
  };
}

describe("coach picker service", () => {
  beforeEach(() => {
    results = {};
    rpc.mockClear();
  });

  it("list_picker_coaches: maps id, name and the active flag", async () => {
    results.list_picker_coaches = { data: [{ coach_id: "c1", coach_name: "Coach One", is_active: true }, { coach_id: "c2", coach_name: "Gone", is_active: false }], error: null };

    const { data, error } = await listPickerCoaches();

    expect(error).toBeNull();
    expect(data).toEqual([{ id: "c1", name: "Coach One", isActive: true }, { id: "c2", name: "Gone", isActive: false }]);
    expect(rpc).toHaveBeenCalledWith("list_picker_coaches");
  });

  it("list_coach_classes: calls the RPC with the coach and groups rows per class, a session-less row becoming a class with no sessions", async () => {
    results.list_coach_classes = {
      data: [
        { class_id: "k1", class_name: "HIIT", capacity: 15, schedule_type: "recurring", one_off_session_at: null, slots: [{ weekday: 1, start_time: "18:00:00" }], gym_timezone: "Africa/Douala", cancelled_at: null, class_session_id: "s1", scheduled_at: "2099-01-01T17:00:00Z", booked_count: "3", matches_slots: true },
        { class_id: "k1", class_name: "HIIT", capacity: 15, schedule_type: "recurring", one_off_session_at: null, slots: [{ weekday: 1, start_time: "18:00:00" }], gym_timezone: "Africa/Douala", cancelled_at: null, class_session_id: "s2", scheduled_at: "2099-01-08T17:00:00Z", booked_count: 0, matches_slots: true },
        { class_id: "k2", class_name: "Old", capacity: 10, schedule_type: "one_off", one_off_session_at: "2020-01-01T10:00:00Z", slots: [], gym_timezone: "Africa/Douala", cancelled_at: "2026-01-01T00:00:00Z", class_session_id: null, scheduled_at: null, booked_count: 0, matches_slots: null },
      ],
      error: null,
    };

    const { data } = await listCoachClasses(COACH);

    expect(rpc).toHaveBeenCalledWith("list_coach_classes", { p_coach_id: COACH });
    expect(data?.map((c) => [c.classId, c.sessions.length, c.cancelledAt !== null])).toEqual([["k1", 2, false], ["k2", 0, true]]);
    expect(data?.[0].sessions[0].bookedCount).toBe(3);
    expect(data?.[0].slots).toEqual([{ weekday: 1, startTime: "18:00" }]);
  });

  it("list_coach_class_session_roster: coach and session ids, three fields", async () => {
    results.list_coach_class_session_roster = { data: [{ member_id: "m1", member_name: "Amara", attended_at: null }], error: null };

    const { data } = await listCoachClassSessionRoster(COACH, SESSION);

    expect(rpc).toHaveBeenCalledWith("list_coach_class_session_roster", { p_coach_id: COACH, p_class_session_id: SESSION });
    expect(data).toEqual([{ memberId: "m1", memberName: "Amara", attendedAt: null }]);
  });

  it("list_coach_assigned_members: maps the profile columns and the note snippet, and searches and sorts in memory", async () => {
    results.list_coach_assigned_members = {
      data: [
        memberRow({ member_id: "m1", member_name: "Carol", plan_name: "Basic", expiry_date: "2099-03-01", last_note_snippet: "hello" }),
        memberRow({ member_id: "m2", member_name: "alice", plan_name: "Premium", expiry_date: "2099-01-01" }),
        memberRow({ member_id: "m3", member_name: "Bob", plan_name: null, status: null, expiry_date: null }),
      ],
      error: null,
    };

    const byName = await listCoachAssignedMembers(COACH);
    expect(rpc).toHaveBeenCalledWith("list_coach_assigned_members", { p_coach_id: COACH });
    expect(byName.data?.map((m) => m.memberId)).toEqual(["m2", "m3", "m1"]);
    expect(byName.data?.[2]).toMatchObject({ memberName: "Carol", planName: "Basic", status: "active", lastNoteSnippet: "hello", joinDate: "2026-01-01" });

    expect((await listCoachAssignedMembers(COACH, { search: " AL " })).data?.map((m) => m.memberId)).toEqual(["m2"]);
    expect((await listCoachAssignedMembers(COACH, { sort: "plan", dir: "desc" })).data?.map((m) => m.memberId)).toEqual(["m2", "m1", "m3"]);
    expect((await listCoachAssignedMembers(COACH, { sort: "expiry", dir: "asc" })).data?.map((m) => m.memberId)).toEqual(["m3", "m2", "m1"]);
    expect((await listCoachAssignedMembers(COACH, { sort: "unknown-column" })).data?.map((m) => m.memberId)).toEqual(["m2", "m3", "m1"]);
  });

  it("a hostile sort or a repeated search falls back to name order and no filter instead of throwing", async () => {
    results.list_coach_assigned_members = { data: [memberRow({ member_id: "m1", member_name: "Carol" }), memberRow({ member_id: "m2", member_name: "Alice" })], error: null };

    for (const sort of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect((await listCoachAssignedMembers(COACH, { sort })).data?.map((m) => m.memberId)).toEqual(["m2", "m1"]);
    }
    const repeated = ["al", "ca"] as unknown as string;
    expect((await listCoachAssignedMembers(COACH, { search: repeated })).data?.map((m) => m.memberId)).toEqual(["m2", "m1"]);
  });

  it("get_coach_assigned_member: the one row, or null when the member is not assigned to that coach", async () => {
    results.get_coach_assigned_member = { data: [memberRow({ member_id: MEMBER })], error: null };
    expect((await getCoachAssignedMember(COACH, MEMBER)).data).toMatchObject({ memberId: MEMBER });
    expect(rpc).toHaveBeenCalledWith("get_coach_assigned_member", { p_coach_id: COACH, p_member_id: MEMBER });

    results.get_coach_assigned_member = { data: [], error: null };
    expect(await getCoachAssignedMember(COACH, MEMBER)).toEqual({ data: null, error: null });
  });

  it("list_coach_member_session_notes: maps note, author and times", async () => {
    results.list_coach_member_session_notes = {
      data: [{ note_id: "n1", coach_id: COACH, coach_name: "Coach A", note_text: "text", created_at: "2026-09-10T10:00:00Z", edited_at: null }],
      error: null,
    };

    const { data } = await listCoachMemberSessionNotes(COACH, MEMBER);

    expect(rpc).toHaveBeenCalledWith("list_coach_member_session_notes", { p_coach_id: COACH, p_member_id: MEMBER });
    expect(data).toEqual([{ id: "n1", coachId: COACH, coachName: "Coach A", noteText: "text", createdAt: "2026-09-10T10:00:00Z", editedAt: null }]);
  });

  it("get_coach_member_workout_plan: groups rows into one plan; a plan with no exercise has an empty list; no rows is null", async () => {
    const base = { plan_id: "p1", plan_name: "Plan", author_id: "a1", author_name: "Author" };
    results.get_coach_member_workout_plan = {
      data: [
        { ...base, plan_exercise_id: "e1", order_index: 1, exercise_name: "Squat", sets: 3, reps: 10, note: null },
        { ...base, plan_exercise_id: "e2", order_index: 2, exercise_name: "Row", sets: 4, reps: 8, note: "slow" },
      ],
      error: null,
    };
    const full = await getCoachMemberWorkoutPlan(COACH, MEMBER);
    expect(rpc).toHaveBeenCalledWith("get_coach_member_workout_plan", { p_coach_id: COACH, p_member_id: MEMBER });
    expect(full.data).toEqual({
      planId: "p1",
      planName: "Plan",
      authorId: "a1",
      authorName: "Author",
      exercises: [
        { id: "e1", orderIndex: 1, exerciseName: "Squat", sets: 3, reps: 10, note: null },
        { id: "e2", orderIndex: 2, exerciseName: "Row", sets: 4, reps: 8, note: "slow" },
      ],
    });

    results.get_coach_member_workout_plan = { data: [{ ...base, plan_exercise_id: null, order_index: null, exercise_name: null, sets: null, reps: null, note: null }], error: null };
    expect((await getCoachMemberWorkoutPlan(COACH, MEMBER)).data).toMatchObject({ planId: "p1", exercises: [] });

    results.get_coach_member_workout_plan = { data: [], error: null };
    expect(await getCoachMemberWorkoutPlan(COACH, MEMBER)).toEqual({ data: null, error: null });
  });

  it("an RPC error is a mapped error and never a throw, for every function", async () => {
    for (const name of [
      "list_picker_coaches",
      "list_coach_classes",
      "list_coach_class_session_roster",
      "list_coach_assigned_members",
      "get_coach_assigned_member",
      "list_coach_member_session_notes",
      "get_coach_member_workout_plan",
    ]) {
      results[name] = { data: null, error: { message: "boom" } };
    }

    for (const result of [
      await listPickerCoaches(),
      await listCoachClasses(COACH),
      await listCoachClassSessionRoster(COACH, SESSION),
      await listCoachAssignedMembers(COACH),
      await getCoachAssignedMember(COACH, MEMBER),
      await listCoachMemberSessionNotes(COACH, MEMBER),
      await getCoachMemberWorkoutPlan(COACH, MEMBER),
    ]) {
      expect(result).toEqual({ data: null, error: { code: "unknown", message: "mapped error" } });
    }
  });
});
