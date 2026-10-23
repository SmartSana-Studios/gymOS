// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Story 26.2: every non-test file that mentions provisionMemberRow (a call, an import, a re-export, an alias or a reference passed
// as a value) is listed here, and every listed file still does. A new caller must be added deliberately, and must go through the
// fee-state rules: no plan and no import-exempt flag leaves the member awaiting the fee (the 0098 trigger decides), and only a
// plan row in a fee gym passes `importExempt`.
const ROOT = join(__dirname, "..", "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".expo", "dist", "build", ".turbo", "playwright-report", "test-results"]);
const LISTED = [
  "apps/dashboard/app/(dashboard)/members/actions.ts",
  "apps/dashboard/services/csvImport.ts",
  "apps/dashboard/services/members.provisioning.ts",
  "apps/dashboard/services/members.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

// Comments do not count as a use.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("provisionMemberRow users", () => {
  it("are exactly the listed files, in the apps", () => {
    const found = walk(join(ROOT, "apps"))
      .filter((file) => /\bprovisionMemberRow\b/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(ROOT, file).split(sep).join("/"))
      .sort();
    expect(found).toEqual([...LISTED].sort());
  });

  it("a plan-less member is never passed the import-exempt flag in the importer", () => {
    const source = stripComments(readFileSync(join(ROOT, "apps/dashboard/services/csvImport.ts"), "utf8"));
    // The only place the flag is set is the per-row decision, which requires the row to have a plan.
    const uses = source.match(/importExempt:\s*true/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(source).toMatch(/exemptFor\s*=\s*\(row: ValidatedCsvRow\)\s*=>\s*feeGym && hasPlan\(row\)/);
  });
});
