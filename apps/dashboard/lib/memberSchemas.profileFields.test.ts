/**
 * Story 26.1: birth year, profession and neighborhood on the three member
 * schemas. Lives here because packages/types has no test runner.
 */
import { describe, expect, it } from "vitest";
import { createFeeGymMemberSchema, createMemberSchema, editMemberSchema } from "@gymos/types";

const year = new Date().getUTCFullYear();
const edit = { name: "Test Member" };
const feeCreate = { name: "Test Member", phone: "+237600000001", joinDate: "2026-01-15" };
const feeZeroCreate = { ...feeCreate, planId: "p", subscriptionStatus: "active" };

const schemas = [
  ["editMemberSchema", editMemberSchema, edit],
  ["createFeeGymMemberSchema", createFeeGymMemberSchema, feeCreate],
  ["createMemberSchema", createMemberSchema, feeZeroCreate],
] as const;

describe.each(schemas)("%s profile fields", (_name, schema, base) => {
  it("accepts all three, trimmed", () => {
    const parsed = schema.parse({ ...base, birthYear: 1984, profession: " Soudeur ", neighborhood: "Ngui" });
    expect(parsed.birthYear).toBe(1984);
    expect(parsed.profession).toBe("Soudeur");
    expect(parsed.neighborhood).toBe("Ngui");
  });

  it("accepts none, and blank text becomes null", () => {
    expect(schema.safeParse(base).success).toBe(true);
    const parsed = schema.parse({ ...base, birthYear: null, profession: "  ", neighborhood: "" });
    expect(parsed.birthYear).toBeNull();
    expect(parsed.profession).toBeNull();
    expect(parsed.neighborhood).toBeNull();
  });

  it("accepts the current year and refuses 1850, next year, 84, abc, NaN and 1984.5", () => {
    expect(schema.safeParse({ ...base, birthYear: year }).success).toBe(true);
    expect(schema.safeParse({ ...base, birthYear: 1899 }).success).toBe(false);
    for (const bad of [1850, year + 1, 84, "abc", Number.NaN, 1984.5]) {
      expect(schema.safeParse({ ...base, birthYear: bad }).success, String(bad)).toBe(false);
    }
  });

  it("refuses 121 characters and accepts 120", () => {
    expect(schema.safeParse({ ...base, profession: "x".repeat(120) }).success).toBe(true);
    expect(schema.safeParse({ ...base, profession: "x".repeat(121) }).success).toBe(false);
    expect(schema.safeParse({ ...base, neighborhood: "x".repeat(121) }).success).toBe(false);
    expect(schema.safeParse({ ...base, neighborhood: ` ${"x".repeat(120)} ` }).success).toBe(true);
  });
});
