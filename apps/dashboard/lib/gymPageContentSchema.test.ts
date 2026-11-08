/**
 * Story 24.5: the Zod mirror of set_gym_page_content() (migration 0161). Lives here because packages/types has no
 * test runner. The database re-validates every rule; these tests pin the client-side copy.
 */
import { describe, expect, it } from "vitest";
import { gymPageContentSchema, setGymPageContentSchema } from "@gymos/types";

const PLAN = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("gymPageContentSchema", () => {
  it("accepts an empty patch and a full valid one", () => {
    expect(gymPageContentSchema.safeParse({}).success).toBe(true);
    const full = gymPageContentSchema.safeParse({
      about_en: "About",
      about_fr: "A propos",
      services_en: "Yoga",
      services_fr: "Yoga",
      address: "Rue 1",
      city: "Douala",
      lat: 4.05,
      lng: 9.76,
      hours: { mon: { open: "06:00", close: "22:00" }, sun: null },
      contact_phone: "+237600111222",
      contact_whatsapp: "+237600111223",
    });
    expect(full.success).toBe(true);
  });

  it("trims text and turns an empty string into null", () => {
    const r = gymPageContentSchema.parse({ about_en: "  hi  ", about_fr: "   ", contact_phone: "" });
    expect(r.about_en).toBe("hi");
    expect(r.about_fr).toBeNull();
    expect(r.contact_phone).toBeNull();

    expect(gymPageContentSchema.parse({ city: "\u00a0Kribi\u3000" }).city).toBe("Kribi");
  });

  it("rejects markup characters anywhere in text", () => {
    expect(gymPageContentSchema.safeParse({ about_en: "<script>x</script>" }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ city: "a>b" }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ address: "a<b" }).success).toBe(false);
  });

  it("bounds text lengths", () => {
    expect(gymPageContentSchema.safeParse({ about_en: "a".repeat(2000) }).success).toBe(true);
    expect(gymPageContentSchema.safeParse({ about_en: "a".repeat(2001) }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ address: "a".repeat(301) }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ city: "a".repeat(101) }).success).toBe(false);
  });

  it("requires E.164 for both public phones", () => {
    expect(gymPageContentSchema.safeParse({ contact_phone: "0600111222" }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ contact_whatsapp: "+0600111222" }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ contact_whatsapp: "+2376001" }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ contact_phone: "+237600111222" }).success).toBe(true);
  });

  it("limits latitude and longitude", () => {
    expect(gymPageContentSchema.safeParse({ lat: 90, lng: 180 }).success).toBe(true);
    expect(gymPageContentSchema.safeParse({ lat: -90, lng: -180 }).success).toBe(true);
    expect(gymPageContentSchema.safeParse({ lat: 90.01 }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ lng: -180.01 }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ lat: "4.0" }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ lat: null, lng: null }).success).toBe(true);
  });

  it("validates opening hours: known days, HH:MM, exactly open and close", () => {
    expect(gymPageContentSchema.safeParse({ hours: { mon: { open: "25:00", close: "22:00" } } }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ hours: { mon: { open: "6:00", close: "22:00" } } }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ hours: { xyz: null } }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ hours: { mon: { open: "06:00" } } }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ hours: { mon: { open: "06:00", close: "22:00", extra: 1 } } }).success).toBe(false);
    // an overnight window is allowed, as for gyms.opening_time
    expect(gymPageContentSchema.safeParse({ hours: { fri: { open: "20:00", close: "02:00" } } }).success).toBe(true);
    expect(gymPageContentSchema.safeParse({ hours: null }).success).toBe(true);
    expect(gymPageContentSchema.safeParse({ hours: {} }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ hours: { mon: { open: "06:00", close: "06:00" } } }).success).toBe(false);
  });

  it("rejects unknown keys, including the login phone", () => {
    expect(gymPageContentSchema.safeParse({ owner_phone: "+237600000000" }).success).toBe(false);
    expect(gymPageContentSchema.safeParse({ page_about_en: "x" }).success).toBe(false);
  });
});

describe("setGymPageContentSchema", () => {
  it("accepts content with public plans and optional labels", () => {
    const r = setGymPageContentSchema.safeParse({
      content: { city: "Douala" },
      plans: [{ plan_id: PLAN, is_public: true, public_label_en: "Monthly" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-uuid plan id, a duplicate plan, a non-boolean flag, markup in a label and unknown plan keys", () => {
    expect(setGymPageContentSchema.safeParse({ content: {}, plans: [{ plan_id: "nope", is_public: true }] }).success).toBe(false);
    expect(setGymPageContentSchema.safeParse({ content: {}, plans: [{ plan_id: PLAN }, { plan_id: PLAN }] }).success).toBe(false);
    expect(setGymPageContentSchema.safeParse({ content: {}, plans: [{ plan_id: PLAN, is_public: "yes" }] }).success).toBe(false);
    expect(setGymPageContentSchema.safeParse({ content: {}, plans: [{ plan_id: PLAN, public_label_fr: "<b>" }] }).success).toBe(false);
    expect(setGymPageContentSchema.safeParse({ content: {}, plans: [{ plan_id: PLAN, price: 1 }] }).success).toBe(false);
  });

  it("bounds the plan label at 80 characters", () => {
    expect(setGymPageContentSchema.safeParse({ content: {}, plans: [{ plan_id: PLAN, public_label_en: "a".repeat(80) }] }).success).toBe(true);
    expect(setGymPageContentSchema.safeParse({ content: {}, plans: [{ plan_id: PLAN, public_label_en: "a".repeat(81) }] }).success).toBe(false);
  });

  it("requires the content object", () => {
    expect(setGymPageContentSchema.safeParse({}).success).toBe(false);
  });
});
