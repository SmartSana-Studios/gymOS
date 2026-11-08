/**
 * Story 24.8: the Zod mirror of publish_gym_page() (migration 0164) and the copy for its gate codes and typed errors.
 * The database owns the gate; these tests pin that every code the dashboard can be handed has English and French copy.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PAGE_PUBLISH_ERROR_CODES,
  PAGE_PUBLISH_GATE_CODES,
  PAGE_UNPUBLISH_REASONS,
  pageTemplateSchema,
  publishGymPageResultSchema,
  publishGymPageSchema,
} from "@gymos/types";
import en from "../locales/en.json";
import fr from "../locales/fr.json";

const gymId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("publish_gym_page input", () => {
  it("takes a gym and an optional template and nothing else (no content)", () => {
    expect(publishGymPageSchema.safeParse({ gymId }).success).toBe(true);
    expect(publishGymPageSchema.safeParse({ gymId, template: "classic" }).success).toBe(true);
    expect(publishGymPageSchema.safeParse({ gymId, template: null }).success).toBe(true); // null keeps the stored template
    expect(publishGymPageSchema.safeParse({ gymId, template: "classic", content: {} }).success).toBe(false);
    expect(publishGymPageSchema.safeParse({ gymId: "x" }).success).toBe(false);
  });

  it("accepts the template names the database accepts and refuses the rest", () => {
    for (const ok of ["ab", "classic", "bold-two", "a" + "b".repeat(30)]) expect(pageTemplateSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["", "a", "Classic", "a b", "a_b", "1abc", "-ab", "a" + "b".repeat(31)]) expect(pageTemplateSchema.safeParse(bad).success, bad).toBe(false);
  });
});

describe("publish_gym_page result", () => {
  it("reads a published result and a failed gate", () => {
    expect(publishGymPageResultSchema.parse({ published: true, missing: [] })).toEqual({ published: true, missing: [] });
    expect(publishGymPageResultSchema.parse({ published: false, missing: ["no_banner", "about_short"] }).missing).toEqual(["no_banner", "about_short"]);
  });

  it("refuses a gate code it does not know (a new database code must be added with copy)", () => {
    expect(publishGymPageResultSchema.safeParse({ published: false, missing: ["no_such_code"] }).success).toBe(false);
  });
});

describe("gate codes", () => {
  it("are exactly the codes the database gate can return (migration 0164)", () => {
    const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "supabase", "migrations", "0164_publish_gate_snapshot.sql"), "utf8");
    const start = sql.indexOf("create function private.gym_page_gate_missing");
    const end = sql.indexOf("create view private.gym_page_visible");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const gate = sql.slice(start, end);
    const codes = [...gate.matchAll(/array_append\(v_missing, '([a-z_]+)'\)/g)].map((m) => m[1]);
    expect([...new Set(codes)].sort()).toEqual([...PAGE_PUBLISH_GATE_CODES].sort());
  });
});

describe("publish copy", () => {
  it.each(PAGE_PUBLISH_GATE_CODES)("gate code %s has English and French copy", (code) => {
    expect((en.pagePublish.gate as Record<string, string>)[code]).toBeTruthy();
    expect((fr.pagePublish.gate as Record<string, string>)[code]).toBeTruthy();
  });

  it.each(PAGE_PUBLISH_ERROR_CODES)("error %s has English and French copy", (code) => {
    expect((en.pagePublish.errors as Record<string, string>)[code]).toBeTruthy();
    expect((fr.pagePublish.errors as Record<string, string>)[code]).toBeTruthy();
  });

  it.each(PAGE_UNPUBLISH_REASONS)("unpublish reason %s has English and French copy", (code) => {
    expect((en.pagePublish.unpublishReason as Record<string, string>)[code]).toBeTruthy();
    expect((fr.pagePublish.unpublishReason as Record<string, string>)[code]).toBeTruthy();
  });

  it("there is no copy for a code the schema does not list", () => {
    expect(Object.keys(en.pagePublish.gate).sort()).toEqual([...PAGE_PUBLISH_GATE_CODES].sort());
    expect(Object.keys(fr.pagePublish.gate).sort()).toEqual([...PAGE_PUBLISH_GATE_CODES].sort());
  });
});
