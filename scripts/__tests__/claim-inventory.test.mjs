import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifySql, classifySource, buildInventory, compare, enforce, validateExempt, sourceKind } from "../claim-inventory.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "claim-inventory.mjs");
const fx = (p) => join(here, "fixtures", "claims", p);
const rows = JSON.parse(readFileSync(fx("rows.json"), "utf8"));

function run(baseline, exempt = "exempt-ok.json", extra = ["--report"]) {
  const r = spawnSync(
    process.execPath,
    [script, "--rows", fx("rows.json"), "--sources", fx("src/empty-none"), "--baseline", fx(baseline), "--exempt", fx(exempt), ...extra],
    { encoding: "utf8" },
  );
  return { code: r.status, out: r.stdout + r.stderr };
}

test("claim read without live helper is claim-only", () => {
  assert.equal(classifySql("(auth.jwt() ->> 'app_role') = 'x'").classification, "claim-only");
});

test("live helper call is live-checked, not claim-only", () => {
  assert.equal(classifySql("private.current_member_role() = 'owner'").classification, "live-checked");
});

test("helper name in a string literal is not a call; helper definitions are live-checked by name (22.3)", () => {
  const body = "raw := auth.jwt() ->> 'gym_id'; raise warning 'private.gym_id() failed';";
  assert.equal(classifySql(body).classification, "claim-only");
  assert.equal(classifySql("select private.gym_id()", "private.current_member_role()").classification, "live-checked");
  assert.equal(classifySql(body, "private.gym_id()").classification, "live-checked");
});

test("session_id style checks are not claims; plain gym_id column is ignored", () => {
  assert.equal(classifySql("select 1 from auth.sessions where id = session_id"), null);
  assert.equal(classifySql("where gym_id = 'x'"), null);
});

test("null-unsafe patterns over a role are listed; far from role is not", () => {
  for (const op of ["<> any (array['a'])", "!= any (x)", "not in ('a','b')"]) {
    const c = classifySql(`select 1 where auth.jwt() ->> 'app_role' ${op}`);
    assert.equal(c.nullUnsafe, true, op);
  }
  assert.equal(classifySql("auth.jwt() ->> 'app_role' = 'x'").nullUnsafe, false);
  const far = "select 1 where auth.jwt() ->> 'app_role' = 'x' " + " ".repeat(400) + " and id not in (1,2)";
  assert.equal(classifySql(far).nullUnsafe, false);
});

test("session_id / aal / sub claim reads are not claim reads", () => {
  assert.equal(classifySql("select 1 where (auth.jwt() ->> 'session_id') = 'x'"), null);
  assert.equal(classifySql("(select auth.jwt() ->> 'aal') = 'aal2'"), null);
  assert.equal(classifySql("(auth.jwt() ->> 'sub')::uuid = user_id"), null);
});

test("role/gym claim spellings are claim reads", () => {
  for (const t of [
    "(select auth.jwt()) ->> 'app_role' = 'owner'",
    "auth.jwt() -> 'app_metadata' ->> 'app_role' = 'owner'",
    "(auth.jwt() ->> 'gym_id'::text)::uuid = gym_id",
    "current_setting('request.jwt.claims', true)::jsonb ->> 'app_role' = 'x'",
  ])
    assert.equal(classifySql(t).classification, "claim-only", t);
});

test("direct claim read plus live helper is live-checked and flagged mixed", () => {
  const t = "private.current_member_role() = 'owner' and (auth.jwt() ->> 'gym_id')::uuid = gym_id";
  const c = classifySql(t);
  assert.equal(c.classification, "live-checked");
  assert.equal(c.mixed, true);
  const inv = buildInventory([{ kind: "policy", name: "public.t.m", text: t }], []);
  assert.equal(inv.mixed.length, 1);
  assert.equal(classifySql("private.current_member_role() = 'owner'").mixed, false);
  const r = spawnSync(
    process.execPath,
    [script, "--rows", fx("rows.json"), "--sources", fx("src/empty-none"), "--baseline", fx("baseline-ok.json"), "--exempt", fx("exempt-ok.json"), "--json"],
    { encoding: "utf8" },
  );
  assert.ok(Array.isArray(JSON.parse(r.stdout).mixed));
});

