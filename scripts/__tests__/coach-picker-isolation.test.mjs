import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkIsolation, DENY_COLUMNS, DENY_RELATIONS } from "../check-coach-picker-isolation.mjs";

const script = fileURLToPath(new URL("../check-coach-picker-isolation.mjs", import.meta.url));
const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const NAMES = [
  "list_picker_coaches",
  "list_coach_classes",
  "list_coach_class_session_roster",
  "list_coach_assigned_members",
  "get_coach_assigned_member",
  "list_coach_member_session_notes",
  "get_coach_member_workout_plan",
];
const ALL_CALLED = NAMES.map((n) => `select * from public.${n}(null);`).join("\n");

const fn = (name, text = "begin return; end;", schema = "public") => ({ id: `f:${schema}.${name}`, kind: "function", schema, name, args: "", text });
const rel = (name, text = null, schema = "public") => ({ id: `r:${schema}.${name}`, kind: "relation", schema, name, text });

/** A clean catalog: the seven picker functions reading ordinary tables and one helper view and helper function. */
function cleanCatalog(extra = [], edges = []) {
  return {
    objects: [
      ...NAMES.map((n) => fn(n, "select m.id from members m join subscriptions_current sc on sc.member_id = m.id where m.gym_id = private.gym_id()")),
      fn("gym_id", "select 1 from members", "private"),
      rel("members"),
      rel("progress_entries"),
      rel("progress_photos"),
      rel("workout_plan_completions"),
      rel("subscriptions_current", "SELECT s.member_id, m.name, m.phone FROM subscriptions s JOIN members m ON m.id = s.member_id"),
      ...extra,
    ],
    edges,
    supportCapabilities: ["set_registration_fee"],
  };
}

const config = (over = {}) => ({ allowList: NAMES, noBodyTestText: ALL_CALLED, ...over });

test("a clean catalog passes", () => {
  const { failures, pickers } = checkIsolation(cleanCatalog(), config());
  assert.deepEqual(failures, []);
  assert.equal(pickers.length, 7);
});

test("the deny list holds the real progress tables and the body columns of the spec", () => {
  assert.deepEqual([...DENY_RELATIONS].sort(), ["progress_entries", "progress_photos", "workout_plan_completions"]);
  for (const c of ["starting_weight_kg", "height_cm", "birth_year", "dob", "emergency_contact", "email", "neighborhood", "profession"]) {
    assert.ok(DENY_COLUMNS.includes(c), c);
  }
  assert.ok(!DENY_RELATIONS.includes("session_notes"), "session_notes is a picker output, not a deny-list entry");
});

test("a picker function reaching progress_entries through a helper view two levels down fails, with the path", () => {
  // The helper views name their source only in the text, as a real view definition does; the function names only the outer view.
  const catalog = cleanCatalog([
    rel("helper_outer", "SELECT h.id FROM helper_inner h"),
    rel("helper_inner", "SELECT e.id FROM progress_entries e"),
  ]);
  catalog.objects.find((o) => o.name === "list_coach_classes").text = "begin return query select o.id from helper_outer o; end;";
  const { failures } = checkIsolation(catalog, config());
  assert.equal(failures.length, 1, failures.join("\n"));
  assert.match(failures[0], /public\.list_coach_classes\(\) -> public\.helper_outer -> public\.helper_inner -> public\.progress_entries/);
});

test("the same reach through pg_depend edges only (no name in any text) also fails", () => {
  const catalog = cleanCatalog(
    [rel("outer_view", "SELECT 1"), rel("inner_view", "SELECT 1")],
    [
      { from: "f:public.get_coach_assigned_member", to: "r:public.outer_view" },
      { from: "r:public.outer_view", to: "r:public.inner_view" },
      { from: "r:public.inner_view", to: "r:public.progress_photos" },
    ],
  );
  const { failures } = checkIsolation(catalog, config());
  assert.equal(failures.length, 1, failures.join("\n"));
  assert.match(failures[0], /get_coach_assigned_member\(\) -> public\.outer_view -> public\.inner_view -> public\.progress_photos/);
});

test("a path through a helper function also fails", () => {
  const catalog = cleanCatalog([fn("helper_fn", "select count(*) from workout_plan_completions", "private")]);
  catalog.objects.find((o) => o.name === "list_picker_coaches").text = "select private.helper_fn()";
  const { failures } = checkIsolation(catalog, config());
  assert.equal(failures.length, 1, failures.join("\n"));
  assert.match(failures[0], /list_picker_coaches\(\) -> private\.helper_fn\(\) -> public\.workout_plan_completions/);
});

test("a picker function that reaches a progress table only through ANOTHER picker function's dependency fails, naming both", () => {
  const catalog = cleanCatalog();
  catalog.objects.find((o) => o.name === "list_coach_member_session_notes").text = "select 1 from progress_entries";
  catalog.objects.find((o) => o.name === "get_coach_member_workout_plan").text = "select * from public.list_coach_member_session_notes(p_coach_id, p_member_id)";
  const { failures } = checkIsolation(catalog, config());
  assert.ok(failures.some((f) => /get_coach_member_workout_plan\(\) -> public\.list_coach_member_session_notes\(\) -> public\.progress_entries/.test(f)), failures.join("\n"));
  assert.ok(failures.some((f) => /^public\.list_coach_member_session_notes\(\) -> public\.progress_entries/.test(f)), failures.join("\n"));
});

