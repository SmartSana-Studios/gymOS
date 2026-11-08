import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanEnvFile, scanLanding, scanPackageJson, scanVercelJson } from "../check-landing-no-supabase.mjs";

const script = fileURLToPath(new URL("../check-landing-no-supabase.mjs", import.meta.url));

test("the real apps/landing passes (24.4)", () => {
  assert.deepEqual(scanLanding(), []);
});

test("@supabase/* and supabase-js in any dependency map are caught, naming file and match", () => {
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const bad = scanPackageJson("p.json", JSON.stringify({ [key]: { "@supabase/ssr": "^1", next: "1" } }));
    assert.equal(bad.length, 1, key);
    assert.match(bad[0], /p\.json.*banned.*@supabase\/ssr/);
  }
  assert.equal(scanPackageJson("p.json", JSON.stringify({ dependencies: { "supabase-js": "1" } })).length, 1);
  assert.equal(scanPackageJson("p.json", JSON.stringify({ pnpm: { overrides: { "@supabase/x": "1" } } })).length, 1);
  assert.deepEqual(scanPackageJson("p.json", JSON.stringify({ dependencies: { next: "1" } })), []);
});

test("anon key, service-role key, JWT secret and Supabase env names are caught in .env files", () => {
  const text = "# SUPABASE_URL=in a comment is fine\nNEXT_PUBLIC_SITE_URL=x\nNEXT_PUBLIC_SUPABASE_ANON_KEY=\nexport SERVICE_ROLE_KEY=1\nJWT_SECRET=\nSUPABASE_URL=\n";
  const bad = scanEnvFile(".env.example", text);
  assert.equal(bad.length, 4);
  assert.match(bad[0], /\.env\.example.*NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.deepEqual(scanEnvFile(".env.example", "PUBLIC_SITE_READER_HOST=\nPUBLIC_SITE_READER_PASSWORD=\n"), []);
});

test("vercel.json env blocks are scanned", () => {
  assert.equal(scanVercelJson("vercel.json", JSON.stringify({ env: { SUPABASE_SERVICE_ROLE_KEY: "@x" }, build: { env: { SUPABASE_JWT_SECRET: "y" } } })).length, 2);
  assert.deepEqual(scanVercelJson("vercel.json", JSON.stringify({ ignoreCommand: "exit 0" })), []);
});

test("the CLI exits 1 on a known-bad manifest and 0 on a clean one", () => {
  const bad = mkdtempSync(join(tmpdir(), "landing-bad-"));
  writeFileSync(join(bad, "package.json"), JSON.stringify({ dependencies: { "@supabase/supabase-js": "2" } }));
  writeFileSync(join(bad, ".env.example"), "SUPABASE_ANON_KEY=\n");
  const r = spawnSync(process.execPath, [script, bad], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /@supabase\/supabase-js/);
  assert.match(r.stderr, /SUPABASE_ANON_KEY/);
  const ok = mkdtempSync(join(tmpdir(), "landing-ok-"));
  writeFileSync(join(ok, "package.json"), JSON.stringify({ dependencies: { next: "1" } }));
  assert.equal(spawnSync(process.execPath, [script, ok], { encoding: "utf8" }).status, 0);
});

test("the supabase CLI and the *-js sub-libraries are caught, including override selectors", () => {
  for (const name of ["supabase", "@supabase/postgrest-js", "postgrest-js", "gotrue-js", "realtime-js", "storage-js"]) {
    assert.equal(scanPackageJson("p.json", JSON.stringify({ devDependencies: { [name]: "1" } })).length, 1, name);
  }
  assert.equal(scanPackageJson("p.json", JSON.stringify({ pnpm: { overrides: { "parent>@supabase/ssr": "1" } } })).length, 1);
  assert.equal(scanPackageJson("p.json", JSON.stringify({ pnpm: { overrides: { "parent>supabase@2": "1" } } })).length, 1);
  assert.deepEqual(scanPackageJson("p.json", JSON.stringify({ dependencies: { supabased: "1", "next-storage-js-x": "1" } })), []);
});

test("a Supabase URL or JWT under a neutral env name is caught by value", () => {
  assert.equal(scanEnvFile(".env", "DB_HOST_URL=https://abc.supabase.co\n").length, 1);
  assert.equal(scanEnvFile(".env", "TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig\n").length, 1);
  assert.deepEqual(scanEnvFile(".env", "NEXT_PUBLIC_SITE_URL=https://gymosapps.com\n"), []);
});

test("a directory named .env* is skipped and an unreadable manifest is a violation, not a stack trace", () => {
  const dir = mkdtempSync(join(tmpdir(), "landing-odd-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "1" } }));
  mkdirSync(join(dir, ".env.d"));
  assert.deepEqual(scanLanding(dir, "x"), []);
  const broken = mkdtempSync(join(tmpdir(), "landing-broken-"));
  mkdirSync(join(broken, "package.json"));
  const out = scanLanding(broken, "x");
  assert.equal(out.length, 0, "a package.json that is a directory is skipped as a non-file");
  const link = join(broken, ".env.link");
  symlinkSync(join(broken, "nowhere"), link);
  const dangling = scanLanding(broken, "x");
  assert.equal(dangling.length, 1);
  assert.match(dangling[0], /\.env\.link: cannot be read/);
});

test("the CLI still runs when started through a symlink", () => {
  const ok = mkdtempSync(join(tmpdir(), "landing-sym-"));
  writeFileSync(join(ok, "package.json"), JSON.stringify({ dependencies: { "@supabase/ssr": "1" } }));
  const link = join(mkdtempSync(join(tmpdir(), "landing-link-")), "check.mjs");
  symlinkSync(script, link);
  assert.equal(spawnSync(process.execPath, [link, ok], { encoding: "utf8" }).status, 1);
});
