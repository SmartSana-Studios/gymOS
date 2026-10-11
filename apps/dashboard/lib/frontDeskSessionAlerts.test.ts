/**
 * Story 19.9b: the follow-up reads behind a session-required alert -- the
 * class that refused the member (latest attempt), a late offline scan, and a
 * Tara session payment in flight.
 */
import { describe, expect, it, vi } from "vitest";

import { loadSessionAlertContext } from "./frontDeskSessionAlerts";

function client(tables: Record<string, { data: unknown; error?: unknown }>) {
  const builderFor = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "in", "order", "limit"]) {
      builder[method] = () => builder;
    }
    builder.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
      Promise.resolve({ data: tables[table]?.data ?? [], error: tables[table]?.error ?? null }).then(resolve, reject);
    return builder;
  };
  return { from: vi.fn((table: string) => builderFor(table)) } as never;
}

describe("loadSessionAlertContext", () => {
  it("takes the class from the latest attempt and flags an in-flight session payment", async () => {
    const result = await loadSessionAlertContext(
      client({
        session_attempts: {
          data: [
            {
              member_id: "m1",
              scanned_at: "2026-10-11T09:00:00Z",
              created_at: "2026-10-11T09:00:02Z",
              class_session_id: "cs1",
              class_sessions: { classes: { name: "HIIT" } },
            },
            {
              member_id: "m1",
              scanned_at: "2026-10-10T09:00:00Z",
              created_at: "2026-10-10T09:00:01Z",
              class_session_id: null,
              class_sessions: null,
            },
          ],
        },
        payments: { data: [{ member_id: "m1" }] },
      }),
      "gym-1",
      ["m1"],
    );

    expect(result.get("m1")).toEqual({ className: "HIIT", scannedOfflineAt: null, paymentInFlight: true });
  });

  it("marks a scan that synced long after it was taken as offline", async () => {
    const result = await loadSessionAlertContext(
      client({
        session_attempts: {
          data: [
            {
              member_id: "m1",
              scanned_at: "2026-10-11T09:00:00Z",
              created_at: "2026-10-11T11:30:00Z",
              class_session_id: null,
              class_sessions: null,
            },
          ],
        },
      }),
      "gym-1",
      ["m1"],
    );

    expect(result.get("m1")).toEqual({
      className: null,
      scannedOfflineAt: "2026-10-11T09:00:00Z",
      paymentInFlight: false,
    });
  });

  it("returns empty context for a member when a read fails", async () => {
    const result = await loadSessionAlertContext(
      client({ session_attempts: { data: null, error: { message: "boom" } }, payments: { data: null, error: { message: "boom" } } }),
      "gym-1",
      ["m1"],
    );
    expect(result.get("m1")).toEqual({ className: null, scannedOfflineAt: null, paymentInFlight: false });
  });
});
