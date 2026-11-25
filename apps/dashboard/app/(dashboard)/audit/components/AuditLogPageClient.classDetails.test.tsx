/**
 * Story 29.2 (UX AD-12 V1.8): the Details cell of a class_cancelled row reads "NAME · N bookings cancelled" and of a class_times_changed row
 * "NAME · old times → new times · N sessions with bookings left unchanged", in the real EN and FR words, singular and plural, a one-off side
 * (an empty slot array) as "One-off". Metadata that is missing or malformed falls back to the generic cell.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { realT } from "@/test-utils/realT";

let language: "en" | "fr" = "en";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/audit",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: realT(language), i18n: { language } }),
}));
vi.mock("../actions", () => ({ exportAuditLogCsvAction: vi.fn() }));

import { AuditLogPageClient } from "./AuditLogPageClient";

function cellsOf(actionType: string, metadata: Record<string, unknown>) {
  const rows = [
    { id: "a", actorId: null, actorDisplayName: "Manager", actionType, targetEntityId: "c1", targetEntityType: "class", metadata, createdAt: "2026-11-20T10:00:00Z" },
  ];
  const { container } = render(
    <AuditLogPageClient initialRows={rows} total={1} page={1} pageSize={50} from="" to="" actorId="" role="owner" actorOptions={[]} />,
  );
  const tr = container.querySelector("tbody tr");
  return { action: tr?.querySelectorAll("td")[2]?.textContent ?? "", details: tr?.querySelectorAll("td")[4]?.textContent ?? "" };
}

const slot = (weekday: number, start_time: string) => ({ weekday, start_time });

describe("audit Details of a cancelled class", () => {
  it("EN plural", () => {
    language = "en";
    const { action, details } = cellsOf("class_cancelled", { class_name: "SPIN", bookings_cancelled: 8 });
    expect(action).toBe("Class cancelled");
    expect(details).toBe("SPIN · 8 bookings cancelled");
  });

  it("EN singular and zero", () => {
    language = "en";
    expect(cellsOf("class_cancelled", { class_name: "SPIN", bookings_cancelled: 1 }).details).toBe("SPIN · 1 booking cancelled");
    expect(cellsOf("class_cancelled", { class_name: "SPIN", bookings_cancelled: 0 }).details).toBe("SPIN · 0 bookings cancelled");
  });

  it("FR", () => {
    language = "fr";
    const { action, details } = cellsOf("class_cancelled", { class_name: "SPIN", bookings_cancelled: 8 });
    expect(action).toBe("Cours annulé");
    expect(details).toBe("SPIN · 8 réservations annulées");
    expect(cellsOf("class_cancelled", { class_name: "SPIN", bookings_cancelled: 1 }).details).toBe("SPIN · 1 réservation annulée");
  });

  it("falls back to the generic cell when the metadata is malformed", () => {
    language = "en";
    expect(cellsOf("class_cancelled", { class_name: "SPIN", bookings_cancelled: "many" }).details).toBe("class_name: SPIN, bookings_cancelled: many");
    expect(cellsOf("class_cancelled", { bookings_cancelled: 3 }).details).toBe("bookings_cancelled: 3");
  });
});

describe("audit Details of a weekly-times change", () => {
  const changed = {
    class_name: "PILATES",
    old_schedule_type: "recurring",
    new_schedule_type: "recurring",
    old_slots: [slot(1, "07:00"), slot(3, "18:30")],
    new_slots: [slot(1, "07:30"), slot(3, "18:30")],
    left_unchanged_count: 2,
  };

  it("EN plural: name, old and new times, the count", () => {
    language = "en";
    const { action, details } = cellsOf("class_times_changed", changed);
    expect(action).toBe("Class weekly times changed");
    expect(details).toBe("PILATES · Mon 07:00 · Wed 18:30 → Mon 07:30 · Wed 18:30 · 2 sessions with bookings left unchanged");
  });

  it("EN singular and zero", () => {
    language = "en";
    expect(cellsOf("class_times_changed", { ...changed, left_unchanged_count: 1 }).details).toMatch(/· 1 session with bookings left unchanged$/);
    expect(cellsOf("class_times_changed", { ...changed, left_unchanged_count: 0 }).details).toMatch(/· 0 sessions with bookings left unchanged$/);
  });

  it("groups days that share an hour", () => {
    language = "en";
    const { details } = cellsOf("class_times_changed", { ...changed, old_slots: [slot(2, "18:00"), slot(4, "18:00")], new_slots: [slot(2, "18:00")] });
    expect(details).toContain("Tue, Thu 18:00 → Tue 18:00");
  });

  it("an empty slot array reads as one-off, on either side", () => {
    language = "en";
    const toOneOff = cellsOf("class_times_changed", { ...changed, old_slots: [slot(1, "07:00")], new_slots: [], new_schedule_type: "one_off" }).details;
    expect(toOneOff).toBe("PILATES · Mon 07:00 → One-off · 2 sessions with bookings left unchanged");
    const fromOneOff = cellsOf("class_times_changed", { ...changed, old_slots: [], new_slots: [slot(1, "07:00")], old_schedule_type: "one_off" }).details;
    expect(fromOneOff).toBe("PILATES · One-off → Mon 07:00 · 2 sessions with bookings left unchanged");
  });

  it("FR", () => {
    language = "fr";
    const { action, details } = cellsOf("class_times_changed", changed);
    expect(action).toBe("Horaires du cours modifiés");
    expect(details).toBe("PILATES · Lun 07:00 · Mer 18:30 → Lun 07:30 · Mer 18:30 · 2 cours réservés non modifiés");
    expect(cellsOf("class_times_changed", { ...changed, left_unchanged_count: 1 }).details).toMatch(/· 1 cours réservé non modifié$/);
  });

  it("falls back to the generic cell when the slots or the count are malformed", () => {
    language = "en";
    expect(cellsOf("class_times_changed", { class_name: "P", old_slots: "x", new_slots: [], left_unchanged_count: 1 }).details).toBe(
      "class_name: P, old_slots: x, new_slots: [], left_unchanged_count: 1",
    );
    expect(cellsOf("class_times_changed", { class_name: "P", old_slots: [{ weekday: "1", start_time: "07:00" }], new_slots: [], left_unchanged_count: 1 }).details).toContain("class_name: P");
    expect(cellsOf("class_times_changed", { ...changed, left_unchanged_count: "2" }).details).toContain("left_unchanged_count: 2");
    expect(cellsOf("class_times_changed", { old_slots: [], new_slots: [], left_unchanged_count: 1 }).details).toBe("old_slots: [], new_slots: [], left_unchanged_count: 1");
  });
});

describe("audit row of a class a Coach created (Story 29.3)", () => {
  const created = { name: "PUMP", coach_id: "coach-1", capacity: 12, schedule_type: "recurring" };

  it("EN: the label and 'NAME · capacity N'", () => {
    language = "en";
    const { action, details } = cellsOf("class_created_by_coach", created);
    expect(action).toBe("Class created");
    expect(details).toBe("PUMP · capacity 12");
  });

  it("FR", () => {
    language = "fr";
    const { action, details } = cellsOf("class_created_by_coach", created);
    expect(action).toBe("Cours créé");
    expect(details).toBe("PUMP · capacité 12");
  });

  it("falls back to the generic cell when the metadata is malformed", () => {
    language = "en";
    expect(cellsOf("class_created_by_coach", { name: "PUMP", capacity: "twelve" }).details).toBe("name: PUMP, capacity: twelve");
  });
});
