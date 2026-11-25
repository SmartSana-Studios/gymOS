/**
 * Story 29.3: `insertClass()`, `updateClass()` and `cancelClass()` turn the database's "... coaches can only manage their own classes" refusal
 * (another coach's class, another gym's class, a missing class, or a coach id that is not the caller's) into the one `class_coach_own_only` code
 * with the `classes.coach.ownOnly` message. `listMyClasses()` carries the description and start date the Edit modal needs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: { message: string } | null };
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<typeof rpcResult>>(async () => rpcResult);

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })) }));

import { cancelClass, insertClass, listMyClasses, updateClass } from "./classes";

const INPUT = {
  name: "Pilates",
  description: null,
  coachId: "coach-1",
  capacity: 10,
  scheduleType: "recurring" as const,
  oneOffSessionAt: null,
  slots: [{ weekday: 1, startTime: "07:00" }],
  recurrenceStartDate: "2026-12-01",
};

const OWN_ONLY = { code: "class_coach_own_only", message: "classes.coach.ownOnly" };

describe("the own-only refusal", () => {
  beforeEach(() => {
    rpc.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("is mapped on create", async () => {
    rpcResult = { data: null, error: { message: "create_class: coaches can only manage their own classes" } };
    await expect(insertClass(INPUT)).resolves.toEqual({ data: null, error: OWN_ONLY });
  });

  it("is mapped on update", async () => {
    rpcResult = { data: null, error: { message: "update_class: coaches can only manage their own classes" } };
    await expect(updateClass("class-1", INPUT)).resolves.toEqual({ data: null, error: OWN_ONLY });
  });

  it("is mapped on cancel, the same for every cause", async () => {
    rpcResult = { data: null, error: { message: "cancel_class: coaches can only manage their own classes" } };
    await expect(cancelClass("class-1")).resolves.toEqual({ data: null, error: OWN_ONLY });
  });

  it("leaves the 'already cancelled' message its own code, and any other failure unmapped", async () => {
    rpcResult = { data: null, error: { message: "cancel_class: class 1 is already cancelled" } };
    await expect(cancelClass("class-1")).resolves.toMatchObject({ error: { code: "class_already_cancelled" } });
    rpcResult = { data: null, error: { message: "update_class: something else" } };
    await expect(updateClass("class-1", INPUT)).resolves.toEqual({ data: null, error: { code: "unknown", message: "mapped error" } });
  });
});

describe("listMyClasses", () => {
  it("carries the description and the recurrence start date of each class", async () => {
    rpcResult = {
      data: [
        {
          class_id: "c1",
          class_name: "HIIT",
          description: "Evening burn",
          recurrence_start_date: "2026-11-01",
          capacity: 12,
          schedule_type: "recurring",
          one_off_session_at: null,
          slots: [{ weekday: 1, start_time: "07:00" }],
          gym_timezone: "Africa/Douala",
          cancelled_at: null,
          class_session_id: null,
          scheduled_at: null,
          booked_count: 0,
          matches_slots: null,
        },
      ],
      error: null,
    };

    const { data } = await listMyClasses();

    expect(data?.[0]).toMatchObject({ classId: "c1", description: "Evening burn", recurrenceStartDate: "2026-11-01" });
  });
});
