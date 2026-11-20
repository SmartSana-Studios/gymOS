/**
 * Story 29.2: `cancelClass()` and `updateClass()` both turn the database's "... is already cancelled" refusal (a stale tab) into the one
 * `class_already_cancelled` code with the `classes.cancel.already` message; any other cancel failure is `class_cancel_failed`; a successful
 * cancel returns the server's `bookings_cancelled` as a number.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: { message: string } | null };
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<typeof rpcResult>>(async () => rpcResult);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { cancelClass, updateClass } from "./classes";

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

const ALREADY = { code: "class_already_cancelled", message: "classes.cancel.already" };

describe("cancelClass", () => {
  beforeEach(() => {
    rpc.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("calls cancel_class with the class id only", async () => {
    rpcResult = { data: { bookings_cancelled: 8 }, error: null };
    await cancelClass("class-1");
    expect(rpc).toHaveBeenCalledWith("cancel_class", { p_class_id: "class-1" });
  });

  it("returns the server's bookings_cancelled as a number", async () => {
    rpcResult = { data: { bookings_cancelled: 8 }, error: null };
    await expect(cancelClass("class-1")).resolves.toEqual({ data: { bookingsCancelled: 8 }, error: null });
  });

  it("reads a missing or non-numeric count as 0", async () => {
    rpcResult = { data: {}, error: null };
    await expect(cancelClass("class-1")).resolves.toEqual({ data: { bookingsCancelled: 0 }, error: null });
    rpcResult = { data: { bookings_cancelled: "x" }, error: null };
    await expect(cancelClass("class-1")).resolves.toEqual({ data: { bookingsCancelled: 0 }, error: null });
  });

  it("maps the database's 'already cancelled' message to class_already_cancelled", async () => {
    rpcResult = { data: null, error: { message: "cancel_class: class 00000000-0000-0000-0000-000000000001 is already cancelled" } };
    await expect(cancelClass("class-1")).resolves.toEqual({ data: null, error: ALREADY });
  });

  it("maps the database's 'nothing left to cancel' message to class_nothing_to_cancel", async () => {
    rpcResult = { data: null, error: { message: "cancel_class: class 00000000-0000-0000-0000-000000000001 has nothing left to cancel" } };
    await expect(cancelClass("class-1")).resolves.toEqual({
      data: null,
      error: { code: "class_nothing_to_cancel", message: "classes.cancel.nothingLeft" },
    });
  });

  it("maps any other failure to class_cancel_failed", async () => {
    rpcResult = { data: null, error: { message: "permission denied" } };
    await expect(cancelClass("class-1")).resolves.toEqual({
      data: null,
      error: { code: "class_cancel_failed", message: "classes.cancel.error" },
    });
  });
});

describe("updateClass", () => {
  beforeEach(() => {
    rpc.mockClear();
  });

  it("maps the database's 'already cancelled' message to class_already_cancelled", async () => {
    rpcResult = { data: null, error: { message: "update_class: class 00000000-0000-0000-0000-000000000001 is already cancelled" } };
    await expect(updateClass("class-1", INPUT)).resolves.toEqual({ data: null, error: ALREADY });
  });

  it("leaves every other error to the generic mapping", async () => {
    rpcResult = { data: null, error: { message: "update_class: class x not found" } };
    await expect(updateClass("class-1", INPUT)).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });

  it("returns the sessions left unchanged on success", async () => {
    rpcResult = {
      data: { left_unchanged: [{ class_session_id: "s1", scheduled_at: "2026-12-01T06:00:00+00:00", booked_count: 2, capacity: 10 }] },
      error: null,
    };
    await expect(updateClass("class-1", INPUT)).resolves.toEqual({
      data: { leftUnchanged: [{ classSessionId: "s1", scheduledAt: "2026-12-01T06:00:00+00:00", bookedCount: 2, capacity: 10 }] },
      error: null,
    });
  });
});
