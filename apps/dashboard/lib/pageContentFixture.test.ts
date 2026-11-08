/**
 * Story 24.9: ONE valid/invalid fixture for the page content rules. The same file is run by supabase/tests/gym_page_status.test.sql
 * against set_gym_page_content() (the SQL side embeds it between two $fx$ markers; this test fails when the embedded copy drifts),
 * and here against the Zod schema. Where the two sides deliberately differ the case carries a note.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAGE_CONTENT_LANGUAGES, gymPageContentSchema } from "@gymos/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureText = readFileSync(join(root, "packages", "types", "src", "fixtures", "pageContentCases.json"), "utf8");
const fixture = JSON.parse(fixtureText) as {
  languages: string[];
  cases: { id: string; content?: Record<string, unknown>; gen?: { key: string; unit: string; times: number }; zod: boolean; sql: boolean; note?: string }[];
};

function contentOf(c: (typeof fixture.cases)[number]): Record<string, unknown> {
  return c.gen ? { [c.gen.key]: c.gen.unit.repeat(c.gen.times) } : (c.content as Record<string, unknown>);
}

describe("shared content fixture", () => {
  it.each(fixture.cases.map((c) => [c.id, c] as const))("Zod agrees with the fixture on %s", (_id, c) => {
    expect(gymPageContentSchema.safeParse(contentOf(c)).success).toBe(c.zod);
  });

  it("ids are unique", () => {
    const ids = fixture.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every difference between the two sides is explained", () => {
    for (const c of fixture.cases) if (c.zod !== c.sql) expect(c.note, c.id).toBeTruthy();
  });

  it("the only differences are Zod being stricter (never looser) than the database", () => {
    for (const c of fixture.cases) if (c.zod !== c.sql) expect({ id: c.id, zod: c.zod, sql: c.sql }).toEqual({ id: c.id, zod: false, sql: true });
  });

  it("the content-language list is the fixture's list (and the database's, pinned in the pgTAP file)", () => {
    expect([...PAGE_CONTENT_LANGUAGES]).toEqual(fixture.languages);
  });

  it("the pgTAP test embeds exactly this fixture", () => {
    const sql = readFileSync(join(root, "supabase", "tests", "gym_page_status.test.sql"), "utf8");
    const m = sql.match(/-- FIXTURE:BEGIN\ncreate temp table fxdoc as select \$fx\$([\s\S]*?)\$fx\$::jsonb as doc;\n-- FIXTURE:END/);
    expect(m, "FIXTURE markers in gym_page_status.test.sql").toBeTruthy();
    expect(JSON.parse(m![1])).toEqual(fixture);
  });
});
