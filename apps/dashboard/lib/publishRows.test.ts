import { describe, expect, it } from "vitest";
import { PAGE_CONTENT_LANGUAGES, pageSnapshotSchema, gymPageStatusSchema } from "@gymos/types";
import { openDays, publishRows } from "./publishRows";

describe("publish rows", () => {
  it("cover every key of the would-be snapshot exactly once (a new snapshot key without a row fails here)", () => {
    const rowKeys = publishRows().flatMap((r) => r.keys as string[]);
    expect(new Set(rowKeys).size).toBe(rowKeys.length);
    expect([...rowKeys].sort()).toEqual(Object.keys(pageSnapshotSchema.shape).sort());
  });

  it("one About row and one Services row per content language, from the one list", () => {
    const ids = publishRows().map((r) => r.id);
    for (const l of PAGE_CONTENT_LANGUAGES) {
      expect(ids).toContain(`about_${l}`);
      expect(ids).toContain(`services_${l}`);
    }
  });

  it("a third language adds its rows with no other change", () => {
    const ids = publishRows(["en", "fr", "de" as never]).map((r) => r.id as string);
    expect(ids).toContain("about_de");
    expect(ids).toContain("services_de");
    expect(ids.filter((i) => i.startsWith("about_"))).toHaveLength(3);
  });
});

describe("the strict snapshot schema", () => {
  it("refuses an identifying key", () => {
    for (const bad of [{ gym_id: "x" }, { plan_id: "x" }, { uploaded_by: "x" }, { gym_token: "x" }]) {
      expect(pageSnapshotSchema.safeParse({ name: "Gym", ...bad }).success).toBe(false);
    }
    expect(pageSnapshotSchema.safeParse({ name: "Gym", plans: [{ name: "P", label_en: "P", label_fr: "P", type: "monthly", price: 1, currency: "XAF", interval: "monthly", plan_id: "x" }] }).success).toBe(false);
  });

  it("the status schema refuses a gym id, an uploader or a plan id anywhere", () => {
    const base = {
      state: "ready", template: null, published_at: null, unpublished_reasons: [], missing: [], bad_text_fields: [], about_min_chars: 100,
      languages: [], media: [], snapshot: { name: "G", default_language: "en" }, taken_down_reason: null, appeal: null,
    };
    expect(gymPageStatusSchema.safeParse(base).success).toBe(true);
    expect(gymPageStatusSchema.safeParse({ ...base, gym_id: "x" }).success).toBe(false);
    expect(gymPageStatusSchema.safeParse({ ...base, media: [{ id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", kind: "logo", derivative_key: "a.webp", sort_order: 0, uploaded_by: "x" }] }).success).toBe(false);
    expect(gymPageStatusSchema.safeParse({ ...base, bad_text_fields: [{ field: "plan_name", plan_id: "x" }] }).success).toBe(false);
    expect(gymPageStatusSchema.safeParse({ ...base, state: "live" }).success).toBe(false);
  });
});

describe("openDays", () => {
  it("lists open days in week order and skips closed ones", () => {
    expect(openDays({ sat: { open: "08:00", close: "14:00" }, mon: { open: "06:00", close: "20:00" }, sun: null })).toEqual([
      { day: "mon", open: "06:00", close: "20:00" },
      { day: "sat", open: "08:00", close: "14:00" },
    ]);
    expect(openDays(undefined)).toEqual([]);
  });
});
