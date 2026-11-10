import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanFiles, scanRepo, stripComments } from "../check-host-neutral-env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "..", "check-host-neutral-env.mjs");
const f = (path, text) => ({ path, text });

test("the real tree passes: no read outside lib/app-env.ts (24.2)", () => {
  assert.deepEqual(scanRepo(join(here, "..", "..")), []);
});

test("a stray read names file:line", () => {
  const bad = scanFiles([f("apps/dashboard/lib/x.ts", "const a = 1;\nconst e = process.env.VERCEL_ENV;\n")]);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /^apps\/dashboard\/lib\/x\.ts:2: reads VERCEL_ENV/);
});

test("VERCEL_GIT_COMMIT_SHA is caught too, including in next.config.ts", () => {
  assert.equal(scanFiles([f("apps/super-admin/next.config.ts", "env: { A: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' }")]).length, 1);
});

test("bracket access and destructuring are caught", () => {
  assert.equal(scanFiles([f("apps/a/x.ts", 'const v = process.env["VERCEL_ENV"];')]).length, 1);
  assert.equal(scanFiles([f("apps/a/x.ts", "const { VERCEL_ENV } = process.env;")]).length, 1);
});

test("only apps/<app>/lib/app-env.ts is allowed; a stray lib/app-env.ts elsewhere is flagged", () => {
  assert.deepEqual(scanFiles([f("apps/dashboard/lib/app-env.ts", "process.env.VERCEL_ENV")]), []);
  assert.equal(scanFiles([f("apps/dashboard/components/lib/app-env.ts", "process.env.VERCEL_ENV")]).length, 1);
  assert.equal(scanFiles([f("packages/types/lib/app-env.ts", "process.env.VERCEL_ENV")]).length, 1);
  assert.equal(scanFiles([f("apps/dashboard/lib/app-env.ts.bak.ts", "process.env.VERCEL_ENV")]).length, 1);
});

test("whole-line comments and block comments are skipped; trailing mentions are flagged", () => {
  assert.deepEqual(scanFiles([f("apps/a/x.ts", "// VERCEL_ENV\n/* VERCEL_GIT_COMMIT_SHA\n * VERCEL_ENV\n again */\nconst u = 1;")]), []);
  assert.deepEqual(scanFiles([f("apps/a/x.ts", "/** VERCEL_ENV one-liner */\nconst u = 1;")]), []);
  assert.equal(scanFiles([f("apps/a/x.ts", "const e = process.env.VERCEL_ENV; // trailing")]).length, 1);
  assert.equal(scanFiles([f("apps/a/x.ts", "/* c */ const e = process.env.VERCEL_ENV;")]).length, 1);
  assert.equal(stripComments("a\n/* x\ny */\nb").split("\n").length, 4, "line count is preserved");
});

test("fails closed: a regex literal containing // or a quote before a stray read does not hide it", () => {
  assert.equal(scanFiles([f("apps/a/x.ts", "const re = /https?:\\/\\//; const e = process.env.VERCEL_ENV;")]).length, 1);
  assert.equal(scanFiles([f("apps/a/x.ts", "const q = /'/;\nconst e = process.env.VERCEL_ENV;\nconst r = /'/;")]).length, 1);
  assert.equal(scanFiles([f("apps/a/x.ts", "const re = /\\/*/;\nconst e = process.env.VERCEL_ENV;")]).length, 1);
});

test("tests are excluded; VERCEL_URL and similar are out of scope", () => {
  assert.deepEqual(scanFiles([f("apps/a/lib/x.test.ts", "process.env.VERCEL_ENV"), f("apps/a/__tests__/y.ts", "process.env.VERCEL_ENV")]), []);
  assert.deepEqual(scanFiles([f("apps/a/x.ts", "process.env.VERCEL_URL; process.env.NEXT_PUBLIC_VERCEL_ENV; process.env.VERCEL_FORCE_BUILD")]), []);
});

test("node_modules and .next are not scanned from disk", () => {
  const root = mkdtempSync(join(tmpdir(), "hne-"));
  for (const d of ["apps/a/node_modules/p", "apps/a/.next", "apps/a/lib"]) mkdirSync(join(root, d), { recursive: true });
  for (const d of ["apps/a/node_modules/p", "apps/a/.next"]) writeFileSync(join(root, d, "x.ts"), "process.env.VERCEL_ENV");
  assert.deepEqual(scanRepo(root), []);
  writeFileSync(join(root, "apps/a/lib/x.ts"), "process.env.VERCEL_ENV");
  assert.equal(scanRepo(root).length, 1);
});

test("the real CLI exits 1 on a stray read and 0 on a clean tree", () => {
  const root = mkdtempSync(join(tmpdir(), "hne-cli-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "apps/a/lib"), { recursive: true });
  copyFileSync(SCRIPT, join(root, "scripts/check-host-neutral-env.mjs"));
  const run = () => spawnSync(process.execPath, [join(root, "scripts/check-host-neutral-env.mjs")], { encoding: "utf8" });
  writeFileSync(join(root, "apps/a/lib/app-env.ts"), "export const e = process.env.VERCEL_ENV;");
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  writeFileSync(join(root, "apps/a/lib/stray.ts"), "export const e = process.env.VERCEL_ENV;");
  const bad = run();
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /apps\/a\/lib\/stray\.ts:1/);
});
