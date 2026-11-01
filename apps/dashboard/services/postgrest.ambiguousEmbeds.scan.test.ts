// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// 2026-11-01 production bug: `loyalty_progress` (member_id, gym_id) gave `members` and `gyms` a second, many-to-many path, so
// an unpinned `members -> gyms(...)` embed started failing with PGRST201 ("more than one relationship") and the Super Admin
// "Resend invitation" showed only "Something went wrong". Any embed between these two tables must name the foreign key:
//   members -> gyms!members_gym_id_fkey(...)      gyms -> members!members_gym_id_fkey(...)
// This scan fails on an unpinned one. Add a pair to AMBIGUOUS_PAIRS when another table pair gets a second path.
//
// Limits (a source scan): a table name held in a variable, `.from<Row>("x")` with a generic, a select string built by
// concatenation, and SQL are not seen. The detector is shown capable of failing in the last test.

const AMBIGUOUS_PAIRS: { from: string; embeds: string }[] = [
  { from: "members", embeds: "gyms" },
  { from: "gyms", embeds: "members" },
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

export type Hit = { line: number; table: string; embed: string };

/** Finds `.from("<table>")` followed (within the same call chain) by a `.select("...")` that embeds the other table unpinned. */
export function findUnpinnedEmbeds(source: string): Hit[] {
  const hits: Hit[] = [];
  for (const { from, embeds } of AMBIGUOUS_PAIRS) {
    const fromRe = new RegExp(`\\.from\\(\\s*["'\`]${from}["'\`]\\s*\\)`, "g");
    for (const m of source.matchAll(fromRe)) {
      const start = m.index ?? 0;
      // The chain's select: the first .select( within the next 600 characters, before another .from(.
      const rest = source.slice(start + m[0].length, start + m[0].length + 600);
      const nextFrom = rest.search(/\.from\(/);
      const chain = nextFrom === -1 ? rest : rest.slice(0, nextFrom);
      const sel = chain.match(/\.select\(\s*(["'`])([\s\S]*?)\1/);
      if (!sel) continue;
      // Unpinned: `gyms(`, `gyms!inner(`, `alias:gyms(`. Pinned `gyms!members_gym_id_fkey(` and `gyms!members_gym_id_fkey!inner(` do not match.
      const embedRe = new RegExp(`(^|[\\s,(:])${embeds}(!inner)?\\s*\\(`);
      if (embedRe.test(sel[2])) {
        hits.push({ line: source.slice(0, start).split("\n").length, table: from, embed: embeds });
      }
    }
  }
  return hits;
}

describe("PostgREST embeds between tables with more than one relationship are pinned to a foreign key", () => {
  it("no source file embeds members <-> gyms without naming the foreign key", () => {
    const files: string[] = [];
    for (const dir of ["apps", join("supabase", "functions")]) {
      try {
        walk(join(ROOT, dir), files);
      } catch {
        // directory absent in this checkout
      }
    }
    expect(files.length).toBeGreaterThan(50);

    const offenders = files.flatMap((file) =>
      findUnpinnedEmbeds(readFileSync(file, "utf8")).map(
        (h) => `${relative(ROOT, file).split(sep).join("/")}:${h.line} from("${h.table}") embeds ${h.embed}(...) unpinned`,
      ),
    );
    expect(offenders, "pin the embed: members -> gyms!members_gym_id_fkey(...) (see the comment at the top of this file)").toEqual([]);
  });

  it("the detector fails on the known-bad shapes and passes the pinned ones", () => {
    const bad = [
      `await admin.from("members").select("user_id, name, gyms!inner(name, status)")`,
      `supabase\n  .from("members")\n  .select("id, gyms(timezone)")`,
      `supabase.from('members').select('id, g:gyms(name)')`,
      `supabase.from("gyms").select("id, members(count)")`,
    ];
    for (const src of bad) expect(findUnpinnedEmbeds(src), src).toHaveLength(1);

    const good = [
      `admin.from("members").select("user_id, gyms!members_gym_id_fkey!inner(name, status)")`,
      `supabase.from("members").select("id, gyms!members_gym_id_fkey(timezone)")`,
      `supabase.from("tiers").select("id, gyms(count)")`,
      `supabase.from("members").select("id, name").eq("x", 1)`,
      `supabase.from("gyms").select("id, members!members_gym_id_fkey(count)")`,
    ];
    for (const src of good) expect(findUnpinnedEmbeds(src), src).toHaveLength(0);
  });
});
