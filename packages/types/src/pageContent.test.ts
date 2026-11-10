import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAGE_CONTENT_LANGUAGES, classifyHost, completePageLanguages, isReservedLabel, isValidPageName, parsePageContentV1, pageSnapshotSchema } from "./index";
import fixture from "./fixtures/pageSnapshotV1.json";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const clone = () => JSON.parse(JSON.stringify(fixture)) as Record<string, any>;
const { _comment: _c, ...row } = clone();
void _c;
const at = (mut: (r: Record<string, any>) => void) => {
  const r = JSON.parse(JSON.stringify(row)) as Record<string, any>;
  mut(r);
  return parsePageContentV1(r as never);
};

function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((el) => [`${prefix}[]`, ...keyPaths(el, `${prefix}[]`)]);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => {
      const p = prefix ? `${prefix}.${k}` : k;
      return [p, ...keyPaths(v, p)];
    });
  }
  return [];
}

describe("PageContentV1", () => {
  it("accepts the fixture snapshot", () => {
    expect(at(() => undefined)).toMatchObject({ ok: true });
  });

  it("the fixture's key paths equal the list pinned in the pgTAP snapshot test (the database's side of the contract)", () => {
    const sql = readFileSync(join(root, "supabase", "tests", "gym_page_publish.test.sql"), "utf8");
    const m = sql.match(/unnest\(array\[\s*('about_en'[\s\S]*?)\]\) x\),\s*'SNAPSHOT KEY PATHS \(pinned\)/);
    expect(m, "the pinned SNAPSHOT KEY PATHS list").toBeTruthy();
    const pinned = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
    const have = [...new Set(keyPaths((row as { content: unknown }).content))].sort();
    expect(have).toEqual(pinned);
  });

  it("the snapshot schema of the editor status and PageContentV1 know the same top-level keys", () => {
    expect(Object.keys(pageSnapshotSchema.shape).sort()).toEqual(Object.keys((row as { content: object }).content).sort());
  });

  it("fails closed: an extra key, a wrong type, another version, a bad template", () => {
    expect(at((r) => (r.content.extra = 1)).ok, "(r.content.extra = 1)").toBe(false);
    expect(at((r) => (r.content.name = 5)).ok, "(r.content.name = 5)").toBe(false);
    expect(at((r) => (r.content.plans[0].price = "1")).ok, "(r.content.plans[0].price = \"1\")").toBe(false);
    expect(at((r) => (r.content.plans[0].extra = 1)).ok, "(r.content.plans[0].extra = 1)").toBe(false);
    expect(at((r) => (r.schema_version = 2)).ok, "(r.schema_version = 2)").toBe(false);
    expect(at((r) => (r.schema_version = "1")).ok, "(r.schema_version = \"1\")").toBe(false);
    expect(at((r) => (r.template = "Bad Template")).ok, "(r.template = \"Bad Template\")").toBe(false);
    expect(at((r) => (r.content.default_language = "es")).ok, "(r.content.default_language = \"es\")").toBe(false);
    expect(at((r) => delete r.content.default_language).ok, "delete r.content.default_language").toBe(false);
    expect(at((r) => (r.content.color = "red")).ok, "(r.content.color = \"red\")").toBe(false);
    expect(at((r) => (r.content.logo = "../../etc/passwd")).ok, "(r.content.logo = \"../../etc/passwd\")").toBe(false);
    expect(at((r) => (r.content.gallery = ["x.webp"])).ok, "(r.content.gallery = [\"x.webp\"])").toBe(false);
    expect(at((r) => (r.content.contact.phone = "tel:1")).ok, "(r.content.contact.phone = \"tel:1\")").toBe(false);
    expect(at((r) => (r.content.map.lat = 91)).ok, "(r.content.map.lat = 91)").toBe(false);
    expect(at((r) => (r.content.plans[0].type = "gold")).ok, "(r.content.plans[0].type = \"gold\")").toBe(false);
  });

  it("a failure names paths and codes, never a value", () => {
    const r = at((x) => (x.content.name = 5));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join("|")).toBe("content.name: invalid_type");
    const hostile = at((x) => (x.content.plans[0].price = "SECRET-GYM-TEXT"));
    expect(JSON.stringify(hostile)).not.toContain("SECRET-GYM-TEXT");
  });

  it("closed days (JSON null) and a missing optional key are accepted", () => {
    expect(at((r) => delete r.content.map).ok).toBe(true);
    expect(at((r) => delete r.content.hours).ok).toBe(true);
  });

  it("completePageLanguages reads the language list: a language is complete when its About is in the snapshot", () => {
    expect(PAGE_CONTENT_LANGUAGES).toEqual(["en", "fr"]);
    const c = (row as { content: any }).content;
    expect(completePageLanguages(c)).toEqual(["en", "fr"]);
    expect(completePageLanguages({ ...c, about_fr: undefined })).toEqual(["en"]);
    expect(completePageLanguages({ ...c, about_fr: "   \n " })).toEqual(["en"]); // whitespace only is not complete (the template trims)
  });
});

