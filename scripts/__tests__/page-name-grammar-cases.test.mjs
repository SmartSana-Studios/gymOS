import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Epic 24 retro D2: the shared page-name case list (JSON) and the rows of the pgTAP file must be the same set, so the TypeScript and SQL
// grammars are tested against identical names.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Rows between `-- CASES BEGIN` and `-- CASES END` of the pgTAP file: [{ name, expected }]. */
export function sqlCases(text) {
  const block = text.split("-- CASES BEGIN")[1]?.split("-- CASES END")[0];
  assert.ok(block, "the CASES BEGIN / CASES END markers are missing");
  const rows = [];
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*\((E?)'((?:[^']|'')*)', (true|false)\),?\s*$/);
    if (!line.trim()) continue;
    assert.ok(m, `unparseable case row: ${line}`);
    let s = m[2].replace(/''/g, "'");
    if (m[1] === "E") s = s.replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
    rows.push({ name: s, expected: m[3] === "true" });
  }
  return rows;
}

const json = JSON.parse(read("../../packages/types/src/constants/pageNameCases.json"));
const sql = sqlCases(read("../../supabase/tests/page_name_grammar.test.sql"));

test("the pgTAP rows are exactly the shared JSON cases", () => {
  assert.deepEqual(sql.filter((r) => r.expected).map((r) => r.name), json.valid);
  assert.deepEqual(sql.filter((r) => !r.expected).map((r) => r.name), json.invalid);
});

test("the plan counts every row plus the load check", () => {
  const text = read("../../supabase/tests/page_name_grammar.test.sql");
  assert.match(text, new RegExp(`select plan\\(${sql.length + 1}\\);`));
  assert.match(text, new RegExp(`count\\(\\*\\)::int from cases\\), ${sql.length},`));
});

test("a case that is in one list and not the other is reported (the check can fail)", () => {
  const drifted = read("../../supabase/tests/page_name_grammar.test.sql").replace("('gym-os', true),\n", "");
  assert.notDeepEqual(sqlCases(drifted).filter((r) => r.expected).map((r) => r.name), json.valid);
});
