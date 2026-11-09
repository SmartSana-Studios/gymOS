import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PAGE_REPORT_REASON_LABELS,
  PAGE_REPORT_REASON_ORDER,
  PAGE_TAKEDOWN_REASONS,
  PAGE_TAKEDOWN_REASON_LABELS,
  decidePageAppealSchema,
  dismissPageReportsSchema,
  gymPageStatusSchema,
  liftGymPageTakedownSchema,
  pageAppealStatusSchema,
  pageReportInputSchema,
  pageTakedownReasonLabel,
  submitPageAppealSchema,
  takeDownGymPageSchema,
} from "./index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migration = readFileSync(join(root, "supabase", "migrations", "0167_page_takedown_reports_media_purge.sql"), "utf8");
const gymId = "11111111-1111-4111-8111-111111111111";

describe("page moderation codes and labels (24.11)", () => {
  it("the six reason codes are the ones the database CHECK constraints accept", () => {
    const checks = [...migration.matchAll(/reason in \(([^)]*)\)/g)].map((m) => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    expect(checks.length).toBeGreaterThanOrEqual(3);
    for (const codes of checks) expect([...codes].sort()).toEqual([...PAGE_TAKEDOWN_REASONS].sort());
  });

  it("the admin labels equal the pairs the database writes into the Owner notice (private.page_takedown_label)", () => {
    const fn = migration.slice(migration.indexOf("create function private.page_takedown_label"));
    const en = fn.slice(fn.indexOf("when 'en'"), fn.indexOf("when 'fr'"));
    const fr = fn.slice(fn.indexOf("when 'fr'"), fn.indexOf("$$;", fn.indexOf("when 'fr'")));
    for (const code of PAGE_TAKEDOWN_REASONS) {
      const pick = (block: string) => block.match(new RegExp(`when '${code}' then '((?:[^']|'')*)'`))?.[1]?.replace(/''/g, "'");
      expect(pick(en), `${code} en`).toBe(PAGE_TAKEDOWN_REASON_LABELS[code].en);
      expect(pick(fr), `${code} fr`).toBe(PAGE_TAKEDOWN_REASON_LABELS[code].fr);
    }
  });

  it("every code has an admin label and a visitor label in English and French, and the visitor order lists each once", () => {
    for (const code of PAGE_TAKEDOWN_REASONS) {
      for (const table of [PAGE_TAKEDOWN_REASON_LABELS, PAGE_REPORT_REASON_LABELS]) {
        expect(table[code].en.length).toBeGreaterThan(0);
        expect(table[code].fr.length).toBeGreaterThan(0);
      }
    }
    expect([...PAGE_REPORT_REASON_ORDER].sort()).toEqual([...PAGE_TAKEDOWN_REASONS].sort());
  });

  it("the label lookup is null for a missing or unknown code", () => {
    expect(pageTakedownReasonLabel("privacy", "fr")).toBe("Vie privée");
    expect(pageTakedownReasonLabel(null, "en")).toBeNull();
    expect(pageTakedownReasonLabel("nope", "en")).toBeNull();
  });
});

describe("page moderation input schemas", () => {
  it("a takedown needs a reason code; 'other' needs a note of 3 to 500 characters", () => {
    expect(takeDownGymPageSchema.safeParse({ gymId, reason: "privacy" }).success).toBe(true);
    expect(takeDownGymPageSchema.safeParse({ gymId, reason: "spam" }).success).toBe(false);
    expect(takeDownGymPageSchema.safeParse({ gymId, reason: "other" }).success).toBe(false);
    expect(takeDownGymPageSchema.safeParse({ gymId, reason: "other", note: " ab " }).success).toBe(false);
    expect(takeDownGymPageSchema.safeParse({ gymId, reason: "other", note: "abc" }).success).toBe(true);
    expect(takeDownGymPageSchema.safeParse({ gymId, reason: "privacy", note: "x".repeat(501) }).success).toBe(false);
    expect(takeDownGymPageSchema.safeParse({ gymId, reason: "privacy", extra: 1 }).success).toBe(false);
  });

  it("a lift and a decision need a reason of 3 to 500 characters; an appeal 1 to 500", () => {
    expect(liftGymPageTakedownSchema.safeParse({ gymId, reason: "ab" }).success).toBe(false);
    expect(liftGymPageTakedownSchema.safeParse({ gymId, reason: "x".repeat(500) }).success).toBe(true);
    expect(liftGymPageTakedownSchema.safeParse({ gymId, reason: "x".repeat(501) }).success).toBe(false);
    expect(decidePageAppealSchema.safeParse({ id: gymId, decision: "uphold", reason: "abc" }).success).toBe(true);
    expect(decidePageAppealSchema.safeParse({ id: gymId, decision: "maybe", reason: "abc" }).success).toBe(false);
    expect(dismissPageReportsSchema.safeParse({ reportIds: [], note: "abc" }).success).toBe(false);
    expect(dismissPageReportsSchema.safeParse({ reportIds: [gymId], note: "ab" }).success).toBe(false);
    expect(submitPageAppealSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(submitPageAppealSchema.safeParse({ reason: "x".repeat(500) }).success).toBe(true);
    expect(submitPageAppealSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });

  it("the public report needs a reason code and 1 to 1000 characters of details", () => {
    expect(pageReportInputSchema.safeParse({ reason: "privacy", details: "a" }).success).toBe(true);
    expect(pageReportInputSchema.safeParse({ reason: "privacy", details: "a".repeat(1000) }).success).toBe(true);
    expect(pageReportInputSchema.safeParse({ reason: "privacy", details: "a".repeat(1001) }).success).toBe(false);
    expect(pageReportInputSchema.safeParse({ reason: "privacy", details: "   " }).success).toBe(false);
    expect(pageReportInputSchema.safeParse({ reason: "bogus", details: "a" }).success).toBe(false);
  });

  it("the appeal block of the status is strict and carries no internal note", () => {
    expect(pageAppealStatusSchema.safeParse({ state: "open", submitted_at: "2026-11-09T10:00:00Z", decided_at: null, decision_reason: null }).success).toBe(true);
    expect(pageAppealStatusSchema.safeParse({ state: "open", submitted_at: null, decided_at: null, decision_reason: null, note: "x" }).success).toBe(false);
    expect(Object.keys(gymPageStatusSchema.shape)).toEqual(expect.arrayContaining(["taken_down_reason", "appeal"]));
    expect(Object.keys(gymPageStatusSchema.shape)).not.toContain("taken_down_note");
  });
});