describe("page name grammar (one function)", () => {
  it("matches the FR-202 table", () => {
    for (const ok of ["abc", "gym-os", "a1b", "a".repeat(30), "1a2"]) expect(isValidPageName(ok), ok).toBe(true);
    for (const bad of ["ab", "-abc", "abc-", "a--b", "xn--abc", "123", "_dmarc", "ABC", "a".repeat(31), "a.b", "", "a b", "é-é-é"]) expect(isValidPageName(bad), bad).toBe(false);
  });
  it("the migration that defines the SQL grammar function (private.page_name_valid) exists; the cases are not shared", () => {
    const sql = readFileSync(join(root, "supabase", "migrations", "0163_page_names.sql"), "utf8");
    expect(sql).toMatch(/page_name_valid/);
  });
});

describe("classifyHost", () => {
  const root = "gymosapps.com";
  it("apex and www keep the marketing site; any other host is not a gym host", () => {
    expect(classifyHost("gymosapps.com", root)).toEqual({ kind: "marketing", reason: "apex" });
    expect(classifyHost("WWW.GymOSApps.com:443", root)).toEqual({ kind: "marketing", reason: "www" });
    expect(classifyHost("gym-os-landing-git-x.vercel.app", root)).toEqual({ kind: "marketing", reason: "other" });
    expect(classifyHost("fit.gymosapps.com.evil.com", root)).toEqual({ kind: "marketing", reason: "other" });
    expect(classifyHost("evilgymosapps.com", root)).toEqual({ kind: "marketing", reason: "other" });
    expect(classifyHost(null, root)).toEqual({ kind: "marketing", reason: "other" });
    expect(classifyHost("fit.gymosapps.com", "")).toEqual({ kind: "marketing", reason: "other" });
    expect(classifyHost("[::1]:3000", root)).toEqual({ kind: "marketing", reason: "other" });
  });
  it("a valid label under the root is a candidate gym page", () => {
    expect(classifyHost("fit.gymosapps.com", root)).toEqual({ kind: "gym", label: "fit" });
    expect(classifyHost("Grace-Fit.gymosapps.com.:8080", root)).toEqual({ kind: "gym", label: "grace-fit" });
    expect(classifyHost("fit.localhost:3002", "localhost:3002")).toEqual({ kind: "gym", label: "fit" });
    expect(classifyHost("localhost:3002", "localhost:3002")).toEqual({ kind: "marketing", reason: "apex" });
  });
  it("grammar failures, reserved labels and a second label level are not-found without a database call", () => {
    expect(classifyHost("ab.gymosapps.com", root)).toEqual({ kind: "not-found", reason: "grammar" });
    expect(classifyHost("xn--abc.gymosapps.com", root)).toEqual({ kind: "not-found", reason: "grammar" });
    expect(classifyHost("123.gymosapps.com", root)).toEqual({ kind: "not-found", reason: "grammar" });
    expect(classifyHost("-ab-.gymosapps.com", root)).toEqual({ kind: "not-found", reason: "grammar" });
    expect(classifyHost("mail.gymosapps.com", root)).toEqual({ kind: "not-found", reason: "reserved" });
    expect(classifyHost("owner.gymosapps.com", root)).toEqual({ kind: "not-found", reason: "reserved" });
    expect(isReservedLabel("gymos-fit")).toBe(true);
    expect(classifyHost("a.b.gymosapps.com", root)).toEqual({ kind: "not-found", reason: "depth" });
    expect(classifyHost(".gymosapps.com", root)).toEqual({ kind: "not-found", reason: "grammar" });
  });
});

describe("the landing-gate kit's page fixture (Story 24.12)", () => {
  it("is a valid strict PageContentV1 snapshot, as the reader would return it", () => {
    // scripts/landing-gate/fixtures/full-page.json is inserted as gym_pages.content by scripts/landing-gate/seed.mjs. The kit's node tests cannot import the
    // schema (it is TypeScript with extensionless imports), so the schema check lives here, where it is imported the way the app imports it.
    const content = JSON.parse(readFileSync(join(root, "scripts", "landing-gate", "fixtures", "full-page.json"), "utf8"));
    const parsed = parsePageContentV1({ template: "classic", schema_version: 1, content } as never);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    // strict: an unknown key makes the same fixture fail, so the check cannot pass by ignoring keys
    expect(parsePageContentV1({ template: "classic", schema_version: 1, content: { ...content, zz_unknown_key: 1 } } as never).ok).toBe(false);
  });
});