test("source: getClaims alone is not a role/gym read; spellings are", () => {
  assert.equal(classifySource("const { data } = await s.auth.getClaims(); const sub = data.claims.sub;"), null);
  for (const t of [
    "claims?.['gym_id']",
    'claims["role"]',
    "const { app_role } = data.claims;",
    "user.app_metadata.app_role",
    "claims.app_role",
  ])
    assert.equal(classifySource(t)?.classification, "claim-only", t);
  assert.equal(classifySource("claims.app_role; current_member_role").mixed, true);
});

test("source kind: supabase/functions is edge, everything else server", () => {
  assert.equal(sourceKind("supabase/functions/x/index.ts"), "edge");
  assert.equal(sourceKind("apps/dashboard/proxy.ts"), "server");
});

test("directory walk: nested files found, test files and skipped dirs ignored, names repo-relative", () => {
  const root = join(here, "fixtures", "claims", `.walk-${process.pid}`);
  const claim = "const c = data.claims.app_role;\n";
  try {
    for (const d of ["lib/nested", "node_modules/pkg", ".next/x", "__tests__"]) mkdirSync(join(root, d), { recursive: true });
    for (const p of ["lib/nested/deep.ts", "lib/a.tsx", "lib/a.test.ts", "node_modules/pkg/n.ts", ".next/x/o.js", "__tests__/t.ts", "lib/notes.md"])
      writeFileSync(join(root, p), claim);
    const r = spawnSync(
      process.execPath,
      [script, "--rows", fx("rows.json"), "--sources", root, "--baseline", fx("baseline-empty.json"), "--exempt", fx("exempt-ok.json"), "--json"],
      { encoding: "utf8" },
    );
    const out = JSON.parse(r.stdout);
    const srv = out.entries.filter((e) => e.kind !== "policy" && e.kind !== "function");
    const rel = "scripts/__tests__/fixtures/claims/.walk-" + process.pid;
    assert.deepEqual(srv.map((e) => e.name).sort(), [`${rel}/lib/a.tsx`, `${rel}/lib/nested/deep.ts`]);
    assert.ok(srv.every((e) => e.kind === "server" && e.story === "22.4"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exempt entry matching nothing is a stale-exempt note, not a failure", () => {
  const r = run("baseline-ok.json", "exempt-stale.json");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /stale exempt: function public\.nope\(\)/);
});

test("offender without a file says file unknown", () => {
  const r = run("baseline-empty.json");
  assert.match(r.out, /null-unsafe function public\.nulls\(\) \(file unknown\)/);
});

test("source: claim read vs comment only", () => {
  assert.equal(classifySource(readFileSync(fx("src/claim.ts"), "utf8")).classification, "claim-only");
  assert.equal(classifySource(readFileSync(fx("src/clean.ts"), "utf8")), null);
});

test("exempt entry is classified exempt with reason; no reason is rejected", () => {
  const inv = buildInventory(rows, [{ kind: "function", name: "public.hook(event jsonb)", reason: "issuer" }]);
  const hook = inv.entries.find((e) => e.name === "public.hook(event jsonb)");
  assert.equal(hook.classification, "exempt");
  assert.equal(hook.reason, "issuer");
  assert.equal(validateExempt([{ kind: "function", name: "x" }]).length, 1);
});

test("inventory is sorted and tagged 22.3 for database entries", () => {
  const inv = buildInventory(rows, []);
  const names = inv.entries.map((e) => e.kind + e.name);
  assert.deepEqual(names, [...names].sort());
  assert.ok(inv.entries.every((e) => e.story === "22.3"));
});

test("baseline match exits 0", () => {
  const r = run("baseline-ok.json");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /claim-only 1/);
});

test("new offender exits 1 naming kind, name and file", () => {
  const r = run("baseline-empty.json");
  assert.equal(r.code, 1);
  assert.match(r.out, /claim-only policy public\.t\.claim_policy/);
  assert.match(r.out, /9999_x\.sql/);
  assert.match(r.out, /null-unsafe function public\.nulls\(\)/);
});

test("fixed entry reports stale baseline and exits 0", () => {
  const r = run("baseline-stale.json");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /stale baseline: claim-only policy:public\.t\.gone/);
});

