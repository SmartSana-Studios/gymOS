import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "check-migration-guardrails.mjs");
const fx = (p) => join(here, "fixtures", p);

function run(dir, gf = "empty.json") {
  const r = spawnSync(
    process.execPath,
    [script, "--migrations", fx(dir), "--grandfather", fx(gf)],
    { encoding: "utf8" },
  );
  return { code: r.status, out: r.stdout + r.stderr };
}

test("clean tree exits 0", () => {
  assert.equal(run("clean").code, 0);
});

test("new app_role read fails, names file and replacement", () => {
  const r = run("new-jwt");
  assert.equal(r.code, 1);
  assert.match(r.out, /0001_bad\.sql/);
  assert.match(r.out, /private\.current_member_role\(\)/);
});

test("single-arrow variant is caught", () => {
  assert.equal(run("new-jwt-arrow").code, 1);
});

test("fixed read passes", () => {
  assert.equal(run("fixed-jwt").code, 0);
});

test("grandfathered file with more reads passes", () => {
  assert.equal(run("grandfathered-edited", "grandfathered-edited.json").code, 0);
});

test("function with no revoke fails naming the function", () => {
  const r = run("fn-none");
  assert.equal(r.code, 1);
  assert.match(r.out, /do_thing/);
});

test("revoke from public only fails", () => {
  const r = run("fn-public-only");
  assert.equal(r.code, 1);
  assert.match(r.out, /private\.only_pub/);
  assert.match(r.out, /anon/);
});

test("revoke from public, anon or two statements passes", () => {
  assert.equal(run("fn-both").code, 0);
});

test("stale grandfather entries fail naming the entry", () => {
  const r = run("stale", "stale.json");
  assert.equal(r.code, 1);
  assert.match(r.out, /0099_gone\.sql/);
  assert.match(r.out, /function_privileges: 0001_ok\.sql/);
});

test("real tree passes with checked-in lists (at most 54 app_role entries)", () => {
  const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const list = JSON.parse(
    readFileSync(join(here, "..", "migration-guardrails.grandfather.json"), "utf8"),
  ).app_role_reads;
  assert.ok(list.length > 0 && list.length <= 54);
});

test("revoke with trailing CASCADE passes", () => {
  assert.equal(run("fn-cascade").code, 0);
});

test("create procedure without revoke fails", () => {
  const r = run("fn-procedure");
  assert.equal(r.code, 1);
  assert.match(r.out, /do_proc/);
});

test("missing argument value exits 2", () => {
  const r = spawnSync(process.execPath, [script, "--migrations"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Missing value/);
});

test("migrations dir with no .sql files exits 2", () => {
  const r = run("empty-dir");
  assert.equal(r.code, 2);
  assert.match(r.out, /empty-dir/);
});

test("revoke by bare name (no argument list) passes", () => {
  assert.equal(run("fn-bare-name").code, 0);
});

test("malformed grandfather file exits 2 naming the file", () => {
  const r = run("clean", "bad-shape.json");
  assert.equal(r.code, 2);
  assert.match(r.out, /bad-shape\.json/);
});
