import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReaders, findReaders, scanReaders } from "../check-attendance-readers.mjs";

const script = fileURLToPath(new URL("../check-attendance-readers.mjs", import.meta.url));

const BASELINE = { entries: [{ file: "apps/mobile/src/services/checkin.ts", count: 1, reason: "member policy hides voided rows (27.1); no mobile build is forced" }] };

function fixtureRoot(files) {
  const root = mkdtempSync(join(tmpdir(), "attendance-readers-"));
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

function run(root, baseline) {
  const path = join(root, "baseline.json");
  writeFileSync(path, JSON.stringify(baseline));
  return spawnSync(process.execPath, [script, "--root", root, "--baseline", path], { encoding: "utf8" });
}

test("the real repo passes against the committed baseline (27.1)", () => {
  const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("every quote style and line break of .from(attendance_events) is found, with its line", () => {
  assert.deepEqual(findReaders(`a\nsupabase.from("attendance_events").select()`), [2]);
  assert.deepEqual(findReaders(`supabase.from('attendance_events')`), [1]);
  assert.deepEqual(findReaders("supabase.from(`attendance_events`)"), [1]);
  assert.deepEqual(findReaders(`supabase\n  .from(\n    "attendance_events",\n  )`), [2], "a trailing comma still reads the table");
  assert.deepEqual(findReaders(`supabase.from(\n  "attendance_events"\n)`), [1]);
  assert.deepEqual(findReaders("supabase.from<Row>('attendance_events')"), [1], "a type argument still reads the table");
  assert.deepEqual(findReaders("supabase.from <Row> (\n  'attendance_events'\n)"), [1], "whitespace around a type argument still reads the table");
  assert.deepEqual(findReaders("supabase.from<Database['public']['Tables']['x']>(`attendance_events`)"), [1], "a nested generic still reads the table");
  assert.deepEqual(findReaders("supabase .from  (  'attendance_events'  )"), [1], "whitespace before the parenthesis still reads the table");
  assert.deepEqual(findReaders(`supabase.from("attendance_counted")`), []);
  assert.deepEqual(findReaders(`supabase.from("member_visit_days").select("attendance_events")`), []);
});

test("a seeded offender outside the baseline fails the check, naming file and line", () => {
  const root = fixtureRoot({
    "apps/dashboard/services/newreader.ts": `export const x = 1;\nawait supabase.from("attendance_events").select("id");\n`,
    "apps/mobile/src/services/checkin.ts": `supabase.from('attendance_events')`,
  });
  const r = run(root, BASELINE);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /apps\/dashboard\/services\/newreader\.ts:2/);
  assert.doesNotMatch(r.stderr, /checkin\.ts/, "the allowlisted file is not reported");
});

test("an allowlisted reader alone passes", () => {
  const root = fixtureRoot({ "apps/mobile/src/services/checkin.ts": `supabase.from('attendance_events')` });
  assert.equal(run(root, BASELINE).status, 0);
});

test("a stale baseline entry (the file no longer reads the table) fails", () => {
  const root = fixtureRoot({ "apps/mobile/src/services/checkin.ts": `supabase.from('attendance_counted')` });
  const r = run(root, BASELINE);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Stale baseline entry: apps\/mobile\/src\/services\/checkin\.ts/);
});

test("a baseline entry without a one-line reason fails", () => {
  for (const reason of [undefined, "", "   ", "two\nlines"]) {
    const found = new Map([["a.ts", [1]]]);
    const out = checkReaders(found, { entries: [{ file: "a.ts", count: 1, reason }] });
    assert.equal(out.length, 1, JSON.stringify(reason));
    assert.match(out[0], /one-line "reason"/);
  }
});

test("supabase/functions and packages are scanned; node_modules and build output are not", () => {
  const root = fixtureRoot({
    "supabase/functions/x/index.ts": `sb.from("attendance_events")`,
    "packages/p/src/a.ts": `sb.from("attendance_events")`,
    "apps/dashboard/node_modules/z/index.js": `sb.from("attendance_events")`,
    "apps/dashboard/.next/server/a.js": `sb.from("attendance_events")`,
    "apps/dashboard/README.md": `sb.from("attendance_events")`,
  });
  assert.deepEqual([...scanReaders(root).keys()].sort(), ["packages/p/src/a.ts", "supabase/functions/x/index.ts"]);
});

test("a missing baseline or an empty scan root is refused, not passed", () => {
  const root = fixtureRoot({ "unrelated/file.txt": "x" });
  const path = join(root, "baseline.json");
  writeFileSync(path, JSON.stringify(BASELINE));
  assert.equal(spawnSync(process.execPath, [script, "--root", root, "--baseline", path], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync(process.execPath, [script, "--root", root, "--baseline", join(root, "nope.json")], { encoding: "utf8" }).status, 2);
});

test("a second base-table read inside an allowlisted file fails, naming both lines", () => {
  const root = fixtureRoot({
    "apps/mobile/src/services/checkin.ts": `supabase.from('attendance_events')\nsupabase.from<Row>("attendance_events")\n`,
  });
  const r = run(root, BASELINE);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /checkin\.ts:1,2: holds 2 base-table read\(s\).*allows 1/);
});

test("a baseline count above the found count fails, and a missing or non-integer count fails", () => {
  const root = fixtureRoot({ "apps/mobile/src/services/checkin.ts": `supabase.from('attendance_events')` });
  const r = run(root, { entries: [{ file: "apps/mobile/src/services/checkin.ts", count: 2, reason: "r" }] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /holds 1 base-table read\(s\).*allows 2/);
  for (const count of [undefined, 0, 1.5, "1"]) {
    const out = checkReaders(new Map([["a.ts", [1]]]), { entries: [{ file: "a.ts", count, reason: "r" }] });
    assert.equal(out.length, 1, JSON.stringify(count));
    assert.match(out[0], /positive integer "count"/);
  }
});

test("a generic-form offender outside the baseline fails", () => {
  const root = fixtureRoot({ "apps/dashboard/services/new.ts": "await supabase.from<Row>('attendance_events').select();\n" });
  const r = run(root, { entries: [] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /apps\/dashboard\/services\/new\.ts:1/);
});
