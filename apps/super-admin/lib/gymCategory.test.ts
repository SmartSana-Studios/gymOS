import { describe, expect, it } from "vitest";

import {
  DEFAULT_GYM_CATEGORY,
  GYM_CATEGORIES,
  GYM_CATEGORY_LABELS,
  createGymSchema,
  gymCategoryLabel,
  gymCategorySchema,
  setGymCategorySchema,
} from "@gymos/types";

describe("gym category (FR-171)", () => {
  it("has exactly the five stable codes, with gym as the default", () => {
    expect([...GYM_CATEGORIES]).toEqual(["gym", "pilates_studio", "yoga_studio", "fitness_center", "other"]);
    expect(DEFAULT_GYM_CATEGORY).toBe("gym");
  });

  it("labels every code in EN and FR with the final wording", () => {
    expect(GYM_CATEGORY_LABELS).toEqual({
      gym: { en: "Gym", fr: "Salle de sport" },
      pilates_studio: { en: "Pilates Studio", fr: "Studio Pilates" },
      yoga_studio: { en: "Yoga Studio", fr: "Studio Yoga" },
      fitness_center: { en: "Fitness Center", fr: "Centre de fitness" },
      other: { en: "Other", fr: "Autre" },
    });
    expect(gymCategoryLabel("fitness_center", "fr")).toBe("Centre de fitness");
    expect(gymCategoryLabel("fitness_center", "en")).toBe("Fitness Center");
    expect(gymCategoryLabel("unknown_code", "en")).toBe("unknown_code");
  });

  it("accepts a code and rejects a label, a wrong case and an empty value", () => {
    expect(gymCategorySchema.safeParse("yoga_studio").success).toBe(true);
    for (const bad of ["Yoga Studio", "Gym", "", "spa", null, undefined]) {
      expect(gymCategorySchema.safeParse(bad).success).toBe(false);
    }
    expect(setGymCategorySchema.safeParse({ category: "other" }).success).toBe(true);
    expect(setGymCategorySchema.safeParse({}).success).toBe(false);
  });

  it("defaults the category to gym on the Create Gym schema and refuses an unknown one", () => {
    const base = {
      gymName: "G",
      ownerName: "O",
      ownerPhone: "+237670123456",
      ownerEmail: "o@example.com",
      tierId: "00000000-0000-4000-8000-000000000001",
    };
    expect(createGymSchema.parse(base).category).toBe("gym");
    expect(createGymSchema.safeParse({ ...base, category: "spa" }).success).toBe(false);
  });
});
