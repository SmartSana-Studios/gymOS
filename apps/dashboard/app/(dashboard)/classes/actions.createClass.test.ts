/**
 * Story 29.3: `createClass()` writes the audit row `class_created_by_coach` when the signed-in role is Coach and `class_created` for everyone
 * else, and a Coach's class is always assigned to the member id of the server-resolved shell context, whatever the client sent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertClass = vi.fn();
const logClassChange = vi.fn();
vi.mock("@/services/classes", () => ({
  cancelClass: vi.fn(),
  insertClass: (...a: unknown[]) => insertClass(...a),
  listSessionBookings: vi.fn(),
  logClassChange: (...a: unknown[]) => logClassChange(...a),
  markAttendance: vi.fn(),
  updateClass: vi.fn(),
}));

const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({ getDashboardShellContext: (...a: unknown[]) => getDashboardShellContext(...a) }));

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })) }));

import { createClass } from "./actions";

const OWN = "22222222-2222-4222-8222-222222222222";
const OTHER = "11111111-1111-4111-8111-111111111111";

const INPUT = {
  name: "Pump",
  coachId: OTHER,
  capacity: 10,
  scheduleType: "recurring",
  oneOffSessionAt: null,
  slots: [{ weekday: 1, startTime: "07:00" }],
  recurrenceStartDate: "2026-12-01",
};

function shell(role: string, memberId: string | null) {
  return { data: { role, memberId, memberName: "X" }, error: null, suspended: null };
}

describe("createClass audit action", () => {
  beforeEach(() => {
    insertClass.mockReset().mockResolvedValue({ data: { id: "new-class" }, error: null });
    logClassChange.mockReset().mockResolvedValue({ error: null });
  });

  it("a Coach: class_created_by_coach, assigned to the shell's member id", async () => {
    getDashboardShellContext.mockResolvedValue(shell("coach", OWN));

    await expect(createClass(INPUT)).resolves.toEqual({ data: { id: "new-class" }, error: null });

    expect(insertClass.mock.calls[0][0]).toMatchObject({ coachId: OWN });
    expect(logClassChange).toHaveBeenCalledWith("class_created_by_coach", "new-class", expect.objectContaining({ coach_id: OWN, name: "Pump", capacity: 10 }));
  });

  it.each(["owner", "supervisor", "manager"])("%s: class_created, with the coach picked in the form", async (role) => {
    getDashboardShellContext.mockResolvedValue(shell(role, OWN));

    await createClass(INPUT);

    expect(insertClass.mock.calls[0][0]).toMatchObject({ coachId: OTHER });
    expect(logClassChange).toHaveBeenCalledWith("class_created", "new-class", expect.objectContaining({ coach_id: OTHER }));
  });

  it("a Coach whose shell has no member id keeps the form's id and lets the database decide", async () => {
    getDashboardShellContext.mockResolvedValue(shell("coach", null));

    await createClass(INPUT);

    expect(insertClass.mock.calls[0][0]).toMatchObject({ coachId: OTHER });
  });

  it("returns a load error and creates nothing when the shell read fails or returns no data", async () => {
    getDashboardShellContext.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" }, suspended: null });
    await expect(createClass(INPUT)).resolves.toEqual({ data: null, error: { code: "load_failed", message: "common.loadError" } });

    getDashboardShellContext.mockResolvedValue({ data: null, error: null, suspended: null });
    await expect(createClass(INPUT)).resolves.toEqual({ data: null, error: { code: "load_failed", message: "common.loadError" } });

    expect(insertClass).not.toHaveBeenCalled();
    expect(logClassChange).not.toHaveBeenCalled();
  });

  it("returns the database's refusal and writes no audit row", async () => {
    getDashboardShellContext.mockResolvedValue(shell("coach", OWN));
    insertClass.mockResolvedValue({ data: null, error: { code: "class_coach_own_only", message: "classes.coach.ownOnly" } });

    await expect(createClass(INPUT)).resolves.toEqual({ data: null, error: { code: "class_coach_own_only", message: "classes.coach.ownOnly" } });
    expect(logClassChange).not.toHaveBeenCalled();
  });
});
