/**
 * Story 29.2 (review pass 2): `editClass()` returns what the edit left unchanged even when only the audit write failed -- the class WAS saved,
 * so the owner still has to see which booked sessions kept their old time. The warning rides along as `audit_log_failed`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateClass = vi.fn();
const logClassChange = vi.fn();

vi.mock("@/services/classes", () => ({
  cancelClass: vi.fn(),
  insertClass: vi.fn(),
  listSessionBookings: vi.fn(),
  logClassChange: (...a: unknown[]) => logClassChange(...a),
  markAttendance: vi.fn(),
  updateClass: (...a: unknown[]) => updateClass(...a),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })) }));

import { editClass } from "./actions";

const INPUT = {
  name: "Pilates",
  coachId: "11111111-1111-4111-8111-111111111111",
  capacity: 10,
  scheduleType: "recurring",
  oneOffSessionAt: null,
  slots: [{ weekday: 1, startTime: "07:00" }],
  recurrenceStartDate: "2026-12-01",
};

const LEFT = [{ classSessionId: "s1", scheduledAt: "2026-12-07T06:00:00+00:00", bookedCount: 3, capacity: 10 }];

describe("editClass", () => {
  beforeEach(() => {
    updateClass.mockReset();
    logClassChange.mockReset();
    updateClass.mockResolvedValue({ data: { leftUnchanged: LEFT }, error: null });
  });

  it("returns the left-unchanged sessions with no error when the edit and its audit row both succeed", async () => {
    logClassChange.mockResolvedValue({ error: null });

    await expect(editClass("class-1", INPUT)).resolves.toEqual({ data: { id: "class-1", leftUnchanged: LEFT }, error: null });
  });

  it("still returns the left-unchanged sessions when only the audit write fails, with the audit_log_failed warning", async () => {
    logClassChange.mockResolvedValue({ error: { code: "unknown", message: "audit down" } });

    await expect(editClass("class-1", INPUT)).resolves.toEqual({
      data: { id: "class-1", leftUnchanged: LEFT },
      error: { code: "audit_log_failed", message: "classes.errors.auditLogFailedEdit" },
    });
  });

  it("returns the update error and writes no audit row when the update fails", async () => {
    updateClass.mockResolvedValue({ data: null, error: { code: "class_already_cancelled", message: "classes.cancel.already" } });

    await expect(editClass("class-1", INPUT)).resolves.toEqual({
      data: null,
      error: { code: "class_already_cancelled", message: "classes.cancel.already" },
    });
    expect(logClassChange).not.toHaveBeenCalled();
  });
});