test("exempt entry without reason fails", () => {
  const r = run("baseline-ok.json", "exempt-noreason.json");
  assert.equal(r.code, 1);
  assert.match(r.out, /no reason/);
});

test("no database exits 2", () => {
  const r = spawnSync(process.execPath, [script, "--baseline", fx("baseline-ok.json")], {
    encoding: "utf8",
    env: { ...process.env, DB_CONTAINER: "no_such_container_xyz" },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Cannot query the local database/);
});

test("compare ignores live-checked and exempt additions", () => {
  const inv = buildInventory(rows, [{ kind: "function", name: "public.hook(event jsonb)", reason: "issuer" }]);
  assert.deepEqual(compare(inv, JSON.parse(readFileSync(fx("baseline-ok.json"), "utf8"))).failures, []);
});

test("path-operator claim reads are claim-only (#>> '{app_role}', nested path, array form)", () => {
  for (const body of [
    "select (auth.jwt() #>> '{app_role}') = 'owner'",
    "select (auth.jwt() #>> '{app_metadata,app_role}') = 'owner'",
    "select (auth.jwt() #>> array['app_role']) = 'owner'",
    "select (auth.jwt() #>> array['app_metadata','gym_id'])::uuid",
  ])
    assert.equal(classifySql(body).classification, "claim-only", body);
  assert.equal(classifySql("select auth.jwt() #>> '{sub}'"), null);
});

test("enforcing (default): any non-exempt claim-only fails even when the baseline lists it", () => {
  const r = run("baseline-ok.json", "exempt-ok.json", []);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /enforcing|baseline must be empty/);
});

test("enforcing: a clean inventory with an empty baseline exits 0, a new claim-only source fails on its own", () => {
  const root = join(here, "fixtures", "claims", `.enforce-${process.pid}`);
  const empty = join(root, "empty-rows.json");
  const baseline = join(root, "baseline.json");
  try {
    mkdirSync(join(root, "lib"), { recursive: true });
    writeFileSync(empty, JSON.stringify([{ kind: "function", name: "public.ok()", text: "select private.current_member_role()" }]));
    writeFileSync(baseline, JSON.stringify({ entries: [], nullUnsafe: [] }));
    writeFileSync(join(root, "lib", "ok.ts"), "export const x = 1;\n");
    const args = (src) => [script, "--rows", empty, "--sources", src, "--baseline", baseline, "--exempt", fx("exempt-ok.json")];
    const ok = spawnSync(process.execPath, args(root), { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    writeFileSync(join(root, "lib", "bad.ts"), "const r = data.claims.app_role;\n");
    const bad = spawnSync(process.execPath, args(root), { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /claim-only server .*bad\.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("enforcing: an exempt source is not a failure; enforce() lists claim-only and null-unsafe", () => {
  const inv = buildInventory(
    [{ kind: "server", name: "apps/x/lib/a.ts", text: "const r = c.claims.app_role;" }],
    [{ kind: "server", name: "apps/x/lib/a.ts", reason: "issuer" }],
  );
  assert.deepEqual(enforce(inv, {}).failures, []);
  const inv2 = buildInventory([{ kind: "server", name: "apps/x/lib/a.ts", text: "const r = c.claims.app_role;" }], []);
  assert.equal(enforce(inv2, {}).failures.length, 1);
});
