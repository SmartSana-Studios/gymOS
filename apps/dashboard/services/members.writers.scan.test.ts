// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Story 26.1: every code path in the apps that inserts into or updates the
// `members` table is listed here, either as carrying the three profile fields
// (birth_year, profession, neighborhood) or as exempt with a reason. A new,
// unlisted writer fails the scan: add it to the right list in the same change.
// (SQL writers -- create_staff_member, support_set_membership -- are database
// functions and are outside this source scan; they leave the fields null.)
//
// What this scan does NOT see (known limits, by design of a source scan): a table name held in a variable, a write that goes
// through a helper, `.from<Row>("members")` with a generic, writers in supabase/functions or packages/*, and SQL RPCs. The
// runtime payload tests (members.provisionMemberRow, members.updateMember) are what prove the carrying writers map the right
// value to the right column; this scan is the inventory.

type Writer = { file: string; kind: "insert" | "update" | "upsert"; count: number };

const CARRIES_THE_FIELDS: (Writer & { why: string })[] = [
  { file: "apps/dashboard/services/members.provisioning.ts", kind: "insert", count: 1, why: "insertMember: create path, also used by the plan CSV import (which passes null)" },
  { file: "apps/dashboard/services/members.changes.ts", kind: "update", count: 1, why: "updateMember (member edit)" },
];

const EXEMPT: (Writer & { reason: string })[] = [
  { file: "apps/dashboard/services/members.provisioning.ts", kind: "update", count: 1, reason: "settles registration_fee_settled_at only (CSV import fee exemption)" },
  { file: "apps/dashboard/services/members.changes.ts", kind: "update", count: 2, reason: "deactivate and reactivate touch deactivated_at only" },
  { file: "apps/super-admin/services/gyms.ts", kind: "insert", count: 1, reason: "creates a gym's owner row at gym creation; staff row, profile fields stay null" },
  { file: "apps/dashboard/e2e/fixtures/seed.ts", kind: "insert", count: 2, reason: "e2e fixtures with synthetic rows" },
  { file: "apps/mobile/src/app/onboarding/plan.tsx", kind: "update", count: 1, reason: "member onboarding goal/experience; the mobile app neither shows nor collects the fields" },
  { file: "apps/mobile/src/app/onboarding/body-profile.tsx", kind: "update", count: 1, reason: "member body profile; the mobile app neither shows nor collects the fields" },
];

const ROOT = join(__dirname, "..", "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo", "playwright-report", "test-results", ".expo"]);

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
}

function scan(): Map<string, number> {
  const files: string[] = [];
  walk(join(ROOT, "apps"), files);
  const found = new Map<string, number>();
  const fromMembers = /\.from\(\s*["'`]members["'`]\s*\)/g;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = fromMembers.exec(text))) {
      const rest = text.slice(m.index + m[0].length);
      const end = rest.indexOf(";");
      const chain = end === -1 ? rest : rest.slice(0, end);
      const kind = /^\s*\.(insert|update|upsert|delete|select)\(/.exec(chain)?.[1];
      if (kind === "insert" || kind === "update" || kind === "upsert") {
        const key = `${relative(ROOT, file).split(sep).join("/")}#${kind}`;
        found.set(key, (found.get(key) ?? 0) + 1);
      }
    }
  }
  return found;
}

describe("members writers carry the profile fields or are exempt", () => {
  it("every insert/update of members in the apps is listed", () => {
    const listed = new Map<string, number>();
    for (const w of [...CARRIES_THE_FIELDS, ...EXEMPT]) {
      const key = `${w.file}#${w.kind}`;
      listed.set(key, (listed.get(key) ?? 0) + w.count);
    }
    expect(Object.fromEntries([...scan()].sort())).toEqual(Object.fromEntries([...listed].sort()));
  });

  it("the carrying writers really write the three columns", () => {
    for (const file of ["apps/dashboard/services/members.provisioning.ts", "apps/dashboard/services/members.changes.ts"]) {
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const column of ["birth_year", "profession", "neighborhood"]) {
        expect(text, `${file} must write ${column}`).toContain(`${column}: input.`);
      }
    }
  });
});