test("a body or contact column in a picker body or in a walked view fails", () => {
  for (const column of DENY_COLUMNS) {
    const direct = cleanCatalog();
    direct.objects.find((o) => o.name === "list_coach_assigned_members").text = `select m.${column} from members m`;
    assert.ok(checkIsolation(direct, config()).failures.some((f) => f.includes(`"${column}"`)), `direct ${column}`);

    const viaView = cleanCatalog();
    viaView.objects.find((o) => o.name === "subscriptions_current").text = `SELECT m.${column} FROM members m`;
    const f = checkIsolation(viaView, config()).failures;
    assert.ok(f.some((x) => x.includes("subscriptions_current") && x.includes(`"${column}"`)), `via view ${column}: ${f.join("\n")}`);
  }
});

test("the progress-photos bucket literal fails; a similar word does not", () => {
  const bad = cleanCatalog();
  bad.objects.find((o) => o.name === "list_picker_coaches").text = "select 'progress-photos'";
  assert.equal(checkIsolation(bad, config()).failures.length, 1);
  const fine = cleanCatalog();
  fine.objects.find((o) => o.name === "list_picker_coaches").text = "select emailed_total, dobson from members";
  assert.deepEqual(checkIsolation(fine, config()).failures, [], "whole words only: dobson and emailed_total are not the deny-listed columns");
});

test("a comment is not a reference", () => {
  const catalog = cleanCatalog();
  catalog.objects.find((o) => o.name === "list_picker_coaches").text = "-- never read progress_entries here\nselect 1 /* starting_weight_kg */";
  assert.deepEqual(checkIsolation(catalog, config()).failures, []);
});

test("a picker function registered in private.support_capabilities fails (FR-251)", () => {
  const catalog = cleanCatalog();
  catalog.supportCapabilities = ["set_registration_fee", "list_coach_classes"];
  const { failures } = checkIsolation(catalog, config());
  assert.equal(failures.length, 1);
  assert.match(failures[0], /list_coach_classes is registered in private\.support_capabilities/);
});

test("an allow-list name with no function is a stale entry and fails", () => {
  const { failures } = checkIsolation(cleanCatalog(), config({ allowList: [...NAMES, "list_coach_gone"], noBodyTestText: `${ALL_CALLED}\nselect list_coach_gone(1);` }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /stale allow-list entry: no function public\.list_coach_gone exists/);
});

test("a function matching the name pattern but missing from the list fails; a renamed function that is listed is still checked", () => {
  const unlisted = cleanCatalog([fn("list_coach_extra", "select 1 from progress_entries")]);
  const f1 = checkIsolation(unlisted, config()).failures;
  assert.ok(f1.some((f) => /list_coach_extra matches the picker name pattern but is not in/.test(f)), f1.join("\n"));

  const renamed = cleanCatalog([fn("show_roster_for", "select 1 from progress_entries")]);
  const f2 = checkIsolation(renamed, config({ allowList: [...NAMES, "show_roster_for"], noBodyTestText: `${ALL_CALLED}\nselect show_roster_for(1);` })).failures;
  assert.ok(f2.some((f) => f.startsWith("public.show_roster_for() -> public.progress_entries")), f2.join("\n"));
});

test("an allow-list name the seeded no-body-data test does not call fails", () => {
  const withoutOne = NAMES.filter((n) => n !== "get_coach_member_workout_plan")
    .map((n) => `select * from public.${n}(null);`)
    .join("\n");
  const { failures } = checkIsolation(cleanCatalog(), config({ noBodyTestText: withoutOne }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /get_coach_member_workout_plan is in the allow-list but coach_picker_no_body_data\.test\.sql does not call it/);
});

test("the committed allow-list names exactly the seven functions, and the committed no-body-data test calls each", () => {
  const list = JSON.parse(readFileSync(join(repoRoot, "scripts/coach-picker-functions.json"), "utf8")).functions;
  assert.deepEqual([...list].sort(), [...NAMES].sort());
  const testSql = readFileSync(join(repoRoot, "supabase/tests/coach_picker_no_body_data.test.sql"), "utf8");
  for (const n of list) assert.match(testSql, new RegExp(`public\\.${n}\\(`), n);
});

test("the command line: a clean offline catalog exits 0, a bad one exits 1 with the path on stderr, a missing file exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "picker-isolation-"));
  const clean = join(dir, "clean.json");
  writeFileSync(clean, JSON.stringify(cleanCatalog()));
  const ok = spawnSync(process.execPath, [script, "--catalog", clean], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);

  const bad = join(dir, "bad.json");
  const catalog = cleanCatalog([rel("helper_outer", "SELECT h.id FROM helper_inner h"), rel("helper_inner", "SELECT e.id FROM progress_entries e")]);
  catalog.objects.find((o) => o.name === "list_picker_coaches").text = "select 1 from helper_outer";
  writeFileSync(bad, JSON.stringify(catalog));
  const failed = spawnSync(process.execPath, [script, "--catalog", bad], { encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /list_picker_coaches\(\) -> public\.helper_outer -> public\.helper_inner -> public\.progress_entries/);

  const missing = spawnSync(process.execPath, [script, "--catalog", join(dir, "nope.json")], { encoding: "utf8" });
  assert.equal(missing.status, 2);
});
