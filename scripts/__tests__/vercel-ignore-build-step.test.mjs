// The Vercel "ignore build step" (epic 19 retro item 35, the Hobby plan's daily build cap): each deployed app skips its build when
// nothing it depends on changed. These checks keep the three configs identical and tied to the repo's Turborepo version, and
// keep the force-build switch and the dashboard's cron in place. See docs/deploy-runbook.md, "Vercel builds are skipped".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const APPS = ["dashboard", "super-admin", "landing"]; // the three Vercel projects (apps/mobile ships through EAS)
const turboRange = read("package.json").devDependencies.turbo; // e.g. ^2.10.3
const turboVersion = turboRange.replace(/^[^0-9]*/, "");

test("every deployed app has the same ignoreCommand", () => {
  const cmds = APPS.map((a) => read(`apps/${a}/vercel.json`).ignoreCommand);
  assert.ok(cmds.every(Boolean), "an app has no ignoreCommand");
  assert.equal(new Set(cmds).size, 1, `the three ignoreCommands differ: ${JSON.stringify(cmds)}`);
});

test("the command uses turbo-ignore pinned to the repo's Turborepo version", () => {
  const cmd = read("apps/super-admin/vercel.json").ignoreCommand;
  assert.match(cmd, new RegExp(`npx turbo-ignore@${turboVersion.replaceAll(".", "\\.")}(\\s|$)`), `expected turbo-ignore@${turboVersion} in: ${cmd}`);
});

test("a first push compares against master (not just the previous commit)", () => {
  assert.match(read("apps/super-admin/vercel.json").ignoreCommand, /--fallback=origin\/master/);
});

test("VERCEL_FORCE_BUILD=1 forces a build (exit 1) before turbo-ignore is consulted", () => {
  const cmd = read("apps/super-admin/vercel.json").ignoreCommand;
  assert.ok(cmd.indexOf("VERCEL_FORCE_BUILD") >= 0 && cmd.indexOf("VERCEL_FORCE_BUILD") < cmd.indexOf("turbo-ignore"));
  assert.match(cmd, /\[ "\$VERCEL_FORCE_BUILD" = "1" \] && exit 1/);
});

test("the dashboard keeps its cron job", () => {
  const crons = read("apps/dashboard/vercel.json").crons;
  assert.ok(Array.isArray(crons) && crons.some((c) => c.path === "/api/cron/saas-billing-reminders"));
});
